// app/api/compras/[negocioId]/reloj/route.ts
// Reloj de entrega (spec §15). GET trae el estado + escenarios de multa (§15.6). PUT fija el reloj
// (§15.1 — validación manual obligatoria).
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { obtenerEstadoReloj, fijarReloj, calcularEscenariosMulta, type PlazoTipo } from '@/app/lib/compras-reloj';
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

    const incluirMultas = request.nextUrl.searchParams.get('multas') === '1';
    const [reloj, escenariosMulta] = await Promise.all([
      obtenerEstadoReloj(id), incluirMultas ? calcularEscenariosMulta(id) : Promise.resolve(null),
    ]);
    return NextResponse.json({ success: true, reloj, escenariosMulta });
  } catch (error) {
    console.error('[compras/reloj][GET]', String(error));
    return NextResponse.json({ error: 'No se pudo cargar el reloj de entrega.' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
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
    await fijarReloj(id, body.hitoInicio, body.fechaInicio, Number(body.plazoDias), body.plazoTipo as PlazoTipo, userId, nombre);
    const reloj = await obtenerEstadoReloj(id);
    return NextResponse.json({ success: true, reloj });
  } catch (error: any) {
    console.error('[compras/reloj][PUT]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo fijar el reloj.' }, { status: 400 });
  }
}
