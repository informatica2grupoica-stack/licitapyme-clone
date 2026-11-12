// app/api/compras/[negocioId]/factura-venta/route.ts
// Factura de venta al cliente final: GET lista · POST (multipart: file, numero?, emitidaAt?, pagadaAt?) la sube y marca sola la tarea
// «Factura y cierre del proyecto» · PATCH {id, numero?, emitidaAt?, pagadaAt?} · DELETE ?id=
import { mensajeSeguro } from '@/app/lib/errores-api';
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';
import { subirDocumentoR2 } from '@/app/lib/r2';
import { errorDeArchivoSubido } from '@/app/lib/subidas';
import { listarFacturasVenta, registrarFacturaVenta, actualizarFacturaVenta, quitarFacturaVenta, fechaValida } from '@/app/lib/compras-factura-venta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

async function acceso(request: NextRequest, negocioId: string) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  const rol = request.headers.get('x-user-rol'); const nombre = request.headers.get('x-user-nombre');
  if (!userId) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  const id = parseInt(negocioId);
  if (!Number.isFinite(id)) return { error: NextResponse.json({ error: 'negocioId inválido' }, { status: 400 }) };
  const asignacion = await obtenerAsignacion(id);
  if (!asignacion) return { error: NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 }) };
  if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
    return { error: NextResponse.json({ error: 'Sin acceso.' }, { status: 403 }) };
  return { id, userId, nombre, asignacion };
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, (await params).negocioId);
    if ('error' in a) return a.error;
    return NextResponse.json({ success: true, facturas: await listarFacturasVenta(a.id).catch(() => []) });
  } catch (e) {
    console.error('[compras/factura-venta][GET]', String(e));
    return NextResponse.json({ error: 'No se pudo cargar la factura de venta.' }, { status: 500 });
  }
}

async function __POST(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, (await params).negocioId);
    if ('error' in a) return a.error;
    const form = await request.formData();
    const f = form.get('file') as File | null;
    if (!f || !f.size) return NextResponse.json({ error: 'Falta el archivo de la factura.' }, { status: 400 });
    const errArchivo = errorDeArchivoSubido(f);
    if (errArchivo) return NextResponse.json({ error: errArchivo }, { status: 400 });
    const url = await subirDocumentoR2(`compras/${a.asignacion.licitacionCodigo}/factura-venta`, f.name, Buffer.from(await f.arrayBuffer()), f.type);
    const numero = String(form.get('numero') || '').trim().slice(0, 40) || null;
    const r = await registrarFacturaVenta(a.id, {
      archivoUrl: url, archivoNombre: f.name, numero, emitidaAt: fechaValida(form.get('emitidaAt')), pagadaAt: fechaValida(form.get('pagadaAt')),
    }, a.userId, a.nombre);
    return NextResponse.json({ success: true, tareaMarcada: r.tareaMarcada, facturas: await listarFacturasVenta(a.id) });
  } catch (e: any) {
    console.error('[compras/factura-venta][POST]', String(e));
    return NextResponse.json({ error: mensajeSeguro(e, 'No se pudo subir la factura.') }, { status: 400 });
  }
}

async function __PATCH(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, (await params).negocioId);
    if ('error' in a) return a.error;
    const b = await request.json();
    const id = parseInt(b.id);
    if (!Number.isFinite(id)) return NextResponse.json({ error: 'Falta la factura.' }, { status: 400 });
    await actualizarFacturaVenta(a.id, id, {
      numero: b.numero === undefined ? undefined : (String(b.numero || '').trim().slice(0, 40) || null),
      emitidaAt: b.emitidaAt === undefined ? undefined : fechaValida(b.emitidaAt),
      pagadaAt: b.pagadaAt === undefined ? undefined : fechaValida(b.pagadaAt),
    });
    return NextResponse.json({ success: true, facturas: await listarFacturasVenta(a.id) });
  } catch (e: any) {
    return NextResponse.json({ error: mensajeSeguro(e, 'No se pudo actualizar la factura.') }, { status: 400 });
  }
}

async function __DELETE(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, (await params).negocioId);
    if ('error' in a) return a.error;
    const id = parseInt(request.nextUrl.searchParams.get('id') || '');
    if (!Number.isFinite(id)) return NextResponse.json({ error: 'Falta la factura.' }, { status: 400 });
    await quitarFacturaVenta(a.id, id);
    return NextResponse.json({ success: true, facturas: await listarFacturasVenta(a.id) });
  } catch (e: any) {
    return NextResponse.json({ error: mensajeSeguro(e, 'No se pudo quitar la factura.') }, { status: 400 });
  }
}

export const POST = conBitacoraCompras(__POST, 'POST');
export const PATCH = conBitacoraCompras(__PATCH, 'PATCH');
export const DELETE = conBitacoraCompras(__DELETE, 'DELETE');
