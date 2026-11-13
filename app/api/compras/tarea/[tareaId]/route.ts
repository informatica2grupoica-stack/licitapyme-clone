// app/api/compras/tarea/[tareaId]/route.ts
// MÓDULO DE COMPRAS — cambia el estado de UNA tarea (PENDIENTE → EN_CURSO → HECHA). Sin estado
// "incumplida" (§5.1): el reloj de entrega es lo que falla, no la tarea.
//
// En la MISMA llamada se puede guardar QUÉ SE HIZO (§5.3/§5.4): las respuestas al formulario que
// declara el catálogo de esa tarea, y la marca de hallazgo. Van juntos a propósito — el encargado
// llena el cuestionario y cierra la tarea en un solo gesto, no en dos.
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { registrarEvento } from '@/app/lib/historial';
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

async function __PATCH(request: NextRequest, { params }: Params) {
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
    if (!asignacion || !(await puedeOperarCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados))) {
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
      }, { id: userId, nombre: actorNombre });
    }
    if (estado !== null) {
      // QA 13-nov: §5.1 «cierre sin ejecución: no permitido» no se cumplía (se cerraba una validación vacía) y una tarea hecha
      // se reabría sin dejar rastro. Ahora: tarea con formulario → cerrar exige lo anotado (o una nota de 10+ letras);
      // reabrir una HECHA exige motivo, que queda en la bitácora.
      const [trows] = await pool.query(
        `SELECT t.estado, t.titulo, t.registro_json, c.campos_json FROM compras_tarea t
           LEFT JOIN compras_tarea_catalogo c ON c.clave = t.catalogo_clave WHERE t.id = ? LIMIT 1`, [id]) as any;
      const t = (trows as any[])[0];
      const nota = String(body.notaCierre || '').trim();
      if (estado === 'HECHA' && t?.campos_json && !t.registro_json && nota.length < 10)
        return NextResponse.json({ error: 'Esta tarea tiene formulario: anota lo que se hizo antes de cerrarla (o escribe una nota de cierre de al menos 10 caracteres).' }, { status: 400 });
      if (t?.estado === 'HECHA' && estado !== 'HECHA') {
        if (nota.length < 5) return NextResponse.json({ error: 'Para reabrir una tarea hecha, escribe el motivo.' }, { status: 400 });
        await registrarEvento({
          tipo: 'COMPRAS_TAREA_REABIERTA', licitacionCodigo: asignacion.licitacionCodigo, actorId: userId, actorNombre,
          mensaje: `Se reabrió la tarea «${t.titulo}»: ${nota.slice(0, 300)}`, metadata: { negocio_id: negocioId, tarea_id: id },
        }).catch(() => {});
      }
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

export const PATCH = conBitacoraCompras(__PATCH, 'PATCH');
