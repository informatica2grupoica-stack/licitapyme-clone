// app/api/licitacion-comentarios/[codigo]/route.ts
// Comentarios de una licitación (sección "Comentarios" de la ficha de detalle).
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { registrarActividad } from '@/app/lib/actividad';
import { puedeVerLicitacion, esExterno } from '@/app/lib/api-auth';
import { ahoraChileSQL } from '@/app/lib/tz';

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
    const [rowsLic] = await pool.query(
      `SELECT c.id, c.comentario, c.created_at, 'licitacion' AS origen,
              u.id AS usuario_id, u.nombre AS usuario_nombre, u.email AS usuario_email
       FROM comentarios_licitacion c
       JOIN usuarios u ON u.id = c.usuario_id
       WHERE c.licitacion_codigo = ?`,
      [codigoDecoded]
    );

    // Fusión con los comentarios del negocio vinculado a esta licitación (si existe): la
    // ficha de negocio ya los tenía, pero la ficha pública de la licitación no los mostraba
    // — mismo hilo, dos vistas. Se muestran juntos, ordenados por fecha; el origen viaja en
    // cada fila para que el DELETE sepa en qué tabla borrar.
    let rowsNeg: any[] = [];
    try {
      const [neg] = await pool.query(
        `SELECT id FROM negocios WHERE licitacion_codigo = ? AND activo = 1 LIMIT 1`,
        [codigoDecoded]
      ) as any;
      const negocioId = (neg as any[])[0]?.id;
      if (negocioId) {
        const [rn] = await pool.query(
          `SELECT c.id, c.comentario, c.created_at, 'negocio' AS origen,
                  u.id AS usuario_id, u.nombre AS usuario_nombre, u.email AS usuario_email
           FROM comentarios_negocio c
           JOIN usuarios u ON u.id = c.usuario_id
           WHERE c.negocio_id = ?`,
          [negocioId]
        );
        rowsNeg = rn as any[];
      }
    } catch (e) { console.warn('[licitacion-comentarios] fusión con negocio falló (no bloquea):', String(e)); }

    const comentarios = [...(rowsLic as any[]), ...rowsNeg]
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    return NextResponse.json({ success: true, comentarios });
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

    // created_at EXPLÍCITO en hora de pared de Chile (mismo bug que actividad_usuario: el
    // DEFAULT CURRENT_TIMESTAMP lo pone el servidor MySQL de Bluehost, UTC-6, 2h atrás de Chile).
    const [result] = await pool.query(
      `INSERT INTO comentarios_licitacion (licitacion_codigo, usuario_id, comentario, created_at)
       VALUES (?, ?, ?, ?)`,
      [codigoDecoded, userId, comentario.trim(), ahoraChileSQL()]
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
  const origen = searchParams.get('origen') === 'negocio' ? 'negocio' : 'licitacion';
  if (!comentarioId) return NextResponse.json({ error: 'comentarioId requerido' }, { status: 400 });

  try {
    // El comentario puede venir fusionado desde comentarios_negocio (ver GET) — hay que
    // borrarlo de la tabla que corresponda según el origen que viajó con la fila.
    if (origen === 'negocio') {
      const [neg] = await pool.query(
        `SELECT id FROM negocios WHERE licitacion_codigo = ? AND activo = 1 LIMIT 1`,
        [codigoDecoded]
      ) as any;
      const negocioId = (neg as any[])[0]?.id;
      if (!negocioId) return NextResponse.json({ error: 'Negocio no encontrado' }, { status: 404 });
      if (rol === 'admin') {
        await pool.query(`DELETE FROM comentarios_negocio WHERE id = ? AND negocio_id = ?`, [comentarioId, negocioId]);
      } else {
        await pool.query(
          `DELETE FROM comentarios_negocio WHERE id = ? AND negocio_id = ? AND usuario_id = ?`,
          [comentarioId, negocioId, userId]
        );
      }
      return NextResponse.json({ success: true });
    }

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
