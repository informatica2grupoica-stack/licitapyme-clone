// app/api/compras/[negocioId]/pagos-oc/route.ts
// Pagos a proveedores por orden de compra (migration-157): anticipo / pago total / saldo, cada uno
// con su comprobante. GET también devuelve las OC reales de Obuma con sus facturas, para que la
// pantalla muestre la factura de cada OC sin que nadie la registre a mano.
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { listarPagosOc, ocsConFacturas, registrarPagoOc, quitarPagoOc, type TipoPagoOc } from '@/app/lib/compras-pagos-oc';
import { puedeOperarReparto } from '@/app/api/compras/[negocioId]/reparto/route';
import { subirDocumentoR2 } from '@/app/lib/r2';
import { parsearMontoCL } from '@/app/lib/numeros';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  return { id: id ? parseInt(id) : null, rol: req.headers.get('x-user-rol'), nombre: req.headers.get('x-user-nombre') };
}

async function acceso(request: NextRequest, negocioId: string) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  const id = parseInt(negocioId);
  const asignacion = await obtenerAsignacion(id);
  if (!asignacion) return { error: NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 }) };
  if (!(await puedeOperarReparto(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
    return { error: NextResponse.json({ error: 'Sin acceso.' }, { status: 403 }) };
  return { id, userId, nombre, asignacion };
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, (await params).negocioId);
    if ('error' in a) return a.error;
    const [pagos, ocs] = await Promise.all([listarPagosOc(a.id), ocsConFacturas(a.id)]);
    return NextResponse.json({ success: true, pagos, ocs });
  } catch (error) {
    console.error('[compras/pagos-oc][GET]', String(error));
    return NextResponse.json({ error: 'No se pudieron cargar los pagos.' }, { status: 500 });
  }
}

async function __POST(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, (await params).negocioId);
    if ('error' in a) return a.error;
    const form = await request.formData();
    // Uno o varios comprobantes por pago (transferencia + factura, pago en partes, etc.).
    const files = (form.getAll('file') as File[]).filter(f => f && f.size > 0);
    if (files.length === 0) return NextResponse.json({ error: 'Falta el comprobante del pago.' }, { status: 400 });
    const adjuntos = await Promise.all(files.map(async f => ({
      url: await subirDocumentoR2(`compras/${a.asignacion.licitacionCodigo}/pagos`, f.name, Buffer.from(await f.arrayBuffer()), f.type),
      nombre: f.name,
    })));
    await registrarPagoOc(a.id, {
      ocFolio: String(form.get('ocFolio') || ''),
      proveedorNombre: (form.get('proveedorNombre') as string) || null,
      tipo: String(form.get('tipo') || '') as TipoPagoOc,
      monto: parsearMontoCL(String(form.get('monto') || '')) ?? 0,
      fecha: String(form.get('fecha') || ''),
      adjuntos,
      nota: (form.get('nota') as string) || null,
    }, a.userId, a.nombre);
    return NextResponse.json({ success: true, pagos: await listarPagosOc(a.id) });
  } catch (error: any) {
    console.error('[compras/pagos-oc][POST]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo registrar el pago.' }, { status: 400 });
  }
}

async function __DELETE(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, (await params).negocioId);
    if ('error' in a) return a.error;
    const pagoId = parseInt(request.nextUrl.searchParams.get('id') || '');
    if (!pagoId) return NextResponse.json({ error: 'Falta el pago.' }, { status: 400 });
    await quitarPagoOc(a.id, pagoId, a.userId, a.nombre);
    return NextResponse.json({ success: true, pagos: await listarPagosOc(a.id) });
  } catch (error: any) {
    console.error('[compras/pagos-oc][DELETE]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo quitar el pago.' }, { status: 400 });
  }
}

export const POST = conBitacoraCompras(__POST, 'POST');
export const DELETE = conBitacoraCompras(__DELETE, 'DELETE');
