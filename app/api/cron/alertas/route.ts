// app/api/cron/alertas/route.ts
// Cron job: busca licitaciones nuevas para cada usuario según sus palabras clave.
// Llamado por cron-job.org cada 4 horas (o Vercel Cron diario).
// Protección: Authorization: Bearer <CRON_SECRET>  o  x-vercel-cron: 1
//
// ESTRATEGIA:
//   1. obtenerActivasHoy() + obtenerUltimosDias(15) EN PARALELO
//   2. Deduplicar por Código
//   3. Filtrar localmente por keyword en Nombre + Descripción
//   4. INSERT IGNORE por lotes (batch) → acumula sin borrar resultados anteriores

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getMercadoPublicoClient } from '@/app/lib/mercado-publico';
import type { Licitacion } from '@/app/types/mercado-publico.types';

const CRON_SECRET    = process.env.CRON_SECRET || '';
const DIAS_RECIENTES = 15;
const KW_CONCURRENCY = 4;   // keywords procesadas en paralelo
const INSERT_BATCH   = 200; // filas por INSERT IGNORE (evita límite de parámetros MySQL)

// ── Helper: concurrencia limitada ─────────────────────────────────────────────
async function withConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const active = new Set<Promise<void>>();
  for (const item of items) {
    const p: Promise<void> = fn(item).finally(() => active.delete(p));
    active.add(p);
    if (active.size >= limit) await Promise.race(active);
  }
  if (active.size > 0) await Promise.all(active);
}

// ── Helper: INSERT IGNORE por lote ────────────────────────────────────────────
type KwRow = { id: number; usuario_id: number; keyword: string };

async function batchInsertAlertas(
  kw: KwRow,
  coincidencias: Licitacion[],
): Promise<number> {
  if (coincidencias.length === 0) return 0;

  let total = 0;

  // Chunk para no superar el límite de parámetros de MySQL
  for (let start = 0; start < coincidencias.length; start += INSERT_BATCH) {
    const chunk = coincidencias.slice(start, start + INSERT_BATCH);

    // Intentar con licitacion_tipo
    try {
      const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?)').join(',');
      const values: unknown[] = [];
      for (const lic of chunk) {
        values.push(
          kw.usuario_id,
          kw.id,
          kw.keyword,
          lic.Codigo,
          lic.Nombre?.substring(0, 500)    ?? null,
          lic.Organismo?.substring(0, 500) ?? null,
          lic.MontoEstimado                || null,
          lic.FechaCierre ? new Date(lic.FechaCierre) : null,
          lic.EstadoNombre || lic.Estado   || null,
          lic.Region                       || null,
          (lic.Tipo || '').substring(0, 20) || null,
        );
      }
      const [res] = await pool.query(
        `INSERT IGNORE INTO alertas_licitaciones
           (usuario_id, palabra_clave_id, keyword_texto, licitacion_codigo,
            licitacion_nombre, licitacion_organismo, licitacion_monto,
            licitacion_cierre, licitacion_estado, licitacion_region, licitacion_tipo)
         VALUES ${placeholders}`,
        values,
      ) as any[];
      total += (res as any).affectedRows ?? 0;
    } catch (e: any) {
      // Columna licitacion_tipo no existe — fallback sin ella
      if (String(e).toLowerCase().includes('unknown column')) {
        try {
          const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(',');
          const values: unknown[] = [];
          for (const lic of chunk) {
            values.push(
              kw.usuario_id,
              kw.id,
              kw.keyword,
              lic.Codigo,
              lic.Nombre?.substring(0, 500)    ?? null,
              lic.Organismo?.substring(0, 500) ?? null,
              lic.MontoEstimado                || null,
              lic.FechaCierre ? new Date(lic.FechaCierre) : null,
              lic.EstadoNombre || lic.Estado   || null,
              lic.Region                       || null,
            );
          }
          const [res] = await pool.query(
            `INSERT IGNORE INTO alertas_licitaciones
               (usuario_id, palabra_clave_id, keyword_texto, licitacion_codigo,
                licitacion_nombre, licitacion_organismo, licitacion_monto,
                licitacion_cierre, licitacion_estado, licitacion_region)
             VALUES ${placeholders}`,
            values,
          ) as any[];
          total += (res as any).affectedRows ?? 0;
        } catch { /* silencioso */ }
      }
    }
  }

  return total;
}

// ── GET handler ───────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  // Autorización
  const authHeader = request.headers.get('authorization');
  const isCron     = request.headers.get('x-vercel-cron') === '1';
  const isManual   = CRON_SECRET !== '' && authHeader === `Bearer ${CRON_SECRET}`;

  if (!isCron && !isManual) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  if (!process.env.MERCADO_PUBLICO_TICKET) {
    console.error('[Cron] ❌ MERCADO_PUBLICO_TICKET no configurado en Vercel.');
    return NextResponse.json({
      success: false,
      error: 'MERCADO_PUBLICO_TICKET no configurado. Ve a Vercel → Settings → Environment Variables.',
    }, { status: 503 });
  }

  console.log(`[Cron] 🚀 Iniciando — ${new Date().toISOString()}`);

  const stats = {
    licitacionesActivas:   0,
    licitacionesRecientes: 0,
    licitacionesTotales:   0,
    keywordsProcesadas:    0,
    alertasNuevas:         0,
    errores:               0,
    duracionMs:            0,
  };

  const startTime = Date.now();

  try {
    const client = getMercadoPublicoClient();

    // ── Paso 1: Descargar ambas fuentes EN PARALELO ───────────────────────────
    console.log('[Cron] 🔍 Descargando licitaciones activas + últimos días (paralelo)...');
    const [licitacionesActivas, licitacionesRecientes] = await Promise.all([
      client.obtenerActivasHoy(),
      client.obtenerUltimosDias(DIAS_RECIENTES),
    ]);

    stats.licitacionesActivas   = licitacionesActivas.length;
    stats.licitacionesRecientes = licitacionesRecientes.length;
    console.log(
      `[Cron] ✅ ${licitacionesActivas.length} activas + ` +
      `${licitacionesRecientes.length} de últimos ${DIAS_RECIENTES} días`,
    );

    // ── Paso 2: Combinar y deduplicar ─────────────────────────────────────────
    const mapa = new Map<string, Licitacion>();
    for (const lic of [...licitacionesActivas, ...licitacionesRecientes]) {
      if (!mapa.has(lic.Codigo)) mapa.set(lic.Codigo, lic);
    }
    const licitaciones = Array.from(mapa.values());
    stats.licitacionesTotales   = licitaciones.length;
    console.log(`[Cron] 🗂️  Total único: ${licitaciones.length} licitaciones`);

    if (licitaciones.length === 0) {
      console.warn('[Cron] ⚠️ La API no devolvió licitaciones — ¿ticket inválido o sin datos hoy?');
      stats.duracionMs = Date.now() - startTime;
      return NextResponse.json({
        success: false,
        error: 'La API de Mercado Público no devolvió licitaciones',
        ...stats,
      }, { status: 503 });
    }

    // ── Paso 3: Cargar keywords activas ───────────────────────────────────────
    const [rows] = await pool.query(
      `SELECT pk.id, pk.usuario_id, pk.keyword
       FROM palabras_clave pk
       JOIN usuarios u ON u.id = pk.usuario_id AND u.activo = TRUE
       WHERE pk.activo = TRUE
       ORDER BY ISNULL(pk.ultima_busqueda) DESC, pk.ultima_busqueda ASC, pk.id ASC`,
    );
    const kws = rows as KwRow[];
    console.log(`[Cron] 📋 ${kws.length} keywords activas — procesando con concurrencia ${KW_CONCURRENCY}`);

    // ── Paso 4: Procesar keywords en paralelo (lotes) ─────────────────────────
    const alertasMap = new Map<number, number>(); // kwId → insertadas
    const coinciMap  = new Map<number, number>(); // kwId → coincidencias

    await withConcurrency(kws, KW_CONCURRENCY, async (kw) => {
      try {
        const termino     = kw.keyword.toLowerCase().trim();
        const coincidencias = licitaciones.filter(lic => {
          const texto = `${lic.Nombre} ${lic.Descripcion || ''}`.toLowerCase();
          return texto.includes(termino);
        });

        const insertadas = await batchInsertAlertas(kw, coincidencias);

        await pool.query(
          `UPDATE palabras_clave
           SET ultima_busqueda   = NOW(),
               resultados_nuevos = resultados_nuevos + ?,
               total_encontradas = total_encontradas + ?
           WHERE id = ?`,
          [insertadas, coincidencias.length, kw.id],
        );

        alertasMap.set(kw.id, insertadas);
        coinciMap.set(kw.id, coincidencias.length);

        console.log(
          `[Cron] "${kw.keyword}" → ${coincidencias.length} coincidencias` +
          (insertadas > 0 ? `, ${insertadas} nuevas 🆕` : ' (ya conocidas)'),
        );
      } catch (err) {
        console.error(`[Cron] ❌ Error procesando "${kw.keyword}":`, err);
        stats.errores++;
      }
    });

    // Sumar totales después de que todas las promises terminaron
    stats.keywordsProcesadas = kws.length;
    for (const v of alertasMap.values()) stats.alertasNuevas += v;

    stats.duracionMs = Date.now() - startTime;
    console.log(`[Cron] ✅ Completado en ${stats.duracionMs}ms —`, stats);

    return NextResponse.json({ success: true, ...stats });

  } catch (error) {
    stats.duracionMs = Date.now() - startTime;
    console.error('[Cron] ❌ Error general:', error);
    return NextResponse.json({ success: false, error: String(error), ...stats }, { status: 500 });
  }
}
