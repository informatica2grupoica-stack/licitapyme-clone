// app/api/compras/[negocioId]/actividad/route.ts
// LÍNEA DE TIEMPO del proyecto en Compras — pedido explícito del usuario (11-sep-2026): "saber qué
// se hizo día 1, 2, 3... hasta terminar". El dato ya existía (cada acción de Compras se registra en
// historial_eventos vía registrarEvento(), ver app/lib/compras.ts) pero nunca se mostraba en el
// módulo — se leía por request personal en la campana, no como bitácora del PROYECTO.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { obtenerAsignacion } from '@/app/lib/compras';
import { puedeVerCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'negocioId inválido' }, { status: 400 });

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeVerCompras(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    // Solo eventos DE COMPRAS (tipo empieza con COMPRAS_) más el "día 0" — cuándo se ganó. Se deja
    // fuera el resto del historial de la licitación (comentarios de postulación, recordatorios de
    // cierre, etc.): esta es la bitácora del proyecto EN Compras, no de todo su historial.
    const [rows]: any = await pool.query(
      `SELECT tipo, mensaje, actor_nombre, usuario_nombre, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS creado_at
         FROM historial_eventos
        WHERE licitacion_codigo = ?
          AND (tipo LIKE 'COMPRAS_%' OR tipo IN ('RESULTADO_ADJUDICACION', 'PROYECTO_GANADO'))
        ORDER BY created_at ASC`,
      [asignacion.licitacionCodigo],
    );
    // El evento de adjudicación se repite una vez por destinatario (mismo patrón que el resto del
    // historial) — se deduplica por (tipo, creado_at) para no mostrar la misma línea 4 veces.
    const vistos = new Set<string>();
    const eventos = (rows as any[]).filter(r => {
      const k = `${r.tipo}|${r.creado_at}`;
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    }).map(r => ({
      tipo: r.tipo, mensaje: r.mensaje,
      actor: r.actor_nombre || r.usuario_nombre || null,
      creadoAt: r.creado_at,
    }));

    return NextResponse.json({ success: true, eventos });
  } catch (error: any) {
    console.error('[compras/[negocioId]/actividad][GET]', String(error));
    return NextResponse.json({ error: 'No se pudo cargar la actividad.' }, { status: 500 });
  }
}
