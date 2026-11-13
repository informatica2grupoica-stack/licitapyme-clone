// app/api/compras/[negocioId]/guia-despacho-obuma/route.ts
// SOLO negocios de Inversiones Claro (la única empresa con Obuma). GET = OC del negocio que sirven de base para la guía.
// POST {folioOc, preciosManual?, enviar?}: arma el borrador (productos de la OC de Obuma, precios de VENTA del costeo). Con enviar=true intenta crearla (hoy solo OBUMA_SIMULAR=1).
import { mensajeSeguro } from '@/app/lib/errores-api';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { puedeOperarReparto } from '@/app/api/compras/[negocioId]/reparto/route';
import { armarGuiaDesdeOcObuma, crearGuiaDespachoObuma, negocioEsDeClaro, ocsParaGuia } from '@/app/lib/compras-guia-despacho-obuma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

async function acceso(request: NextRequest, negocioId: string) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  if (!userId) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  const id = parseInt(negocioId);
  if (!Number.isFinite(id)) return { error: NextResponse.json({ error: 'negocioId inválido' }, { status: 400 }) };
  const asignacion = await obtenerAsignacion(id);
  if (!asignacion) return { error: NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 }) };
  if (!(await puedeOperarReparto(userId, request.headers.get('x-user-rol'), asignacion.asignadoA, asignacion.coencargados)))
    return { error: NextResponse.json({ error: 'Sin acceso.' }, { status: 403 }) };
  if (!(await negocioEsDeClaro(id))) return { error: NextResponse.json({ error: 'Las guías de despacho solo están disponibles para Inversiones Claro.' }, { status: 403 }) };
  return { id };
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, (await params).negocioId);
    if ('error' in a) return a.error;
    // creacionHabilitada: hoy solo con OBUMA_SIMULAR=1 (ver crearGuiaDespachoObuma). La UI deja el botón apagado y lo explica.
    return NextResponse.json({ success: true, ocs: await ocsParaGuia(a.id), creacionHabilitada: process.env.OBUMA_SIMULAR === '1' });
  } catch (error) {
    console.error('[compras/guia-despacho-obuma][GET]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudieron cargar las órdenes de compra.') }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, (await params).negocioId);
    if ('error' in a) return a.error;
    const body = await request.json().catch(() => ({}));
    const preciosManual = body?.preciosManual && typeof body.preciosManual === 'object' ? body.preciosManual : {};
    const guia = await armarGuiaDesdeOcObuma(a.id, String(body?.folioOc || ''), preciosManual);
    const envio = body?.enviar === true ? await crearGuiaDespachoObuma(guia) : null;
    return NextResponse.json({ success: true, guia, envio });
  } catch (error) {
    console.error('[compras/guia-despacho-obuma][POST]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudo armar la guía de despacho.') }, { status: 500 });
  }
}
