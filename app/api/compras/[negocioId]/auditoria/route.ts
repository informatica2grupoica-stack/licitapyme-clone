// app/api/compras/[negocioId]/auditoria/route.ts
// Auditoría completa de la compra: costeo → cotización → OC → factura, por proveedor, con la diferencia en pesos y su causa.
// GET            → JSON
// GET ?html=1    → el documento como HTML (es lo que se ve en pantalla y el respaldo si el chromium del servidor no anda)
// GET ?pdf=1     → PDF A4 para descargar
import { mensajeSeguro } from '@/app/lib/errores-api';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { auditoriaCompra } from '@/app/lib/compras-auditoria-negocio';
import { construirAuditoriaHtml } from '@/app/lib/compras-auditoria-pdf';
import { generarInformePdf } from '@/app/lib/generar-informe';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';
import pool from '@/app/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type Params = { params: Promise<{ negocioId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  const rol = request.headers.get('x-user-rol');
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const id = parseInt((await params).negocioId);
  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados))) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const auditoria = await auditoriaCompra(id);
    const sp = request.nextUrl.searchParams;
    if (sp.get('html') !== '1' && sp.get('pdf') !== '1') return NextResponse.json({ success: true, auditoria });

    const [[u]]: any = await pool.query(`SELECT nombre FROM usuarios WHERE id = ? LIMIT 1`, [userId]).catch(() => [[null]]);
    const html = construirAuditoriaHtml(auditoria, u?.nombre ?? null);
    const nombre = `Auditoria_${auditoria.codigo.replace(/[^\w.-]/g, '_')}`;
    if (sp.get('html') === '1') return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `inline; filename="${nombre}.html"` } });

    const pdf = await generarInformePdf(html);
    return new NextResponse(new Uint8Array(pdf), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${nombre}.pdf"`, 'Content-Length': String(pdf.length) },
    });
  } catch (error: any) {
    console.error('[compras/auditoria][GET]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudo armar la auditoría. Puedes ver la versión en pantalla e imprimirla.') }, { status: 500 });
  }
}
