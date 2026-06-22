// app/api/actividad/route.ts
// Historial de actividad de usuarios — SOLO ADMIN.
// GET: lista filtrable por usuario y acción. Devuelve también la lista de usuarios
// (para el filtro) y un resumen de acciones.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';

function getUser(req: NextRequest) {
  const id  = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id, 10) : null, rol };
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
