// app/lib/gemini.ts
// Cliente Gemini via endpoint OpenAI-compatible.
// Solo gemini-2.5-flash (único modelo habilitado en este proyecto).
// Thinking desactivado para respuestas rápidas.

import OpenAI from 'openai';
import { parseJsonIA } from '@/app/lib/json-ia';

// ─── Tipos ─────────────────────────────────────────────────────────────────────
export interface AnalisisIALicitacion {
  presupuesto?: { monto?: number | null; moneda?: string | null };
  plazoEjecucionDias?: number | null;
  plazoEntregaDias?: number | null;
  modalidadAdjudicacion?: string | null;
  tipoContrato?: string | null;
  lugarEntrega?: string | null;

  criteriosEvaluacion?: Array<{
    nombre: string;
    ponderacion: number;
    tipo?: 'tecnico' | 'economico' | 'experiencia' | 'otros';
    descripcion?: string;
    formula?: string;
  }>;

  especificacionesTecnicas?: Array<{
    item: string;
    descripcion: string;
    cantidad?: number | null;
    unidad?: string | null;
    requisitosMinimos?: string | null;
  }>;

  documentosAPresenter?: string[];

  requisitos?: {
    administrativos?: string[];
    tecnicos?: string[];
    economicos?: string[];
    habilitantes?: string[];
    prohibiciones?: string[];
  };

  garantias?: Array<{
    tipo: string;
    porcentaje?: number | null;
    montoFijo?: number | null;
    momento?: string | null;
    devolucion?: string | null;
    plazo?: string | null;
  }>;

  multas?: Array<{
    concepto: string;
    valor: string;
    unidad?: 'UTM' | 'UF' | 'pesos' | 'porcentaje';
  }>;

  contacto?: {
    nombre?: string | null;
    cargo?: string | null;
    email?: string | null;
    telefono?: string | null;
  } | null;

  resumenBasesAdmin?: {
    objeto: string;
    plazo_contrato: string | null;
    modalidad_pago: string | null;
    forma_pago: string | null;
    garantias_exigidas: string[];
    causales_rechazo: string[];
    cronograma: Array<{ etapa: string; fecha: string }>;
    condiciones_contrato: string[];
    penalidades_resumen: string | null;
  } | null;

  resumenBasesTecnicas?: {
    descripcion_general: string;
    alcance: string;
    entregables: string[];
    estandares_calidad: string[];
    condiciones_entrega: string | null;
    requisitos_tecnicos_oferente: string[];
    lugar_ejecucion: string | null;
  } | null;

  analisisExperto?: {
    resumenEjecutivo?: string;
    puntosCriticos?: string[];
    oportunidades?: string[];
    riesgosDetectados?: string[];
    recomendaciones?: string[];
    complejidad?: 'baja' | 'media' | 'alta';
    atractivo?: string;
    ventajasCompetitivas?: string[];
    aspectosNegociables?: string[];
  } | null;

  error?: string;
  raw?: string;
}

// ─── Proveedor de razonamiento de texto (clasificación/viabilidad/chat/…) ─────
// Se elige con IA_TEXT_PROVIDER: 'zai' (GLM-4.6), 'deepseek' o 'gemini'. Los TRES exponen un
// endpoint compatible con OpenAI, así que el mismo cliente sirve (Gemini vía el endpoint
// OpenAI-compatible de Google). El modelo de Gemini se ajusta con GEMINI_MODEL.
type ProveedorTexto = { baseURL: string; keyEnv: string; model: string; sinThinking: boolean };
const PROVEEDORES_TEXTO: Record<string, ProveedorTexto> = {
  zai:      { baseURL: 'https://api.z.ai/api/paas/v4', keyEnv: 'ZAI_API_KEY',      model: 'glm-4.6',      sinThinking: true  },
  deepseek: { baseURL: 'https://api.deepseek.com',     keyEnv: 'DEEPSEEK_API_KEY', model: 'deepseek-chat', sinThinking: false },
  gemini:   { baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', keyEnv: 'GEMINI_API_KEY', model: process.env.GEMINI_MODEL || 'gemini-2.5-flash', sinThinking: false },
};
export const IA_TEXT_PROVIDER = (process.env.IA_TEXT_PROVIDER ?? 'zai').toLowerCase();
function cfgTexto(): ProveedorTexto { return PROVEEDORES_TEXTO[IA_TEXT_PROVIDER] ?? PROVEEDORES_TEXTO.zai; }
// Proveedor de RESPALDO: el PRIMERO de los otros que tenga API key configurada (no
// desperdicia créditos si el principal cae). Orden de preferencia: gemini → deepseek → zai.
function cfgTextoAlterno(): ProveedorTexto {
  const orden = ['gemini', 'deepseek', 'zai'].filter((k) => k !== IA_TEXT_PROVIDER);
  for (const k of orden) {
    const cfg = PROVEEDORES_TEXTO[k];
    if (cfg && process.env[cfg.keyEnv]) return cfg;
  }
  return PROVEEDORES_TEXTO.deepseek;
}

// Modelo del proveedor activo (glm-4.6 por defecto). Exportado para etiquetar resultados.
export const MODELO_TEXTO = cfgTexto().model;

// ¿Hay key para el proveedor de texto activo? Reemplaza los checks de DEEPSEEK_API_KEY.
export function iaTextoConfigurada(): boolean { return Boolean(process.env[cfgTexto().keyEnv]); }

function clienteProveedor(cfg: ProveedorTexto) {
  return new OpenAI({
    apiKey:  process.env[cfg.keyEnv] ?? 'not-configured',
    baseURL: cfg.baseURL,
    timeout: 120_000,
    maxRetries: 0,
  });
}

export function getGemini() { return clienteProveedor(cfgTexto()); }

function cuerpoPara(cfg: ProveedorTexto, params: any): any {
  const body: any = { ...params, model: cfg.model };
  if (cfg.sinThinking) body.thinking = { type: 'disabled' };
  return body;
}

// Crea un chat completion en el proveedor de texto ACTIVO (GLM por defecto). Fuerza el
// modelo correcto e inyecta thinking=disabled en GLM (respuestas rápidas, sin gasto de
// razonamiento). Si el principal falla y el OTRO proveedor tiene key, reintenta con él
// (red de seguridad: aprovecha los créditos de DeepSeek cuando GLM cae). Úsalo en vez de
// getGemini().chat.completions.create(...) en todo el código de análisis.
// opts.timeoutMs: timeout por-request (override del cliente). Las llamadas grandes (viabilidad,
// ~90k tokens) necesitan más de los 120s por defecto o GLM cae por timeout y termina
// respondiendo DeepSeek. opts.sinRespaldo: no caer al otro proveedor (para pruebas puras).
// Telemetría SIEMPRE visible de cada llamada de texto: modelo, tiempo, tokens y costo
// estimado. Tarifas por millón de tokens (USD), configurables por env. Default GLM-4.6 (Z.AI).
function logTelemetriaIA(model: string, ms: number, usage: any, respaldo: boolean) {
  const inTok  = Number(usage?.prompt_tokens ?? 0);
  const outTok = Number(usage?.completion_tokens ?? 0);
  const totTok = Number(usage?.total_tokens ?? (inTok + outTok));
  const esGlm = /glm/i.test(model);
  const precIn  = Number(process.env.GLM_PRICE_IN_USD_PER_M  ?? (esGlm ? 0.43 : 0.27));
  const precOut = Number(process.env.GLM_PRICE_OUT_USD_PER_M ?? (esGlm ? 1.74 : 1.10));
  const costo = (inTok / 1e6) * precIn + (outTok / 1e6) * precOut;
  console.log(
    `[ia] 💰 ${model}${respaldo ? ' (RESPALDO)' : ''} · ${(ms / 1000).toFixed(1)}s · in=${inTok} out=${outTok} tot=${totTok} tok · ~$${costo.toFixed(4)} USD`,
  );
}

// Circuit breaker de TEXTO por saldo agotado (code 1113). Igual que en GLM-OCR: al primer
// 1113 marcamos el proveedor principal como sin saldo y saltamos directo al respaldo el resto
// de la sesión (evita perder ~2s y ensuciar el log tratando de usar GLM en cada llamada).
let textoPrincipalSinSaldo = false;
function esSaldoAgotadoTexto(e: any): boolean {
  const s = `${JSON.stringify(e?.error ?? '')} ${String(e?.code ?? '')} ${String(e?.message ?? '')}`;
  // GLM (1113 / insufficient balance) + Gemini ("prepayment credits are depleted"). Frases
  // INEQUÍVOCAS de crédito agotado → PERMANENTE (saltar al respaldo, no reintentar). No incluimos
  // RESOURCE_EXHAUSTED "a secas" porque Gemini también lo usa para rate-limit transitorio.
  return /"?1113"?|insufficient balance|no resource package|recharge|credits are depleted|prepayment credits/i.test(s);
}

// ¿Error TRANSITORIO que conviene reintentar? (red caída + rate-limit + 5xx).
// ECONNRESET/ETIMEDOUT/socket-hang-up son los que tumbaban la viabilidad a mitad de camino.
function esTransitorioIA(e: any): boolean {
  const st = Number(e?.status ?? 0);
  if (st === 429 || st === 500 || st === 502 || st === 503 || st === 504) return true;
  const s = `${String(e?.code ?? '')} ${String(e?.errno ?? '')} ${String(e?.cause?.code ?? '')} ${String(e?.message ?? '')}`;
  return /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EPIPE|EAI_AGAIN|ENOTFOUND|socket hang up|network error|fetch failed|terminated|aborted|timeout/i.test(s);
}

// Llama a UN proveedor con reintentos ante transitorios (backoff). Saldo agotado (1113) y
// errores permanentes (400/401/403) NO se reintentan: se propagan para que el caller decida.
async function intentarProveedor(cfg: ProveedorTexto, params: any, reqOpts: any, respaldo: boolean): Promise<any> {
  const ESPERAS = [0, 2_000, 6_000]; // 3 intentos por proveedor
  let ultimo: any;
  for (let i = 0; i < ESPERAS.length; i++) {
    if (i > 0) await sleep(ESPERAS[i]);
    try {
      const t0 = Date.now();
      const r = await clienteProveedor(cfg).chat.completions.create(cuerpoPara(cfg, params), reqOpts);
      logTelemetriaIA(cfg.model, Date.now() - t0, (r as any).usage, respaldo);
      return r;
    } catch (e: any) {
      ultimo = e;
      if (esSaldoAgotadoTexto(e) || !esTransitorioIA(e)) throw e; // permanente → arriba decide
      console.warn(`[ia] ${cfg.model} transitorio (${String(e?.status ?? e?.code ?? e?.message).slice(0, 60)}), reintento ${i + 1}/${ESPERAS.length}...`);
    }
  }
  throw ultimo;
}

export async function crearChatIA(params: any, opts: { timeoutMs?: number; sinRespaldo?: boolean } = {}) {
  const activo = cfgTexto();
  const alt = cfgTextoAlterno();
  const dbg = process.env.VIABILIDAD_DEBUG === '1';
  const reqOpts = opts.timeoutMs ? { timeout: opts.timeoutMs } : undefined;
  const hayRespaldo = !opts.sinRespaldo && alt.keyEnv !== activo.keyEnv && !!process.env[alt.keyEnv];

  // Breaker: si el principal ya se declaró sin saldo y hay respaldo, vamos directo al respaldo.
  if (textoPrincipalSinSaldo && hayRespaldo) return intentarProveedor(alt, params, reqOpts, true);

  try {
    if (dbg) console.log(`[ia-dbg] chat PRINCIPAL → ${activo.model} (${activo.baseURL})${opts.timeoutMs ? ` timeout=${opts.timeoutMs}ms` : ''}`);
    return await intentarProveedor(activo, params, reqOpts, false);
  } catch (e: any) {
    // Saldo agotado (1113) → activar breaker para no reintentar el principal en toda la sesión.
    if (esSaldoAgotadoTexto(e) && !textoPrincipalSinSaldo) {
      textoPrincipalSinSaldo = true;
      console.warn(`[ia] ⛔ ${activo.model} SIN SALDO (code 1113) → circuit breaker ON: se usará ${alt.model} el resto de la sesión. Recarga en https://z.ai para reactivar.`);
    }
    if (hayRespaldo) {
      console.warn(`[ia] ${activo.model} falló (${String(e?.status ?? e?.message ?? e).slice(0, 80)}), respaldo → ${alt.model}`);
      return intentarProveedor(alt, params, reqOpts, true); // el respaldo también reintenta transitorios
    }
    throw e;
  }
}

const MODELO = MODELO_TEXTO;

// ─── Gemini Vision OCR (PDFs escaneados) ─────────────────────────────────────
// Usa la API nativa de Gemini para leer PDFs con imágenes escaneadas.
// Solo se llama cuando pdf-parse no puede extraer texto suficiente.
export async function extraerTextoConGeminiVision(buffer: Buffer): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY no configurada para OCR');

  const base64 = buffer.toString('base64');
  const reqBody = JSON.stringify({
    contents: [{
      parts: [
        { text: 'Extrae TODO el texto de este documento PDF tal como aparece. Incluye tablas con sus valores, listas numeradas, porcentajes y montos. No omitas nada. Devuelve solo el texto, sin comentarios.' },
        { inlineData: { mimeType: 'application/pdf', data: base64 } },
      ],
    }],
    generationConfig: { temperature: 0 },
  });

  // Reintentos con backoff. En el plan de PAGO, 429 = límite por minuto (transitorio,
  // reintentar ayuda) y 503 = sobrecarga temporal del modelo. Ambos se reintentan con
  // espera creciente; los errores permanentes (400/401/403) fallan de inmediato.
  // Alternamos de modelo: gemini-2.5-flash se satura seguido (503 high-demand); el alias
  // multimodal gemini-flash-latest es más estable y también lee PDF/imágenes.
  const ESPERAS = [0, 6_000, 15_000, 30_000]; // 4 intentos
  const MODELOS = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-latest'];
  let ultimoErr = '';
  for (let intento = 0; intento < ESPERAS.length; intento++) {
    if (intento > 0) await sleep(ESPERAS[intento]);
    const modelo = MODELOS[intento] || 'gemini-flash-latest';

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: reqBody,
        signal: AbortSignal.timeout(180_000),
      }
    );

    if (res.ok) {
      const data = await res.json();
      const texto = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      console.log(`[gemini-vision] OCR completado: ${texto.length} chars (intento ${intento})`);
      return texto;
    }

    const errBody = await res.text().catch(() => '');
    ultimoErr = `${modelo} ${res.status}: ${errBody.slice(0, 200)}`;
    if (res.status === 429 || res.status === 503) {
      console.warn(`[gemini-vision] ${modelo} ${res.status} transitorio, reintentando (${intento + 1}/${ESPERAS.length})...`);
      continue;
    }
    throw new Error(`Gemini Vision ${res.status}: ${errBody.slice(0, 300)}`);
  }

  throw new Error(`Gemini Vision no respondió tras reintentos. Último error: ${ultimoErr}`);
}
const sleep  = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── OCR de PDF vía Gemini File API (troceado por páginas) ───────────────────────
// Sube el PDF a la File API de Gemini y le pide transcribir TODO el texto con
// marcadores [[PÁGINA N]]. A diferencia del OCR por bloques (OCR.space, tope 45 págs,
// frágil ante cuota), lo lee un modelo de VISIÓN — mejor calidad en tablas de criterios,
// multas y caracteres especiales.
//
// CLAVE (medido 2026-06-30): pedir la transcripción de un escaneado GRANDE (37 págs) en
// UNA sola llamada NO termina dentro del timeout (>300s: el modelo genera demasiada
// salida de golpe). Y un bloque de 10 págs dispara el filtro RECITATION de Gemini
// (finishReason=RECITATION, 0 chars) cuando el texto es boilerplate legal muy verbatim.
// Medido: bloques de ≤4 págs completan en <90s y NO disparan RECITATION; la página suelta
// SIEMPRE funciona. Solución: trocear en bloques de FILEAPI_CHUNK_PAGINAS y transcribirlos
// en PARALELO acotado (FILEAPI_CONCURRENCIA), numerando las páginas de forma ABSOLUTA
// para que las citas [[PÁGINA N]] del informe sigan siendo correctas. Si un bloque multipágina vuelve
// vacío (RECITATION o saturación), se REINTENTA página por página (fiable). Así Gemini lee
// el documento entero al 100%, sin caer a OCR.space.
// Devuelve '' si no logra transcribir nada (el llamador cae al OCR por bloques).

const FILEAPI_CHUNK_PAGINAS = 4; // págs por llamada: <90s y sin RECITATION (medido)
const FILEAPI_CONCURRENCIA  = 3; // bloques en paralelo: reduce el tiempo total ~3x

export async function extraerTextoPdfConGeminiFileAPI(buffer: Buffer): Promise<string> {
  // ¿Cuántas páginas tiene? Si no se puede leer el conteo, una sola llamada con el doc completo.
  let totalPaginas = 0;
  try {
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    totalPaginas = doc.getPageCount();
  } catch { /* conteo desconocido → tratamos como documento único */ }

  if (totalPaginas === 0) return transcribirPdfFileAPI(buffer, 1);

  const { PDFDocument } = await import('pdf-lib');
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  // Sub-PDF con un conjunto de índices de página (0-based).
  const subBufDe = async (indices: number[]): Promise<Buffer> => {
    const sub = await PDFDocument.create();
    const copiadas = await sub.copyPages(src, indices);
    copiadas.forEach(pg => sub.addPage(pg));
    return Buffer.from(await sub.save());
  };

  // Bloques de páginas a transcribir (cada uno es independiente).
  const bloques: number[][] = [];
  for (let inicio = 0; inicio < totalPaginas; inicio += FILEAPI_CHUNK_PAGINAS) {
    const indices: number[] = [];
    for (let p = inicio; p < Math.min(inicio + FILEAPI_CHUNK_PAGINAS, totalPaginas); p++) indices.push(p);
    bloques.push(indices);
  }

  // Procesa un bloque: transcripción normal; si vuelve vacío (RECITATION/saturación),
  // reintento página por página (fiable, secuencial dentro del bloque).
  const procesarBloque = async (indices: number[]): Promise<string> => {
    const inicio = indices[0];
    let t = '';
    try {
      t = await transcribirPdfFileAPI(await subBufDe(indices), inicio + 1);
    } catch (e) {
      console.warn(`[gemini-fileapi] bloque págs ${inicio + 1}-${inicio + indices.length} error:`, e instanceof Error ? e.message : e);
    }
    if ((!t || !t.trim()) && indices.length > 1) {
      console.warn(`[gemini-fileapi] bloque págs ${inicio + 1}-${inicio + indices.length} vacío (posible RECITATION) → reintento página por página`);
      const sueltas: string[] = [];
      for (const pi of indices) {
        try {
          const tp = await transcribirPdfFileAPI(await subBufDe([pi]), pi + 1);
          if (tp && tp.trim()) sueltas.push(tp.trim());
        } catch (e) {
          console.warn(`[gemini-fileapi] pág ${pi + 1} falló:`, e instanceof Error ? e.message : e);
        }
      }
      t = sueltas.join('\n\n');
    }
    console.log(`[gemini-fileapi] bloque págs ${inicio + 1}-${inicio + indices.length}: ${t.length} chars`);
    return t.trim();
  };

  // Bloques en PARALELO con concurrencia acotada: secuencial puro tardaba >15 min en
  // escaneados de 30+ páginas. Con 3 a la vez el muro cae a ~1/3 sin gatillar el
  // rate-limit (los reintentos con backoff de transcribirPdfFileAPI absorben algún 429).
  // El orden de las páginas se preserva: cada bloque escribe en su propio índice.
  const resultados = new Array<string>(bloques.length).fill('');
  let cursor = 0;
  const worker = async () => {
    while (cursor < bloques.length) {
      const i = cursor++;
      resultados[i] = await procesarBloque(bloques[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(FILEAPI_CONCURRENCIA, bloques.length) }, worker));

  return resultados.filter(Boolean).join('\n\n');
}

// Sube UN buffer PDF a la File API y transcribe su texto. `startPageAbs` = número de
// página del documento ORIGINAL al que corresponde la primera página de este buffer, para
// que los marcadores [[PÁGINA N]] lleven la numeración absoluta correcta.
async function transcribirPdfFileAPI(buffer: Buffer, startPageAbs: number): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY no configurada para OCR');
  const BASE = 'https://generativelanguage.googleapis.com';

  // 1) Subida resumable a la File API.
  const start = await fetch(`${BASE}/upload/v1beta/files?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(buffer.length),
      'X-Goog-Upload-Header-Content-Type': 'application/pdf',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: 'doc' } }),
    signal: AbortSignal.timeout(120_000),
  });
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error(`File API start ${start.status}: ${(await start.text().catch(() => '')).slice(0, 150)}`);

  const up = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0', 'Content-Type': 'application/pdf' },
    body: buffer as any,
    signal: AbortSignal.timeout(180_000),
  });
  let file = (await up.json())?.file;
  if (!file?.name) throw new Error('File API: subida sin nombre de archivo');

  try {
    // 2) Esperar a que el archivo quede ACTIVE (Gemini lo procesa unos segundos).
    for (let i = 0; i < 30 && file.state !== 'ACTIVE'; i++) {
      await sleep(2_000);
      file = await fetch(`${BASE}/v1beta/${file.name}?key=${apiKey}`).then(r => r.json()).catch(() => file);
      if (file.state === 'FAILED') throw new Error('File API: procesamiento FAILED');
    }
    if (file.state !== 'ACTIVE') throw new Error(`File API: archivo no quedó ACTIVE (estado=${file.state})`);

    // 3) Transcripción con marcadores de página ABSOLUTOS, alternando modelos ante 503.
    const instruccion =
      `Transcribe TODO el texto de este PDF escaneado, página por página y en orden. ` +
      `La PRIMERA página de este PDF corresponde a la página ${startPageAbs} del documento original: ` +
      `antepón a esa página, en su propia línea, el marcador exacto [[PÁGINA ${startPageAbs}]]; ` +
      `a la siguiente [[PÁGINA ${startPageAbs + 1}]], y así sucesivamente (un marcador por página, numeración correlativa desde ${startPageAbs}). ` +
      `Incluye tablas con sus valores, criterios de evaluación y ponderaciones, multas, garantías, plazos, montos, requisitos y listas. ` +
      `No resumas ni omitas nada. Devuelve solo el texto transcrito.`;
    const body = JSON.stringify({
      contents: [{ parts: [
        { text: instruccion },
        { fileData: { mimeType: 'application/pdf', fileUri: file.uri } },
      ] }],
      generationConfig: { temperature: 0, maxOutputTokens: 60_000 },
    });
    const ESPERAS = [0, 6_000, 15_000, 30_000];
    const MODELOS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash'];
    let ultimoErr = '';
    for (let intento = 0; intento < ESPERAS.length; intento++) {
      if (intento > 0) await sleep(ESPERAS[intento]);
      const modelo = MODELOS[intento] || 'gemini-flash-latest';
      const res = await fetch(`${BASE}/v1beta/models/${modelo}:generateContent?key=${apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(180_000) });
      if (res.ok) {
        const data = await res.json();
        const texto = String(data.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
        console.log(`[gemini-fileapi] transcrito desde pág ${startPageAbs}: ${texto.length} chars (${modelo})`);
        return texto;
      }
      ultimoErr = `${modelo} ${res.status}: ${(await res.text().catch(() => '')).slice(0, 150)}`;
      if (res.status !== 429 && res.status !== 503) break;
      console.warn(`[gemini-fileapi] ${modelo} ${res.status} transitorio, reintento ${intento + 1}/${ESPERAS.length}...`);
    }
    throw new Error(`Gemini File API saturado: ${ultimoErr}`);
  } finally {
    // 4) Limpieza: borrar el archivo subido (no se cobra almacenamiento, pero higiene).
    fetch(`${BASE}/v1beta/${file.name}?key=${apiKey}`, { method: 'DELETE' }).catch(() => {});
  }
}

// ─── Llamada con reintentos (solo para 429 transitorio) ───────────────────────
async function llamarGemini(systemPrompt: string, userPrompt: string): Promise<string> {
  const errores: string[] = [];

  for (let intento = 0; intento < 4; intento++) {
    if (intento > 0) {
      // Esperar que se resetee el rate-limit: 30s, 60s, 90s
      const espera = intento * 30_000;
      console.log(`[gemini] Intento ${intento} — esperando ${espera / 1000}s por rate-limit...`);
      await sleep(espera);
    }

    try {
      console.log(`[gemini] Llamando ${MODELO} (intento ${intento})...`);

      const completion = await crearChatIA({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   },
        ],
        temperature: 0.1,
        stream: false,
        max_tokens: 12_000,
        response_format: { type: 'json_object' },
      });

      const texto = completion.choices[0]?.message?.content ?? '';
      const razon = completion.choices[0]?.finish_reason;
      if (!texto.trim()) throw new Error('Respuesta vacía');

      if (razon === 'length') {
        console.warn(`[deepseek] Respuesta truncada (length). Intentando reparar JSON...`);
      }
      console.log(`[deepseek] OK (intento ${intento}) — ${texto.length} chars, finish_reason: ${razon}`);
      return texto;

    } catch (err: any) {
      const status = err?.status ?? 0;
      const msg    = String(err?.message ?? err);
      errores.push(`[${intento}] ${status}: ${msg.slice(0, 100)}`);
      console.warn(`[gemini] Error intento ${intento}:`, msg.slice(0, 200));

      // Errores permanentes: no reintentar
      if (status === 400) break; // Bad request — problema en el formato
      if (status === 401) throw new Error('API key de Gemini inválida o expirada. Genera una nueva en aistudio.google.com y actualiza GEMINI_API_KEY en .env.local');
      if (status === 403) throw new Error('Proyecto de Google AI denegado (PERMISSION_DENIED). Crea un nuevo proyecto en aistudio.google.com, genera una nueva API key y actualiza GEMINI_API_KEY en .env.local');
      if (status === 404) break; // Modelo no encontrado

      // Transitorios: reintentar con backoff
      const esTransitorio = status === 429 || status === 503 || status === 0
        || msg.includes('timeout') || msg.includes('ETIMEDOUT');
      if (!esTransitorio) break;
    }
  }

  throw new Error(`Gemini no respondió tras 4 intentos:\n${errores.join('\n')}`);
}

// ─── Extraer JSON robusto (delegado a json-ia.ts) ─────────────────────────────
function extraerJSON(respuesta: string): AnalisisIALicitacion {
  // Parser tolerante compartido: sanea caracteres de control ilegales y repara truncado.
  const parsed = parseJsonIA<AnalisisIALicitacion>(respuesta);
  if (parsed) return parsed;
  console.error('[ia] No se pudo parsear JSON. Primeros 500 chars:', respuesta.slice(0, 500));
  throw new Error('No se encontró JSON válido en la respuesta');
}

// ─── Truncado inteligente por tipo de documento ───────────────────────────────
// 40k chars ≈ 10k tokens. Gemini 2.5 Flash sin thinking responde en ~20-40s.
const MAX_CHARS_TOTAL    = 85_000;
const MAX_CHARS_BASES    = 48_000; // BASES y resoluciones: aquí viven criterios, modalidad y presupuesto
const MAX_CHARS_TECNICAS = 28_000; // Especificaciones técnicas / itemizado
const MAX_CHARS_OTROS    =  4_000; // Anexos de oferente / formularios (solo si no hay bases)

// Palabras clave que indican secciones críticas de evaluación
const SECCIONES_CRITICAS = [
  'criterios de evaluaci',
  'tabla de evaluaci',
  'puntaje',
  'ponderaci',
  'factor de evaluaci',
  'oferta econ',
  'precio oferta',
  'precio unitario',
  'especificaci',
  'item',
  'ítem',
  'requerimiento',
  'cronograma',
  'plazos',
  'presupuesto',
  'monto m',
  'garantia',
  'garantía',
];

// Clasifica el tipo de documento para asignar límite de chars
function clasificarDocumento(nombre: string): 'bases' | 'tecnicas' | 'otros' {
  const n = nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (
    n.includes('bases') || n.includes('resolucion') || n.includes('res_') ||
    n.includes('res exenta') || n.includes('bases_admin') || n.includes('licitacion') ||
    n.includes('convenio') || n.includes('contrato')
  ) return 'bases';
  if (
    n.includes('tecnica') || n.includes('especif') || n.includes('itemizado') ||
    n.includes('anexo_5') || n.includes('anexo 5') || n.includes('terminos') ||
    n.includes('requerimientos') || n.includes('oferta_econ') || n.includes('oferta econ')
  ) return 'tecnicas';
  return 'otros';
}

// Extrae secciones críticas del texto (criterios, ítems, presupuesto)
// Retorna el texto reorganizado con las secciones más importantes al inicio.
function extraerSeccionesCriticas(texto: string, limiteChars: number): string {
  if (texto.length <= limiteChars) return texto;

  // Dividir en párrafos o bloques de ~300 chars
  const bloques = texto.split(/\n\n+|\n(?=[A-Z0-9])/);
  const criticos: string[] = [];
  const normales: string[]  = [];

  const textoNorm = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const bloque of bloques) {
    const b = bloque.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const esCritico = SECCIONES_CRITICAS.some(kw => b.includes(kw));
    if (esCritico) criticos.push(bloque);
    else normales.push(bloque);
  }

  // Construir: primeras 8k chars del doc (cabecera/objeto) + secciones críticas + resto
  const cabecera = texto.slice(0, 8_000);
  const cuerpo = [
    ...criticos.filter(b => !cabecera.includes(b.slice(0, 50))),
    ...normales.filter(b => !cabecera.includes(b.slice(0, 50))),
  ].join('\n\n');

  const combinado = cabecera + '\n\n[SECCIONES RELEVANTES]\n\n' + cuerpo;
  return combinado.length > limiteChars
    ? combinado.slice(0, limiteChars) + '\n[...truncado...]'
    : combinado;
}

// Determina si el documento es un anexo de oferente (formulario vacío → excluir)
function esAnexoOferente(nombre: string): boolean {
  const n = nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return (
    (n.includes('declaracion') && (n.includes('jurada') || n.includes('simple'))) ||
    n.includes('programa de integridad') ||
    n.includes('identificacion_proveedor') ||
    n.includes('identificacion proveedor') ||
    (n.includes('anexo_1') && !n.includes('tecnic')) ||
    (n.includes('anexo 1') && !n.includes('tecnic')) ||
    n.includes('anexo_2') || n.includes('anexo 2') ||
    n.includes('anexo_4') || n.includes('anexo 4')
  );
}

type TipoParte = 'bases' | 'tecnicas' | 'item-list' | 'otros' | 'descartable';

// Clasifica cada documento para el análisis combinando extensión, categoría Fase 1 y nombre.
// REGLA DE ORO: el Excel (anexo económico/itemizado) y los anexos técnicos/administrativos
// NUNCA se descartan — ahí viven los ítems y las especificaciones. Solo se descartan los
// formularios vacíos del oferente (identificación, declaración jurada).
function clasificarParte(nombre: string, categoria?: string | null): TipoParte {
  const n = nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const ext = (n.split('.').pop() || '');

  // Excel = lista itemizada / presupuesto → SIEMPRE valioso.
  if (ext === 'xlsx' || ext === 'xls') return 'item-list';

  const c = (categoria || '').toUpperCase();
  if (c === 'BASES_ADMINISTRATIVAS' || c === 'CRITERIOS_EVALUACION') return 'bases';
  if (c === 'BASES_TECNICAS') return 'tecnicas';
  // Ficha/solicitud del municipio: trae criterios y specs específicos.
  if (c === 'DOCUMENTOS_PROCESO') return 'bases';

  // Anexos del oferente: descartar SOLO si es un formulario vacío reconocible.
  // Si el nombre indica contenido real (técnico/económico/especificaciones), se conserva.
  if (c === 'ANEXOS_OFERENTE') {
    if (esAnexoOferente(nombre)) return 'descartable';
    if (n.includes('tecnic') || n.includes('especif') || n.includes('itemiz') || n.includes('economic')) return 'tecnicas';
    if (n.includes('administ')) return 'bases';
    return 'otros';
  }

  if (esAnexoOferente(nombre)) return 'descartable';
  // Sin categoría confiable → heurística por nombre.
  return clasificarDocumento(nombre);
}

export function truncarTextoDocumentos(
  partes: Array<{ nombre: string; texto: string; categoria?: string | null }>
): string {
  // 1. Clasificar cada documento.
  const clasificadas = partes.map(p => ({ ...p, tipo: clasificarParte(p.nombre, p.categoria) }));

  // 2. Descartar SOLO formularios vacíos del oferente.
  let utiles = clasificadas.filter(p => {
    if (p.tipo === 'descartable') {
      console.log(`[gemini] Excluido del análisis (formulario vacío del oferente): ${p.nombre}`);
      return false;
    }
    return true;
  });
  if (utiles.length === 0) utiles = clasificadas; // si se filtró todo, no quedarse sin nada

  // 3. Guarda anti-dilución: solo cuando hay MUCHOS documentos (≥9) y existen bases,
  // soltamos los 'otros' de relleno para que bases/técnicas/ítems reciban el presupuesto.
  // Con pocos documentos se conserva todo (no descartamos anexos valiosos).
  const hayBases = utiles.some(p => p.tipo === 'bases' || p.tipo === 'tecnicas');
  if (utiles.length >= 9 && hayBases) {
    const filtradas = utiles.filter(p => p.tipo !== 'otros');
    const descartados = utiles.length - filtradas.length;
    if (descartados > 0 && filtradas.length > 0) {
      console.log(`[gemini] ${descartados} documentos de relleno (OTROS) descartados por dilución (${utiles.length} docs).`);
      utiles = filtradas;
    }
  }

  // 4. Asignar presupuesto de caracteres por tipo y extraer secciones críticas.
  const presupuesto = (t: TipoParte) =>
    t === 'bases' ? MAX_CHARS_BASES
    : t === 'tecnicas' ? MAX_CHARS_TECNICAS
    : t === 'item-list' ? MAX_CHARS_TECNICAS
    : MAX_CHARS_OTROS;
  const truncadas = utiles.map(p => ({
    nombre: p.nombre,
    tipo: p.tipo,
    texto: extraerSeccionesCriticas(p.texto, presupuesto(p.tipo)),
  }));

  // 5. Ordenar: bases → técnicas → ítems → otros.
  const orden: Record<TipoParte, number> = { bases: 0, tecnicas: 1, 'item-list': 2, otros: 3, descartable: 4 };
  truncadas.sort((a, b) => orden[a.tipo] - orden[b.tipo]);

  let resultado = truncadas.map(p => `\n\n=== ${p.nombre} (${p.tipo}) ===\n\n${p.texto}`).join('');
  if (resultado.length > MAX_CHARS_TOTAL) {
    resultado = resultado.slice(0, MAX_CHARS_TOTAL) + '\n[...truncado total...]';
  }
  return resultado;
}

// ─── Análisis exhaustivo de licitación ────────────────────────────────────────
export async function analizarLicitacionConGemini(
  texto: string,
  documentoNombre: string,
  metadatos: { metodo: string; confianza: string; paginas: number },
): Promise<AnalisisIALicitacion> {

  const esMultiDoc = metadatos.metodo === 'multi-documento';
  const advertOCR  = metadatos.metodo === 'pdf-ocr'
    ? '\nNOTA: Texto extraído por OCR — puede tener errores tipográficos.\n'
    : '';

  const systemPrompt = `Eres experto en licitaciones públicas de Chile (Ley 19.886, DS 250/2004, portal Mercado Público).
Analiza los documentos y extrae datos estructurados. Responde SOLO con JSON válido, sin markdown ni texto adicional.
Usa null para campos ausentes. NUNCA inventes datos.${advertOCR}

GUÍA DE EXTRACCIÓN PARA LICITACIONES CHILENAS:

CRITERIOS DE EVALUACIÓN (campo más importante):
- Busca secciones tituladas: "CRITERIOS DE EVALUACIÓN", "FACTORES DE EVALUACIÓN", "PAUTA DE EVALUACIÓN", "PONDERACIÓN"
- Formato típico chileno: tabla con columnas "Criterio | Ponderación" o "Factor | Puntos | %"
- Ejemplo: "Precio: 40%, Técnico: 40%, Plazo: 20%" → 3 criterios con sus ponderaciones
- Los % deben sumar 100. Si usa puntos (ej: 40/100), conviértelos a porcentaje
- tipo: "economico" para precio/costo, "tecnico" para calidad/experiencia/plazo

PRESUPUESTO:
- Busca: "presupuesto disponible", "monto máximo", "precio referencial", "valor estimado"
- Puede estar en CLP, UF, UTM. Convierte UF a número puro, guarda moneda como "CLP"/"UF"

ESPECIFICACIONES TÉCNICAS / ÍTEMS:
- Busca ANEXO DE ESPECIFICACIONES, ITEMIZADO, listas numeradas con productos/servicios
- Extrae máximo 50 ítems. Incluye nombre, descripción, cantidad y unidad si están disponibles
- Si la cantidad no aparece explícitamente, deja null (no inventes)

CRONOGRAMA (dentro de resumenBasesAdmin):
- Busca tabla de "Etapas del proceso", "Calendario", "Plazos"
- Incluye: publicación, consultas, respuestas, cierre de ofertas, acto de apertura, adjudicación

GARANTÍAS:
- Busca "garantía de seriedad", "garantía de fiel cumplimiento", "boleta de garantía"
- Incluye monto o % y plazo de vigencia

MULTAS:
- Busca "multas", "penalidades", "descuentos por incumplimiento"

DOCUMENTOS A PRESENTAR:
- Lista de documentos que debe incluir la oferta`;

  const userPrompt = `${esMultiDoc
    ? `LICITACIÓN (${metadatos.paginas} documentos): ${documentoNombre}`
    : `DOCUMENTO: ${documentoNombre}`}

TEXTO DE LOS DOCUMENTOS:
${texto}

DEVUELVE EXACTAMENTE ESTE JSON (completa cada campo con lo que encuentres):
{
  "presupuesto": { "monto": null, "moneda": null },
  "plazoEjecucionDias": null,
  "plazoEntregaDias": null,
  "modalidadAdjudicacion": null,
  "tipoContrato": null,
  "lugarEntrega": null,
  "criteriosEvaluacion": [],
  "especificacionesTecnicas": [],
  "documentosAPresenter": [],
  "requisitos": { "administrativos": [], "tecnicos": [], "economicos": [], "habilitantes": [], "prohibiciones": [] },
  "garantias": [],
  "multas": [],
  "contacto": { "nombre": null, "cargo": null, "email": null, "telefono": null },
  "resumenBasesAdmin": {
    "objeto": null,
    "plazo_contrato": null,
    "modalidad_pago": null,
    "forma_pago": null,
    "garantias_exigidas": [],
    "causales_rechazo": [],
    "cronograma": [],
    "condiciones_contrato": [],
    "penalidades_resumen": null
  },
  "resumenBasesTecnicas": {
    "descripcion_general": null,
    "alcance": null,
    "entregables": [],
    "estandares_calidad": [],
    "condiciones_entrega": null,
    "requisitos_tecnicos_oferente": [],
    "lugar_ejecucion": null
  },
  "analisisExperto": {
    "resumenEjecutivo": null,
    "puntosCriticos": [],
    "oportunidades": [],
    "riesgosDetectados": [],
    "recomendaciones": [],
    "ventajasCompetitivas": [],
    "aspectosNegociables": [],
    "complejidad": "media",
    "atractivo": null
  }
}

FORMATO criteriosEvaluacion: [{"nombre":"Precio","ponderacion":40,"tipo":"economico","descripcion":"","formula":null}]
FORMATO especificacionesTecnicas (máx 50): [{"item":"1","descripcion":"Aceite Motor","cantidad":10,"unidad":"litro","requisitosMinimos":null}]
FORMATO garantias: [{"tipo":"Seriedad de la Oferta","porcentaje":null,"montoFijo":100000,"momento":"presentación","devolucion":null,"plazo":"60 días"}]
FORMATO cronograma: [{"etapa":"Publicación","fecha":"01/06/2026"}]`;

  try {
    const respuesta = await llamarGemini(systemPrompt, userPrompt);
    return extraerJSON(respuesta);
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    console.error('[gemini] Fallo definitivo:', msg);
    return { error: msg };
  }
}
