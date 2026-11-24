// app/api/compras/[negocioId]/orden-compra-obuma/modificar/route.ts
// Modificar una OC YA creada desde Licitank (Obuma: /comprasOc.update.json).
// GET ?ocId=…: lo que la OC tiene hoy en Obuma (líneas, observación, entrega, despacho) para armar el formulario.
// POST: aplica los cambios en Obuma (escritura real), relee para verificar y deja Licitank al día.
import { mensajeSeguro } from '@/app/lib/errores-api';
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { leerOcParaModificar, modificarOrdenCompraNegocio, sincronizarOcDesdeObuma } from '@/app/lib/compras-oc-obuma';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';
import type { CambiosOcObuma } from '@/app/lib/obuma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Params = { params: Promise<{ negocioId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  return { id: id ? parseInt(id) : null, rol: req.headers.get('x-user-rol'), nombre: req.headers.get('x-user-nombre') };
}

async function acceso(request: NextRequest, params: Params['params']) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  const id = parseInt((await params).negocioId);
  if (!Number.isFinite(id)) return { error: NextResponse.json({ error: 'negocioId inválido' }, { status: 400 }) };
  const asignacion = await obtenerAsignacion(id);
  if (!asignacion) return { error: NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 }) };
  if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
    return { error: NextResponse.json({ error: 'Sin acceso.' }, { status: 403 }) };
  return { id, userId, nombre, asignacion, esAdmin: rol === 'admin' };
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, params);
    if ('error' in a) return a.error;
    const ocId = String(request.nextUrl.searchParams.get('ocId') || '');
    if (!/^\d+$/.test(ocId)) return NextResponse.json({ error: 'Falta la orden de compra.' }, { status: 400 });
    return NextResponse.json({ success: true, oc: await leerOcParaModificar(a.id, ocId, a.esAdmin) });
  } catch (error: any) {
    console.error('[compras/orden-compra-obuma/modificar][GET]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudo leer la orden de compra.') }, { status: 400 });
  }
}

async function __POST(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, params);
    if ('error' in a) return a.error;
    if (a.asignacion.precompra)
      return NextResponse.json({ error: 'Esto es una pre-compra: no hay órdenes de compra que modificar.' }, { status: 409 });
    const body = await request.json();
    const ocId = String(body.ocId || '');
    if (!/^\d+$/.test(ocId)) return NextResponse.json({ error: 'Falta la orden de compra.' }, { status: 400 });
    if (body.sincronizar === true) {
      const r = await sincronizarOcDesdeObuma(a.id, ocId, a.userId, a.nombre);
      return NextResponse.json({ success: true, ...r });
    }
    const num = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(String(v).replace(',', '.')));
    const cambios: CambiosOcObuma = {
      observacion: typeof body.observacion === 'string' ? body.observacion.slice(0, 500) : undefined,
      fechaEntrega: typeof body.fechaEntrega === 'string' && body.fechaEntrega ? body.fechaEntrega : undefined,
      metodoDespacho: typeof body.metodoDespacho === 'string' && body.metodoDespacho ? body.metodoDespacho : undefined,
      lineas: Array.isArray(body.lineas) ? body.lineas.map((l: any) => ({
        codId: String(l.codId), cantidad: num(l.cantidad), precio: num(l.precio),
        descripcion: typeof l.descripcion === 'string' ? l.descripcion.slice(0, 1000) : undefined,
      })) : [],
      forzarFacturada: a.esAdmin,
    };
    const r = await modificarOrdenCompraNegocio(a.id, ocId, cambios, a.userId, a.nombre);
    return NextResponse.json({ success: true, ...r });
  } catch (error: any) {
    console.error('[compras/orden-compra-obuma/modificar][POST]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudo modificar la orden de compra.') }, { status: 400 });
  }
}

export const POST = conBitacoraCompras(__POST, 'POST');
