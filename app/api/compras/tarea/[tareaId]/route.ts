// app/api/compras/tarea/[tareaId]/route.ts
// MÓDULO DE COMPRAS — cambia el estado de UNA tarea (PENDIENTE → EN_CURSO → HECHA). Sin estado
// "incumplida" (§5.1): el reloj de entrega es lo que falla, no la tarea.
//
// En la MISMA llamada se puede guardar QUÉ SE HIZO (§5.3/§5.4): las respuestas al formulario que
// declara el catálogo de esa tarea, y la marca de hallazgo. Van juntos a propósito — el encargado
// llena el cuestionario y cierra la tarea en un solo gesto, no en dos.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { cambiarEstadoTarea, guardarRegistroTarea, obtenerAsignacion, type EstadoTarea } from '@/app/lib/compras';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ tareaId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

const ESTADOS_VALIDOS: EstadoTarea[] = ['PENDIENTE', 'EN_CURSO', 'HECHA'];

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { tareaId } = await params;
  const id = parseInt(tareaId);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'tareaId inválido' }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  // `estado` es opcional: se puede anotar el registro de la tarea sin moverla de estado (se va
  // llenando mientras está EN_CURSO). Si viene, tiene que ser uno de los tres válidos.
  const estado = body.estado === undefined ? null : body.estado as EstadoTarea;
  if (estado !== null && !ESTADOS_VALIDOS.includes(estado)) return NextResponse.json({ error: 'Estado inválido.' }, { status: 400 });
  const hayRegistro = body.registro !== undefined || body.hallazgo !== undefined;
  if (estado === null && !hayRegistro) return NextResponse.json({ error: 'No hay nada que actualizar.' }, { status: 400 });

  try {
    const [rows] = await pool.query('SELECT negocio_id FROM compras_tarea WHERE id = ? LIMIT 1', [id]) as any;
    const negocioId = (rows as any[])[0]?.negocio_id;
    if (!negocioId) return NextResponse.json({ error: 'Tarea no encontrada.' }, { status: 404 });

    const asignacion = await obtenerAsignacion(negocioId);
    if (!asignacion || !(await puedeOperarCompras(userId, rol, asignacion.asignadoA))) {
      return NextResponse.json({ error: 'Sin acceso a esta tarea.' }, { status: 403 });
    }

    const [urows] = await pool.query('SELECT nombre FROM usuarios WHERE id = ? LIMIT 1', [userId]) as any;
    const actorNombre = (urows as any[])[0]?.nombre || null;

    // El registro se guarda ANTES del cambio de estado: si la tarea se está cerrando, lo que quedó
    // anotado es lo que la justifica (§5.1: "cierre sin ejecución: no permitido").
    if (hayRegistro) {
      await guardarRegistroTarea(id, {
        registro: (body.registro && typeof body.registro === 'object') ? body.registro : {},
        hallazgo: !!body.hallazgo,
      });
    }
    if (estado !== null) {
      await cambiarEstadoTarea(id, estado, {
        actorId: userId, actorNombre,
        notaCierre: body.notaCierre ? String(body.notaCierre).slice(0, 2000) : null,
      });
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[compras/tarea/[tareaId]][PATCH]', String(error));
    return NextResponse.json({ error: 'No se pudo actualizar la tarea.' }, { status: 500 });
  }
}
