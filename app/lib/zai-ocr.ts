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

// Págs por llamada (ventana). El endpoint tolera 100; usamos ventanas más chicas para
// obtener marcadores de página con mejor granularidad y paralelizar (recomendación oficial).
const PAGINAS_POR_LLAMADA = 8;
// Tope de páginas a OCR-ear (presupuesto/criterios/garantías van casi siempre en el
// primer tercio de las bases chilenas). Igual que el motor anterior.
const MAX_PAGINAS_OCR = 45;
// Ventanas en paralelo: reduce el muro total; los reintentos con backoff absorben 429/503.
const CONCURRENCIA = 3;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

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
    // Transitorios reales (429/503 SIN 1113) → reintentar con backoff.
    if (res.status === 429 || res.status === 503) {
      console.warn(`[glm-ocr] ${res.status} transitorio, reintento ${intento + 1}/${ESPERAS.length}...`);
      continue;
    }
    throw new Error(`GLM-OCR ${res.status}: ${errBody.slice(0, 300)}`);
  }

  throw new Error(`GLM-OCR no respondió tras reintentos. Último error: ${ultimoErr}`);
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
// `totalPaginas` es el conteo real (de pdf-parse). Si es 0/desconocido, una sola llamada
// al documento completo (sin marcadores por-página). Devuelve '' si no transcribe nada.
export async function extraerTextoPdfPorUrlConGlmOcr(
  url: string,
  totalPaginas: number,
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

  const procesarVentana = async (v: { desde: number; hasta: number }): Promise<string> => {
    const t = await extraerPaginasConGlmOcr(url, v.desde, v.hasta);
    const etiqueta = v.desde === v.hasta ? `[[PÁGINA ${v.desde}]]` : `[[PÁGINA ${v.desde}-${v.hasta}]]`;
    console.log(`[glm-ocr] págs ${v.desde}-${v.hasta}: ${t.length} chars`);
    return t ? `${etiqueta}\n${t}` : '';
  };

  // Paralelo con concurrencia acotada; cada ventana escribe en su índice (preserva orden).
  const resultados = new Array<string>(ventanas.length).fill('');
  let cursor = 0;
  const worker = async () => {
    while (cursor < ventanas.length) {
      const i = cursor++;
      resultados[i] = await procesarVentana(ventanas[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, ventanas.length) }, worker));

  let salida = resultados.filter(Boolean).join('\n\n');
  if (totalPaginas > MAX_PAGINAS_OCR && salida) {
    salida += `\n\n[NOTA: documento de ${totalPaginas} págs — OCR aplicado a las primeras ${MAX_PAGINAS_OCR}.]`;
  }
  return salida;
}
