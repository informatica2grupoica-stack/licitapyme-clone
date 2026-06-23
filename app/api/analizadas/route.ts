// app/api/analizadas/route.ts
// Lista las licitaciones que ya fueron ANALIZADAS con IA (PROMPT 2).
// "Analizada con IA" = viabilidad_licitacion.modelo empieza con 'ia+' (lo escribe
// guardarViabilidadIA). Devuelve lo esencial para la vista: score, semáforo, veredicto,
// presupuesto, nombre y organismo. Datos compartidos por código (la decisión es por licitación).

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getUserId(req: NextRequest): number | null {
  const id = req.headers.get('x-user-id');
  if (!id) return null;
  const n = parseInt(id, 10);
  return isNaN(n) ? null : n;
}

function parseJSON(v: any): any {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  try {
    const [rows] = await pool.query(
      `SELECT v.licitacion_codigo, v.score_total, v.semaforo, v.area_negocio, v.updated_at, v.informe_ejecutivo,
              (SELECT MAX(a.licitacion_nombre)    FROM alertas_licitaciones a WHERE a.licitacion_codigo = v.licitacion_codigo) AS nombre,
              (SELECT MAX(a.licitacion_organismo) FROM alertas_licitaciones a WHERE a.licitacion_codigo = v.licitacion_codigo) AS organismo,
              (SELECT MAX(a.licitacion_cierre)    FROM alertas_licitaciones a WHERE a.licitacion_codigo = v.licitacion_codigo) AS cierre
       FROM viabilidad_licitacion v
       WHERE v.modelo LIKE 'ia+%'
       ORDER BY v.updated_at DESC
       LIMIT 500`,
    ) as any[];

    const licitaciones = (rows as any[]).map(r => {
      const ie = parseJSON(r.informe_ejecutivo) || {};
      const informe = ie._informe_ia || {};
      return {
        codigo: r.licitacion_codigo,
        nombre: r.nombre || informe.meta?.nombre || '(sin nombre)',
        organismo: r.organismo || informe.meta?.organismo || '',
        cierre: r.cierre,
        analizado_at: r.updated_at,
        score: r.score_total,
        semaforo: r.semaforo,
        area: r.area_negocio,
        gana: informe.veredicto?.gana_probable || null,
        nivel: informe.veredicto?.nivel || null,
        presupuesto_neto: informe.presupuesto?.neto ?? informe.presupuesto?.bruto ?? null,
        modalidad: informe.modalidad?.tipo || null,
        n_lineas: informe.manifiesto_productos?.length ?? null,
      };
    });

    return NextResponse.json({ success: true, total: licitaciones.length, licitaciones });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
