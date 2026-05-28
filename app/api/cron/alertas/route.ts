// app/api/cron/alertas/route.ts
// Cron job: busca licitaciones nuevas para cada usuario según sus palabras clave.
// Llamado por cron-job.org cada 4 horas (o Vercel Cron diario).
// Protección: Authorization: Bearer <CRON_SECRET>  o  x-vercel-cron: 1
//
// ESTRATEGIA (two-pass):
//   1. obtenerActivasHoy() + obtenerUltimosDias(15) EN PARALELO → pool batch (solo nombres)
//   2. Enriquecer las N más recientes con descripción completa via obtenerPorCodigoRapido
//   3. Filtrar por keyword en Nombre + Descripcion + Items (texto completo)
//   4. INSERT IGNORE por lotes → acumula sin borrar resultados anteriores

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getMercadoPublicoClient } from '@/app/lib/mercado-publico';
import type { Licitacion } from '@/app/types/mercado-publico.types';

const CRON_SECRET        = process.env.CRON_SECRET || '';
const DIAS_RECIENTES     = 15;
const KW_CONCURRENCY     = 4;   // keywords procesadas en paralelo
const INSERT_BATCH       = 200; // filas por INSERT IGNORE
const ENRICH_CAP         = 400; // máx licitaciones a enriquecer con descripción
const ENRICH_CONCURRENCY = 10;  // llamadas paralelas a obtenerPorCodigoRapido
const ENRICH_TIMEOUT_MS  = 8_000; // timeout por llamada individual
const TIEMPO_LIMITE_MS   = 50_000; // si tomamos más de 50s en total, paramos

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

// ── Helper: texto completo para búsqueda ──────────────────────────────────────
function textoCompleto(lic: Licitacion): string {
  const items = (lic.Items || [])
    .map(it => `${it.NombreProducto || ''} ${it.Descripcion || ''} ${it.Categoria || ''}`)
    .join(' ');
  return `${lic.Nombre} ${lic.Descripcion || ''} ${items}`.toLowerCase();
}

// ── Helper: INSERT IGNORE por lote ────────────────────────────────────────────
type KwRow = { id: number; usuario_id: number; keyword: string };

async function batchInsertAlertas(
  kw: KwRow,
  coincidencias: Licitacion[],
): Promise<number> {
  if (coincidencias.length === 0) return 0;

  let total = 0;

  for (let start = 0; start < coincidencias.length; start += INSERT_BATCH) {
    const chunk = coincidencias.slice(start, start + INSERT_BATCH);

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
      if (String(e).toLowerCase().includes('unknown column')) {
        try {
          const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(',');
          const values: unknown[] = [];
          for (const lic of chunk) {
            values.push(
              kw.usuario_id, kw.id, kw.keyword, lic.Codigo,
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
    licitacionesActivas:    0,
    licitacionesRecientes:  0,
    licitacionesTotales:    0,
    enriquecidas:           0,   // con descripción completa obtenida
    enriquecimientoOmitido: false,
    keywordsProcesadas:     0,
    alertasNuevas:          0,
    errores:                0,
    duracionMs:             0,
  };

  const startTime = Date.now();
  const elapsed   = () => Date.now() - startTime;

  try {
    const client = getMercadoPublicoClient();

    // ── Paso 1: Descarga batch en paralelo ────────────────────────────────────
    console.log('[Cron] 🔍 Descargando licitaciones activas + últimos días (paralelo)...');
    const [licitacionesActivas, licitacionesRecientes] = await Promise.all([
      client.obtenerActivasHoy(),
      client.obtenerUltimosDias(DIAS_RECIENTES),
    ]);

    stats.licitacionesActivas   = licitacionesActivas.length;
    stats.licitacionesRecientes = licitacionesRecientes.length;
    console.log(
      `[Cron] ✅ ${licitacionesActivas.length} activas + ` +
      `${licitacionesRecientes.length} de últimos ${DIAS_RECIENTES} días — ${elapsed()}ms`,
    );

    // Deduplicar
    const mapa = new Map<string, Licitacion>();
    for (const lic of [...licitacionesActivas, ...licitacionesRecientes]) {
      if (!mapa.has(lic.Codigo)) mapa.set(lic.Codigo, lic);
    }
    const licitaciones = Array.from(mapa.values());
    stats.licitacionesTotales   = licitaciones.length;
    console.log(`[Cron] 🗂️  Total único: ${licitaciones.length} — ${elapsed()}ms`);

    if (licitaciones.length === 0) {
      console.warn('[Cron] ⚠️ La API no devolvió licitaciones');
      stats.duracionMs = elapsed();
      return NextResponse.json({ success: false, error: 'Sin licitaciones', ...stats }, { status: 503 });
    }

    // ── Paso 2: Enriquecer con descripciones (two-pass) ───────────────────────
    // Tomamos las N más recientes y las enriquecemos con obtenerPorCodigoRapido.
    // Si el tiempo ya supera el límite, lo omitimos y usamos solo nombres.
    const enrichedMap = new Map<string, Licitacion>(
      licitaciones.map(l => [l.Codigo, l])
    );

    if (elapsed() < TIEMPO_LIMITE_MS) {
      // Ordenar por fecha de publicación (más recientes primero) para máxima relevancia
      const toEnrich = [...licitaciones]
        .sort((a, b) => {
          const ta = a.FechaPublicacion ? new Date(a.FechaPublicacion).getTime() : 0;
          const tb = b.FechaPublicacion ? new Date(b.FechaPublicacion).getTime() : 0;
          return tb - ta;
        })
        .slice(0, ENRICH_CAP);

      console.log(
        `[Cron] 🔎 Enriqueciendo ${toEnrich.length} licitaciones con descripción completa ` +
        `(concurrencia ${ENRICH_CONCURRENCY}, timeout ${ENRICH_TIMEOUT_MS / 1000}s/llamada)...`,
      );

      await withConcurrency(toEnrich, ENRICH_CONCURRENCY, async (lic) => {
        const full = await client.obtenerPorCodigoRapido(lic.Codigo, ENRICH_TIMEOUT_MS);
        if (full) enrichedMap.set(lic.Codigo, full);
      });

      stats.enriquecidas = [...enrichedMap.values()]
        .filter(l => (l.Descripcion || '').trim().length > 0).length;

      console.log(
        `[Cron] ✅ ${stats.enriquecidas} con descripción obtenida — ${elapsed()}ms`,
      );
    } else {
      stats.enriquecimientoOmitido = true;
      console.warn(`[Cron] ⏭ Enriquecimiento omitido — ya transcurrieron ${elapsed()}ms`);
    }

    // Listado final (enriquecido donde fue posible, batch donde no)
    const licitacionesFinales = Array.from(enrichedMap.values());

    // ── Paso 3: Cargar keywords ───────────────────────────────────────────────
    const [rows] = await pool.query(
      `SELECT pk.id, pk.usuario_id, pk.keyword
       FROM palabras_clave pk
       JOIN usuarios u ON u.id = pk.usuario_id AND u.activo = TRUE
       WHERE pk.activo = TRUE
       ORDER BY ISNULL(pk.ultima_busqueda) DESC, pk.ultima_busqueda ASC, pk.id ASC`,
    );
    const kws = rows as KwRow[];
    console.log(`[Cron] 📋 ${kws.length} keywords — concurrencia ${KW_CONCURRENCY}`);

    // ── Paso 4: Procesar keywords en paralelo ─────────────────────────────────
    const alertasMap = new Map<number, number>();

    await withConcurrency(kws, KW_CONCURRENCY, async (kw) => {
      try {
        const termino = kw.keyword.toLowerCase().trim();

        // Busca en Nombre + Descripcion + Items (texto completo)
        const coincidencias = licitacionesFinales.filter(lic =>
          textoCompleto(lic).includes(termino)
        );

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

        console.log(
          `[Cron] "${kw.keyword}" → ${coincidencias.length} coincidencias` +
          (insertadas > 0 ? `, ${insertadas} nuevas 🆕` : ' (ya conocidas)'),
        );
      } catch (err) {
        console.error(`[Cron] ❌ Error procesando "${kw.keyword}":`, err);
        stats.errores++;
      }
    });

    stats.keywordsProcesadas = kws.length;
    for (const v of alertasMap.values()) stats.alertasNuevas += v;

    stats.duracionMs = elapsed();
    console.log(`[Cron] ✅ Completado en ${stats.duracionMs}ms —`, stats);

    return NextResponse.json({ success: true, ...stats });

  } catch (error) {
    stats.duracionMs = elapsed();
    console.error('[Cron] ❌ Error general:', error);
    return NextResponse.json({ success: false, error: String(error), ...stats }, { status: 500 });
  }
}
