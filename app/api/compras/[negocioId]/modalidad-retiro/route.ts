// app/api/compras/[negocioId]/modalidad-retiro/route.ts
// §13.2 — modalidad de retiro (interna/externa/mixta): se define en el primer instante, la define
// el humano, el sistema no la calcula ni la propone acá.
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { obtenerModalidadRetiro, definirModalidadRetiro, type ModalidadRetiro } from '@/app/lib/compras-logistica';
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

    const info = await obtenerModalidadRetiro(id);
    return NextResponse.json({ success: true, ...info });
  } catch (error) {
    console.error('[compras/modalidad-retiro][GET]', String(error));
    return NextResponse.json({ error: 'No se pudo cargar la modalidad de retiro.' }, { status: 500 });
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
    await definirModalidadRetiro(id, body.modalidad as ModalidadRetiro, userId, nombre);
    const info = await obtenerModalidadRetiro(id);
    return NextResponse.json({ success: true, ...info });
  } catch (error: any) {
    console.error('[compras/modalidad-retiro][PUT]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo definir la modalidad.' }, { status: 400 });
  }
}
