// app/api/compras/[negocioId]/orden-compra-obuma/route.ts
// Órdenes de compra REALES contra Obuma (spec §11.1) — una por proveedor del escenario elegido.
// GET: proveedores del escenario elegido con sus ítems y si ya tienen OC creada.
// POST: crea la OC de verdad en Obuma para UN proveedor (escritura real).
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { proveedoresParaOrdenCompra, crearOrdenCompraParaProveedor } from '@/app/lib/compras-oc-obuma';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';
import { parsearMontoCL } from '@/app/lib/numeros';
import { sincronizarComprasObuma } from '@/app/lib/obuma-compras';
import { buscarCentroCostoPorLicitacion, centrosDeCostoCompleto } from '@/app/lib/obuma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Params = { params: Promise<{ negocioId: string }> };

const ultimaSyncObuma = new Map<number, number>();

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
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    // Las OC hechas directo en Obuma solo se ven si la copia local está al día: se refresca esta licitación (máx. 1 vez por minuto).
    const ultima = ultimaSyncObuma.get(id) ?? 0;
    if (Date.now() - ultima > 60_000) {
      ultimaSyncObuma.set(id, Date.now());
      await Promise.race([
        sincronizarComprasObuma({ paginas: 5, soloCodigo: asignacion.licitacionCodigo }),
        new Promise(r => setTimeout(r, 15_000)),
      ]).catch(e => console.warn('[compras/orden-compra-obuma] sync previo falló:', String(e).slice(0, 150)));
    }

    const [proveedores, centroCosto, centros] = await Promise.all([
      proveedoresParaOrdenCompra(id),
      buscarCentroCostoPorLicitacion(asignacion.licitacionCodigo).catch(() => null),
      centrosDeCostoCompleto().catch(() => []),
    ]);
    // Lista para el selector del formulario de la OC (solo activos, los más nuevos primero).
    const centrosCosto = centros.filter(c => c.activo).sort((a, b) => Number(b.id) - Number(a.id)).map(c => ({ id: c.id, nombre: c.nombre }));
    return NextResponse.json({ success: true, proveedores, centroCosto, centrosCosto });
  } catch (error: any) {
    console.error('[compras/orden-compra-obuma][GET]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudieron cargar las órdenes de compra.' }, { status: 500 });
  }
}

async function __POST(request: NextRequest, { params }: Params) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    if (asignacion.precompra)
      return NextResponse.json({ error: 'Esto es una pre-compra: aún no hay adjudicación firme, así que no se pueden emitir órdenes de compra a proveedores.' }, { status: 409 });

    const body = await request.json();
    const proveedorNombre = String(body.proveedorNombre || '').trim();
    if (!proveedorNombre) return NextResponse.json({ error: 'Falta el proveedor.' }, { status: 400 });
    const formaPagoId = String(body.formaPagoId || '').trim();
    if (!formaPagoId) return NextResponse.json({ error: 'Falta la forma de pago.' }, { status: 400 });

    const resultado = await crearOrdenCompraParaProveedor(id, proveedorNombre, {
      formaPagoId, incluirFlete: !!body.incluirFlete,
      fleteMonto: parsearMontoCL(body.fleteMonto),
      confirmarPeseADuplicado: !!body.confirmarPeseADuplicado,
      centroCostoId: /^\d+$/.test(String(body.centroCostoId ?? '')) ? String(body.centroCostoId) : undefined,
      productoIds: Array.isArray(body.productoIds) ? body.productoIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : undefined,
    }, userId, nombre);

    return NextResponse.json({ success: true, ...resultado });
  } catch (error: any) {
    console.error('[compras/orden-compra-obuma][POST]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo crear la orden de compra.' }, { status: 400 });
  }
}

export const POST = conBitacoraCompras(__POST, 'POST');
