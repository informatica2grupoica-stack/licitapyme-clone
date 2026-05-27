// app/api/negocios/[id]/comentarios/route.ts
// Hilo de comentarios de un negocio
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';

function getUser(req: NextRequest) {
  const id  = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

type Params = { params: Promise<{ id: string }> };

// GET — lista de comentarios del negocio
export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { id } = await params;

  try {
    // Verificar acceso
    const [negRows] = await pool.query(
      `SELECT asignado_a FROM negocios WHERE id = ? AND activo = TRUE`, [id]
    ) as any;
    if (!(negRows as any[]).length)
      return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (rol !== 'admin' && (negRows as any[])[0].asignado_a !== userId)
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });

    const [rows] = await pool.query(
      `SELECT c.id, c.comentario, c.created_at,
              u.id AS usuario_id, u.nombre AS usuario_nombre, u.email AS usuario_email,
              e.id AS etiqueta_id, e.nombre AS etiqueta_nombre, e.color AS etiqueta_color
       FROM comentarios_negocio c
       JOIN usuarios u ON u.id = c.usuario_id
       LEFT JOIN etiquetas e ON e.id = c.etiqueta_id
       WHERE c.negocio_id = ?
       ORDER BY c.created_at ASC`,
      [id]
    );

    return NextResponse.json({ success: true, comentarios: rows });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST — agregar comentario (con o sin etiqueta)
export async function POST(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { id } = await params;

  try {
    const { comentario, etiqueta_id } = await request.json();
    if (!comentario?.trim())
      return NextResponse.json({ error: 'El comentario no puede estar vacío' }, { status: 400 });

    // Verificar acceso
    const [negRows] = await pool.query(
      `SELECT asignado_a FROM negocios WHERE id = ? AND activo = TRUE`, [id]
    ) as any;
    if (!(negRows as any[]).length)
      return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (rol !== 'admin' && (negRows as any[])[0].asignado_a !== userId)
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });

    const [result] = await pool.query(
      `INSERT INTO comentarios_negocio (negocio_id, usuario_id, etiqueta_id, comentario)
       VALUES (?, ?, ?, ?)`,
      [id, userId, etiqueta_id || null, comentario.trim()]
    );

    // Actualizar updated_at del negocio
    await pool.query(`UPDATE negocios SET updated_at = NOW() WHERE id = ?`, [id]);

    return NextResponse.json({ success: true, id: (result as any).insertId });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE — eliminar comentario (solo el autor o admin)
export async function DELETE(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { id: negocioId } = await params;
  const { searchParams } = new URL(request.url);
  const comentarioId = searchParams.get('comentarioId');
  if (!comentarioId) return NextResponse.json({ error: 'comentarioId requerido' }, { status: 400 });

  try {
    if (rol === 'admin') {
      await pool.query(`DELETE FROM comentarios_negocio WHERE id = ? AND negocio_id = ?`, [comentarioId, negocioId]);
    } else {
      await pool.query(
        `DELETE FROM comentarios_negocio WHERE id = ? AND negocio_id = ? AND usuario_id = ?`,
        [comentarioId, negocioId, userId]
      );
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
