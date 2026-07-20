// app/api/negocios/[id]/recorrido/route.ts
// GET → los HITOS del recorrido completo de un negocio, en orden cronológico:
//   detectada en radar → prefiltro IA → asignación (y reasignaciones) → viabilidad IA →
//   cambios de etapa → postulación → resultado de adjudicación → (o descarte).
// Cada bloque se consulta por separado y en try/catch: si una tabla falta o un dato no
// existe, el hito simplemente no aparece (nunca rompe el detalle del negocio).
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { puedeVerNegocioAsignado } from '@/app/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getUser(req: NextRequest) {
  const id  = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id } = await params;

  try {
    const [nRows] = await pool.query(
      `SELECT n.*, u.nombre AS asignado_nombre, u.email AS asignado_email,
              ap.nombre AS asignado_por_nombre, d.nombre AS descarte_por_nombre
       FROM negocios n
       JOIN usuarios u  ON u.id  = n.asignado_a
       LEFT JOIN usuarios ap ON ap.id = n.asignado_por
       LEFT JOIN usuarios d  ON d.id  = n.descarte_por
       WHERE n.id = ?`, [id]) as any;
    const negocio = (nRows as any[])[0];
    if (!negocio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (!(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a)))
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });

    const codigo = negocio.licitacion_codigo;

    // ── Bloques independientes, cada uno best-effort ──────────────────────────
    const [radar, prefiltro, viabilidad, eventos, adjudicacion, empresa] = await Promise.all([
      // 1) Radar: primera detección + a cuántos perfiles les llegó y con qué palabra.
      pool.query(
        `SELECT MIN(created_at) AS primera, COUNT(DISTINCT usuario_id) AS n_perfiles,
                SUBSTRING_INDEX(GROUP_CONCAT(DISTINCT keyword_texto SEPARATOR '||'), '||', 3) AS palabras
         FROM alertas_licitaciones WHERE licitacion_codigo = ?`, [codigo]
      ).then(([r]: any) => (r as any[])[0]?.primera ? (r as any[])[0] : null).catch(() => null),

      // 2) Prefiltro IA de perfil (PASA / EXCLUIDO).
      pool.query(
        `SELECT decision, categoria, confianza, motivo, created_at
         FROM prefiltro_licitacion WHERE licitacion_codigo = ? LIMIT 1`, [codigo]
      ).then(([r]: any) => (r as any[])[0] || null).catch(() => null),

      // 3) Viabilidad IA (score + veredicto v3 si existe).
      pool.query(
        `SELECT score_total, semaforo, created_at, updated_at,
                JSON_UNQUOTE(JSON_EXTRACT(informe_ejecutivo, '$.tarjeta_decision.veredicto')) AS veredicto_v3,
                JSON_UNQUOTE(JSON_EXTRACT(informe_ejecutivo, '$.score_0_100')) AS score_v3
         FROM viabilidad_licitacion WHERE licitacion_codigo = ? LIMIT 1`, [codigo]
      ).then(([r]: any) => (r as any[])[0] || null)
        // informe_ejecutivo con JSON inválido → reintento sin los JSON_EXTRACT.
        .catch(() => pool.query(
          `SELECT score_total, semaforo, created_at, updated_at
           FROM viabilidad_licitacion WHERE licitacion_codigo = ? LIMIT 1`, [codigo]
        ).then(([r]: any) => (r as any[])[0] || null).catch(() => null)),

      // 4) Bitácora: SOLO los hitos que cambian el rumbo (asignación y cambios de etapa),
      //    en orden cronológico ascendente. Las "vistas" no son hitos.
      pool.query(
        `SELECT a.accion, a.descripcion, a.created_at,
                u.nombre AS actor_nombre, u.email AS actor_email
         FROM actividad_usuario a
         LEFT JOIN usuarios u ON u.id = a.usuario_id
         WHERE (a.accion IN ('asignacion', 'cambio_pipeline'))
           AND ((a.entidad_tipo = 'licitacion' AND a.entidad_id = ?)
             OR a.metadata LIKE CONCAT('%"licitacion_codigo":"', ?, '"%'))
         ORDER BY a.created_at ASC
         LIMIT 100`, [codigo, codigo]
      ).then(([r]: any) => r as any[]).catch(() => []),

      // 5) Resultado de adjudicación (cache que alimenta el cron; nunca consulta MP en vivo).
      pool.query(
        `SELECT es_adjudicada, estado, fecha_adjudicacion, monto_adjudicado_total,
                numero_oferentes, url_acta
         FROM adjudicacion_cache WHERE licitacion_codigo = ? LIMIT 1`, [codigo]
      ).then(([r]: any) => (r as any[])[0] || null).catch(() => null),

      // 6) Empresa con la que se postuló (si se registró).
      negocio.empresa_id
        ? pool.query(`SELECT nombre FROM empresas WHERE id = ? LIMIT 1`, [negocio.empresa_id])
            .then(([r]: any) => (r as any[])[0]?.nombre || null).catch(() => null)
        : Promise.resolve(null),
    ]);

    return NextResponse.json({
      success: true,
      recorrido: {
        codigo,
        radar,
        prefiltro,
        asignacion: {
          fecha: negocio.created_at,
          a_nombre: negocio.asignado_nombre || negocio.asignado_email,
          por_nombre: negocio.asignado_por_nombre,
        },
        viabilidad,
        eventos,          // asignaciones/reasignaciones + cambios de etapa, ASC
        estado_actual: negocio.estado_pipeline || 'ASIGNADO',
        activo: !!negocio.activo,
        monto_ofertado: negocio.monto_ofertado,
        empresa,
        adjudicacion,
        descarte: negocio.descarte_at
          ? { fecha: negocio.descarte_at, motivo: negocio.descarte_motivo, por_nombre: negocio.descarte_por_nombre }
          : null,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
