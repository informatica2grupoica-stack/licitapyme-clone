// app/api/palabras-clave/route.ts
// CRUD de palabras clave para búsqueda automática
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';

function getUserId(req: NextRequest): number | null {
  const id = req.headers.get('x-user-id');
  if (!id) return null;
  const n = parseInt(id, 10);
  return isNaN(n) ? null : n;
}

// GET — listar palabras clave del usuario
export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  try {
    const [rows] = await pool.query(
      `SELECT id, keyword, activo, ultima_busqueda, resultados_nuevos, total_encontradas, created_at
       FROM palabras_clave
       WHERE usuario_id = ?
       ORDER BY created_at DESC`,
      [userId]
    );
    return NextResponse.json({ success: true, keywords: rows });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST — crear palabra clave
export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  try {
    const { keyword } = await request.json();
    if (!keyword?.trim()) return NextResponse.json({ error: 'keyword requerido' }, { status: 400 });

    const kw = keyword.trim().toLowerCase();

    // Verificar duplicado
    const [exist] = await pool.query(
      `SELECT id FROM palabras_clave WHERE usuario_id = ? AND keyword = ?`,
      [userId, kw]
    );
    if ((exist as any[]).length > 0) {
      return NextResponse.json({ error: 'Esa palabra clave ya existe' }, { status: 409 });
    }

    const [result] = await pool.query(
      `INSERT INTO palabras_clave (usuario_id, keyword) VALUES (?, ?)`,
      [userId, kw]
    );
    const id = (result as any).insertId;

    return NextResponse.json({ success: true, id, keyword: kw });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PATCH — toggle activo o actualizar
export async function PATCH(request: NextRequest) {
  const userId = getUserId(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  try {
    const { id, activo } = await request.json();
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });

    await pool.query(
      `UPDATE palabras_clave SET activo = ? WHERE id = ? AND usuario_id = ?`,
      [activo ? 1 : 0, id, userId]
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE — eliminar palabra clave
export async function DELETE(request: NextRequest) {
  const userId = getUserId(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });

  try {
    await pool.query(
      `DELETE FROM palabras_clave WHERE id = ? AND usuario_id = ?`,
      [id, userId]
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
