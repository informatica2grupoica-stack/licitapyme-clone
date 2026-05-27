// app/api/cron/alertas/route.ts
//
// Cron job: busca licitaciones nuevas para cada usuario según sus palabras clave.
// Llamado por Vercel Cron cada 6 horas (ver vercel.json).
// También puede llamarse manualmente desde el panel de alertas.
//
// Protección: requiere header Authorization: Bearer <CRON_SECRET>
// O que la llamada venga del sistema Vercel (header x-vercel-cron: 1).

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';

const CRON_SECRET = process.env.CRON_SECRET || '';

interface MPLicitacion {
  CodigoLicitacion: string;
  Nombre: string;
  NombreOrganismo: string;
  MontoEstimado: number;
  FechaCierre: string;
  Estado: string;
  Region: string;
}

async function buscarEnMP(keyword: string): Promise<MPLicitacion[]> {
  try {
    const ticket = process.env.MP_API_TICKET;
    if (!ticket) return [];

    const url = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?buscar=${encodeURIComponent(keyword)}&ticket=${ticket}&estado=publicada&cantidad=20`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.Listado || []) as MPLicitacion[];
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  // Verificar autorización
  const authHeader = request.headers.get('authorization');
  const isCronCall = request.headers.get('x-vercel-cron') === '1';
  const isManual = authHeader === `Bearer ${CRON_SECRET}` && CRON_SECRET !== '';

  if (!isCronCall && !isManual) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const results = {
    usuariosProcesados: 0,
    keywordsBuscadas: 0,
    alertasNuevas: 0,
    errores: 0,
  };

  try {
    // Obtener todas las palabras clave activas
    const [keywords] = await pool.query(
      `SELECT pk.id, pk.usuario_id, pk.keyword
       FROM palabras_clave pk
       JOIN usuarios u ON u.id = pk.usuario_id AND u.activo = TRUE
       WHERE pk.activo = TRUE
       ORDER BY pk.usuario_id, pk.id`
    );

    const kws = keywords as Array<{ id: number; usuario_id: number; keyword: string }>;
    const usuariosSet = new Set(kws.map(k => k.usuario_id));
    results.usuariosProcesados = usuariosSet.size;
    results.keywordsBuscadas = kws.length;

    for (const kw of kws) {
      try {
        const licitaciones = await buscarEnMP(kw.keyword);

        let nuevas = 0;
        for (const lic of licitaciones) {
          try {
            const monto = lic.MontoEstimado || null;
            const cierre = lic.FechaCierre ? new Date(lic.FechaCierre) : null;

            await pool.query(
              `INSERT IGNORE INTO alertas_licitaciones
                 (usuario_id, palabra_clave_id, keyword_texto, licitacion_codigo,
                  licitacion_nombre, licitacion_organismo, licitacion_monto,
                  licitacion_cierre, licitacion_estado, licitacion_region)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                kw.usuario_id, kw.id, kw.keyword,
                lic.CodigoLicitacion,
                lic.Nombre?.substring(0, 500),
                lic.NombreOrganismo?.substring(0, 500),
                monto,
                cierre,
                lic.Estado,
                lic.Region,
              ]
            );
            nuevas++;
          } catch { /* INSERT IGNORE handles duplicates */ }
        }

        // Actualizar última búsqueda y contador
        await pool.query(
          `UPDATE palabras_clave
           SET ultima_busqueda = NOW(),
               resultados_nuevos = resultados_nuevos + ?,
               total_encontradas = total_encontradas + ?
           WHERE id = ?`,
          [nuevas, licitaciones.length, kw.id]
        );

        results.alertasNuevas += nuevas;
      } catch (kwError) {
        console.error(`Error procesando keyword "${kw.keyword}":`, kwError);
        results.errores++;
      }
    }

    console.log('Cron alertas completado:', results);
    return NextResponse.json({ success: true, ...results });
  } catch (error) {
    console.error('Error en cron alertas:', error);
    return NextResponse.json({ error: String(error), ...results }, { status: 500 });
  }
}
