// app/api/pdf-pagina/route.ts
// Renderiza UNA página de un PDF a PNG (vía mupdf, WASM) para la vista previa de las
// citas de viabilidad. Mostrar una imagen de la página es legible y se posiciona bien;
// embeber el PDF en un iframe se veía diminuto y descuadrado.
//
// La imagen se CACHEA en R2 con una key determinista (url + página): los PDFs son
// inmutables, así que cada página se renderiza una sola vez y las siguientes cargas son
// instantáneas.
import { NextRequest, NextResponse } from 'next/server';
import { PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'crypto';
import { r2Client } from '@/app/lib/r2';

export const runtime = 'nodejs';   // mupdf usa WASM + Buffer: requiere runtime Node, no edge.

const SCALE = 2;                    // 2x → nítido sin pesar de más.
const MAX_PAGINA = 300;             // tope defensivo.

// Mismo anti-SSRF que /api/proxy: solo Mercado Público y R2.
function hostPermitido(host: string): boolean {
  const h = host.toLowerCase();
  const r2AccountId = (process.env.R2_ACCOUNT_ID || '').toLowerCase();
  return (
    h === 'mercadopublico.cl' || h.endsWith('.mercadopublico.cl') ||
    h.endsWith('.r2.dev') || h.endsWith('.r2.cloudflarestorage.com') ||
    (!!r2AccountId && h.includes(r2AccountId))
  );
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const url = sp.get('url');
  const pagina = Math.max(1, Math.min(MAX_PAGINA, parseInt(sp.get('pagina') || '1', 10) || 1));
  // q = texto a RESALTAR en la página (se busca con mupdf y se pinta amarillo).
  const q = (sp.get('q') || '').trim().slice(0, 120);

  if (!url) return NextResponse.json({ error: 'Falta el parámetro url' }, { status: 400 });

  let parsed: URL;
  try { parsed = new URL(url); } catch { return NextResponse.json({ error: 'URL inválida' }, { status: 400 }); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return NextResponse.json({ error: 'Protocolo no permitido' }, { status: 403 });
  if (!hostPermitido(parsed.hostname)) return NextResponse.json({ error: 'URL no permitida' }, { status: 403 });

  const bucket = process.env.R2_BUCKET_NAME;
  const publicBase = process.env.R2_PUBLIC_URL || `https://pub-${process.env.R2_ACCOUNT_ID}.r2.dev`;
  const hash = createHash('sha1').update(url).digest('hex');
  // El sufijo de q en la key separa la versión resaltada de la limpia (cache distinto).
  const qSuf = q ? `_h${createHash('sha1').update(q).digest('hex').slice(0, 10)}` : '';
  const key = `previews/${hash}_p${pagina}_x${SCALE}${qSuf}.png`;
  const cacheHeaders = { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' };

  // 1) ¿Ya está renderizada en R2? → redirige a la URL pública (la sirve Cloudflare).
  try {
    await r2Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return NextResponse.redirect(`${publicBase}/${key}`, 302);
  } catch { /* no existe → renderizar */ }

  try {
    // 2) Descargar el PDF.
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/pdf,*/*',
        'Referer': 'https://www.mercadopublico.cl/',
      },
    });
    if (!res.ok) return NextResponse.json({ error: `No se pudo descargar el PDF (${res.status})` }, { status: 502 });
    const buffer = Buffer.from(await res.arrayBuffer());

    // 3) Renderizar la página a PNG con mupdf.
    const mupdf = await import('mupdf');
    const doc = mupdf.Document.openDocument(buffer, 'application/pdf');
    const total = doc.countPages();
    const idx = Math.min(pagina, total) - 1;   // 1-based → 0-based, acotado a las páginas reales.
    const page = doc.loadPage(idx);

    // Resaltado: busca q en la página y pinta un Highlight amarillo sobre cada coincidencia.
    // Best-effort: si no hay coincidencias o falla, se renderiza la página sin resaltar.
    if (q) {
      try {
        const hits = page.search(q);              // array de matches; cada match = array de Quad
        const quads = Array.isArray(hits) ? hits.flat() : [];
        // createAnnotation existe en PDFPage (no en el tipo base Page); los docs son PDF.
        const pdfPage = page as unknown as { createAnnotation(tipo: string): { setQuadPoints(q: number[][]): void; setColor(c: number[]): void; update(): void } };
        if (quads.length && typeof pdfPage.createAnnotation === 'function') {
          const annot = pdfPage.createAnnotation('Highlight');
          annot.setQuadPoints(quads);
          annot.setColor([1, 0.9, 0.2]);
          annot.update();
        }
      } catch (e) {
        console.warn('[pdf-pagina] resaltado falló:', e instanceof Error ? e.message : e);
      }
    }

    const pix = page.toPixmap(mupdf.Matrix.scale(SCALE, SCALE), mupdf.ColorSpace.DeviceRGB, false);
    const png = Buffer.from(pix.asPNG());

    // 4) Guardar en R2 (best-effort) para servir instantáneo la próxima vez.
    r2Client.send(new PutObjectCommand({
      Bucket: bucket, Key: key, Body: png,
      ContentType: 'image/png', ContentDisposition: 'inline', CacheControl: 'public, max-age=31536000, immutable',
    })).catch(e => console.warn('[pdf-pagina] no se pudo cachear en R2:', e instanceof Error ? e.message : e));

    return new NextResponse(png, { headers: cacheHeaders });
  } catch (error) {
    console.error('[pdf-pagina] error renderizando:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'No se pudo renderizar la página' }, { status: 500 });
  }
}
