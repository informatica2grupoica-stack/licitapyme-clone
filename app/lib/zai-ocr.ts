// app/lib/zai-ocr.ts
// OCR con GLM-OCR de Z.AI (https://docs.z.ai/guides/vlm/glm-ocr).
// Reemplaza a Gemini como MOTOR PRINCIPAL de OCR para PDFs escaneados:
// GLM-OCR es un modelo especialista en parsing de documentos (SOTA en OmniDocBench),
// con muy buena precisión en tablas de criterios, sellos, montos y layouts complejos.
//
// Endpoint síncrono: POST https://api.z.ai/api/paas/v4/layout_parsing
//   body: { model:'glm-ocr', file:<url|base64>, start_page_id?, end_page_id? }
//   respuesta: { md_results:'<markdown>', data_info:{ num_pages }, usage, ... }
//
// RESTRICCIONES MEDIDAS contra la API real (importante):
//  - PDF: SOLO se acepta por URL pública. El base64 de un PDF se rechaza (code 1214,
//    "formato no soportado"). Por eso este módulo trabaja sobre la URL del documento
//    (los docs viven en R2 con URL pública e inmutable). Las imágenes SÍ aceptan base64
//    (data URI), pero aquí no las usamos.
//  - start_page_id / end_page_id son 1-based; 0 = "sin límite". La doc oficial recomienda
//    trocear el PDF por páginas y llamar en PARALELO para ir más rápido.
//  - Límites: imagen ≤10MB, PDF ≤50MB, máx 100 págs por llamada.
//
// Troceamos por ventanas de páginas y numeramos los marcadores [[PÁGINA a-b]] de forma
// ABSOLUTA para que el chat y las citas puedan referenciar la página, igual que hacía el
// OCR anterior.

const ZAI_URL   = 'https://api.z.ai/api/paas/v4/layout_parsing';
const ZAI_MODEL = 'glm-ocr';

// Págs por llamada (ventana). El endpoint tolera 100. CITAS EXACTAS = 1 página por llamada:
// GLM-OCR solo emite la marca de página cuando detecta una imagen/logo en ella (![](page=K,...)),
// así que con ventanas grandes las páginas SIN logo se fusionan y los marcadores [[PÁGINA N]]
// salían escasos (p.ej. 1,9,16,24… cada 8 págs) → el modelo, sin marcador cercano, citaba el
// número IMPRESO del documento (pág. 29/4/19…) que NO calza con la página física y mandaba a la
// página equivocada. Con ventana=1, segmentarPorPaginaExacta rotula SIEMPRE la página absoluta
// (con o sin logo), así cada dato tiene su marcador exacto y la cita apunta a la página real.
// Cuesta ~8× llamadas de OCR (baratas) pero se paralelizan (GLM_OCR_CONCURRENCIA). Para volver
// al comportamiento anterior (más rápido, citas gruesas): GLM_OCR_PAGINAS_POR_LLAMADA=8.
const PAGINAS_POR_LLAMADA = Math.max(1, Number(process.env.GLM_OCR_PAGINAS_POR_LLAMADA) || 1);
// Tope de páginas a OCR-ear. REGLA: se leen TODAS las páginas del documento (la viabilidad
// y el chat deben ser fidedignos; el presupuesto/criterios pueden estar en cualquier página,
// como se comprobó con bases cuya cifra vivía en la pág. 2 y el OCR anterior la perdía). El
// tope alto es solo un cortacircuito ante un PDF monstruoso; configurable por env.
export const MAX_PAGINAS_OCR = Math.max(1, Number(process.env.GLM_OCR_MAX_PAGINAS) || 400);
// Límite DURO de GLM-OCR: rechaza (code 1214) cualquier PDF de >100 págs, incluso pidiendo
// un rango. Por encima de esto hay que trocear el PDF en sub-archivos ≤ este tope (ver
// document-extraction.ts → ocrPdfGrandePorChunks). Exportado para que el llamador decida.
export const GLM_OCR_LIMITE_PAGINAS = 100;
// Ventanas en paralelo: reduce el muro total; los reintentos con backoff absorben 429/503.
// Configurable por env (GLM_OCR_CONCURRENCIA): subir acelera docs grandes, pero más alto arriesga
// más 429/503 de Z.AI. Acotado a [1, 8] por seguridad.
const CONCURRENCIA = Math.min(8, Math.max(1, Number(process.env.GLM_OCR_CONCURRENCIA) || 5));

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Marca VISIBLE de una ventana que el OCR no pudo transcribir tras todos los reintentos.
// NUNCA se descarta una página en silencio: si falla, queda esta marca en el texto para que
// (a) sea evidente en el análisis/chat que faltan páginas y (b) el reuso de caché la detecte
// y vuelva a OCR-ear el documento (auto-sanación). Ver ocrTieneHuecos().
const MARCA_HUECO = 'OCR_NO_DISPONIBLE';
export function ocrTieneHuecos(texto: string): boolean {
  return typeof texto === 'string' && texto.includes(MARCA_HUECO);
}

// ─── Circuit breaker por SALDO AGOTADO (code 1113) ───────────────────────────────
// Z.AI devuelve HTTP 429 con { code: 1113, "Insufficient balance ... recharge" } cuando
// la cuenta NO tiene saldo. Eso es PERMANENTE, no transitorio: reintentarlo (4× por ventana
// × N ventanas) desperdicia minutos. Al primer 1113 marcamos GLM-OCR como agotado para ESTE
// proceso → las llamadas siguientes saltan GLM y caen directo al respaldo (Gemini). Se
// resetea al reiniciar el server (p.ej. tras recargar saldo en Z.AI).
let glmOcrSinSaldo = false;
export function glmOcrDisponible(): boolean { return !glmOcrSinSaldo; }

// ¿El cuerpo del error indica saldo agotado / recarga necesaria? (permanente)
function esSaldoAgotado(body: string): boolean {
  return /"code"\s*:\s*"?1113"?/.test(body) || /insufficient balance|no resource package|recharge/i.test(body);
}

// ¿Es una URL directamente alcanzable por GLM-OCR (pública)? Los PDFs deben servirse por
// URL; los de R2 (.r2.dev) son públicos. Las URLs de terceros (portal MP) no sirven: hay
// que descargarlas por el proxy, así que GLM-OCR no las puede leer y el llamador cae a Gemini.
export function esUrlOcrPublica(url: string): boolean {
  return /^https?:\/\//i.test(url) && url.includes('.r2.dev');
}

// ─── Llamada única a layout_parsing sobre una URL (ventana de páginas opcional) ──
// Devuelve el markdown reconocido (md_results). Reintenta ante 429/503 (transitorios);
// los errores permanentes (400/401/403) fallan de inmediato.
async function glmLayoutParsing(
  url: string,
  rango?: { startPage: number; endPage: number },
): Promise<string> {
  const apiKey = process.env.ZAI_API_KEY;
  if (!apiKey) throw new Error('ZAI_API_KEY no configurada para OCR (GLM-OCR)');
  // Circuit breaker: si ya sabemos que la cuenta no tiene saldo, no golpeamos GLM-OCR.
  if (glmOcrSinSaldo) throw new Error('GLM-OCR sin saldo (circuit breaker) → respaldo');

  const payload: Record<string, unknown> = { model: ZAI_MODEL, file: url };
  if (rango) { payload.start_page_id = rango.startPage; payload.end_page_id = rango.endPage; }
  const body = JSON.stringify(payload);

  const ESPERAS = [0, 6_000, 15_000, 30_000]; // 4 intentos
  let ultimoErr = '';
  for (let intento = 0; intento < ESPERAS.length; intento++) {
    if (intento > 0) await sleep(ESPERAS[intento]);

    const res = await fetch(ZAI_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(180_000),
    });

    if (res.ok) {
      const data = await res.json();
      // Telemetría de tokens del OCR (usage de la respuesta layout_parsing). Tarifa GLM-OCR
      // configurable por env; default estimado (se calibra con el precio real de Z.AI).
      const u = data?.usage ?? {};
      const inTok = Number(u.prompt_tokens ?? u.input_tokens ?? 0);
      const outTok = Number(u.completion_tokens ?? u.output_tokens ?? 0);
      const totTok = Number(u.total_tokens ?? (inTok + outTok));
      const numPags = Number(data?.data_info?.num_pages ?? 0);
      const precIn = Number(process.env.GLM_OCR_PRICE_IN_USD_PER_M ?? 0.03);  // GLM-OCR Z.AI: $0.03/M
      const precOut = Number(process.env.GLM_OCR_PRICE_OUT_USD_PER_M ?? 0.03); // GLM-OCR Z.AI: $0.03/M
      const costo = (inTok / 1e6) * precIn + (outTok / 1e6) * precOut;
      console.log(`[glm-ocr] 💰 págs=${numPags} · in=${inTok} out=${outTok} tot=${totTok} tok · ~$${costo.toFixed(4)} USD`);
      return String(data?.md_results ?? '');
    }

    const errBody = await res.text().catch(() => '');
    ultimoErr = `${res.status}: ${errBody.slice(0, 200)}`;
    // SALDO AGOTADO (1113): permanente → activar circuit breaker y fallar YA (respaldo Gemini).
    if (esSaldoAgotado(errBody)) {
      if (!glmOcrSinSaldo) {
        glmOcrSinSaldo = true;
        console.warn('[glm-ocr] ⛔ Z.AI SIN SALDO (code 1113) → circuit breaker ON: se usará el respaldo (Gemini) el resto de la sesión. Recarga en https://z.ai para reactivar GLM-OCR.');
      }
      throw new Error(`GLM-OCR sin saldo (1113): ${errBody.slice(0, 120)}`);
    }
    // Transitorios → reintentar con backoff: 429/503, 5xx de red, o cuerpo que pide reintentar
    // (code 1234 "Network error, please try again later", timeouts). NO se reintentan los 4xx
    // permanentes (1214 = formato/>100 págs, 401/403 = credenciales): esos fallan de inmediato.
    const esTransitorio =
      res.status === 429 || res.status === 503 || res.status === 500 || res.status === 502 || res.status === 504 ||
      /"code"\s*:\s*"?1234"?/.test(errBody) || /network error|try again later|timeout/i.test(errBody);
    if (esTransitorio) {
      console.warn(`[glm-ocr] ${res.status} transitorio (${errBody.slice(0, 70).replace(/\s+/g, ' ')}), reintento ${intento + 1}/${ESPERAS.length}...`);
      continue;
    }
    throw new Error(`GLM-OCR ${res.status}: ${errBody.slice(0, 300)}`);
  }

  throw new Error(`GLM-OCR no respondió tras reintentos. Último error: ${ultimoErr}`);
}

// ─── Marcado de PÁGINA EXACTA dentro de una ventana ──────────────────────────────
// GLM-OCR devuelve el markdown de la ventana con marcas de figura ![](page=K,bbox=[...])
// donde K es la página 0-based DENTRO de la ventana (0 = primera página del bloque). Esas
// marcas aparecen en cada página (logos/timbres municipales), así que sirven para saber en
// qué página va cada bloque de texto. Convertimos esa señal en marcadores [[PÁGINA N]] con
// el número ABSOLUTO, para que la viabilidad CITE la página exacta (antes citaba el rango
// grosero [[PÁGINA 9-16]] y el modelo inventaba "pág. 4"). Si la ventana no trae marcas de
// página, se rotula con el rango como respaldo (no se inventa un número).
function segmentarPorPaginaExacta(md: string, desde: number, hasta: number): string {
  const reImgPagina = /!\[\]\(page=(\d+),bbox=\[[^\]]*\]\)/g;
  const marcas: Array<{ idx: number; fin: number; k: number }> = [];
  let mm: RegExpExecArray | null;
  while ((mm = reImgPagina.exec(md)) !== null) marcas.push({ idx: mm.index, fin: reImgPagina.lastIndex, k: parseInt(mm[1], 10) });

  // Sin señal de página → respaldo: rotular con el rango de la ventana (no inventar página).
  if (!marcas.length) {
    const et = desde === hasta ? `[[PÁGINA ${desde}]]` : `[[PÁGINA ${desde}-${hasta}]]`;
    return `${et}\n${limpiarImagenes(md).trim()}`;
  }

  // Recorremos el markdown insertando [[PÁGINA absoluta]] cuando la página sube, y quitando
  // las marcas de imagen (son ruido para el LLM/chat; el resaltado se hace por búsqueda de texto).
  let out = '', cursor = 0, pagEmitida = -1, pagActual = 0;
  const emitir = (p: number) => { if (p !== pagEmitida) { out += `${out ? '\n\n' : ''}[[PÁGINA ${desde + p}]]\n`; pagEmitida = p; } };
  emitir(0); // el bloque arranca en su primera página
  for (const m of marcas) {
    out += md.slice(cursor, m.idx);   // texto previo → página actual ya emitida
    cursor = m.fin;                    // saltar la marca de imagen (se descarta)
    if (m.k > pagActual) { pagActual = m.k; emitir(pagActual); }
  }
  out += md.slice(cursor);
  return limpiarImagenes(out).trim();
}

// Quita cualquier marcador de imagen markdown restante (![](...)): son placeholders de
// figuras sin valor textual y ensucian el contexto del LLM y del chat.
function limpiarImagenes(s: string): string {
  return s.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\n{3,}/g, '\n\n');
}

// ─── OCR de UNA ventana de páginas (para clasificar la 1ª página) ────────────────
// startPage/endPage 1-based. Devuelve '' si no reconoce nada. No añade marcadores.
export async function extraerPaginasConGlmOcr(
  url: string,
  startPage: number,
  endPage: number,
): Promise<string> {
  try {
    return (await glmLayoutParsing(url, { startPage, endPage })).trim();
  } catch (e) {
    console.warn('[glm-ocr] fallo (ventana):', e instanceof Error ? e.message : e);
    return '';
  }
}

// ─── OCR de un PDF completo por URL (ventanas paralelas + marcadores absolutos) ──
// `totalPaginas` es el conteo real (de pdf-parse) DE ESTE archivo/URL. Si es 0/desconocido,
// una sola llamada al documento completo (sin marcadores por-página). Devuelve '' si no
// transcribe nada.
// `offsetAbsoluto` = páginas que preceden a este archivo dentro del documento ORIGINAL. Es 0
// para un PDF entero; para un trozo (chunk) de una base larga se pasa el nº de páginas de los
// trozos anteriores, así los marcadores [[PÁGINA N]] llevan el número absoluto del documento
// completo (las llamadas a la API siguen usando el rango 1-based DENTRO del trozo).
export async function extraerTextoPdfPorUrlConGlmOcr(
  url: string,
  totalPaginas: number,
  offsetAbsoluto = 0,
): Promise<string> {
  // Circuit breaker: cuenta sin saldo → ni lo intentamos, el llamador cae a Gemini.
  if (glmOcrSinSaldo) return '';

  // Sin conteo confiable → una sola llamada al documento completo (GLM tolera ≤100 págs).
  if (!totalPaginas || totalPaginas < 1) {
    try { return (await glmLayoutParsing(url)).trim(); }
    catch (e) { console.warn('[glm-ocr] doc completo falló:', e instanceof Error ? e.message : e); return ''; }
  }

  const paginas = Math.min(totalPaginas, MAX_PAGINAS_OCR);

  // Ventanas [desde, hasta] 1-based.
  const ventanas: Array<{ desde: number; hasta: number }> = [];
  for (let inicio = 1; inicio <= paginas; inicio += PAGINAS_POR_LLAMADA) {
    ventanas.push({ desde: inicio, hasta: Math.min(inicio + PAGINAS_POR_LLAMADA - 1, paginas) });
  }
  // Etiquetas SIEMPRE en página absoluta (aplica el offset del trozo).
  const etiquetaDe = (v: { desde: number; hasta: number }) => {
    const a = v.desde + offsetAbsoluto, b = v.hasta + offsetAbsoluto;
    return a === b ? `[[PÁGINA ${a}]]` : `[[PÁGINA ${a}-${b}]]`;
  };

  // Estado por ventana: ok=true si la llamada RESPONDIÓ (aunque la página venga en blanco);
  // ok=false si la API falló tras sus reintentos internos → candidata a reintento adicional.
  // Distinguir "página en blanco" (ok, texto '') de "fallo de OCR" (no ok) evita marcar como
  // hueco lo que realmente está vacío, y evita perder páginas por un 429 pasajero.
  const estado = new Array<{ texto: string; ok: boolean }>(ventanas.length);

  const correr = async (indices: number[], concurrencia: number) => {
    let cursor = 0;
    const worker = async () => {
      while (cursor < indices.length) {
        const i = indices[cursor++];
        const v = ventanas[i];
        try {
          // La API usa el rango 1-based DENTRO de este archivo (v.desde/v.hasta); el marcado
          // de página se hace en ABSOLUTO (con el offset del trozo) para que las citas apunten
          // a la página real del documento completo.
          const raw = (await glmLayoutParsing(url, { startPage: v.desde, endPage: v.hasta })).trim();
          const t = raw ? segmentarPorPaginaExacta(raw, v.desde + offsetAbsoluto, v.hasta + offsetAbsoluto) : '';
          estado[i] = { texto: t, ok: true };
          console.log(`[glm-ocr] págs ${v.desde + offsetAbsoluto}-${v.hasta + offsetAbsoluto}: ${t.length} chars`);
        } catch (e) {
          estado[i] = { texto: '', ok: false };
          console.warn(`[glm-ocr] págs ${v.desde + offsetAbsoluto}-${v.hasta + offsetAbsoluto} FALLÓ: ${e instanceof Error ? e.message : e}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrencia, indices.length) }, worker));
  };

  // 1ª pasada en paralelo sobre todas las ventanas.
  await correr(ventanas.map((_, i) => i), CONCURRENCIA);

  // 2ª pasada (SERIAL) solo sobre las ventanas que fallaron: absorbe tormentas de 429/503
  // que ya se despejaron. Serial para no volver a saturar. Sin esto, un fallo pasajero
  // borraba 8 páginas en silencio (p.ej. el bloque con el presupuesto).
  const fallidas = ventanas.map((_, i) => i).filter(i => !estado[i].ok);
  if (fallidas.length && !glmOcrSinSaldo) {
    console.warn(`[glm-ocr] reintentando ${fallidas.length} ventana(s) fallida(s) en serie...`);
    await correr(fallidas, 1);
  }

  // Ensamblar EN ORDEN. Toda ventana que siga fallando deja una marca VISIBLE (no se descarta
  // en silencio): así el análisis/chat sabe que falta y el reuso de caché la vuelve a OCR-ear.
  const partes: string[] = [];
  let huecos = 0;
  for (let i = 0; i < ventanas.length; i++) {
    const v = ventanas[i], et = etiquetaDe(v), s = estado[i];
    // Con texto: los marcadores [[PÁGINA N]] EXACTOS ya vienen dentro (segmentarPorPaginaExacta),
    // no se antepone el rango. Sin texto o con fallo: se rotula con el rango de la ventana.
    if (s.ok && s.texto) partes.push(s.texto);
    else if (s.ok) partes.push(`${et}\n(página sin texto)`);
    else { partes.push(`${et}\n[${MARCA_HUECO}: no se pudo OCR-ear estas páginas — se reintentará]`); huecos++; }
  }
  // Si TODO falló, devolvemos '' para que el llamador caiga al siguiente motor (Tesseract),
  // en vez de cachear un documento entero de puras marcas de hueco.
  if (huecos === ventanas.length) return '';

  let salida = partes.join('\n\n');
  if (huecos > 0) console.warn(`[glm-ocr] ⚠️ ${huecos}/${ventanas.length} ventana(s) quedaron sin OCR (marcadas para reintento).`);
  if (totalPaginas > MAX_PAGINAS_OCR && salida) {
    salida += `\n\n[NOTA: documento de ${totalPaginas} págs — OCR aplicado a las primeras ${MAX_PAGINAS_OCR}.]`;
  }
  return salida;
}
