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
  // `h3` = versión del algoritmo de resaltado (búsqueda por frase + respaldo por palabras);
  // subir el número invalida los PNG cacheados con la lógica anterior.
  const qSuf = q ? `_h3${createHash('sha1').update(q).digest('hex').slice(0, 10)}` : '';
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
    // ROBUSTO: primero intenta la FRASE COMPLETA; si no aparece tal cual (mayúsculas distintas,
    // texto en tabla, redacción algo diferente), cae a resaltar cada PALABRA CLAVE (≥4 letras,
    // sin muletillas) para que SIEMPRE se marque en color la zona de donde salió el dato. Así el
    // usuario ve exactamente dónde en la página está la fuente, no solo la página.
    // Best-effort: si nada aparece o falla, se renderiza la página sin resaltar.
    if (q) {
      try {
        // createAnnotation existe en PDFPage (no en el tipo base Page); los docs son PDF.
        const pdfPage = page as unknown as { createAnnotation(tipo: string): { setQuadPoints(q: number[][]): void; setColor(c: number[]): void; update(): void } };
        const buscar = (t: string): number[][] => {
          try { const h = page.search(t); return Array.isArray(h) ? h.flat() : []; } catch { return []; }
        };
        let quads = buscar(q);                     // 1) frase completa
        if (!quads.length) {                       // 2) respaldo: palabras clave sueltas
          const STOP = new Set(['para','como','este','esta','esas','esos','desde','entre','segun','sobre','pagina','pag','del','los','las','una','uno','que','con','por','articulo','numeral']);
          // Trocear conservando las TILDES: mupdf.search es case-insensitive pero SÍ distingue
          // acentos, así que hay que buscar la palabra ORIGINAL ("Económica"), no "economica".
          const palabras = q.split(/[^0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ°]+/).filter(Boolean);
          const vistas = new Set<string>();
          for (const w of palabras) {
            const wn = w.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); // solo para filtrar
            if (wn.length < 4 || STOP.has(wn) || vistas.has(wn)) continue;
            vistas.add(wn);
            quads = quads.concat(buscar(w));        // buscar con la palabra original (con tildes)
            if (quads.length >= 60) break;          // tope: no pintar la página entera
          }
        }
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
