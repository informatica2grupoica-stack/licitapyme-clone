// app/api/cron/alertas/route.ts
// Cron job: busca licitaciones nuevas para cada usuario según sus palabras clave.
// Llamado por cron-job.org cada 4 horas (o Vercel Cron diario).
// Protección: Authorization: Bearer <CRON_SECRET>  o  x-vercel-cron: 1

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';

const CRON_SECRET      = process.env.CRON_SECRET            || '';
const MERCADO_PUBLICO_TICKET    = process.env.MERCADO_PUBLICO_TICKET  || '';
const BATCH_CONCURRENCY = 8;      // keywords en paralelo
const API_TIMEOUT_MS   = 8_000;   // timeout por keyword (8s)
const WALL_CLOCK_MS    = 52_000;  // límite total (52s < 60s de Vercel)

interface MPLicitacion {
  CodigoLicitacion: string;
  Nombre:           string;
  NombreOrganismo:  string;
  MontoEstimado:    number;
  FechaCierre:      string;
  Estado:           string;
  Region:           string;
  Tipo:             string;
}

async function buscarEnMP(keyword: string): Promise<MPLicitacion[]> {
  if (!MERCADO_PUBLICO_TICKET) {
    console.warn('[Cron] ⚠️  MERCADO_PUBLICO_TICKET no configurado en variables de entorno. Configúralo en Vercel.');
    return [];
  }
  try {
    const url = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json` +
                `?buscar=${encodeURIComponent(keyword)}&ticket=${MERCADO_PUBLICO_TICKET}&estado=publicada&cantidad=20`;

    console.log(`[Cron] 🔍 Buscando: "${keyword}"`);
    const res = await fetch(url, { signal: AbortSignal.timeout(API_TIMEOUT_MS) });

    if (!res.ok) {
      console.warn(`[Cron] ⚠️  MP API status ${res.status} para "${keyword}"`);
      return [];
    }
    const data = await res.json();
    const lista = (data.Listado || []) as MPLicitacion[];
    console.log(`[Cron] ✅ "${keyword}" → ${lista.length} resultados`);
    return lista;
  } catch (err) {
    console.warn(`[Cron] ⚠️  Error buscando "${keyword}":`, String(err));
    return [];
  }
}

async function procesarKeyword(
  kw: { id: number; usuario_id: number; keyword: string },
  stats: { nuevas: number; errores: number }
): Promise<void> {
  try {
    const licitaciones = await buscarEnMP(kw.keyword);
    let insertadas = 0;

    for (const lic of licitaciones) {
      try {
        const [r] = await pool.query(
          `INSERT IGNORE INTO alertas_licitaciones
             (usuario_id, palabra_clave_id, keyword_texto, licitacion_codigo,
              licitacion_nombre, licitacion_organismo, licitacion_monto,
              licitacion_cierre, licitacion_estado, licitacion_region)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            kw.usuario_id,
            kw.id,
            kw.keyword,
            lic.CodigoLicitacion,
            lic.Nombre?.substring(0, 500)         ?? null,
            lic.NombreOrganismo?.substring(0, 500) ?? null,
            lic.MontoEstimado  || null,
            lic.FechaCierre    ? new Date(lic.FechaCierre) : null,
            lic.Estado         || null,
            lic.Region         || null,
          ]
        ) as any[];
        if (r.affectedRows > 0) insertadas++;
      } catch (insertErr) {
        // INSERT IGNORE silencia duplicados; otros errores los logueamos
        console.warn(`[Cron] INSERT error para ${lic.CodigoLicitacion}:`, String(insertErr));
      }
    }

    // Actualizar stats de la keyword
    await pool.query(
      `UPDATE palabras_clave
       SET ultima_busqueda    = NOW(),
           resultados_nuevos  = resultados_nuevos + ?,
           total_encontradas  = total_encontradas + ?
       WHERE id = ?`,
      [insertadas, licitaciones.length, kw.id]
    );

    stats.nuevas += insertadas;
    console.log(`[Cron] 📌 "${kw.keyword}" → ${insertadas} insertadas`);
  } catch (err) {
    console.error(`[Cron] ❌ Error en keyword "${kw.keyword}":`, err);
    stats.errores++;
  }
}

export async function GET(request: NextRequest) {
  // ── Autorización ────────────────────────────────────────────────────────────
  const authHeader  = request.headers.get('authorization');
  const isCronCall  = request.headers.get('x-vercel-cron') === '1';
  const isManual    = CRON_SECRET !== '' && authHeader === `Bearer ${CRON_SECRET}`;

  if (!isCronCall && !isManual) {
    console.warn('[Cron] ⛔ Llamada no autorizada');
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  console.log(`[Cron] 🚀 Iniciando búsqueda — ${new Date().toISOString()}`);

  if (!MERCADO_PUBLICO_TICKET) {
    console.error('[Cron] ❌ MERCADO_PUBLICO_TICKET no configurado. Agrega la variable en Vercel → Settings → Environment Variables.');
    return NextResponse.json({
      success:  false,
      error:    'MERCADO_PUBLICO_TICKET no configurado en Vercel. Ve a Settings → Environment Variables y agrégala.',
      keywords: 0,
      nuevas:   0,
    }, { status: 503 });
  }

  const stats = {
    keywordsProcesadas: 0,
    keywordsOmitidas:   0,
    alertasNuevas:      0,
    errores:            0,
    duracionMs:         0,
  };

  const startTime = Date.now();

  try {
    // ── Cargar todas las keywords activas ──────────────────────────────────
    const [rows] = await pool.query(
      `SELECT pk.id, pk.usuario_id, pk.keyword
       FROM palabras_clave pk
       JOIN usuarios u ON u.id = pk.usuario_id AND u.activo = TRUE
       WHERE pk.activo = TRUE
       ORDER BY pk.usuario_id, pk.ultima_busqueda ASC`
      // ASC: procesa primero las que llevan más tiempo sin buscarse
    );

    const kws = rows as Array<{ id: number; usuario_id: number; keyword: string }>;
    console.log(`[Cron] 📋 ${kws.length} keywords activas para procesar`);

    // ── Procesar en batches paralelos ──────────────────────────────────────
    for (let i = 0; i < kws.length; i += BATCH_CONCURRENCY) {
      // Parar si nos acercamos al límite de tiempo
      if (Date.now() - startTime > WALL_CLOCK_MS) {
        const omitidas = kws.length - i;
        stats.keywordsOmitidas = omitidas;
        console.warn(`[Cron] ⏱ Límite de tiempo alcanzado. Omitiendo ${omitidas} keywords restantes.`);
        break;
      }

      const batch = kws.slice(i, i + BATCH_CONCURRENCY);
      const batchStats = { nuevas: 0, errores: 0 };

      await Promise.all(batch.map(kw => procesarKeyword(kw, batchStats)));

      stats.keywordsProcesadas += batch.length;
      stats.alertasNuevas      += batchStats.nuevas;
      stats.errores            += batchStats.errores;

      console.log(`[Cron] Batch ${Math.floor(i / BATCH_CONCURRENCY) + 1}/${Math.ceil(kws.length / BATCH_CONCURRENCY)} completado`);
    }

    stats.duracionMs = Date.now() - startTime;
    console.log(`[Cron] ✅ Completado en ${stats.duracionMs}ms —`, stats);

    return NextResponse.json({ success: true, ...stats });
  } catch (error) {
    stats.duracionMs = Date.now() - startTime;
    console.error('[Cron] ❌ Error general:', error);
    return NextResponse.json({ success: false, error: String(error), ...stats }, { status: 500 });
  }
}
