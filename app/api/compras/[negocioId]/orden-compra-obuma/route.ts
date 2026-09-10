// app/api/compras/[negocioId]/orden-compra-obuma/route.ts
// Órdenes de compra REALES contra Obuma (spec §11.1) — una por proveedor del escenario elegido.
// GET: proveedores del escenario elegido con sus ítems y si ya tienen OC creada.
// POST: crea la OC de verdad en Obuma para UN proveedor (escritura real).
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { proveedoresParaOrdenCompra, crearOrdenCompraParaProveedor } from '@/app/lib/compras-oc-obuma';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';
import { parsearMontoCL } from '@/app/lib/numeros';
import { buscarCentroCostoPorLicitacion } from '@/app/lib/obuma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

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

    const [proveedores, centroCosto] = await Promise.all([
      proveedoresParaOrdenCompra(id),
      buscarCentroCostoPorLicitacion(asignacion.licitacionCodigo).catch(() => null),
    ]);
    return NextResponse.json({ success: true, proveedores, centroCosto });
  } catch (error: any) {
    console.error('[compras/orden-compra-obuma][GET]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudieron cargar las órdenes de compra.' }, { status: 500 });
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
    const proveedorNombre = String(body.proveedorNombre || '').trim();
    if (!proveedorNombre) return NextResponse.json({ error: 'Falta el proveedor.' }, { status: 400 });
    const formaPagoId = String(body.formaPagoId || '').trim();
    if (!formaPagoId) return NextResponse.json({ error: 'Falta la forma de pago.' }, { status: 400 });

    const resultado = await crearOrdenCompraParaProveedor(id, proveedorNombre, {
      formaPagoId, incluirFlete: !!body.incluirFlete,
      fleteMonto: parsearMontoCL(body.fleteMonto),
    }, userId, nombre);

    return NextResponse.json({ success: true, ...resultado });
  } catch (error: any) {
    console.error('[compras/orden-compra-obuma][POST]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo crear la orden de compra.' }, { status: 400 });
  }
}
