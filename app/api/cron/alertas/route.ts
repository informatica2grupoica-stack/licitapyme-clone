// app/api/cron/alertas/route.ts
// Cron job: busca licitaciones nuevas para cada usuario según sus palabras clave.
// Llamado por cron-job.org cada 4 horas (o Vercel Cron diario).
// Protección: Authorization: Bearer <CRON_SECRET>  o  x-vercel-cron: 1
//
// ESTRATEGIA CORRECTA:
//   La API de Mercado Público NO tiene parámetro "buscar".
//   Descargamos TODAS las licitaciones de los últimos N días (una llamada
//   por día) y luego filtramos localmente por keyword — igual que el buscador.

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getMercadoPublicoClient } from '@/app/lib/mercado-publico';

const CRON_SECRET   = process.env.CRON_SECRET || '';
const DIAS_BUSQUEDA = 7; // Días atrás que revisamos en cada ejecución

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
    licitacionesDescargadas: 0,
    keywordsProcesadas:       0,
    alertasNuevas:            0,
    errores:                  0,
    duracionMs:               0,
  };

  const startTime = Date.now();

  try {
    // ── Paso 1: Descargar licitaciones recientes UNA sola vez ────────────────
    // Una llamada por día (7 llamadas en total) en lugar de una por keyword.
    // Esto evita completamente los errores 400/429 de la API de MP.
    console.log(`[Cron] 📅 Descargando licitaciones de los últimos ${DIAS_BUSQUEDA} días...`);
    const client      = getMercadoPublicoClient();
    const licitaciones = await client.obtenerUltimosDias(DIAS_BUSQUEDA);
    stats.licitacionesDescargadas = licitaciones.length;
    console.log(`[Cron] ✅ ${licitaciones.length} licitaciones descargadas`);

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
    // El filtrado en memoria es instantáneo — sin llamadas a la API aquí.
    for (const kw of kws) {
      try {
        const termino = kw.keyword.toLowerCase().trim();

        // Buscar keyword en Nombre + Descripcion (igual que el buscador)
        const coincidencias = licitaciones.filter(lic => {
          const texto = `${lic.Nombre} ${lic.Descripcion || ''}`.toLowerCase();
          return texto.includes(termino);
        });

        let insertadas = 0;

        for (const lic of coincidencias) {
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
                lic.Codigo,
                lic.Nombre?.substring(0, 500)    ?? null,
                lic.Organismo?.substring(0, 500) ?? null,
                lic.MontoEstimado                || null,
                lic.FechaCierre ? new Date(lic.FechaCierre) : null,
                lic.Estado                       || null,
                lic.Region                       || null,
              ]
            ) as any[];
            if (r.affectedRows > 0) insertadas++;
          } catch { /* INSERT IGNORE maneja duplicados silenciosamente */ }
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
