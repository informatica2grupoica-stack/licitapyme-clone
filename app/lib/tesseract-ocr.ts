// app/lib/tesseract-ocr.ts
// OCR 100% LOCAL, sin API ni saldo: rasteriza cada página del PDF con mupdf (WASM) y la lee
// con Tesseract (tesseract.js, paquete español). Se usa como proveedor de OCR
// (IA_OCR_PROVIDER=tesseract) y como ÚLTIMO respaldo cuando los OCR por IA (GLM/Gemini) caen
// o están sin crédito. Calidad menor que GLM-OCR/Gemini en tablas complejas y timbres, pero
// suficiente para no quedar ciego; devuelve el texto con marcadores [[PÁGINA N]] como el resto.
//
// Un worker por LLAMADA (documento): evita carreras si dos documentos se OCR-ean en paralelo
// (el análisis usa concurrencia 2). El worker lee todas las páginas en serie y luego se cierra.

// REGLA DEL PROYECTO (19-ago-2026, explícita del usuario): "el OCR tiene que leer al 100% los
// documentos escaneados SIEMPRE, sean 100 páginas o más, y si deja huecos que los reponga".
//
// Este tope era 40 y cortaba EN SILENCIO. Caso real 2981-214-LE26: bases de 68 páginas leídas
// hasta la 40; el anexo con la tabla de criterios (págs 47-48, el 60/20/10/5/5 que decide quién
// gana) nunca existió para el sistema, y el informe terminó con criterios inventados.
//
// Ahora el número NO es un tope de lectura sino un CORTACIRCUITO ante un PDF monstruoso, y muy
// por encima de cualquier pliego real (el más grande visto ronda las 140 págs). Si alguna vez se
// alcanza, las páginas que quedan fuera NO se pierden: se escriben como HUECOS reponibles (ver
// abajo), que es justo lo que la regla pide.
const OCR_LOCAL_MAX_PAGINAS = Number(process.env.OCR_LOCAL_MAX_PAGINAS ?? 500);
const OCR_LOCAL_SCALE = Number(process.env.OCR_LOCAL_SCALE ?? 2.0);
// Dónde cachea Tesseract el paquete de idioma (spa.traineddata, ~15 MB). Por defecto una
// carpeta dedicada (gitignored). En serverless de solo-lectura (Vercel), apunta a /tmp con
// TESSERACT_CACHE_PATH. La carpeta se crea sola si no existe.
const TESSERACT_CACHE_PATH = process.env.TESSERACT_CACHE_PATH || '.tesseract-cache';

// ── Marcas de página: TODA página del documento queda representada en el texto ────────────────
// Dos estados distintos, y la diferencia importa:
//
//  · HUECO (`OCR_NO_DISPONIBLE`) — no se pudo leer: falla técnica, o página fuera del
//    cortacircuito. Es REPONIBLE: `ocrTieneHuecos()` lo detecta, el análisis no reusa ese texto
//    como si estuviera completo, y `rellenarHuecos()` lo sustituye cuando se recupere.
//    Mismo formato EXACTO que emite GLM-OCR (ver zai-ocr.ts → paginasConHueco), para que el
//    reparador que ya existe funcione igual venga de donde venga el hueco.
//
//  · SIN TEXTO — se leyó y de verdad no hay nada (página en blanco, separador, una foto sin
//    letras). NO es un hueco: si se marcara como tal, cada análisis reintentaría para siempre
//    una página que nunca va a dar texto, re-OCR-eando el documento entero cada vez. Queda
//    anotada para que la cobertura cuadre y para que un humano sepa que ahí no falta nada.
function bloqueHueco(desde: number, hasta: number, motivo: string): string {
  const etiqueta = desde === hasta ? `[[PÁGINA ${desde}]]` : `[[PÁGINA ${desde}-${hasta}]]`;
  return `${etiqueta}\n[OCR_NO_DISPONIBLE: ${motivo} — se repondrá]`;
}

function paginaSinTexto(pagina: number): string {
  return `[[PÁGINA ${pagina}]]\n[PÁGINA SIN TEXTO: leída con OCR local, no contiene texto legible]`;
}

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
        // TODA página deja marca, tenga texto o no. Antes, una página sin resultado simplemente no
        // se escribía: desaparecía del texto sin dejar rastro, y el documento quedaba con un salto
        // invisible entre la página N y la N+2. Con la marca, el hueco se ve y se puede reponer.
        if (t) partes.push(`[[PÁGINA ${i + 1}]]\n${t}`);
        else partes.push(paginaSinTexto(i + 1));
      } catch (e) {
        console.warn(`[tesseract] pág ${i + 1} falló:`, e instanceof Error ? e.message : e);
        // Falla TÉCNICA (no "página en blanco"): se marca como hueco reponible, para que el
        // pipeline la reintente en vez de darla por leída.
        partes.push(bloqueHueco(i + 1, i + 1, 'Tesseract falló en esta página'));
      }
    }
  } finally {
    await worker.terminate().catch(() => {});
  }

  if (total > nPags) {
    console.warn(`[tesseract] OCR local limitado a ${nPags}/${total} págs (OCR_LOCAL_MAX_PAGINAS=${OCR_LOCAL_MAX_PAGINAS}).`);
    // Las páginas que quedaron fuera del cortacircuito NO se dan por perdidas: se escriben como
    // HUECOS con el mismo formato que usa GLM-OCR, así `ocrTieneHuecos()` devuelve true (el
    // análisis deja de reusar este texto como si estuviera completo) y `paginasConHueco()` +
    // `rellenarHuecos()` pueden reponerlas después sin volver a leer todo el documento.
    // El hueco YA dice cuántas páginas faltan y por qué, y a diferencia de una nota en prosa es
    // accionable: lo lee `paginasConHueco()` y lo repone `rellenarHuecos()`.
    partes.push(bloqueHueco(nPags + 1, total, `documento de ${total} págs, cortacircuito en ${nPags}`));
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
