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
      // Marcador de página (rango del bloque) para que la IA pueda citar la página.
      if (t) { partes.push(`\n\n[[PÁGINA ${start + 1}-${start + indices.length}]]\n${t}`); fallosSeguidos = 0; }
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
// OCR DE PDFs LARGOS (>100 págs) — TROCEO PARA GLM-OCR
// ======================================================
// GLM-OCR rechaza (code 1214) cualquier PDF de más de 100 págs, INCLUSO pidiendo un rango de
// páginas: valida el total del archivo ANTES de aplicar start/end_page. Por eso una base de
// 136 págs falla en TODAS las ventanas y la viabilidad se queda sin texto.
// Solución: partir el PDF en sub-PDFs de ≤GLM_OCR_LIMITE_PAGINAS págs (con pdf-lib), subir cada
// trozo a R2 (URL pública que GLM sí lee) y OCR-earlo con offset de página ABSOLUTO, de modo que
// los marcadores [[PÁGINA N]] sigan apuntando a la página real del documento completo. Los
// trozos temporales se borran al terminar (best-effort). Reutiliza toda la lógica de ventanas/
// paralelismo/reintentos de zai-ocr.
async function ocrPdfGrandePorChunksGlm(buffer: Buffer, totalPaginas: number, nombre: string): Promise<string> {
  const { PDFDocument } = await import('pdf-lib');
  const { subirDocumentoR2, borrarDocumentoR2 } = await import('@/app/lib/r2');
  const { extraerTextoPdfPorUrlConGlmOcr, GLM_OCR_LIMITE_PAGINAS, MAX_PAGINAS_OCR } = await import('@/app/lib/zai-ocr');

  // Tamaño de trozo: ≤ límite duro de GLM (100). Configurable con margen por si algún PDF trae
  // páginas extra al copiar; default 90 (holgado y aún eficiente: pocas subidas a R2).
  const CHUNK = Math.max(1, Math.min(GLM_OCR_LIMITE_PAGINAS, Number(process.env.GLM_OCR_CHUNK_PAGINAS) || 90));

  let src;
  try {
    src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  } catch (e) {
    console.warn('[glm-ocr] no se pudo abrir el PDF para trocear:', e instanceof Error ? e.message : e);
    return '';
  }

  const paginas = Math.min(totalPaginas, MAX_PAGINAS_OCR);
  const partes: string[] = [];
  const urlsTemp: string[] = [];

  for (let inicio = 0; inicio < paginas; inicio += CHUNK) {
    const fin = Math.min(inicio + CHUNK, paginas);            // [inicio, fin) 0-based
    const indices = Array.from({ length: fin - inicio }, (_, k) => inicio + k);
    try {
      const sub = await PDFDocument.create();
      const copiadas = await sub.copyPages(src, indices);
      copiadas.forEach(p => sub.addPage(p));
      const subBuf = Buffer.from(await sub.save());
      // Sub-PDF temporal en R2 bajo un prefijo aparte. Nombre .pdf → se sirve como application/pdf
      // (embebible) y GLM lo acepta por URL. El nombre lleva el rango para depurar.
      const nombreChunk = `_ocrtmp_${nombre.replace(/\.[^.]+$/, '')}.p${inicio + 1}-${fin}.pdf`;
      const urlChunk = await subirDocumentoR2('_ocrtmp', nombreChunk, subBuf, 'application/pdf');
      urlsTemp.push(urlChunk);
      // OCR del trozo con su propio conteo de páginas y el offset absoluto (páginas previas).
      const textoChunk = await extraerTextoPdfPorUrlConGlmOcr(urlChunk, fin - inicio, inicio);
      if (textoChunk) partes.push(textoChunk);
      console.log(`[glm-ocr] chunk págs ${inicio + 1}-${fin}: ${textoChunk.length} chars`);
    } catch (e) {
      console.warn(`[glm-ocr] chunk págs ${inicio + 1}-${fin} FALLÓ:`, e instanceof Error ? e.message : e);
    }
  }

  // Limpieza best-effort de los trozos temporales (no bloquea ni rompe si falla).
  for (const u of urlsTemp) borrarDocumentoR2(u).catch(() => {});

  if (totalPaginas > MAX_PAGINAS_OCR && partes.length) {
    partes.push(`\n[NOTA: documento de ${totalPaginas} págs — OCR aplicado a las primeras ${MAX_PAGINAS_OCR}.]`);
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
  opts: { omitirOCR?: boolean; sourceUrl?: string } = {},
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
      // Paso 1: Intentar extraer texto normal.
      // pagerender propio: replica el render por defecto de pdf-parse pero antepone
      // un marcador [[PÁGINA N]] en cada página, para que la IA pueda CITAR la página
      // exacta de cada dato (requisito del PROMPT 2). Las páginas se procesan en orden.
      const pdfParse = (await import('pdf-parse')).default;
      let _pag = 0;
      const pagerender = (pageData: any) =>
        pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false })
          .then((tc: any) => {
            _pag++;
            let lastY: number | undefined, text = '';
            for (const item of tc.items) {
              if (lastY === item.transform[5] || lastY === undefined) text += item.str;
              else text += '\n' + item.str;
              lastY = item.transform[5];
            }
            return `\n\n[[PÁGINA ${_pag}]]\n${text}`;
          });
      const pdfData = await pdfParse(buffer, { pagerender });

      // ¿El texto extraído es REAL o solo los marcadores [[PÁGINA N]] de un escaneado?
      // pdf-parse antepone un marcador por página aunque la página sea una imagen sin
      // capa de texto. Un PDF escaneado de 33 págs devuelve 452 chars que son SOLO los
      // 33 marcadores → texto real = 0. Antes pasaba el umbral de 300 y se marcaba como
      // 'pdf-text' exitoso, saltándose el OCR y perdiendo TODO el contenido (p.ej. los
      // criterios de evaluación en la pág 13). Medimos el texto SIN marcadores y exigimos
      // una densidad mínima por página: si es bajísima, es escaneado → va a OCR.
      const textoReal = (pdfData.text || '').replace(/\[\[P[ÁA]GINA[^\]]*\]\]/gi, '').trim();
      const numPags = Math.max(1, pdfData.numpages || 1);
      const densidad = textoReal.length / numPags;  // chars de texto real por página
      const tieneCapaDeTexto = textoReal.length > 300 && densidad >= 120;

      if (tieneCapaDeTexto) {
        console.log(`✅ PDF con texto: ${textoReal.length} chars reales, ${numPags} págs (densidad ${Math.round(densidad)}/pág)`);
        return {
          texto: pdfData.text,
          numPages: pdfData.numpages,
          metodo: 'pdf-text',
          confianza: 'alta'
        };
      }
      console.log(`⚠️ PDF con poca capa de texto: ${textoReal.length} chars reales en ${numPags} págs (densidad ${Math.round(densidad)}/pág) → tratado como escaneado`);

      // PDF escaneado pero se pidió OMITIR OCR (p.ej. planos/imágenes que no aportan
      // al análisis): devolver lo poco que haya sin gastar cuota de OCR.
      if (opts.omitirOCR) {
        console.log(`⏭ PDF escaneado sin OCR (omitirOCR): ${fileName}`);
        return { texto: pdfData.text || '', numPages: pdfData.numpages, metodo: 'pdf-sin-ocr', confianza: 'baja' };
      }

      // Paso 2: PDF escaneado — GLM-OCR (Z.AI) lee las imágenes.
      // MÉTODO PRINCIPAL: GLM-OCR sobre la URL pública del documento (troceado por
      // ventanas de páginas en paralelo, con numeración absoluta). Modelo especialista
      // en parsing de documentos (SOTA en OmniDocBench), mejor que Gemini en tablas de
      // criterios, sellos y layouts complejos. GLM-OCR SOLO lee PDFs por URL pública
      // (no base64), así que este camino requiere opts.sourceUrl alcanzable (R2).
      // Proveedor de OCR: 'zai' (GLM-OCR, por defecto) o 'gemini' (salta GLM y usa Gemini
      // File API directo). Útil cuando GLM está sin saldo o se quiere Gemini al 100%.
      const ocrProvider = (process.env.IA_OCR_PROVIDER ?? 'zai').toLowerCase();

      // OCR LOCAL (Tesseract) como PRINCIPAL: 100% local, sin API ni saldo. Ideal cuando
      // GLM/Gemini están caídos o sin crédito. No depende de URL pública (lee el buffer).
      if (ocrProvider === 'tesseract') {
        console.log(`⚠️ PDF escaneado (${pdfData.numpages} págs) → OCR local Tesseract...`);
        try {
          const { ocrPdfLocalTesseract } = await import('@/app/lib/tesseract-ocr');
          const textoLocal = await ocrPdfLocalTesseract(buffer);
          if (textoLocal && textoLocal.trim().length > 100) {
            return { texto: textoLocal, numPages: pdfData.numpages, metodo: 'pdf-tesseract-local', confianza: 'media' };
          }
          console.warn('[OCR] Tesseract local devolvió poco texto; caigo a los OCR por IA.');
        } catch (tessErr) {
          console.warn('[OCR] Tesseract local falló, caigo a los OCR por IA:', tessErr instanceof Error ? tessErr.message : tessErr);
        }
      }

      const { esUrlOcrPublica } = await import('@/app/lib/zai-ocr');
      if (ocrProvider !== 'gemini' && ocrProvider !== 'tesseract' && opts.sourceUrl && esUrlOcrPublica(opts.sourceUrl) && process.env.ZAI_API_KEY) {
        console.log(`⚠️ PDF escaneado (${pdfData.text?.length || 0} chars, ${pdfData.numpages} págs). GLM-OCR (por URL)...`);
        try {
          const { extraerTextoPdfPorUrlConGlmOcr, ocrTieneHuecos, GLM_OCR_LIMITE_PAGINAS } = await import('@/app/lib/zai-ocr');
          // GLM rechaza PDFs de >100 págs (code 1214) aunque se pida un rango: hay que trocear el
          // archivo en sub-PDFs ≤100 págs, subirlos a R2 y OCR-ear cada uno con offset absoluto.
          const textoGlm = (pdfData.numpages || 0) > GLM_OCR_LIMITE_PAGINAS
            ? await ocrPdfGrandePorChunksGlm(buffer, pdfData.numpages, fileName)
            : await extraerTextoPdfPorUrlConGlmOcr(opts.sourceUrl, pdfData.numpages || 0);
          if (textoGlm && textoGlm.trim().length > 100) {
            // Si alguna ventana quedó sin OCR (hueco), lo marcamos como incompleto y confianza
            // BAJA: así el reuso de caché lo re-OCR-ea en vez de fijarlo (auto-sanación).
            const incompleto = ocrTieneHuecos(textoGlm);
            return {
              texto: textoGlm, numPages: pdfData.numpages,
              metodo: incompleto ? 'pdf-glm-ocr-incompleto' : 'pdf-glm-ocr',
              confianza: incompleto ? 'baja' : 'alta',
            };
          }
        } catch (glmErr) {
          console.warn('[OCR] GLM-OCR falló, caigo a Gemini:', glmErr instanceof Error ? glmErr.message : glmErr);
        }
      }

      // RESPALDO Gemini RETIRADO: File API / Vision solo corren si se reactiva Gemini a
      // propósito (GEMINI_HABILITADO=1 + key). Sin eso, el flujo salta DIRECTO a Tesseract
      // local (código Gemini dormido por si se vuelve a ocupar).
      const { geminiHabilitado } = await import('@/app/lib/gemini');
      if (geminiHabilitado()) {
        console.log(`⚠️ PDF escaneado → respaldo Gemini File API...`);
        try {
          const { extraerTextoPdfConGeminiFileAPI } = await import('@/app/lib/gemini');
          const textoFile = await extraerTextoPdfConGeminiFileAPI(buffer);
          if (textoFile && textoFile.trim().length > 100) {
            return { texto: textoFile, numPages: pdfData.numpages, metodo: 'pdf-gemini-fileapi', confianza: 'alta' };
          }
        } catch (fileErr) {
          console.warn('[OCR] Gemini File API falló, caigo a OCR por bloques:', fileErr instanceof Error ? fileErr.message : fileErr);
        }

        const esGrande = pdfData.numpages > 12;
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
      }

      // ÚLTIMO RESPALDO: OCR local Tesseract (si no se intentó ya como principal). Evita
      // devolver vacío cuando los OCR por IA caen/sin crédito. Local, sin API.
      if (ocrProvider !== 'tesseract') {
        console.log(`⚠️ OCR por IA sin resultado → último respaldo: Tesseract local...`);
        try {
          const { ocrPdfLocalTesseract } = await import('@/app/lib/tesseract-ocr');
          const textoLocal = await ocrPdfLocalTesseract(buffer);
          if (textoLocal && textoLocal.trim().length > 100) {
            return { texto: textoLocal, numPages: pdfData.numpages, metodo: 'pdf-tesseract-local', confianza: 'media' };
          }
        } catch (tessErr) {
          console.warn('[OCR] Tesseract local (respaldo) falló:', tessErr instanceof Error ? tessErr.message : tessErr);
        }
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

  // Pasamos la URL de origen: si es pública (R2), GLM-OCR la lee directo para el OCR.
  const result = await extractTextFromDocument(buffer, extension, nombre, { ...opts, sourceUrl: url });
  return { ...result, bytes: buffer.length };
}
