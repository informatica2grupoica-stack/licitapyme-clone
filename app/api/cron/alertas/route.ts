// app/api/cron/alertas/route.ts
// Cron job: busca licitaciones nuevas para cada usuario según sus palabras clave.
// Llamado por cron-job.org cada 4 horas (o Vercel Cron diario).
// Protección: Authorization: Bearer <CRON_SECRET>  o  x-vercel-cron: 1
//
// NOTA: La API de MP limita las peticiones. Procesamos de forma secuencial
//       con 600ms entre cada keyword para evitar HTTP 429.

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';

const CRON_SECRET   = process.env.CRON_SECRET            || '';
const MP_TICKET     = process.env.MERCADO_PUBLICO_TICKET  || '';
const DELAY_MS      = 600;     // ms entre keywords (evita 429)
const RETRY_WAIT_MS = 3_000;   // ms de espera al recibir 429 antes de reintentar
const API_TIMEOUT   = 10_000;  // timeout por request (10s)
const WALL_CLOCK_MS = 50_000;  // límite total de la función (50s < 60s Vercel)

interface MPLicitacion {
  CodigoLicitacion: string;
  Nombre:           string;
  NombreOrganismo:  string;
  MontoEstimado:    number;
  FechaCierre:      string;
  Estado:           string;
  Region:           string;
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// Busca en la API de MP con reintentos automáticos en 429
async function buscarEnMP(keyword: string, intento = 1): Promise<MPLicitacion[]> {
  if (!MP_TICKET) return [];
  try {
    const url =
      `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json` +
      `?buscar=${encodeURIComponent(keyword)}&ticket=${MP_TICKET}&estado=publicada&cantidad=20`;

    const res = await fetch(url, { signal: AbortSignal.timeout(API_TIMEOUT) });

    // Rate limit → esperar y reintentar una vez
    if (res.status === 429 && intento < 3) {
      const espera = RETRY_WAIT_MS * intento;
      console.warn(`[Cron] ⏱ 429 en "${keyword}" (intento ${intento}), esperando ${espera}ms...`);
      await sleep(espera);
      return buscarEnMP(keyword, intento + 1);
    }

    if (!res.ok) {
      // Leer body para entender el error
      let body = '';
      try { body = await res.text(); } catch { /* noop */ }
      const snippet = body.replace(/\s+/g, ' ').substring(0, 120);
      console.warn(`[Cron] ⚠️  HTTP ${res.status} para "${keyword}" → ${snippet || '(sin cuerpo)'}`);
      return [];
    }

    const data = await res.json();
    const lista = (data?.Listado || []) as MPLicitacion[];
    console.log(`[Cron] ✅ "${keyword}" → ${lista.length} resultados`);
    return lista;
  } catch (err) {
    console.warn(`[Cron] ⚠️  Error de red en "${keyword}": ${String(err)}`);
    return [];
  }
}

export async function GET(request: NextRequest) {
  // ── Autorización ──────────────────────────────────────────────────────────
  const authHeader = request.headers.get('authorization');
  const isCron     = request.headers.get('x-vercel-cron') === '1';
  const isManual   = CRON_SECRET !== '' && authHeader === `Bearer ${CRON_SECRET}`;

  if (!isCron && !isManual) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  if (!MP_TICKET) {
    console.error('[Cron] ❌ MERCADO_PUBLICO_TICKET no configurado en Vercel.');
    return NextResponse.json({
      success: false,
      error:   'MERCADO_PUBLICO_TICKET no configurado. Ve a Vercel → Settings → Environment Variables.',
    }, { status: 503 });
  }

  console.log(`[Cron] 🚀 Iniciando — ${new Date().toISOString()}`);

  const stats = {
    keywordsProcesadas: 0,
    keywordsOmitidas:   0,
    alertasNuevas:      0,
    errores:            0,
    duracionMs:         0,
  };

  const startTime = Date.now();

  try {
    // Cargar todas las keywords activas ordenadas por última búsqueda (más antigua primero)
    const [rows] = await pool.query(
      `SELECT pk.id, pk.usuario_id, pk.keyword
       FROM palabras_clave pk
       JOIN usuarios u ON u.id = pk.usuario_id AND u.activo = TRUE
       WHERE pk.activo = TRUE
       ORDER BY ISNULL(pk.ultima_busqueda) DESC, pk.ultima_busqueda ASC, pk.id ASC`
    );

    const kws = rows as Array<{ id: number; usuario_id: number; keyword: string }>;
    console.log(`[Cron] 📋 ${kws.length} keywords activas`);

    // ── Procesamiento SECUENCIAL con delay ────────────────────────────────
    for (let i = 0; i < kws.length; i++) {
      // Parar si nos acercamos al límite de tiempo
      const elapsed = Date.now() - startTime;
      if (elapsed > WALL_CLOCK_MS) {
        stats.keywordsOmitidas = kws.length - i;
        console.warn(`[Cron] ⏱ Tiempo límite (${elapsed}ms). Omitiendo ${stats.keywordsOmitidas} keywords.`);
        break;
      }

      // Esperar entre keywords para no saturar la API de MP
      if (i > 0) await sleep(DELAY_MS);

      const kw = kws[i];
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
                kw.usuario_id, kw.id, kw.keyword,
                lic.CodigoLicitacion,
                lic.Nombre?.substring(0, 500)          ?? null,
                lic.NombreOrganismo?.substring(0, 500)  ?? null,
                lic.MontoEstimado  || null,
                lic.FechaCierre    ? new Date(lic.FechaCierre) : null,
                lic.Estado         || null,
                lic.Region         || null,
              ]
            ) as any[];
            if (r.affectedRows > 0) insertadas++;
          } catch { /* INSERT IGNORE = duplicado, ignorar */ }
        }

        await pool.query(
          `UPDATE palabras_clave
           SET ultima_busqueda   = NOW(),
               resultados_nuevos = resultados_nuevos + ?,
               total_encontradas = total_encontradas + ?
           WHERE id = ?`,
          [insertadas, licitaciones.length, kw.id]
        );

        stats.alertasNuevas      += insertadas;
        stats.keywordsProcesadas += 1;

        if (insertadas > 0) {
          console.log(`[Cron] 🆕 "${kw.keyword}" → ${insertadas} licitaciones nuevas`);
        }
      } catch (err) {
        console.error(`[Cron] ❌ Error procesando "${kw.keyword}":`, err);
        stats.errores++;
        stats.keywordsProcesadas++;
      }
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
