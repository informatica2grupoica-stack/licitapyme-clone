// app/lib/document-extraction.ts
// Extracción de texto de documentos de licitación (PDF/Word/Excel), con OCR
// como fallback para PDFs escaneados. Usado por /api/analizar-documento y
// /api/licitacion-ia.

// ======================================================
// OCR CON OCR.SPACE (GRATUITO - 500 REQUESTS/MES)
// ======================================================

export async function extraerConOCRSpace(buffer: Buffer, fileName: string): Promise<{ texto: string; confianza: string }> {
  console.log('🔄 Enviando a OCR.space para reconocimiento...');

  const base64 = buffer.toString('base64');

  const formData = new FormData();
  formData.append('base64Image', `data:application/pdf;base64,${base64}`);
  formData.append('language', 'spa');
  formData.append('OCREngine', '2');
  formData.append('isCreateSearchablePdf', 'false');
  formData.append('isSearchablePdfHideTextLayer', 'true');

  try {
    const ocrKey = process.env.OCRSPACE_API_KEY || 'helloworld';
    const response = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      headers: { 'apikey': ocrKey },
      body: formData,
    });

    const data = await response.json();

    if (data.IsErroredOnProcessing) {
      console.error('Error OCR.space:', data.ErrorMessage);
      throw new Error(data.ErrorMessage?.[0] || 'Error en OCR');
    }

    const texto = data.ParsedResults?.[0]?.ParsedText || '';
    const confianza = data.ParsedResults?.[0]?.FileParseExitCode === 1 ? 'alta' : 'media';

    console.log(`✅ OCR completado: ${texto.length} caracteres, confianza: ${confianza}`);
    return { texto, confianza };

  } catch (error) {
    console.error('Error en OCR.space:', error);
    throw new Error(`OCR falló: ${error instanceof Error ? error.message : 'desconocido'}`);
  }
}

// ======================================================
// OCR POR BLOQUES (PDFs escaneados grandes)
// ======================================================
// Gemini Vision no puede con un PDF escaneado de 120 págs / 11.7MB en una sola
// llamada (rate-limit 429 + tiempo). Solución: dividir con pdf-lib y OCR-ear las
// primeras N páginas en bloques pequeños y SECUENCIALES (respeta la cuota).
// En las bases chilenas, presupuesto/criterios/garantías casi siempre están en el primer tercio.

const OCR_MAX_PAGINAS = 45; // tope de páginas a OCR-ear (presupuesto/criterios suelen ir < pág 40)
const OCR_BLOQUE      = 2;  // páginas por bloque: ≤1MB, requisito del plan gratuito de OCR.space

// OCR de un bloque pequeño. Motor principal: OCR.space (gratis con OCRSPACE_API_KEY,
// funciona enviando bloques ≤1MB). Respaldo: Gemini Vision (solo si hay cuota; el free
// tier de Gemini se agota rápido con 429). Enviar el PDF entero a OCR.space SÍ daba 0
// chars por exceder 1MB — por eso se trocea con pdf-lib antes de llamar.
async function ocrBloque(subBuf: Buffer): Promise<string> {
  // 1) OCR.space (gratis, alto volumen)
  try {
    const { texto } = await extraerConOCRSpace(subBuf, 'bloque.pdf');
    if (texto && texto.trim().length > 20) return texto.trim();
  } catch (e) {
    console.warn('[ocr-bloques] OCR.space falló:', e instanceof Error ? e.message : e);
  }
  // 2) Gemini Vision (respaldo)
  try {
    const { extraerTextoConGeminiVision } = await import('@/app/lib/gemini');
    const t = await extraerTextoConGeminiVision(subBuf);
    if (t && t.trim()) return t.trim();
  } catch (e) {
    console.warn('[ocr-bloques] Gemini Vision falló:', e instanceof Error ? e.message : e);
  }
  return '';
}

async function ocrPdfPorBloques(buffer: Buffer, totalPages: number): Promise<string> {
  const { PDFDocument } = await import('pdf-lib');

  let src;
  try {
    src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  } catch (e) {
    console.warn('[ocr-bloques] No se pudo abrir el PDF con pdf-lib:', e instanceof Error ? e.message : e);
    return '';
  }

  const paginas = Math.min(totalPages, OCR_MAX_PAGINAS);
  const partes: string[] = [];
  let fallosSeguidos = 0;

  for (let start = 0; start < paginas; start += OCR_BLOQUE) {
    const indices: number[] = [];
    for (let p = start; p < Math.min(start + OCR_BLOQUE, paginas); p++) indices.push(p);
    try {
      const sub = await PDFDocument.create();
      const copiadas = await sub.copyPages(src, indices);
      copiadas.forEach(pg => sub.addPage(pg));
      const subBuf = Buffer.from(await sub.save());
      const t = await ocrBloque(subBuf);
      console.log(`[ocr-bloques] págs ${start + 1}-${start + indices.length}: ${t.length} chars`);
      if (t) { partes.push(t); fallosSeguidos = 0; }
      else if (++fallosSeguidos >= 3) {
        console.warn('[ocr-bloques] 3 bloques sin texto seguidos — se detiene.');
        break;
      }
    } catch (e) {
      console.warn(`[ocr-bloques] Bloque ${start + 1}+ error:`, e instanceof Error ? e.message : e);
      if (++fallosSeguidos >= 3) break;
    }
  }

  if (totalPages > OCR_MAX_PAGINAS && partes.length > 0) {
    partes.push(`\n[NOTA: documento de ${totalPages} págs — OCR aplicado a las primeras ${OCR_MAX_PAGINAS}.]`);
  }
  return partes.join('\n\n');
}

// ======================================================
// EXTRACCIÓN DE TEXTO CON DETECCIÓN INTELIGENTE
// ======================================================

export interface ItemExcel { item: string; descripcion: string; cantidad: number | null; unidad: string | null }

// Parsea una hoja de cálculo (anexo económico/itemizado) a ítems estructurados.
// Detecta la columna de descripción (la de más texto / cabecera material|descrip|producto)
// y, si existen, las de cantidad y unidad por cabecera. Robusto a planillas sin precios.
function parsearItemsExcel(rowsAoA: any[][]): ItemExcel[] {
  const norm = (s: any) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  // Buscar la fila de cabecera: primera fila con ≥2 celdas de texto.
  let headerIdx = rowsAoA.findIndex(r => r && r.filter(c => typeof c === 'string' && c.trim().length > 1).length >= 1);
  if (headerIdx < 0) headerIdx = 0;
  // Array.from convierte huecos de la fila dispersa en undefined → norm los vuelve '' (denso).
  const header: string[] = Array.from(rowsAoA[headerIdx] || [], norm);

  const findCol = (claves: string[]) => header.findIndex(h => claves.some(k => (h || '').includes(k)));
  let colDesc = findCol(['material', 'descrip', 'producto', 'detalle', 'articulo', 'item', 'glosa', 'insumo']);
  const colCant = findCol(['cantidad', 'cant', 'cdad']);
  const colUnid = findCol(['unidad', 'medida', 'um', 'un.']);

  // Si no se encontró por cabecera, elegir la columna con más texto promedio.
  if (colDesc < 0) {
    const data = rowsAoA.slice(headerIdx + 1, headerIdx + 60);
    let mejor = -1, mejorLargo = 0;
    const ncols = Math.max(...rowsAoA.slice(0, 40).map(r => (r ? r.length : 0)), 0);
    for (let c = 0; c < ncols; c++) {
      const largo = data.reduce((s, r) => s + (typeof r?.[c] === 'string' ? r[c].trim().length : 0), 0);
      if (largo > mejorLargo) { mejorLargo = largo; mejor = c; }
    }
    colDesc = mejor;
  }
  if (colDesc < 0) return [];

  const items: ItemExcel[] = [];
  for (let i = headerIdx + 1; i < rowsAoA.length; i++) {
    const r = rowsAoA[i]; if (!r) continue;
    const desc = String(r[colDesc] ?? '').trim();
    if (desc.length < 2) continue;
    if (/^(total|subtotal|valor|monto|observ|nota|n°|nº|#)\b/i.test(desc)) continue; // saltar totales/notas
    const cantRaw = colCant >= 0 ? r[colCant] : null;
    const cantidad = cantRaw != null && !isNaN(Number(cantRaw)) ? Number(cantRaw) : null;
    const unidad = colUnid >= 0 && r[colUnid] != null ? String(r[colUnid]).trim() || null : null;
    items.push({ item: String(items.length + 1), descripcion: desc, cantidad, unidad });
    if (items.length >= 500) break;
  }
  return items;
}

export async function extractTextFromDocument(
  buffer: Buffer,
  extension: string,
  fileName: string,
  opts: { omitirOCR?: boolean } = {},
): Promise<{ texto: string; numPages: number; metodo: string; confianza: string; items?: ItemExcel[] }> {

  // WORD (DOCX/DOC)
  if (extension === 'docx' || extension === 'doc') {
    // mammoth solo lee .docx (OOXML = zip que empieza con "PK"). Los .doc legacy
    // (binario OLE, empieza con D0 CF 11 E0) se leen con word-extractor.
    const esZipDocx = buffer.length > 1 && buffer[0] === 0x50 && buffer[1] === 0x4b; // "PK"
    if (esZipDocx) {
      try {
        const mammoth = await import('mammoth');
        const result = await mammoth.extractRawText({ buffer });
        const texto = result.value || '';
        console.log(`✅ Word (.docx): ${texto.length} caracteres extraídos`);
        return { texto, numPages: 1, metodo: 'word', confianza: 'alta' };
      } catch (error) {
        console.warn(`[word] ${fileName}: mammoth falló —`, error instanceof Error ? error.message : error);
        return { texto: '', numPages: 1, metodo: 'word-error', confianza: 'baja' };
      }
    }
    // .doc legacy (OLE) → word-extractor
    try {
      const WordExtractor = (await import('word-extractor')).default;
      const extractor = new WordExtractor();
      const doc = await extractor.extract(buffer);
      const texto = [doc.getBody(), doc.getHeaders?.(), doc.getFootnotes?.()].filter(Boolean).join('\n').trim();
      if (texto.length > 0) {
        console.log(`✅ Word (.doc legacy): ${texto.length} caracteres extraídos`);
        return { texto, numPages: 1, metodo: 'word-doc', confianza: 'alta' };
      }
      console.warn(`[word] ${fileName}: .doc sin texto extraíble`);
      return { texto: '', numPages: 1, metodo: 'word-doc-vacio', confianza: 'baja' };
    } catch (error) {
      console.warn(`[word] ${fileName}: word-extractor falló —`, error instanceof Error ? error.message : error);
      return { texto: '', numPages: 1, metodo: 'word-doc-error', confianza: 'baja' };
    }
  }

  // EXCEL (XLSX/XLS)
  if (extension === 'xlsx' || extension === 'xls') {
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      let textoCompleto = '';
      const items: ItemExcel[] = [];
      workbook.SheetNames.forEach((sheetName: string) => {
        const sheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        textoCompleto += `\n--- Hoja: ${sheetName} ---\n${csv}\n`;
        // Ítems estructurados (lista itemizada / presupuesto) — independiente del OCR.
        const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false }) as any[][];
        if (items.length < 500) items.push(...parsearItemsExcel(aoa));
      });
      console.log(`✅ Excel: ${textoCompleto.length} caracteres, ${items.length} ítems de ${workbook.SheetNames.length} hojas`);
      return { texto: textoCompleto, numPages: workbook.SheetNames.length, metodo: 'excel', confianza: 'alta', items: items.slice(0, 500) };
    } catch (error) {
      console.error('Error en Excel:', error);
      return { texto: '', numPages: 1, metodo: 'excel-error', confianza: 'baja' };
    }
  }

  // PDF
  if (extension === 'pdf') {
    try {
      // Paso 1: Intentar extraer texto normal
      const pdfParse = (await import('pdf-parse')).default;
      const pdfData = await pdfParse(buffer);

      // Si tiene suficiente texto (más de 300 caracteres)
      if (pdfData.text && pdfData.text.trim().length > 300) {
        console.log(`✅ PDF con texto: ${pdfData.text.length} caracteres, ${pdfData.numpages} páginas`);
        return {
          texto: pdfData.text,
          numPages: pdfData.numpages,
          metodo: 'pdf-text',
          confianza: 'alta'
        };
      }

      // PDF escaneado pero se pidió OMITIR OCR (p.ej. planos/imágenes que no aportan
      // al análisis): devolver lo poco que haya sin gastar cuota de OCR.
      if (opts.omitirOCR) {
        console.log(`⏭ PDF escaneado sin OCR (omitirOCR): ${fileName}`);
        return { texto: pdfData.text || '', numPages: pdfData.numpages, metodo: 'pdf-sin-ocr', confianza: 'baja' };
      }

      // Paso 2: PDF escaneado — usar Gemini Vision (lee imágenes directamente).
      // Documentos grandes (>12 págs) → OCR por bloques con pdf-lib para no exceder cuota/tiempo.
      const esGrande = pdfData.numpages > 12;
      console.log(`⚠️ PDF escaneado (${pdfData.text?.length || 0} chars, ${pdfData.numpages} págs). Usando Gemini Vision OCR${esGrande ? ' por bloques' : ''}...`);
      try {
        const { extraerTextoConGeminiVision } = await import('@/app/lib/gemini');
        const textoVision = esGrande
          ? await ocrPdfPorBloques(buffer, pdfData.numpages)
          : await extraerTextoConGeminiVision(buffer);
        if (textoVision && textoVision.trim().length > 100) {
          return {
            texto: textoVision,
            numPages: pdfData.numpages,
            metodo: esGrande ? 'pdf-gemini-vision-bloques' : 'pdf-gemini-vision',
            confianza: 'alta',
          };
        }
      } catch (visionErr) {
        console.warn('[OCR] Gemini Vision falló:', visionErr);
      }

      // Paso 3: Devolver lo que hay (OCR.space se removió: devolvía siempre 0 chars).
      return {
        texto: pdfData.text || '',
        numPages: pdfData.numpages,
        metodo: 'pdf-sin-texto',
        confianza: 'baja',
      };

    } catch (error) {
      console.error('Error en PDF:', error);
      return { texto: '', numPages: 0, metodo: 'pdf-error', confianza: 'baja' };
    }
  }

  return { texto: '', numPages: 0, metodo: 'unsupported', confianza: 'baja' };
}

// ======================================================
// DESCARGA + EXTRACCIÓN DE TEXTO DE UN DOCUMENTO (por URL)
// ======================================================

type ResultadoExtraccion = { texto: string; numPages: number; metodo: string; confianza: string; bytes: number; items?: ItemExcel[] } | null;

// Caché + dedup en memoria. Los documentos en R2 son inmutables (la URL lleva timestamp),
// así que el texto extraído se puede reutilizar. Esto evita re-OCR-ear el mismo PDF cuando
// clasificación + análisis + viabilidad lo piden a la vez o al reabrir la licitación en la
// misma sesión del servidor. Guardamos la Promise para colapsar llamadas concurrentes en una.
const _extraccionCache = new Map<string, Promise<ResultadoExtraccion>>();
const EXTRACCION_CACHE_MAX = 400;

export async function descargarYExtraerTexto(url: string, nombre: string, opts: { omitirOCR?: boolean } = {}): Promise<ResultadoExtraccion> {
  const urlSinQuery = url.split('?')[0];
  const cacheKey = `${urlSinQuery}|ocr:${opts.omitirOCR ? '0' : '1'}`;
  const enCache = _extraccionCache.get(cacheKey);
  if (enCache) { console.log(`[extraccion] cache hit: ${nombre}`); return enCache; }

  const promesa = _descargarYExtraerTextoImpl(url, nombre, opts);
  _extraccionCache.set(cacheKey, promesa);
  // Solo cacheamos extracciones ÚTILES. Si falla, o un PDF escaneado no dio texto
  // (p.ej. OCR caído por cuota), lo quitamos para reintentar cuando el OCR vuelva.
  promesa.then(r => {
    const util = r != null && ((r.items && r.items.length > 0) || (r.texto && r.texto.trim().length >= 50));
    if (!util) _extraccionCache.delete(cacheKey);
  }).catch(() => _extraccionCache.delete(cacheKey));
  // Tope simple para no crecer sin límite (evicta la entrada más antigua).
  if (_extraccionCache.size > EXTRACCION_CACHE_MAX) {
    const primera = _extraccionCache.keys().next().value;
    if (primera) _extraccionCache.delete(primera);
  }
  return promesa;
}

async function _descargarYExtraerTextoImpl(url: string, nombre: string, opts: { omitirOCR?: boolean } = {}): Promise<ResultadoExtraccion> {
  const urlSinQuery = url.split('?')[0];
  const extension = (urlSinQuery.split('.').pop() || '').toLowerCase();
  const formatosPermitidos = ['pdf', 'docx', 'doc', 'xlsx', 'xls'];
  if (!formatosPermitidos.includes(extension)) return null;

  let fetchUrl: string;
  const esUrlPropia = url.includes('.r2.dev') || url.includes(process.env.R2_ACCOUNT_ID || '__no__');
  if (esUrlPropia) {
    fetchUrl = url;
  } else {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    fetchUrl = `${baseUrl}/api/proxy?url=${encodeURIComponent(url)}`;
  }

  const res = await fetch(fetchUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LicitapymeBot/1.0)' }
  });
  if (!res.ok) return null;

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length === 0) return null;

  const result = await extractTextFromDocument(buffer, extension, nombre, opts);
  return { ...result, bytes: buffer.length };
}
