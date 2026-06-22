// app/api/alertas/route.ts
// Listar y marcar como leídas las alertas de licitaciones encontradas
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';

function getUserId(req: NextRequest): number | null {
  const id = req.headers.get('x-user-id');
  if (!id) return null;
  const n = parseInt(id, 10);
  return isNaN(n) ? null : n;
}

// GET — lista TODAS las alertas del usuario (sin límite artificial)
// ?noLeidas=true → solo las no leídas
// ?limit=N       → opcional; sin ?limit devuelve todas
export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const soloNoLeidas = searchParams.get('noLeidas') === 'true';
  const limitParam   = searchParams.get('limit');

  try {
    const whereExtra = soloNoLeidas ? ' AND leida = FALSE' : '';
    const params: unknown[] = limitParam
      ? [userId, parseInt(limitParam, 10)]
      : [userId];

    // Intentar primero con las columnas nuevas; si no existen (migración pendiente)
    // caer a la versión sin ellas para no dejar el radar en blanco.
    let rows: unknown[];
    try {
      // Ordenar por: no leídas primero → fecha publicación más reciente → created_at como fallback
      const selectCols =
        `SELECT a.id, a.keyword_texto, a.licitacion_codigo, a.licitacion_nombre,
                a.licitacion_organismo, a.licitacion_monto, a.licitacion_cierre,
                a.licitacion_fecha_publicacion,
                a.licitacion_estado, a.licitacion_region, a.licitacion_tipo,
                a.match_fuente, a.match_contexto, a.match_score, a.leida, a.created_at,
                EXISTS (SELECT 1 FROM documentos_cache dc WHERE dc.licitacion_codigo = a.licitacion_codigo) AS tiene_documentos,
                v.score_total AS viabilidad_score,
                v.semaforo    AS viabilidad_semaforo,
                v.area_negocio AS viabilidad_area,
                v.informe_ejecutivo AS viabilidad_informe,
                pf.decision  AS prefiltro_decision,
                pf.categoria AS prefiltro_categoria,
                pf.motivo    AS prefiltro_motivo,
                pf.confianza AS prefiltro_confianza,
                cat.nombre AS categoria_nombre,
                cat.color  AS categoria_color
         FROM alertas_licitaciones a
         LEFT JOIN viabilidad_licitacion v ON v.licitacion_codigo = a.licitacion_codigo
         LEFT JOIN prefiltro_licitacion pf ON pf.licitacion_codigo = a.licitacion_codigo
         LEFT JOIN palabras_clave pc ON pc.id = a.palabra_clave_id
         LEFT JOIN etiquetas cat ON cat.id = pc.categoria_id
         WHERE a.usuario_id = ?${whereExtra}
         ORDER BY COALESCE(a.licitacion_fecha_publicacion, a.licitacion_cierre, a.created_at) DESC`;
      const query = limitParam ? `${selectCols} LIMIT ?` : selectCols;
      [rows] = await pool.query(query, params) as any[];
    } catch {
      // Columnas nuevas no existen aún — fallback sin columnas opcionales
      const query = limitParam
        ? `SELECT id, keyword_texto, licitacion_codigo, licitacion_nombre,
                  licitacion_organismo, licitacion_monto, licitacion_cierre,
                  licitacion_estado, licitacion_region, licitacion_tipo,
                  leida, created_at,
                  EXISTS (SELECT 1 FROM documentos_cache dc WHERE dc.licitacion_codigo = a.licitacion_codigo) AS tiene_documentos
           FROM alertas_licitaciones a
           WHERE usuario_id = ?${whereExtra}
           ORDER BY COALESCE(licitacion_cierre, created_at) DESC
           LIMIT ?`
        : `SELECT id, keyword_texto, licitacion_codigo, licitacion_nombre,
                  licitacion_organismo, licitacion_monto, licitacion_cierre,
                  licitacion_estado, licitacion_region, licitacion_tipo,
                  leida, created_at,
                  EXISTS (SELECT 1 FROM documentos_cache dc WHERE dc.licitacion_codigo = a.licitacion_codigo) AS tiene_documentos
           FROM alertas_licitaciones a
           WHERE usuario_id = ?${whereExtra}
           ORDER BY COALESCE(licitacion_cierre, created_at) DESC`;
      [rows] = await pool.query(query, params) as any[];
    }

    const [countRows] = await pool.query(
      `SELECT COUNT(*) as total FROM alertas_licitaciones WHERE usuario_id = ? AND leida = FALSE`,
      [userId]
    );
    const noLeidas = (countRows as any[])[0]?.total || 0;

    return NextResponse.json({ success: true, alertas: rows, noLeidas, total: (rows as any[]).length });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PATCH — marcar como leída(s)
// Body: { ids: number[] } o { all: true } para marcar todas
export async function PATCH(request: NextRequest) {
  const userId = getUserId(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  try {
    const { ids, all } = await request.json();

    if (all) {
      await pool.query(
        `UPDATE alertas_licitaciones SET leida = TRUE WHERE usuario_id = ?`,
        [userId]
      );
    } else if (ids?.length) {
      const placeholders = ids.map(() => '?').join(',');
      await pool.query(
        `UPDATE alertas_licitaciones SET leida = TRUE WHERE id IN (${placeholders}) AND usuario_id = ?`,
        [...ids, userId]
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE — eliminar alerta
export async function DELETE(request: NextRequest) {
  const userId = getUserId(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });

  try {
    await pool.query(
      `DELETE FROM alertas_licitaciones WHERE id = ? AND usuario_id = ?`,
      [id, userId]
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
