// app/api/compras/[negocioId]/orden-compra-obuma/route.ts
// Órdenes de compra REALES contra Obuma (spec §11.1) — una por proveedor del escenario elegido.
// GET: proveedores del escenario elegido con sus ítems y si ya tienen OC creada.
// POST: crea la OC de verdad en Obuma para UN proveedor (escritura real).
import { mensajeSeguro } from '@/app/lib/errores-api';
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { proveedoresParaOrdenCompra, crearOrdenCompraParaProveedor, marcarCompradosConOc } from '@/app/lib/compras-oc-obuma';
import { revisarMargenAprobado } from '@/app/lib/compras-aprobaciones';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';
import { parsearMontoCL } from '@/app/lib/numeros';
import { sincronizarComprasObuma } from '@/app/lib/obuma-compras';
import { buscarCentroCostoPorLicitacion, centrosDeCostoCompleto, listarMonedasExtranjerasObuma } from '@/app/lib/obuma';
import { obtenerTipoCambio } from '@/app/lib/tipo-cambio';

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
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'negocioId inválido' }, { status: 400 });

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

    const [proveedores, centroCosto, centros, monedas, usdHoy, eurHoy] = await Promise.all([
      proveedoresParaOrdenCompra(id),
      buscarCentroCostoPorLicitacion(asignacion.licitacionCodigo).catch(() => null),
      centrosDeCostoCompleto().catch(() => []),
      // Para la OC internacional: monedas extranjeras de Obuma y el tipo de cambio de hoy (precarga, la persona lo puede cambiar).
      listarMonedasExtranjerasObuma().catch(() => []),
      // Con tope de 4 s: si mindicador.cl está lento no frena la pantalla (queda el campo vacío para escribirlo a mano).
      Promise.race([obtenerTipoCambio('USD'), new Promise<null>(r => setTimeout(() => r(null), 4_000))]).catch(() => null),
      Promise.race([obtenerTipoCambio('EUR'), new Promise<null>(r => setTimeout(() => r(null), 4_000))]).catch(() => null),
    ]);
    const tiposCambioHoy: Record<string, number> = {};
    if (usdHoy) tiposCambioHoy.USD = usdHoy.valor;
    if (eurHoy) tiposCambioHoy.EUR = eurHoy.valor;
    // Recién sincronizado con Obuma: lo que ya tiene OC pasa a «Comprado».
    await marcarCompradosConOc(id, proveedores).catch(e => console.warn('[compras/orden-compra-obuma] marcar Comprado por OC:', String(e).slice(0, 150)));
    // Y si una OC cambió el costo de la compra, el margen aprobado se revisa (reabre la compuerta 2 si bajó).
    await revisarMargenAprobado(id).catch(e => console.warn('[compras/orden-compra-obuma] revisar margen:', String(e).slice(0, 150)));
    // Lista para el selector del formulario de la OC (solo activos, los más nuevos primero).
    const centrosCosto = centros.filter(c => c.activo).sort((a, b) => Number(b.id) - Number(a.id)).map(c => ({ id: c.id, nombre: c.nombre }));
    return NextResponse.json({ success: true, proveedores, centroCosto, centrosCosto, monedas, tiposCambioHoy });
  } catch (error: any) {
    console.error('[compras/orden-compra-obuma][GET]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudieron cargar las órdenes de compra.') }, { status: 500 });
  }
}

async function __POST(request: NextRequest, { params }: Params) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'negocioId inválido' }, { status: 400 });

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
      fechaEntrega: String(body.fechaEntrega || '').trim(), metodoDespacho: String(body.metodoDespacho || '').trim(),
      productoIds: Array.isArray(body.productoIds) ? body.productoIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : undefined,
      internacional: !!body.internacional,
      monedaId: body.internacional ? String(body.monedaId ?? '').trim() || null : null,
      // Tipo de cambio con decimales («943,52» o «943.52»).
      tipoCambio: body.internacional ? Number(String(body.tipoCambio ?? '').trim().replace(',', '.')) : null,
    }, userId, nombre);

    return NextResponse.json({ success: true, ...resultado });
  } catch (error: any) {
    console.error('[compras/orden-compra-obuma][POST]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudo crear la orden de compra.') }, { status: 400 });
  }
}

export const POST = conBitacoraCompras(__POST, 'POST');
