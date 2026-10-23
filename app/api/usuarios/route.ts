// app/api/usuarios/route.ts
// Lista de usuarios activos — disponible para admins (el middleware verifica auth)
// Usado por favoritos y negocios para asignar licitaciones a otros usuarios
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { clienteDeHeader } from '@/app/lib/tenant';

export async function GET(request: NextRequest) {
  const clienteId = clienteDeHeader(request);
  if (!clienteId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  try {
    const rolHeader = request.headers.get('x-user-rol') || '';
    if (rolHeader !== 'admin') {
      return NextResponse.json({ error: 'Acceso denegado' }, { status: 403 });
    }

    const [rows] = await pool.query(
      `SELECT id, nombre, email, empresa, rol
       FROM usuarios
       WHERE activo = TRUE AND cliente_id = ?
       ORDER BY nombre ASC`,
      [clienteId]
    );

    return NextResponse.json({ success: true, usuarios: rows });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
