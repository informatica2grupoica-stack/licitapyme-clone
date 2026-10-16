// app/api/compras/[negocioId]/sku/[skuId]/obuma/route.ts
// Detalle en vivo del producto que Obuma tiene para este SKU (nombre, código, precios, categoría). Solo lectura, a pedido.
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { detalleObumaDeSku } from '@/app/lib/compras-aprobaciones';
import { puedeVerCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string; skuId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  const rol = request.headers.get('x-user-rol');
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId, skuId } = await params;
  const id = parseInt(negocioId);
  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeVerCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });
    return NextResponse.json({ success: true, producto: await detalleObumaDeSku(id, Number(skuId)) });
  } catch (error: any) {
    console.error('[compras/sku/obuma][GET]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo consultar Obuma.' }, { status: 400 });
  }
}
