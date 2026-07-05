// app/api/licitacion-comentarios/[codigo]/route.ts
// Comentarios de una licitación (sección "Comentarios" de la ficha de detalle).
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { registrarActividad } from '@/app/lib/actividad';
import { puedeVerLicitacion, esExterno } from '@/app/lib/api-auth';

function getUser(req: NextRequest) {
  const id  = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

type Params = { params: Promise<{ codigo: string }> };

// GET — lista de comentarios de la licitación
export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { codigo } = await params;
  const codigoDecoded = decodeURIComponent(codigo);
  if (!(await puedeVerLicitacion(request, codigoDecoded)))
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });

  try {
    const [rows] = await pool.query(
      `SELECT c.id, c.comentario, c.created_at,
              u.id AS usuario_id, u.nombre AS usuario_nombre, u.email AS usuario_email
       FROM comentarios_licitacion c
       JOIN usuarios u ON u.id = c.usuario_id
       WHERE c.licitacion_codigo = ?
       ORDER BY c.created_at ASC`,
      [codigoDecoded]
    );

    return NextResponse.json({ success: true, comentarios: rows });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST — agregar comentario
export async function POST(request: NextRequest, { params }: Params) {
  const { id: userId } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { codigo } = await params;
  const codigoDecoded = decodeURIComponent(codigo);
  if (await esExterno(request))
    return NextResponse.json({ error: 'No autorizado para comentar' }, { status: 403 });
  if (!(await puedeVerLicitacion(request, codigoDecoded)))
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });

  try {
    const { comentario } = await request.json();
    if (!comentario?.trim())
      return NextResponse.json({ error: 'El comentario no puede estar vacío' }, { status: 400 });

    const [result] = await pool.query(
      `INSERT INTO comentarios_licitacion (licitacion_codigo, usuario_id, comentario)
       VALUES (?, ?, ?)`,
      [codigoDecoded, userId, comentario.trim()]
    );

    registrarActividad({
      usuarioId: userId, accion: 'comentario_licitacion',
      entidadTipo: 'licitacion', entidadId: codigoDecoded,
      descripcion: `Comentó en la licitación ${codigoDecoded}`,
      metadata: { comentario: comentario.trim().slice(0, 200) },
    });

    return NextResponse.json({ success: true, id: (result as any).insertId });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE — eliminar comentario (solo el autor o admin)
export async function DELETE(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { codigo } = await params;
  const codigoDecoded = decodeURIComponent(codigo);
  const { searchParams } = new URL(request.url);
  const comentarioId = searchParams.get('comentarioId');
  if (!comentarioId) return NextResponse.json({ error: 'comentarioId requerido' }, { status: 400 });

  try {
    if (rol === 'admin') {
      await pool.query(
        `DELETE FROM comentarios_licitacion WHERE id = ? AND licitacion_codigo = ?`,
        [comentarioId, codigoDecoded]
      );
    } else {
      await pool.query(
        `DELETE FROM comentarios_licitacion WHERE id = ? AND licitacion_codigo = ? AND usuario_id = ?`,
        [comentarioId, codigoDecoded, userId]
      );
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
