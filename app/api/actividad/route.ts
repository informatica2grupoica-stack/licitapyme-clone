// app/api/actividad/route.ts
// Historial de actividad de usuarios.
// GET  (solo admin): lista filtrable por usuario y acción, + lista de usuarios para el filtro.
// POST (cualquier autenticado): registra una acción del CLIENTE que no tiene endpoint propio
//      (ver/descargar un documento). Se limita a un conjunto seguro de acciones y exige acceso a
//      la licitación. Aparece en el Historial de la licitación. Best-effort.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser, puedeVerLicitacion } from '@/app/lib/api-auth';
import { registrarActividad, type AccionActividad } from '@/app/lib/actividad';

function getUser(req: NextRequest) {
  const id  = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id, 10) : null, rol };
}

// Acciones que el cliente PUEDE registrar (las demás se registran server-side en su endpoint).
const ACCIONES_CLIENTE: AccionActividad[] = ['ver_documento'];

export async function POST(request: NextRequest) {
  const usuario = await getAuthedUser(request);
  if (!usuario) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  let body: { accion?: string; licitacion_codigo?: string; descripcion?: string } = {};
  try { body = await request.json(); } catch { /* body vacío */ }

  const accion = String(body.accion || '') as AccionActividad;
  const codigo = String(body.licitacion_codigo || '').trim();
  if (!ACCIONES_CLIENTE.includes(accion) || !codigo) {
    return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });
  }

  // Acceso a la licitación (externo → solo asignadas). No se registra sobre lo que no puede ver.
  if (!(await puedeVerLicitacion(request, codigo))) {
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });
  }

  await registrarActividad({
    usuarioId: usuario.id, accion,
    entidadTipo: 'licitacion', entidadId: codigo,
    descripcion: (body.descripcion || 'Vio un documento').toString().slice(0, 200),
    metadata: { licitacion_codigo: codigo },
  });

  return NextResponse.json({ success: true });
}

export async function GET(request: NextRequest) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (rol !== 'admin') return NextResponse.json({ error: 'Solo el admin puede ver el historial' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const filtroUsuario = searchParams.get('usuarioId');
  const filtroAccion  = searchParams.get('accion');
  const limit = Math.min(parseInt(searchParams.get('limit') || '300', 10) || 300, 1000);

  try {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filtroUsuario) { where.push('a.usuario_id = ?'); params.push(parseInt(filtroUsuario, 10)); }
    if (filtroAccion)  { where.push('a.accion = ?');     params.push(filtroAccion); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit);

    const [rows] = await pool.query(
      `SELECT a.id, a.usuario_id, a.accion, a.entidad_tipo, a.entidad_id,
              a.descripcion, a.metadata, a.created_at,
              u.nombre AS usuario_nombre, u.email AS usuario_email
       FROM actividad_usuario a
       LEFT JOIN usuarios u ON u.id = a.usuario_id
       ${whereSql}
       ORDER BY a.created_at DESC
       LIMIT ?`,
      params,
    );

    const [usuarios] = await pool.query(
      `SELECT id, nombre, email FROM usuarios ORDER BY nombre ASC`,
    );

    return NextResponse.json({ success: true, actividad: rows, usuarios });
  } catch (error: any) {
    // Tabla aún no creada (migración 18 pendiente) → responder vacío, sin romper la página.
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      const [usuarios] = await pool.query(`SELECT id, nombre, email FROM usuarios ORDER BY nombre ASC`);
      return NextResponse.json({ success: true, actividad: [], usuarios, migracionPendiente: true });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
