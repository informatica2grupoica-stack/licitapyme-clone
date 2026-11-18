// app/api/compras/[negocioId]/entrega-archivos/route.ts
// Escaneos firmados de la entrega: GET lista · POST (multipart: file, tipo = acta|guia|capacitacion) · DELETE ?id=
import { mensajeSeguro } from '@/app/lib/errores-api';
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { puedeOperarCompras, puedeVerCompras } from '@/app/api/compras/[negocioId]/route';
import { subirDocumentoR2, borrarDocumentoR2 } from '@/app/lib/r2';
import { errorDeArchivoSubido } from '@/app/lib/subidas';
import { listarEscaneosEntrega, registrarEscaneoEntrega, quitarEscaneoEntrega, TIPOS_ESCANEO, type TipoEscaneoEntrega } from '@/app/lib/compras-entrega-archivos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

async function acceso(request: NextRequest, negocioId: string, escribe: boolean) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  const rol = request.headers.get('x-user-rol'); const nombre = request.headers.get('x-user-nombre');
  if (!userId) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  const id = parseInt(negocioId);
  if (!Number.isFinite(id)) return { error: NextResponse.json({ error: 'negocioId inválido' }, { status: 400 }) };
  const asignacion = await obtenerAsignacion(id);
  if (!asignacion) return { error: NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 }) };
  const ok = escribe
    ? await puedeOperarCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados)
    : await puedeVerCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados);
  if (!ok) return { error: NextResponse.json({ error: 'Sin acceso.' }, { status: 403 }) };
  return { id, userId, nombre, asignacion };
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, (await params).negocioId, false);
    if ('error' in a) return a.error;
    return NextResponse.json({ success: true, archivos: await listarEscaneosEntrega(a.id) });
  } catch (e) {
    console.error('[compras/entrega-archivos][GET]', String(e));
    return NextResponse.json({ error: 'No se pudieron cargar los documentos de la entrega.' }, { status: 500 });
  }
}

async function __POST(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, (await params).negocioId, true);
    if ('error' in a) return a.error;
    const form = await request.formData();
    const tipo = String(form.get('tipo') || '') as TipoEscaneoEntrega;
    if (!TIPOS_ESCANEO.includes(tipo)) return NextResponse.json({ error: 'Falta decir qué documento es (acta, guía o capacitación).' }, { status: 400 });
    const f = form.get('file') as File | null;
    if (!f || !f.size) return NextResponse.json({ error: 'Falta el archivo.' }, { status: 400 });
    const errArchivo = errorDeArchivoSubido(f);
    if (errArchivo) return NextResponse.json({ error: errArchivo }, { status: 400 });
    const url = await subirDocumentoR2(`compras/${a.asignacion.licitacionCodigo}/entrega-${tipo}`, f.name, Buffer.from(await f.arrayBuffer()), f.type);
    // Si no se puede guardar en la BD, el archivo recién subido no queda huérfano en R2.
    await registrarEscaneoEntrega(a.id, tipo, { url, nombre: f.name }, a.userId, a.nombre).catch(async (e) => { await borrarDocumentoR2(url).catch(() => {}); throw e; });
    return NextResponse.json({ success: true, archivos: await listarEscaneosEntrega(a.id) });
  } catch (e: any) {
    console.error('[compras/entrega-archivos][POST]', String(e));
    return NextResponse.json({ error: mensajeSeguro(e, 'No se pudo subir el documento.') }, { status: 400 });
  }
}

async function __DELETE(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, (await params).negocioId, true);
    if ('error' in a) return a.error;
    const id = parseInt(request.nextUrl.searchParams.get('id') || '');
    if (!Number.isFinite(id)) return NextResponse.json({ error: 'Falta el documento.' }, { status: 400 });
    await quitarEscaneoEntrega(a.id, id, a.userId, a.nombre);
    return NextResponse.json({ success: true, archivos: await listarEscaneosEntrega(a.id) });
  } catch (e: any) {
    return NextResponse.json({ error: mensajeSeguro(e, 'No se pudo quitar el documento.') }, { status: 400 });
  }
}

export const POST = conBitacoraCompras(__POST, 'POST');
export const DELETE = conBitacoraCompras(__DELETE, 'DELETE');
