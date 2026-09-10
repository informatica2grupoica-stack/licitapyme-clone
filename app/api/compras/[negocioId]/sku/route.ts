// app/api/compras/[negocioId]/sku/route.ts
// Creación de SKU (spec §7): se habilita recién con la Compuerta 1 (Aprobación de compra) resuelta.
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { listarSkus, crearSku, type DatosSku } from '@/app/lib/compras-aprobaciones';
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

    const skus = await listarSkus(id);
    return NextResponse.json({ success: true, skus });
  } catch (error) {
    console.error('[compras/sku][GET]', String(error));
    return NextResponse.json({ error: 'No se pudieron cargar los SKU.' }, { status: 500 });
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
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const body = await request.json();
    const productoId = Number(body.productoId);
    if (!Number.isFinite(productoId)) return NextResponse.json({ error: 'Falta productoId' }, { status: 400 });

    const datos: DatosSku = {
      skuPropio: body.skuPropio, skuProveedor: body.skuProveedor || null,
      proveedorNombre: body.proveedorNombre || null, marca: body.marca || null, modelo: body.modelo || null,
      obumaProductoId: body.obumaProductoId || null,
      crearEnObuma: !!body.crearEnObuma, obumaSubcategoriaId: body.obumaSubcategoriaId || null,
      nombreObuma: body.nombreObuma || null,
      costoEsperado: body.costoEsperado != null ? Number(body.costoEsperado) : null,
    };
    const skuId = await crearSku(id, productoId, datos, userId, nombre);
    const skus = await listarSkus(id);
    return NextResponse.json({ success: true, id: skuId, skus });
  } catch (error: any) {
    console.error('[compras/sku][POST]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo crear el SKU.' }, { status: 400 });
  }
}
