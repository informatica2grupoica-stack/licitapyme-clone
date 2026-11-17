// app/api/compras/[negocioId]/documentos-logos/route.ts
// BANCO DE LOGOS de Gestionar documentos: GET = lista; POST (multipart nombre + file) = sube uno; DELETE ?id = borra uno.
// Los logos son del CLIENTE dueño del negocio (nunca se ven entre empresas distintas).
import { mensajeSeguro } from '@/app/lib/errores-api';
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { puedeOperarReparto } from '@/app/api/compras/[negocioId]/reparto/route';
import { clienteDeNegocio } from '@/app/lib/tenant';
import { listarLogos, agregarLogo, eliminarLogo } from '@/app/lib/compras-documentos';

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
  if (!(await puedeOperarReparto(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
    return { error: NextResponse.json({ error: 'Sin acceso.' }, { status: 403 }) };
  const clienteId = await clienteDeNegocio(id);
  if (!clienteId) return { error: NextResponse.json({ error: 'Negocio no encontrado.' }, { status: 404 }) };
  return { id, userId, nombre, clienteId };
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, (await params).negocioId);
    if ('error' in a) return a.error;
    return NextResponse.json({ success: true, logos: await listarLogos(a.clienteId) });
  } catch (error: any) {
    console.error('[compras/documentos-logos][GET]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudieron cargar los logos.') }, { status: 400 });
  }
}

async function __POST(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, (await params).negocioId);
    if ('error' in a) return a.error;
    const fd = await request.formData();
    const file = fd.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'Falta el archivo del logo.' }, { status: 400 });
    const id = await agregarLogo(a.clienteId, String(fd.get('nombre') || ''), { name: file.name, type: file.type, buffer: Buffer.from(await file.arrayBuffer()) }, a.nombre);
    return NextResponse.json({ success: true, id });
  } catch (error: any) {
    console.error('[compras/documentos-logos][POST]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudo subir el logo.') }, { status: 400 });
  }
}

async function __DELETE(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, (await params).negocioId);
    if ('error' in a) return a.error;
    const id = parseInt(request.nextUrl.searchParams.get('id') || '');
    if (!id) return NextResponse.json({ error: 'Falta el logo.' }, { status: 400 });
    await eliminarLogo(a.clienteId, id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[compras/documentos-logos][DELETE]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudo eliminar el logo.') }, { status: 400 });
  }
}
export const POST = conBitacoraCompras(__POST, 'POST');
export const DELETE = conBitacoraCompras(__DELETE, 'DELETE');
