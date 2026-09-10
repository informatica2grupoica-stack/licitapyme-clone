// app/api/compras/[negocioId]/postventa/route.ts
// §17.1 — los compromisos de postventa vienen del resumen ejecutivo (paquete de traspaso); acá
// solo se marca cuáles ya se resolvieron.
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { listarPostventa, marcarPostventaResuelta, desmarcarPostventa } from '@/app/lib/compras-entrega';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  const nombre = req.headers.get('x-user-nombre');
  return { id: id ? parseInt(id) : null, rol, nombre };
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const compromisos = asignacion.resumen ? ((asignacion.resumen as any).compromisosPostventa || []) : [];
    const garantias = asignacion.resumen ? ((asignacion.resumen as any).garantias || []) : [];
    const resueltos = await listarPostventa(id);
    return NextResponse.json({
      success: true,
      compromisos: compromisos.map((c: any) => ({ titulo: c.titulo, descripcion: c.descripcion ?? null, ...(resueltos.get(c.titulo) || { resuelto: false, resueltoPorNombre: null, resueltoAt: null, notas: null }) })),
      garantias,
    });
  } catch (error) {
    console.error('[compras/postventa][GET]', String(error));
    return NextResponse.json({ error: 'No se pudo cargar la postventa.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const body = await request.json();
    if (body.resuelto) await marcarPostventaResuelta(id, body.compromisoTexto, body.notas || null, userId, nombre);
    else await desmarcarPostventa(id, body.compromisoTexto);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[compras/postventa][PATCH]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo actualizar.' }, { status: 400 });
  }
}
