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
    // Dueño = el negocio ACTIVO más reciente de esa licitación (una fila por código, sin
    // duplicar la analizada aunque se haya asignado a varios perfiles con el tiempo).
    const [rows] = await pool.query(
      `SELECT v.licitacion_codigo, v.score_total, v.semaforo, v.area_negocio,
              v.created_at, v.updated_at, v.confianza_analisis, v.informe_ejecutivo,
              (SELECT MAX(a.licitacion_nombre)    FROM alertas_licitaciones a WHERE a.licitacion_codigo = v.licitacion_codigo) AS nombre,
              (SELECT MAX(a.licitacion_organismo) FROM alertas_licitaciones a WHERE a.licitacion_codigo = v.licitacion_codigo) AS organismo,
              (SELECT MAX(a.licitacion_cierre)    FROM alertas_licitaciones a WHERE a.licitacion_codigo = v.licitacion_codigo) AS cierre,
              ng.estado_pipeline AS estado_pipeline,
              u.nombre AS owner_nombre, u.email AS owner_email
       FROM viabilidad_licitacion v
       LEFT JOIN (
         SELECT n1.licitacion_codigo, n1.asignado_a, n1.estado_pipeline
         FROM negocios n1
         JOIN (SELECT licitacion_codigo, MAX(id) AS mid FROM negocios WHERE activo = TRUE GROUP BY licitacion_codigo) pick
           ON pick.mid = n1.id
       ) ng ON ng.licitacion_codigo = v.licitacion_codigo
       LEFT JOIN usuarios u ON u.id = ng.asignado_a
       WHERE v.modelo LIKE 'ia+%'
       ORDER BY v.updated_at DESC
       LIMIT 500`,
    ) as any[];

    // Normaliza el veredicto de negocio a un único vocabulario (GANABLE / PUEDE_SER / NO_VAMOS),
    // venga el informe en esquema v3 (tarjeta_decision) o v2 (veredicto.gana_probable).
    const normResultado = (inf: any, esV3: boolean): string | null => {
      if (esV3) return inf.tarjeta_decision?.veredicto || null; // ya es GANABLE/PUEDE_SER/NO_VAMOS
      const g = (inf.veredicto?.gana_probable || '').toLowerCase();
      return g === 'si' ? 'GANABLE' : g === 'no' ? 'NO_VAMOS' : g ? 'PUEDE_SER' : null;
    };

    const licitaciones = (rows as any[]).map(r => {
      const ie = parseJSON(r.informe_ejecutivo) || {};
      // v3 (esquema actual) con respaldo a v2 (informes viejos) — así NINGUNA analizada queda
      // sin sus datos (score/veredicto/presupuesto/modalidad), que era el bug con los v3.
      const esV3 = !!ie._informe_ia_v3;
      const inf = ie._informe_ia_v3 || ie._informe_ia || {};
      const presupuesto = esV3
        ? (inf.presupuesto?.bruto ?? inf.presupuesto?.neto ?? null)
        : (inf.presupuesto?.neto ?? inf.presupuesto?.bruto ?? null);
      const modalidad = esV3
        ? (inf.adjudicacion?.como_se_adjudica || null)
        : (inf.modalidad?.tipo || null);
      const nLineas = (inf.productos?.items?.length
        ?? inf.costeo?.items?.length
        ?? inf.manifiesto_productos?.length
        ?? null);
      return {
        codigo: r.licitacion_codigo,
        nombre: r.nombre || inf.meta?.nombre || '(sin nombre)',
        organismo: r.organismo || inf.meta?.organismo || '',
        cierre: r.cierre,
        analizado_at: r.updated_at,     // último análisis (re-análisis)
        creado_at: r.created_at,        // primer análisis
        reanalizada: r.created_at && r.updated_at && new Date(r.updated_at).getTime() - new Date(r.created_at).getTime() > 60_000,
        score: r.score_total,
        semaforo: r.semaforo,
        area: r.area_negocio,
        resultado: normResultado(inf, esV3),
        titular: esV3 ? (inf.tarjeta_decision?.titular || null) : null,
        presupuesto,
        modalidad,
        n_lineas: nLineas,
        confianza: inf.confianza_global ?? (r.confianza_analisis != null ? Number(r.confianza_analisis) : null),
        esquema: esV3 ? 'v3' : 'v2',
        owner_nombre: r.owner_nombre || null,
        owner_email: r.owner_email || null,
        estado_pipeline: r.estado_pipeline || null,
      };
    });

    return NextResponse.json({ success: true, total: licitaciones.length, licitaciones });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
