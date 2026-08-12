// app/lib/tesseract-ocr.ts
// OCR 100% LOCAL, sin API ni saldo: rasteriza cada página del PDF con mupdf (WASM) y la lee
// con Tesseract (tesseract.js, paquete español). Se usa como proveedor de OCR
// (IA_OCR_PROVIDER=tesseract) y como ÚLTIMO respaldo cuando los OCR por IA (GLM/Gemini) caen
// o están sin crédito. Calidad menor que GLM-OCR/Gemini en tablas complejas y timbres, pero
// suficiente para no quedar ciego; devuelve el texto con marcadores [[PÁGINA N]] como el resto.
//
// Un worker por LLAMADA (documento): evita carreras si dos documentos se OCR-ean en paralelo
// (el análisis usa concurrencia 2). El worker lee todas las páginas en serie y luego se cierra.

// Tope de páginas y escala configurables por entorno (acotan tiempo/memoria del OCR local).
const OCR_LOCAL_MAX_PAGINAS = Number(process.env.OCR_LOCAL_MAX_PAGINAS ?? 40);
const OCR_LOCAL_SCALE = Number(process.env.OCR_LOCAL_SCALE ?? 2.0);
// Dónde cachea Tesseract el paquete de idioma (spa.traineddata, ~15 MB). Por defecto una
// carpeta dedicada (gitignored). En serverless de solo-lectura (Vercel), apunta a /tmp con
// TESSERACT_CACHE_PATH. La carpeta se crea sola si no existe.
const TESSERACT_CACHE_PATH = process.env.TESSERACT_CACHE_PATH || '.tesseract-cache';

export async function ocrPdfLocalTesseract(buffer: Buffer): Promise<string> {
  const mupdf = await import('mupdf');
  const { createWorker } = await import('tesseract.js');

  const doc = mupdf.Document.openDocument(buffer, 'application/pdf');
  const total = doc.countPages();
  const nPags = Math.min(total, OCR_LOCAL_MAX_PAGINAS);

  const t0 = Date.now();
  // descarga/cachea spa.traineddata la 1ª vez en TESSERACT_CACHE_PATH.
  const worker = await createWorker('spa', undefined, { cachePath: TESSERACT_CACHE_PATH });
  const partes: string[] = [];
  try {
    for (let i = 0; i < nPags; i++) {
      try {
        const page = doc.loadPage(i);
        const pix = page.toPixmap(mupdf.Matrix.scale(OCR_LOCAL_SCALE, OCR_LOCAL_SCALE), mupdf.ColorSpace.DeviceRGB, false);
        const png = Buffer.from(pix.asPNG());
        const { data } = await worker.recognize(png);
        const t = (data?.text || '').trim();
        if (t) partes.push(`[[PÁGINA ${i + 1}]]\n${t}`);
      } catch (e) {
        console.warn(`[tesseract] pág ${i + 1} falló:`, e instanceof Error ? e.message : e);
      }
    }
  } finally {
    await worker.terminate().catch(() => {});
  }

  if (total > nPags) {
    console.warn(`[tesseract] OCR local limitado a ${nPags}/${total} págs (OCR_LOCAL_MAX_PAGINAS=${OCR_LOCAL_MAX_PAGINAS}).`);
  }
  const texto = partes.join('\n\n');
  console.log(`[tesseract] OCR local: ${texto.length} chars de ${nPags} págs en ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return texto;
}

// OCR LOCAL de páginas PUNTUALES (1-based) de un PDF — relleno de huecos que dejó GLM-OCR tras
// agotar sus reintentos (ver zai-ocr.ts → paginasConHueco/rellenarHuecos). A diferencia de
// ocrPdfLocalTesseract (todo el documento), esto solo procesa las páginas pedidas: mucho más
// rápido cuando faltan 2-3 de 37, y sin el tope OCR_LOCAL_MAX_PAGINAS (son pocas por diseño).
// Devuelve solo las páginas donde SÍ se reconoció texto; el llamador decide qué hacer con las
// que sigan vacías (página realmente en blanco, o imagen ilegible también para Tesseract).
export async function ocrPaginasLocalTesseract(buffer: Buffer, paginas: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!paginas.length) return out;
  const mupdf = await import('mupdf');
  const { createWorker } = await import('tesseract.js');

  const doc = mupdf.Document.openDocument(buffer, 'application/pdf');
  const total = doc.countPages();
  const t0 = Date.now();
  const worker = await createWorker('spa', undefined, { cachePath: TESSERACT_CACHE_PATH });
  try {
    for (const pag of paginas) {
      if (pag < 1 || pag > total) continue; // fuera de rango (documento más corto de lo esperado)
      try {
        const page = doc.loadPage(pag - 1); // mupdf es 0-based
        const pix = page.toPixmap(mupdf.Matrix.scale(OCR_LOCAL_SCALE, OCR_LOCAL_SCALE), mupdf.ColorSpace.DeviceRGB, false);
        const png = Buffer.from(pix.asPNG());
        const { data } = await worker.recognize(png);
        const t = (data?.text || '').trim();
        if (t) out.set(pag, t);
      } catch (e) {
        console.warn(`[tesseract] relleno pág ${pag} falló:`, e instanceof Error ? e.message : e);
      }
    }
  } finally {
    await worker.terminate().catch(() => {});
  }
  console.log(`[tesseract] relleno de huecos: ${out.size}/${paginas.length} pág(s) recuperadas en ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return out;
}

// OCR de UNA imagen suelta (png/jpeg), sin pasar por mupdf (eso es solo para rasterizar PÁGINAS
// de un PDF) — el buffer YA es una imagen. Respaldo local cuando GLM-OCR falla o no hay saldo,
// para el caso de un anexo con una sección pegada como foto (ver anexos-imagen-escaneada.ts).
export async function ocrImagenLocalTesseract(buffer: Buffer): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const t0 = Date.now();
  const worker = await createWorker('spa', undefined, { cachePath: TESSERACT_CACHE_PATH });
  try {
    const { data } = await worker.recognize(buffer);
    const texto = (data?.text || '').trim();
    console.log(`[tesseract] OCR de imagen: ${texto.length} chars en ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return texto;
  } finally {
    await worker.terminate().catch(() => {});
  }
}
