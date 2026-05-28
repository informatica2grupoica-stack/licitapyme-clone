// app/api/usuarios/route.ts
// Lista de usuarios activos — disponible para admins (el middleware verifica auth)
// Usado por favoritos y negocios para asignar licitaciones a otros usuarios
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';

export async function GET(request: NextRequest) {
  try {
    const rolHeader = request.headers.get('x-user-rol') || '';
    if (rolHeader !== 'admin') {
      return NextResponse.json({ error: 'Acceso denegado' }, { status: 403 });
    }

    const [rows] = await pool.query(
      `SELECT id, nombre, email, empresa, rol
       FROM usuarios
       WHERE activo = TRUE
       ORDER BY nombre ASC`
    );

    return NextResponse.json({ success: true, usuarios: rows });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
