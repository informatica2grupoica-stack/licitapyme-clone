// app/api/compras/[negocioId]/orden-compra-obuma/detalle/route.ts
// Vista propia de la(s) orden(es) de compra ya emitidas para este negocio (spec §11 — "rescatar el
// documento de Obuma para ver la OC"). Ver ordenesCompraParaVista en compras-oc-obuma.ts.
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { ordenesCompraParaVista } from '@/app/lib/compras-oc-obuma';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

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

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const ordenes = await ordenesCompraParaVista(id);
    return NextResponse.json({ success: true, ordenes });
  } catch (error: any) {
    console.error('[compras/orden-compra-obuma/detalle][GET]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo cargar la orden de compra.' }, { status: 500 });
  }
}
