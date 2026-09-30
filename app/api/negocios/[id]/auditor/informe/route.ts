// app/api/negocios/[id]/auditor/informe/route.ts
// AUDITOR → informe COMPLETO, con todo desplegado y sin que falte nada (resumen, posición de precio, cotizaciones, costos asociados, mensajes al proveedor
// y, por línea, cada opción con su verificación de costo, mercado, IA de costo y verificación técnica + cuadro comparativo). Sale de los mismos datos que
// pinta la pantalla (armarPanelAuditor); nada se recalcula aquí. Lógica del documento en app/lib/auditor-informe.ts.
//   GET ?formato=texto → texto plano (lo que copia el botón «Copiar todo»)
//   GET ?formato=pdf       → PDF de la PANTALLA del Auditor, tal cual se ve, con todo desplegado (defecto): el servidor abre la misma página con la
//                            sesión del usuario (?imprimir=1) y la imprime.
//   GET ?formato=documento → PDF A4 del documento aparte (informe de texto ordenado), por si la impresión de la pantalla no está disponible
//   GET ?formato=html  → el mismo documento como HTML imprimible (respaldo si el chromium del servidor no está disponible)
import { NextRequest, NextResponse } from 'next/server';
import { contextoAuditor } from '@/app/lib/auditor-acceso';
import { armarPanelAuditor } from '@/app/lib/auditor-opciones';
import { ultimaPosicion } from '@/app/lib/auditor-posicion';
import { construirInformeAuditor, informeATexto, informeAHtml } from '@/app/lib/auditor-informe';
import { generarInformePdf, generarPdfDePagina } from '@/app/lib/generar-informe';
import { ahoraChileSQL } from '@/app/lib/tz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 150;

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const c = await contextoAuditor(request, params);
  if (c instanceof NextResponse) return c;
  const formato = request.nextUrl.searchParams.get('formato') || 'pdf';
  try {
    if (formato === 'pdf') {
      const nombre = `Auditor_${String(c.negocio.licitacion_codigo).replace(/[^\w.-]/g, '_')}_${ahoraChileSQL().slice(0, 10)}`;
      try {
        const base = process.env.INTERNAL_BASE_URL || request.nextUrl.origin;
        const pdf = await generarPdfDePagina({
          url: `${base}/negocios/${c.negocio.id}?seccion=auditor_compra&imprimir=1`, cookieHeader: request.headers.get('cookie') || '',
          selector: '[data-auditor-panel]', selectorListo: '[data-auditor-listo]', ocultar: '[data-no-pdf]'
        });
        return new NextResponse(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${nombre}.pdf"`, 'Content-Length': String(pdf.length) } });
      } catch (e) {
        console.error('[auditor][informe][pdf-pantalla]', String(e).slice(0, 300));
        return NextResponse.json({ error: 'No se pudo imprimir la pantalla del Auditor en el servidor.', alternativa: `/api/negocios/${c.negocio.id}/auditor/informe?formato=documento` }, { status: 500 });
      }
    }
    const [panel, posicion] = await Promise.all([armarPanelAuditor(c.negocio.id, c.negocio.licitacion_codigo), ultimaPosicion(c.negocio.id).catch(() => null)]);
    const ahora = ahoraChileSQL();
    const informe = construirInformeAuditor({ ...panel, posicion }, { licitacionCodigo: c.negocio.licitacion_codigo, generadoPor: c.actor.nombre, generadoAt: ahora });
    const nombre = `Auditor_${String(c.negocio.licitacion_codigo).replace(/[^\w.-]/g, '_')}_${ahora.slice(0, 10)}`;

    if (formato === 'texto') return new NextResponse(informeATexto(informe), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
    const html = informeAHtml(informe);
    if (formato === 'html') return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `inline; filename="${nombre}.html"` } });
    try {
      // formato=documento: el informe de texto ordenado (respaldo).
      const pdf = await generarInformePdf(html);
      return new NextResponse(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${nombre}.pdf"`, 'Content-Length': String(pdf.length) } });
    } catch (e) {
      console.error('[auditor][informe][pdf]', String(e).slice(0, 300));
      return NextResponse.json({ error: 'No se pudo generar el PDF en el servidor. Puedes abrir la versión imprimible en HTML.', alternativa: `/api/negocios/${c.negocio.id}/auditor/informe?formato=html` }, { status: 500 });
    }
  } catch (e) {
    console.error('[auditor][informe]', String(e).slice(0, 300));
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
