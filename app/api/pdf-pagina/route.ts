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
const MAX_QUADS = 60;               // tope de zonas resaltadas (no pintar la página entera).
// Dónde cachea Tesseract el paquete de idioma (spa.traineddata, ~15 MB). Igual que tesseract-ocr.ts:
// carpeta dedicada por defecto; en serverless de solo-lectura apuntar a /tmp con TESSERACT_CACHE_PATH.
const TESSERACT_CACHE_PATH = process.env.TESSERACT_CACHE_PATH || '.tesseract-cache';

// Muletillas que NO sirven para localizar la zona de la cita (se descartan al trocear la frase).
const STOP = new Set(['para','como','este','esta','esas','esos','desde','entre','segun','sobre','pagina','pag','del','los','las','una','uno','que','con','por','articulo','numeral']);

// Normaliza para COMPARAR (sin tildes, minúsculas, solo alfanumérico): "Económica" → "economica".
function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^0-9a-z]/g, '');
}

// Palabras CLAVE de la cita (≥4 letras, sin muletillas, deduplicadas). Se usan tanto para el
// respaldo de búsqueda de texto como para el matching contra el OCR. Conserva la palabra ORIGINAL
// (con tildes) porque mupdf.search distingue acentos; la forma normalizada se usa solo para filtrar.
function palabrasClave(q: string): string[] {
  const palabras = q.split(/[^0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ°]+/).filter(Boolean);
  const vistas = new Set<string>();
  const out: string[] = [];
  for (const w of palabras) {
    const wn = normalizar(w);
    if (wn.length < 4 || STOP.has(wn) || vistas.has(wn)) continue;
    vistas.add(wn);
    out.push(w);
  }
  return out;
}

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

// ─── Fallback OCR para PDFs ESCANEADOS (sin capa de texto) ───────────────────────
// mupdf.search no encuentra nada en un escaneo (no hay texto seleccionable). Aquí rasterizamos
// la página y la leemos con Tesseract, que devuelve el bounding box de cada palabra; resaltamos
// las que calzan con las palabras clave de la cita. Devuelve quads en espacio de PÁGINA (mismo
// sistema que page.search), listos para setQuadPoints. Best-effort: [] si no matchea o falla.
async function resaltarPorOcr(
  page: { toPixmap(m: unknown, cs: unknown, alpha: boolean): { asPNG(): Uint8Array } },
  mupdf: typeof import('mupdf'),
  claves: string[],
): Promise<number[][]> {
  try {
    // Rasterizar a la MISMA escala que el render final (píxel = punto × SCALE).
    const pix = page.toPixmap(mupdf.Matrix.scale(SCALE, SCALE), mupdf.ColorSpace.DeviceRGB, false);
    const png = Buffer.from(pix.asPNG());

    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('spa', undefined, { cachePath: TESSERACT_CACHE_PATH });
    const words: Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }> = [];
    try {
      // blocks:true → jerarquía blocks→paragraphs→lines→words, cada word con text + bbox (px).
      const { data } = await worker.recognize(png, {}, { blocks: true });
      const blocks = (data as { blocks?: unknown[] } | undefined)?.blocks ?? [];
      for (const b of blocks as any[]) {
        for (const p of (b?.paragraphs ?? [])) {
          for (const l of (p?.lines ?? [])) {
            for (const w of (l?.words ?? [])) {
              if (w?.text && w?.bbox) words.push({ text: w.text, bbox: w.bbox });
            }
          }
        }
      }
    } finally {
      await worker.terminate().catch(() => {});
    }
    if (!words.length) return [];

    const clavesNorm = claves.map(normalizar).filter(c => c.length >= 4);
    if (!clavesNorm.length) return [];
    const quads: number[][] = [];
    for (const w of words) {
      const wn = normalizar(w.text);
      if (wn.length < 4) continue;
      // Calza si la palabra OCR y una clave son iguales o una es prefijo de la otra (tolera cortes
      // de OCR y sufijos flexivos). Prefijo con ambas ≥4 evita falsos positivos de fragmentos cortos.
      const match = clavesNorm.some(c => wn === c || wn.startsWith(c) || c.startsWith(wn));
      if (!match) continue;
      const { x0, y0, x1, y1 } = w.bbox;
      // Píxel (página × SCALE) → coordenada de página (÷ SCALE). Quad mupdf = [ulx,uly, urx,ury, llx,lly, lrx,lry].
      const X0 = x0 / SCALE, Y0 = y0 / SCALE, X1 = x1 / SCALE, Y1 = y1 / SCALE;
      quads.push([X0, Y0, X1, Y0, X0, Y1, X1, Y1]);
      if (quads.length >= MAX_QUADS) break;
    }
    return quads;
  } catch (e) {
    console.warn('[pdf-pagina] OCR de resaltado falló:', e instanceof Error ? e.message : e);
    return [];
  }
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
  // `h4` = versión del algoritmo de resaltado (búsqueda por frase + respaldo por palabras +
  // FALLBACK OCR con coordenadas para escaneados); subir el número invalida los PNG cacheados
  // con la lógica anterior.
  const qSuf = q ? `_h4${createHash('sha1').update(q).digest('hex').slice(0, 10)}` : '';
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
    // ROBUSTO en TRES capas para que SIEMPRE se marque la zona de donde salió el dato:
    //   1) FRASE COMPLETA por capa de texto (mupdf.search).
    //   2) PALABRAS CLAVE sueltas por capa de texto (redacción algo distinta, tablas…).
    //   3) FALLBACK OCR: si el PDF es ESCANEADO (sin capa de texto), search() no encuentra nada;
    //      se rasteriza la página y se lee con Tesseract, obteniendo el bounding box de cada
    //      palabra; se resaltan las que calzan con las palabras clave de la cita.
    // Best-effort: si nada aparece o falla, se renderiza la página sin resaltar.
    if (q) {
      try {
        // createAnnotation existe en PDFPage (no en el tipo base Page); los docs son PDF.
        const pdfPage = page as unknown as { createAnnotation(tipo: string): { setQuadPoints(q: number[][]): void; setColor(c: number[]): void; update(): void } };
        const buscar = (t: string): number[][] => {
          try { const h = page.search(t); return Array.isArray(h) ? h.flat() : []; } catch { return []; }
        };
        const claves = palabrasClave(q);
        let quads = buscar(q);                       // 1) frase completa (capa de texto)
        if (!quads.length) {                         // 2) respaldo: palabras clave sueltas
          // Trocear conservando las TILDES: mupdf.search es case-insensitive pero SÍ distingue
          // acentos, así que hay que buscar la palabra ORIGINAL ("Económica"), no "economica".
          for (const w of claves) {
            quads = quads.concat(buscar(w));
            if (quads.length >= MAX_QUADS) break;    // tope: no pintar la página entera
          }
        }
        // 3) FALLBACK OCR para ESCANEADOS: la capa de texto no dio nada → leer la página con
        // Tesseract y resaltar por coordenadas. Solo si hay palabras clave que localizar.
        if (!quads.length && claves.length) {
          quads = await resaltarPorOcr(page, mupdf, claves);
        }
        if (quads.length && typeof pdfPage.createAnnotation === 'function') {
          const annot = pdfPage.createAnnotation('Highlight');
          annot.setQuadPoints(quads.slice(0, MAX_QUADS));
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
