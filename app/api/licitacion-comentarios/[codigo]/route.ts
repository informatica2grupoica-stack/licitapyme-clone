// app/api/licitacion-comentarios/[codigo]/route.ts
// Comentarios de una licitación (sección "Comentarios" de la ficha de detalle).
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { registrarActividad } from '@/app/lib/actividad';
import { puedeVerLicitacion, esExterno } from '@/app/lib/api-auth';
import { ahoraChileSQL } from '@/app/lib/tz';
import { registrarEvento } from '@/app/lib/historial';

function getUser(req: NextRequest) {
  const id  = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

type Params = { params: Promise<{ codigo: string }> };

async function negocioIdDe(codigo: string): Promise<number | null> {
  const [neg] = await pool.query(`SELECT id FROM negocios WHERE licitacion_codigo = ? AND activo = 1 LIMIT 1`, [codigo]) as any;
  return (neg as any[])[0]?.id ?? null;
}

// Hilos (migration-138): `padre_id` y el rol del autor. Si la columna aún no existe, se lee como antes.
async function consultarConHilo(sql: (conHilo: boolean) => string, params: unknown[]): Promise<any[]> {
  try {
    const [r] = await pool.query(sql(true), params);
    return r as any[];
  } catch {
    const [r] = await pool.query(sql(false), params);
    return r as any[];
  }
}
const colsHilo = (conHilo: boolean) => conHilo ? 'c.padre_id, u.rol AS usuario_rol' : 'NULL AS padre_id, NULL AS usuario_rol';

// Responde un comentario. Los hilos son de un solo nivel: si se responde a una respuesta, cuelga del
// comentario original. Avisa por la campana al autor del comentario respondido (si no es quien responde).
async function responderComentario({ userId, codigo, padreId, origen, texto }: { userId: number; codigo: string; padreId: number; origen: 'licitacion' | 'negocio'; texto: string }) {
  try {
    const negocioId = origen === 'negocio' ? await negocioIdDe(codigo) : null;
    if (origen === 'negocio' && !negocioId) return { status: 404, cuerpo: { error: 'Negocio no encontrado' } };
    const tabla = origen === 'negocio' ? 'comentarios_negocio' : 'comentarios_licitacion';
    const filtro = origen === 'negocio' ? 'negocio_id = ?' : 'licitacion_codigo = ?';
    const ambito = origen === 'negocio' ? negocioId : codigo;

    const [pr] = await pool.query(`SELECT id, usuario_id, padre_id FROM ${tabla} WHERE id = ? AND ${filtro}`, [padreId, ambito]) as any;
    let padre = (pr as any[])[0];
    if (!padre) return { status: 404, cuerpo: { error: 'El comentario que intentas responder ya no existe' } };
    if (padre.padre_id) {
      const [rr] = await pool.query(`SELECT id, usuario_id, padre_id FROM ${tabla} WHERE id = ? AND ${filtro}`, [padre.padre_id, ambito]) as any;
      padre = (rr as any[])[0] || padre;
    }

    const [ins] = origen === 'negocio'
      ? await pool.query(`INSERT INTO comentarios_negocio (negocio_id, usuario_id, comentario, padre_id, created_at) VALUES (?, ?, ?, ?, ?)`, [negocioId, userId, texto, padre.id, ahoraChileSQL()])
      : await pool.query(`INSERT INTO comentarios_licitacion (licitacion_codigo, usuario_id, comentario, padre_id, created_at) VALUES (?, ?, ?, ?, ?)`, [codigo, userId, texto, padre.id, ahoraChileSQL()]);

    registrarActividad({
      usuarioId: userId, accion: origen === 'negocio' ? 'comentario_negocio' : 'comentario_licitacion',
      entidadTipo: origen === 'negocio' ? 'negocio' : 'licitacion', entidadId: origen === 'negocio' ? String(negocioId) : codigo,
      descripcion: `Respondió un comentario en la licitación ${codigo}`,
      metadata: { licitacion_codigo: codigo, comentario: texto.slice(0, 200), padre_id: padre.id },
    });

    if (Number(padre.usuario_id) !== Number(userId)) {
      (async () => {
        try {
          const [aRows] = await pool.query(`SELECT nombre, email FROM usuarios WHERE id = ?`, [userId]);
          const actorNombre = (aRows as any[])[0]?.nombre || (aRows as any[])[0]?.email || 'Alguien';
          const [nRows] = await pool.query(`SELECT licitacion_nombre FROM negocios WHERE licitacion_codigo = ? AND activo = 1 LIMIT 1`, [codigo]);
          await registrarEvento({
            tipo: 'COMENTARIO', licitacionCodigo: codigo, licitacionNombre: (nRows as any[])[0]?.licitacion_nombre ?? null,
            usuarioId: Number(padre.usuario_id), usuarioNombre: null, actorId: userId, actorNombre,
            mensaje: `${actorNombre} respondió tu comentario: “${texto.replace(/\s+/g, ' ').slice(0, 120)}”`,
            metadata: { licitacion_codigo: codigo, padre_id: padre.id },
          });
        } catch (e) { console.error('[comentarios] notif de respuesta falló:', String(e)); }
      })();
    }

    return { status: 200, cuerpo: { success: true, id: (ins as any).insertId } };
  } catch (error) {
    // Sin la columna `padre_id` (migration-138 sin aplicar) no se pueden guardar respuestas.
    if ((error as any)?.code === 'ER_BAD_FIELD_ERROR')
      return { status: 409, cuerpo: { error: 'Falta aplicar la migración 138 (hilos de comentarios): node scripts/aplicar-migration-138.mjs' } };
    return { status: 500, cuerpo: { error: String(error) } };
  }
}

// GET — lista de comentarios de la licitación
export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { codigo } = await params;
  const codigoDecoded = decodeURIComponent(codigo);
  if (!(await puedeVerLicitacion(request, codigoDecoded)))
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });

  try {
    const rowsLic = await consultarConHilo(conHilo =>
      `SELECT c.id, c.comentario, c.created_at, 'licitacion' AS origen, NULL AS pipeline_estado, ${colsHilo(conHilo)},
              u.id AS usuario_id, u.nombre AS usuario_nombre, u.email AS usuario_email
       FROM comentarios_licitacion c
       JOIN usuarios u ON u.id = c.usuario_id
       WHERE c.licitacion_codigo = ?`,
      [codigoDecoded]);

    // Fusión con los comentarios del negocio vinculado a esta licitación (si existe): la
    // ficha de negocio ya los tenía, pero la ficha pública de la licitación no los mostraba
    // — mismo hilo, dos vistas. Se muestran juntos, ordenados por fecha; el origen viaja en
    // cada fila para que el DELETE sepa en qué tabla borrar.
    let rowsNeg: any[] = [];
    try {
      const negocioId = await negocioIdDe(codigoDecoded);
      if (negocioId) {
        rowsNeg = await consultarConHilo(conHilo =>
          `SELECT c.id, c.comentario, c.created_at, 'negocio' AS origen, c.pipeline_estado, ${colsHilo(conHilo)},
                  u.id AS usuario_id, u.nombre AS usuario_nombre, u.email AS usuario_email
           FROM comentarios_negocio c
           JOIN usuarios u ON u.id = c.usuario_id
           WHERE c.negocio_id = ?`,
          [negocioId]);
      }
    } catch (e) { console.warn('[licitacion-comentarios] fusión con negocio falló (no bloquea):', String(e)); }

    const comentarios = [...rowsLic, ...rowsNeg]
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
    const { comentario, padre_id, origen } = await request.json();
    if (!comentario?.trim())
      return NextResponse.json({ error: 'El comentario no puede estar vacío' }, { status: 400 });

    // Respuesta a un comentario (hilo): se guarda en la MISMA tabla que el comentario original.
    if (padre_id) {
      const r = await responderComentario({ userId, codigo: codigoDecoded, padreId: Number(padre_id), origen: origen === 'negocio' ? 'negocio' : 'licitacion', texto: comentario.trim() });
      return NextResponse.json(r.cuerpo, { status: r.status });
    }

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
    // borrarlo de la tabla que corresponda según el origen que viajó con la fila. Al borrar un
    // comentario se borran también sus respuestas (hilo).
    const borrarRespuestas = async (tabla: string, id: string) => {
      try { await pool.query(`DELETE FROM ${tabla} WHERE padre_id = ?`, [id]); } catch { /* sin migration-138 no hay hilos */ }
    };
    if (origen === 'negocio') {
      const negocioId = await negocioIdDe(codigoDecoded);
      if (!negocioId) return NextResponse.json({ error: 'Negocio no encontrado' }, { status: 404 });
      const [r] = (rol === 'admin'
        ? await pool.query(`DELETE FROM comentarios_negocio WHERE id = ? AND negocio_id = ?`, [comentarioId, negocioId])
        : await pool.query(`DELETE FROM comentarios_negocio WHERE id = ? AND negocio_id = ? AND usuario_id = ?`, [comentarioId, negocioId, userId])) as any;
      if ((r as any).affectedRows > 0) await borrarRespuestas('comentarios_negocio', comentarioId);
      return NextResponse.json({ success: true });
    }

    const [r] = (rol === 'admin'
      ? await pool.query(`DELETE FROM comentarios_licitacion WHERE id = ? AND licitacion_codigo = ?`, [comentarioId, codigoDecoded])
      : await pool.query(`DELETE FROM comentarios_licitacion WHERE id = ? AND licitacion_codigo = ? AND usuario_id = ?`, [comentarioId, codigoDecoded, userId])) as any;
    if ((r as any).affectedRows > 0) await borrarRespuestas('comentarios_licitacion', comentarioId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
