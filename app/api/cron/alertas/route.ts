// app/api/cron/alertas/route.ts
// Cron job: busca licitaciones nuevas para cada usuario según sus palabras clave.
// Llamado por cron-job.org cada 4 horas (o Vercel Cron diario).
// Protección: Authorization: Bearer <CRON_SECRET>  o  x-vercel-cron: 1
//
// ESTRATEGIA:
//   1. obtenerActivasHoy()     → TODAS las licitaciones con estado=activas (sin límite de fecha)
//   2. obtenerUltimosDias(15)  → últimas 15 publicaciones por fecha (captura recientes no-activas aún)
//   3. Combinar y deduplicar por Código
//   4. Filtrar localmente por keyword en Nombre + Descripción
//   5. INSERT IGNORE → acumula sin borrar resultados anteriores

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getMercadoPublicoClient } from '@/app/lib/mercado-publico';

const CRON_SECRET   = process.env.CRON_SECRET || '';
const DIAS_RECIENTES = 15; // Días de publicaciones recientes (complementa las activas)

export async function GET(request: NextRequest) {
  // ── Autorización ──────────────────────────────────────────────────────────
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
    licitacionesActivas:      0,
    licitacionesRecientes:    0,
    licitacionesTotales:      0,
    keywordsProcesadas:       0,
    alertasNuevas:            0,
    errores:                  0,
    duracionMs:               0,
  };

  const startTime = Date.now();

  try {
    const client = getMercadoPublicoClient();

    // ── Paso 1a: Obtener TODAS las licitaciones activas (sin límite de fecha) ──
    // Esto captura licitaciones publicadas hace 30+ días que aún están abiertas.
    console.log('[Cron] 🔍 Descargando licitaciones activas (estado=activas)...');
    let licitacionesActivas = await client.obtenerActivasHoy();
    stats.licitacionesActivas = licitacionesActivas.length;
    console.log(`[Cron] ✅ ${licitacionesActivas.length} licitaciones activas`);

    // ── Paso 1b: Obtener publicaciones de los últimos N días ──────────────────
    // Complementa las activas: captura recientes en cualquier estado.
    console.log(`[Cron] 📅 Descargando últimas ${DIAS_RECIENTES} días de publicaciones...`);
    const licitacionesRecientes = await client.obtenerUltimosDias(DIAS_RECIENTES);
    stats.licitacionesRecientes = licitacionesRecientes.length;
    console.log(`[Cron] ✅ ${licitacionesRecientes.length} licitaciones de los últimos ${DIAS_RECIENTES} días`);

    // ── Paso 1c: Combinar y deduplicar ────────────────────────────────────────
    const mapa = new Map<string, typeof licitacionesActivas[0]>();
    for (const lic of [...licitacionesActivas, ...licitacionesRecientes]) {
      if (!mapa.has(lic.Codigo)) mapa.set(lic.Codigo, lic);
    }
    const licitaciones = Array.from(mapa.values());
    stats.licitacionesTotales = licitaciones.length;
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

    // ── Paso 2: Cargar keywords activas (más antigua primero) ────────────────
    const [rows] = await pool.query(
      `SELECT pk.id, pk.usuario_id, pk.keyword
       FROM palabras_clave pk
       JOIN usuarios u ON u.id = pk.usuario_id AND u.activo = TRUE
       WHERE pk.activo = TRUE
       ORDER BY ISNULL(pk.ultima_busqueda) DESC, pk.ultima_busqueda ASC, pk.id ASC`
    );
    const kws = rows as Array<{ id: number; usuario_id: number; keyword: string }>;
    console.log(`[Cron] 📋 ${kws.length} keywords activas`);

    // ── Paso 3: Filtrar localmente por cada keyword ───────────────────────────
    // Busca en Nombre + Descripción (campo completo de texto).
    // INSERT IGNORE garantiza acumulación: no borra resultados anteriores.
    for (const kw of kws) {
      try {
        const termino = kw.keyword.toLowerCase().trim();

        // Buscar keyword en Nombre + Descripcion
        const coincidencias = licitaciones.filter(lic => {
          const texto = `${lic.Nombre} ${lic.Descripcion || ''}`.toLowerCase();
          return texto.includes(termino);
        });

        let insertadas = 0;

        for (const lic of coincidencias) {
          try {
            // Derivar tipo desde el código (ej: L1, LE, LP, etc.)
            const tipo = lic.Tipo || '';

            const [r] = await pool.query(
              `INSERT IGNORE INTO alertas_licitaciones
                 (usuario_id, palabra_clave_id, keyword_texto, licitacion_codigo,
                  licitacion_nombre, licitacion_organismo, licitacion_monto,
                  licitacion_cierre, licitacion_estado, licitacion_region, licitacion_tipo)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                kw.usuario_id,
                kw.id,
                kw.keyword,
                lic.Codigo,
                lic.Nombre?.substring(0, 500)      ?? null,
                lic.Organismo?.substring(0, 500)   ?? null,
                lic.MontoEstimado                  || null,
                lic.FechaCierre ? new Date(lic.FechaCierre) : null,
                lic.EstadoNombre || lic.Estado     || null,
                lic.Region                         || null,
                tipo?.substring(0, 20)             || null,
              ]
            ) as any[];
            if (r.affectedRows > 0) insertadas++;
          } catch (insertErr: any) {
            // Si falla por columna licitacion_tipo inexistente, reintenta sin ella
            if (String(insertErr).toLowerCase().includes('unknown column')) {
              try {
                const [r2] = await pool.query(
                  `INSERT IGNORE INTO alertas_licitaciones
                     (usuario_id, palabra_clave_id, keyword_texto, licitacion_codigo,
                      licitacion_nombre, licitacion_organismo, licitacion_monto,
                      licitacion_cierre, licitacion_estado, licitacion_region)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [
                    kw.usuario_id, kw.id, kw.keyword, lic.Codigo,
                    lic.Nombre?.substring(0, 500) ?? null,
                    lic.Organismo?.substring(0, 500) ?? null,
                    lic.MontoEstimado || null,
                    lic.FechaCierre ? new Date(lic.FechaCierre) : null,
                    lic.EstadoNombre || lic.Estado || null,
                    lic.Region || null,
                  ]
                ) as any[];
                if ((r2 as any).affectedRows > 0) insertadas++;
              } catch { /* silencioso */ }
            }
            /* INSERT IGNORE maneja duplicados silenciosamente */
          }
        }

        await pool.query(
          `UPDATE palabras_clave
           SET ultima_busqueda   = NOW(),
               resultados_nuevos = resultados_nuevos + ?,
               total_encontradas = total_encontradas + ?
           WHERE id = ?`,
          [insertadas, coincidencias.length, kw.id]
        );

        stats.alertasNuevas      += insertadas;
        stats.keywordsProcesadas += 1;

        console.log(
          `[Cron] "${kw.keyword}" → ${coincidencias.length} coincidencias` +
          (insertadas > 0 ? `, ${insertadas} nuevas 🆕` : ' (ya conocidas)')
        );
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
