// app/api/compras/[negocioId]/costo-real/route.ts
// Costo real CONSOLIDADO del negocio (costeo + gastos + importación, contrastado con Obuma) y su
// CIERRE con resultado final (24-sep-2026). GET = mirar; POST = cerrar el resultado.
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { costoRealDeNegocio, obtenerCierre, cerrarResultado } from '@/app/lib/compras-costo-real';
import { puedeOperarCompras, puedeVerCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol, nombre: req.headers.get('x-user-nombre') };
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);
  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeVerCompras(userId, rol, asignacion.asignadoA))) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });
    const [resultado, cierre] = await Promise.all([costoRealDeNegocio(id), obtenerCierre(id)]);
    return NextResponse.json({ success: true, resultado, cierre });
  } catch (error: any) {
    console.error('[compras/costo-real][GET]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo calcular el costo real.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);
  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA))) return NextResponse.json({ error: 'Sin permiso para cerrar el resultado.' }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const r = await cerrarResultado(id, typeof body?.motivoIncompleto === 'string' ? body.motivoIncompleto : null, userId, nombre);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ success: true, cierre: r.cierre });
  } catch (error: any) {
    console.error('[compras/costo-real][POST]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo cerrar el resultado.' }, { status: 500 });
  }
}
