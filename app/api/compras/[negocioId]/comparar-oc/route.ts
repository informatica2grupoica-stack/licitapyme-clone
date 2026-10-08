// app/api/compras/[negocioId]/comparar-oc/route.ts
// GET ?oc=<folio de la OC en Obuma>: cotización del plan, OC de Obuma y factura(s), lado a lado. Solo lectura.
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { compararOrdenCompra } from '@/app/lib/compras-comparar-oc';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  const rol = request.headers.get('x-user-rol');
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const id = parseInt((await params).negocioId);
  const oc = request.nextUrl.searchParams.get('oc');
  if (!oc) return NextResponse.json({ error: 'Falta la orden de compra.' }, { status: 400 });
  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA))) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });
    const comparacion = await compararOrdenCompra(id, oc);
    if (!comparacion) return NextResponse.json({ error: 'Esa orden de compra no es de este negocio.' }, { status: 404 });
    return NextResponse.json({ success: true, comparacion });
  } catch (error: any) {
    console.error('[compras/comparar-oc][GET]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo armar la comparación.' }, { status: 500 });
  }
}
