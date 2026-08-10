// app/api/negocios/buscar/route.ts
// GET /api/negocios/buscar?q=... — búsqueda rápida de licitaciones (tabla negocios) por código o
// nombre, para selectores de "vincular a licitación" (ver /ordenes-compra). Admin-only: el único
// consumidor hoy es la vista de gestión de órdenes de compra, que ya es admin-only.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

export async function GET(request: NextRequest) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (rol !== 'admin') return NextResponse.json({ error: 'Solo administradores.' }, { status: 403 });

  const q = (request.nextUrl.searchParams.get('q') || '').trim();
  if (q.length < 2) return NextResponse.json({ success: true, negocios: [] });

  try {
    const like = `%${q}%`;
    const [rows] = await pool.query(
      `SELECT DISTINCT licitacion_codigo, licitacion_nombre, licitacion_organismo
         FROM negocios
        WHERE activo = TRUE AND (licitacion_codigo LIKE ? OR licitacion_nombre LIKE ?)
        ORDER BY updated_at DESC
        LIMIT 15`,
      [like, like],
    );
    return NextResponse.json({ success: true, negocios: rows });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
