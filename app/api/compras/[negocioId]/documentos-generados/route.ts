// app/api/compras/[negocioId]/documentos-generados/route.ts
// GESTIONAR DOCUMENTOS: GET = plantillas + datos de la licitación + historial (habilitado:false si la empresa del negocio no tiene plantillas);
// GET ?pdf=<id> = el PDF de un documento generado; POST {plantillaId, valores, personas} = genera y deja en el historial.
import { mensajeSeguro } from '@/app/lib/errores-api';
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { puedeOperarReparto } from '@/app/api/compras/[negocioId]/reparto/route';
import { plantillasDelNegocio, historialDocumentos, generarDocumento, pdfDeDocumento, eliminarDocumento } from '@/app/lib/compras-documentos';

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
  return { id, userId, nombre };
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, (await params).negocioId);
    if ('error' in a) return a.error;
    const pdfId = parseInt(request.nextUrl.searchParams.get('pdf') || '');
    if (pdfId) {
      const { pdf, nombre } = await pdfDeDocumento(a.id, pdfId);
      return new NextResponse(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${nombre}"`, 'Cache-Control': 'private, max-age=30' } });
    }
    const { habilitado, plantillas, contexto } = await plantillasDelNegocio(a.id);
    if (!habilitado) return NextResponse.json({ success: true, habilitado: false });
    return NextResponse.json({ success: true, habilitado: true, plantillas, contexto, historial: await historialDocumentos(a.id) });
  } catch (error: any) {
    console.error('[compras/documentos-generados][GET]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudieron cargar los documentos.') }, { status: 400 });
  }
}

async function __POST(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, (await params).negocioId);
    if ('error' in a) return a.error;
    const body = await request.json();
    const plantillaId = parseInt(body?.plantillaId);
    if (!plantillaId) return NextResponse.json({ error: 'Falta elegir la plantilla.' }, { status: 400 });
    const valores: Record<string, string> = {};
    for (const [k, v] of Object.entries(body?.valores || {})) if (/^\w+$/.test(k)) valores[k] = String(v ?? '').slice(0, 4000);
    const personas = (Array.isArray(body?.personas) ? body.personas : []).slice(0, 100).map((p: any) => ({ nombre: String(p?.nombre || '').slice(0, 200), rut: String(p?.rut || '').slice(0, 20) }));
    const id = await generarDocumento(a.id, plantillaId, valores, personas, { id: a.userId, nombre: a.nombre });
    return NextResponse.json({ success: true, id });
  } catch (error: any) {
    console.error('[compras/documentos-generados][POST]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudo generar el documento.') }, { status: 400 });
  }
}
async function __DELETE(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, (await params).negocioId);
    if ('error' in a) return a.error;
    const id = parseInt(request.nextUrl.searchParams.get('id') || '');
    if (!id) return NextResponse.json({ error: 'Falta el documento.' }, { status: 400 });
    await eliminarDocumento(a.id, id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[compras/documentos-generados][DELETE]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudo eliminar el documento.') }, { status: 400 });
  }
}
export const POST = conBitacoraCompras(__POST, 'POST');
export const DELETE = conBitacoraCompras(__DELETE, 'DELETE');
