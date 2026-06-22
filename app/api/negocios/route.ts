// app/api/negocios/route.ts
// Lista y crea asignaciones de licitaciones
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { registrarActividad } from '@/app/lib/actividad';

function getUser(req: NextRequest) {
  const id  = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

// GET — lista negocios
// Admin: puede ver ?usuarioId=X  o todos si no pasa filtro
// Usuario normal: solo los suyos
export async function GET(request: NextRequest) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const filtroUsuario = searchParams.get('usuarioId');

  try {
    // Verificar que las tablas existen (migración pendiente)
    try {
      await pool.query('SELECT 1 FROM negocios LIMIT 1');
    } catch {
      return NextResponse.json({ success: true, negocios: [], usuarios: [], _migrationPending: true });
    }

    let whereClause = '';
    let params: any[] = [];

    if (rol === 'admin' && filtroUsuario) {
      whereClause = 'WHERE n.asignado_a = ? AND n.activo = TRUE';
      params = [parseInt(filtroUsuario)];
    } else if (rol === 'admin' && !filtroUsuario) {
      whereClause = 'WHERE n.activo = TRUE';
    } else {
      whereClause = 'WHERE n.asignado_a = ? AND n.activo = TRUE';
      params = [userId];
    }

    const [rows] = await pool.query(
      `SELECT
         n.id, n.licitacion_codigo, n.licitacion_nombre, n.licitacion_organismo,
         n.licitacion_monto, n.licitacion_cierre, n.licitacion_estado,
         n.licitacion_tipo, n.licitacion_region, n.monto_ofertado,
         COALESCE(n.estado_pipeline, '1ASIGNADO') AS estado_pipeline,
         n.created_at, n.updated_at,
         u.nombre AS usuario_nombre, u.email AS usuario_email,
         GROUP_CONCAT(DISTINCT e.nombre ORDER BY e.nombre SEPARATOR ',') AS etiquetas_nombres,
         GROUP_CONCAT(DISTINCT CONCAT(e.id,':',e.nombre,':',e.color) ORDER BY e.nombre SEPARATOR '|') AS etiquetas_raw,
         (SELECT COUNT(*) FROM comentarios_negocio cn WHERE cn.negocio_id = n.id) AS comentarios_count
       FROM negocios n
       JOIN usuarios u ON u.id = n.asignado_a
       LEFT JOIN negocios_etiquetas ne ON ne.negocio_id = n.id
       LEFT JOIN etiquetas e ON e.id = ne.etiqueta_id
       ${whereClause}
       GROUP BY n.id
       ORDER BY n.updated_at DESC`,
      params
    );

    // Parsear etiquetas_raw a objetos
    const negocios = (rows as any[]).map(row => ({
      ...row,
      etiquetas: row.etiquetas_raw
        ? row.etiquetas_raw.split('|').map((e: string) => {
            const [id, nombre, color] = e.split(':');
            return { id: parseInt(id), nombre, color };
          })
        : [],
      etiquetas_raw: undefined,
      etiquetas_nombres: undefined,
    }));

    // Si admin, también devuelve lista de usuarios para el filtro
    let usuarios: any[] = [];
    if (rol === 'admin') {
      const [uRows] = await pool.query(
        `SELECT id, nombre, email FROM usuarios WHERE activo = TRUE ORDER BY nombre ASC`
      );
      usuarios = uRows as any[];
    }

    return NextResponse.json({ success: true, negocios, usuarios });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST — asignar licitación a usuario (solo admin)
export async function POST(request: NextRequest) {
  const { id: userId, rol } = getUser(request);
  if (!userId || rol !== 'admin')
    return NextResponse.json({ error: 'Solo el admin puede asignar licitaciones' }, { status: 403 });

  try {
    const {
      licitacion_codigo, asignado_a, etiqueta_ids = [],
      licitacion_nombre, licitacion_organismo, licitacion_monto,
      licitacion_cierre, licitacion_estado, licitacion_tipo,
      licitacion_region, licitacion_descripcion,
    } = await request.json();

    if (!licitacion_codigo || !asignado_a)
      return NextResponse.json({ error: 'licitacion_codigo y asignado_a son requeridos' }, { status: 400 });

    const [result] = await pool.query(
      `INSERT INTO negocios (
         licitacion_codigo, licitacion_nombre, licitacion_organismo, licitacion_monto,
         licitacion_cierre, licitacion_estado, licitacion_tipo, licitacion_region,
         licitacion_descripcion, asignado_a, asignado_por
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         licitacion_nombre = COALESCE(VALUES(licitacion_nombre), licitacion_nombre),
         licitacion_estado = COALESCE(VALUES(licitacion_estado), licitacion_estado),
         activo = TRUE`,
      [
        licitacion_codigo,
        licitacion_nombre || null, licitacion_organismo || null,
        licitacion_monto || null,
        licitacion_cierre ? new Date(licitacion_cierre) : null,
        licitacion_estado || null, licitacion_tipo || null,
        licitacion_region || null, licitacion_descripcion || null,
        asignado_a, userId,
      ]
    );

    const negocioId = (result as any).insertId || null;

    // Si tenemos el id (INSERT) asignar etiquetas
    if (negocioId && etiqueta_ids.length > 0) {
      for (const eId of etiqueta_ids) {
        await pool.query(
          `INSERT IGNORE INTO negocios_etiquetas (negocio_id, etiqueta_id) VALUES (?, ?)`,
          [negocioId, eId]
        );
      }
    }

    // Historial: registrar la asignación (a quién se le cargó la licitación)
    try {
      const [uRows] = await pool.query(`SELECT nombre, email FROM usuarios WHERE id = ?`, [asignado_a]);
      const u = (uRows as any[])[0];
      const destino = u?.nombre || u?.email || `usuario ${asignado_a}`;
      registrarActividad({
        usuarioId: userId, accion: 'asignacion',
        entidadTipo: 'negocio', entidadId: String(negocioId || licitacion_codigo),
        descripcion: `Asignó la licitación ${licitacion_codigo} a ${destino}`,
        metadata: { licitacion_codigo, licitacion_nombre: licitacion_nombre || null, asignado_a, asignado_a_nombre: destino },
      });
    } catch { /* no bloquear */ }

    return NextResponse.json({ success: true, id: negocioId });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
