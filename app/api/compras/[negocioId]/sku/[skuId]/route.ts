// app/api/compras/[negocioId]/sku/[skuId]/route.ts
// DELETE: deshace un SKU SOLO en Licitank (el producto creado en Obuma no se borra desde acá).
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { eliminarSkuLocal } from '@/app/lib/compras-aprobaciones';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string; skuId: string }> };

async function __DELETE(request: NextRequest, { params }: Params) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  const rol = request.headers.get('x-user-rol');
  const nombre = request.headers.get('x-user-nombre');
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId, skuId } = await params;
  const id = parseInt(negocioId);
  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });
    const r = await eliminarSkuLocal(id, Number(skuId), userId, nombre);
    return NextResponse.json({ success: true, ...r });
  } catch (error: any) {
    console.error('[compras/sku][DELETE]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo deshacer el SKU.' }, { status: 400 });
  }
}

export const DELETE = conBitacoraCompras(__DELETE, 'DELETE');
