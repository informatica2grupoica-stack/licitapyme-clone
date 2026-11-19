// app/api/compras/[negocioId]/equivalencias/route.ts
// Equivalencias de la empresa para el pareo de cotizaciones: GET = lista; POST {patron, familia} = crea o cambia; DELETE ?id = borra.
// Son del CLIENTE dueño del negocio (nunca se ven entre empresas distintas).
import { mensajeSeguro } from '@/app/lib/errores-api';
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { puedeOperarPreAprobacion } from '@/app/api/compras/[negocioId]/route';
import { clienteDeNegocio } from '@/app/lib/tenant';
import { listarEquivalencias, guardarEquivalencia, eliminarEquivalencia } from '@/app/lib/compras-equivalencias';

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
  if (!(await puedeOperarPreAprobacion(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
    return { error: NextResponse.json({ error: 'Sin acceso.' }, { status: 403 }) };
  const clienteId = await clienteDeNegocio(id);
  if (!clienteId) return { error: NextResponse.json({ error: 'Negocio no encontrado.' }, { status: 404 }) };
  return { id, userId, nombre, clienteId };
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, (await params).negocioId);
    if ('error' in a) return a.error;
    return NextResponse.json({ success: true, equivalencias: await listarEquivalencias(a.clienteId) });
  } catch (error: any) {
    console.error('[compras/equivalencias][GET]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudieron cargar las equivalencias.') }, { status: 400 });
  }
}

async function __POST(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, (await params).negocioId);
    if ('error' in a) return a.error;
    const body = await request.json().catch(() => ({}));
    await guardarEquivalencia(a.clienteId, String(body?.patron || ''), String(body?.familia || ''), a.nombre);
    return NextResponse.json({ success: true, equivalencias: await listarEquivalencias(a.clienteId) });
  } catch (error: any) {
    console.error('[compras/equivalencias][POST]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudo guardar la equivalencia.') }, { status: 400 });
  }
}

async function __DELETE(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, (await params).negocioId);
    if ('error' in a) return a.error;
    const id = parseInt(new URL(request.url).searchParams.get('id') || '');
    if (!Number.isFinite(id)) return NextResponse.json({ error: 'Falta el id.' }, { status: 400 });
    await eliminarEquivalencia(a.clienteId, id);
    return NextResponse.json({ success: true, equivalencias: await listarEquivalencias(a.clienteId) });
  } catch (error: any) {
    console.error('[compras/equivalencias][DELETE]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudo borrar la equivalencia.') }, { status: 400 });
  }
}

export const POST = conBitacoraCompras(__POST, 'POST');
export const DELETE = conBitacoraCompras(__DELETE, 'DELETE');
