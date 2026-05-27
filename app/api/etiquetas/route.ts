// app/api/etiquetas/route.ts
// Gestión de etiquetas/líneas de negocio — GET público, POST/DELETE solo admin
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';

function getUser(req: NextRequest) {
  const id  = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

// GET — lista todas las etiquetas activas
export async function GET() {
  try {
    const [rows] = await pool.query(
      `SELECT id, nombre, color, descripcion, activa FROM etiquetas ORDER BY nombre ASC`
    );
    return NextResponse.json({ success: true, etiquetas: rows });
  } catch (error: any) {
    // Tabla no existe todavía (migración pendiente)
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      return NextResponse.json({ success: true, etiquetas: [] });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST — crear etiqueta (solo admin)
export async function POST(request: NextRequest) {
  const { id: userId, rol } = getUser(request);
  if (!userId || rol !== 'admin')
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });

  try {
    const { nombre, color, descripcion } = await request.json();
    if (!nombre?.trim()) return NextResponse.json({ error: 'nombre requerido' }, { status: 400 });

    const [result] = await pool.query(
      `INSERT INTO etiquetas (nombre, color, descripcion, created_by) VALUES (?, ?, ?, ?)`,
      [nombre.trim().toUpperCase(), color || '#3B82F6', descripcion || null, userId]
    );
    return NextResponse.json({ success: true, id: (result as any).insertId });
  } catch (error: any) {
    if (error.code === 'ER_DUP_ENTRY')
      return NextResponse.json({ error: 'Esa etiqueta ya existe' }, { status: 409 });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PATCH — actualizar etiqueta (solo admin)
export async function PATCH(request: NextRequest) {
  const { id: userId, rol } = getUser(request);
  if (!userId || rol !== 'admin')
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });

  try {
    const { id, nombre, color, descripcion, activa } = await request.json();
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });

    await pool.query(
      `UPDATE etiquetas SET nombre=?, color=?, descripcion=?, activa=? WHERE id=?`,
      [nombre, color, descripcion || null, activa ? 1 : 0, id]
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE — eliminar etiqueta (solo admin)
export async function DELETE(request: NextRequest) {
  const { id: userId, rol } = getUser(request);
  if (!userId || rol !== 'admin')
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });

  try {
    await pool.query(`DELETE FROM etiquetas WHERE id = ?`, [id]);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
