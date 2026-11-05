// app/api/compras/oc-comercial-mp/route.ts
// Menú «OC Comercial MP» (pedido del dueño, 05-nov-2026): todas las órdenes de compra propias (migration-180) de todas las
// licitaciones, con su licitación y su factura. Solo lectura: emitir, subir factura y anular se siguen haciendo en el negocio.
// GET = lista; GET ?pdf=<id> = el PDF de esa OC.
import { mensajeSeguro } from '@/app/lib/errores-api';
import { NextRequest, NextResponse } from 'next/server';
import { permisosCrudosDeUsuario, clienteIdOrNull } from '@/app/lib/api-auth';
import { generarPdfOc } from '@/app/lib/compras-oc-pdf';
import { listarTodasOcPropias, negocioDeOcPropia, documentoOcPropia } from '@/app/lib/compras-oc-propia';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const p = await permisosCrudosDeUsuario(userId);
  if (!(p.compras_todo || p.compras || p.aprobar_comercial || p.compras_ver || p.compras_auditor))
    return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });
  const clienteId = await clienteIdOrNull(request);
  if (!clienteId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  try {
    const pdfId = parseInt(request.nextUrl.searchParams.get('pdf') || '');
    if (pdfId) {
      const negocioId = await negocioDeOcPropia(pdfId, clienteId);
      if (!negocioId) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
      const { doc, logo } = await documentoOcPropia(negocioId, pdfId);
      const bytes = await generarPdfOc(doc, { logo, firma: null });
      return new NextResponse(Buffer.from(bytes), {
        headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="orden-de-compra-${doc.folio}.pdf"`, 'Cache-Control': 'no-store' },
      });
    }
    return NextResponse.json({ success: true, ocs: await listarTodasOcPropias(clienteId) });
  } catch (error) {
    console.error('[compras/oc-comercial-mp][GET]', String(error));
    const sinTabla = (error as { code?: string })?.code === 'ER_NO_SUCH_TABLE';
    return NextResponse.json({ error: sinTabla ? 'Falta aplicar la migración 180 (órdenes de compra propias).' : mensajeSeguro(error, 'No se pudieron cargar las órdenes de compra.') }, { status: sinTabla ? 503 : 500 });
  }
}
