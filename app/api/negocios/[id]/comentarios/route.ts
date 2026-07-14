// app/api/negocios/[id]/comentarios/route.ts
// Hilo de comentarios de un negocio
// pipeline_estado: cuando se envía, también actualiza negocios.estado_pipeline
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { registrarActividad } from '@/app/lib/actividad';
import { registrarEvento } from '@/app/lib/historial';
import { puedeVerNegocioAsignado } from '@/app/lib/api-auth';

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
    if (!(await puedeVerNegocioAsignado(userId, rol, (negRows as any[])[0].asignado_a)))
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });

    // pipeline_estado puede no existir si migration-5 no ha sido ejecutada
    let rows: any[];
    try {
      const [r] = await pool.query(
        `SELECT c.id, c.comentario, c.created_at, c.pipeline_estado,
                u.id AS usuario_id, u.nombre AS usuario_nombre, u.email AS usuario_email,
                e.id AS etiqueta_id, e.nombre AS etiqueta_nombre, e.color AS etiqueta_color
         FROM comentarios_negocio c
         JOIN usuarios u ON u.id = c.usuario_id
         LEFT JOIN etiquetas e ON e.id = c.etiqueta_id
         WHERE c.negocio_id = ?
         ORDER BY c.created_at ASC`,
        [id]
      );
      rows = r as any[];
    } catch {
      // Fallback sin columna pipeline_estado (migration-5 no ejecutada)
      const [r] = await pool.query(
        `SELECT c.id, c.comentario, c.created_at, NULL AS pipeline_estado,
                u.id AS usuario_id, u.nombre AS usuario_nombre, u.email AS usuario_email,
                e.id AS etiqueta_id, e.nombre AS etiqueta_nombre, e.color AS etiqueta_color
         FROM comentarios_negocio c
         JOIN usuarios u ON u.id = c.usuario_id
         LEFT JOIN etiquetas e ON e.id = c.etiqueta_id
         WHERE c.negocio_id = ?
         ORDER BY c.created_at ASC`,
        [id]
      );
      rows = r as any[];
    }

    return NextResponse.json({ success: true, comentarios: rows });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST — agregar comentario (con pipeline_estado opcional)
export async function POST(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { id } = await params;

  try {
    const { comentario, etiqueta_id, pipeline_estado } = await request.json();
    if (!comentario?.trim())
      return NextResponse.json({ error: 'El comentario no puede estar vacío' }, { status: 400 });

    // Verificar acceso
    const [negRows] = await pool.query(
      `SELECT asignado_a, licitacion_codigo, licitacion_nombre FROM negocios WHERE id = ? AND activo = TRUE`, [id]
    ) as any;
    if (!(negRows as any[]).length)
      return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    const negocio = (negRows as any[])[0];
    if (!(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a)))
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });

    // Insertar comentario
    let insertId: number;
    try {
      const [result] = await pool.query(
        `INSERT INTO comentarios_negocio (negocio_id, usuario_id, etiqueta_id, pipeline_estado, comentario)
         VALUES (?, ?, ?, ?, ?)`,
        [id, userId, etiqueta_id || null, pipeline_estado || null, comentario.trim()]
      );
      insertId = (result as any).insertId;
    } catch {
      // Fallback: sin columna pipeline_estado
      const [result] = await pool.query(
        `INSERT INTO comentarios_negocio (negocio_id, usuario_id, etiqueta_id, comentario)
         VALUES (?, ?, ?, ?)`,
        [id, userId, etiqueta_id || null, comentario.trim()]
      );
      insertId = (result as any).insertId;
    }

    // Si se indicó un pipeline_estado, actualizar el negocio
    let nuevoEstado: string | null = null;
    if (pipeline_estado) {
      try {
        await pool.query(
          `UPDATE negocios SET estado_pipeline = ?, updated_at = NOW() WHERE id = ?`,
          [pipeline_estado, id]
        );
        nuevoEstado = pipeline_estado;
      } catch {
        // No bloquear si falla (migration-4 no ejecutada)
      }
    }

    // Actualizar updated_at del negocio
    await pool.query(`UPDATE negocios SET updated_at = NOW() WHERE id = ?`, [id]);

    registrarActividad({
      usuarioId: userId, accion: 'comentario_negocio',
      entidadTipo: 'negocio', entidadId: String(id),
      descripcion: `Comentó en "${negocio.licitacion_nombre || negocio.licitacion_codigo}"`,
      metadata: { licitacion_codigo: negocio.licitacion_codigo, comentario: comentario.trim().slice(0, 200), pipeline_estado: nuevoEstado },
    });
    if (nuevoEstado) {
      registrarActividad({
        usuarioId: userId, accion: 'cambio_pipeline',
        entidadTipo: 'negocio', entidadId: String(id),
        descripcion: `Cambió el estado de "${negocio.licitacion_nombre || negocio.licitacion_codigo}" a ${nuevoEstado}`,
        metadata: { licitacion_codigo: negocio.licitacion_codigo, estado_pipeline: nuevoEstado },
      });
    }

    // Campana: avisar al perfil asignado que comentaron su licitación (si no es él mismo).
    if (Number(negocio.asignado_a) !== Number(userId)) {
      (async () => {
        try {
          const [aRows] = await pool.query(`SELECT nombre, email FROM usuarios WHERE id = ?`, [userId]);
          const actorNombre = (aRows as any[])[0]?.nombre || (aRows as any[])[0]?.email || 'Alguien';
          const snippet = comentario.trim().replace(/\s+/g, ' ').slice(0, 120);
          await registrarEvento({
            tipo: 'COMENTARIO',
            licitacionCodigo: negocio.licitacion_codigo, licitacionNombre: negocio.licitacion_nombre,
            usuarioId: Number(negocio.asignado_a), usuarioNombre: null,
            actorId: userId, actorNombre,
            mensaje: `${actorNombre} comentó: “${snippet}”`,
            metadata: { licitacion_codigo: negocio.licitacion_codigo, pipeline_estado: nuevoEstado },
          });
        } catch (e) { console.error('[comentarios] notif campana falló:', String(e)); }
      })();
    }

    return NextResponse.json({ success: true, id: insertId, nuevo_estado: nuevoEstado });
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
