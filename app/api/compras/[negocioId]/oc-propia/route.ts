// app/api/compras/[negocioId]/oc-propia/route.ts
// Órdenes de compra propias (migration-180): las que Comercial MP le emite a Inversiones Claro desde Licitank (Comercial MP no está
// en Obuma). GET = si el negocio las usa + productos con precio sugerido + OC emitidas; GET ?pdf=<id> = el PDF.
// POST JSON {accion: 'crear' | 'anular' | 'quitar-factura'}; POST multipart = subir la factura de una OC (XML o PDF).
import { mensajeSeguro } from '@/app/lib/errores-api';
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { puedeOperarReparto } from '@/app/api/compras/[negocioId]/reparto/route';
import { subirDocumentoR2 } from '@/app/lib/r2';
import { errorDeArchivoSubido } from '@/app/lib/subidas';
import { parsearMontoCL } from '@/app/lib/numeros';
import { generarPdfOc } from '@/app/lib/compras-oc-pdf';
import { sincronizarTrasCambioDeOc } from '@/app/lib/compras-oc-obuma';
import {
  emisorOcPropia, listarOcPropias, productosParaOcPropia, crearOcPropia, documentoOcPropia,
  registrarFacturaOcPropia, revisarFacturaXmlOcPropia, quitarFacturaOcPropia, anularOcPropia, type DatosOcPropia,
} from '@/app/lib/compras-oc-propia';

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
  return { id, userId, nombre, asignacion };
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, (await params).negocioId);
    if ('error' in a) return a.error;
    const pdfId = parseInt(request.nextUrl.searchParams.get('pdf') || '');
    if (pdfId) {
      const { doc, logo } = await documentoOcPropia(a.id, pdfId);
      const bytes = await generarPdfOc(doc, { logo, firma: null });
      return new NextResponse(Buffer.from(bytes), {
        headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="orden-de-compra-${doc.folio}.pdf"`, 'Cache-Control': 'no-store' },
      });
    }
    const emisor = await emisorOcPropia(a.id);
    if (!emisor) return NextResponse.json({ success: true, habilitada: false });
    const [productos, ocs] = await Promise.all([productosParaOcPropia(a.id), listarOcPropias(a.id)]);
    return NextResponse.json({ success: true, habilitada: true, empresa: emisor.empresa, proveedor: emisor.proveedor, productos, ocs });
  } catch (error: any) {
    console.error('[compras/oc-propia][GET]', String(error));
    const sinTabla = String(error?.code || '') === 'ER_NO_SUCH_TABLE';
    return NextResponse.json({ error: sinTabla ? 'Falta aplicar la migración 180 (órdenes de compra propias).' : mensajeSeguro(error, 'No se pudieron cargar las órdenes de compra.') }, { status: sinTabla ? 503 : 400 });
  }
}

/** El XML del SII suele venir en ISO-8859-1: se decodifica según lo que declara su cabecera. */
function textoXml(buf: Buffer): string {
  const cabecera = buf.subarray(0, 200).toString('latin1');
  return /encoding=["']ISO-8859-1["']/i.test(cabecera) ? buf.toString('latin1') : buf.toString('utf8');
}

async function __POST(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, (await params).negocioId);
    if ('error' in a) return a.error;

    if ((request.headers.get('content-type') || '').includes('multipart/form-data')) {
      const form = await request.formData();
      const ocId = parseInt(String(form.get('ocId') || ''));
      const file = form.get('file') as File | null;
      if (!ocId) return NextResponse.json({ error: 'Falta la orden de compra.' }, { status: 400 });
      if (!file || file.size === 0) return NextResponse.json({ error: 'Falta el archivo de la factura.' }, { status: 400 });
      const errArchivo = errorDeArchivoSubido(file); if (errArchivo) return NextResponse.json({ error: errArchivo }, { status: 400 });
      const buf = Buffer.from(await file.arrayBuffer());
      const esXml = /\.xml$/i.test(file.name);
      const xml = esXml ? textoXml(buf) : null;
      const confirmar = form.get('confirmar') === '1';
      // El XML se revisa ANTES de subir el archivo: si no calza, o calza solo por monto y falta confirmar, no queda nada suelto en R2.
      if (xml && !confirmar) {
        const res = await revisarFacturaXmlOcPropia(a.id, ocId, xml);
        if (res.tipo === 'MONTO') return NextResponse.json({ success: true, pendiente: res });
      }
      const url = await subirDocumentoR2(`compras/${a.asignacion.licitacionCodigo}/facturas-oc-propia`, file.name, buf, file.type);
      const manual = xml ? null : {
        folio: String(form.get('folio') || ''), fecha: (form.get('fecha') as string) || null,
        neto: parsearMontoCL(String(form.get('neto') || '')) ?? 0, total: parsearMontoCL(String(form.get('total') || '')),
      };
      await registrarFacturaOcPropia(a.id, ocId, { archivo: { url, nombre: file.name }, xml, manual, confirmar }, a.userId, a.nombre);
      return NextResponse.json({ success: true, ocs: await listarOcPropias(a.id) });
    }

    const body = await request.json();
    if (body.accion === 'crear') {
      const oc = await crearOcPropia(a.id, body as DatosOcPropia, a.userId, a.nombre);
      await sincronizarTrasCambioDeOc(a.id);   // Comprado, tarea de OC, folios del reparto y margen al día
      return NextResponse.json({ success: true, oc, ocs: await listarOcPropias(a.id) });
    }
    if (body.accion === 'anular') {
      await anularOcPropia(a.id, Number(body.ocId), String(body.motivo || ''), a.userId, a.nombre);
      await sincronizarTrasCambioDeOc(a.id);   // si quedó sin OC vigente, el producto vuelve a Pendiente
      return NextResponse.json({ success: true, ocs: await listarOcPropias(a.id) });
    }
    if (body.accion === 'quitar-factura') {
      await quitarFacturaOcPropia(a.id, Number(body.ocId), a.userId, a.nombre);
      return NextResponse.json({ success: true, ocs: await listarOcPropias(a.id) });
    }
    return NextResponse.json({ error: 'Acción desconocida.' }, { status: 400 });
  } catch (error: any) {
    console.error('[compras/oc-propia][POST]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudo guardar la orden de compra.') }, { status: 400 });
  }
}

export const POST = conBitacoraCompras(__POST, 'POST');
