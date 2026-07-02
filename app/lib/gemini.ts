// app/lib/gemini.ts
// Cliente Gemini via endpoint OpenAI-compatible.
// Solo gemini-2.5-flash (único modelo habilitado en este proyecto).
// Thinking desactivado para respuestas rápidas.

import OpenAI from 'openai';

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

// ─── Cliente DeepSeek (análisis de texto) ────────────────────────────────────
export function getGemini() {
  return new OpenAI({
    apiKey:  process.env.DEEPSEEK_API_KEY ?? 'not-configured',
    baseURL: 'https://api.deepseek.com',
    timeout: 120_000,
    maxRetries: 0,
  });
}

const MODELO = 'deepseek-chat';

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
  const client = getGemini();
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

      const completion = await client.chat.completions.create({
        model: MODELO,
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

// ─── Reparar JSON truncado ────────────────────────────────────────────────────
// Cierra corchetes/llaves abiertos y repara valores incompletos al final.
function repararJSONTruncado(s: string): string {
  let t = s.trimEnd();
  // Eliminar valor incompleto al final antes de cerrar
  t = t.replace(/,\s*$/, '');                           // trailing comma
  t = t.replace(/:\s*"[^"]*$/, ': null');               // string sin cerrar
  t = t.replace(/:\s*(nul?l?|tru?e?|fals?e?)\s*$/, ': null'); // valor incompleto
  t = t.replace(/:\s*\d+\.?\d*\s*$/, ': null');         // número al corte

  // Contar estructuras abiertas
  const stack: string[] = [];
  let inStr = false, esc = false;
  for (const c of t) {
    if (esc)  { esc = false; continue; }
    if (c === '\\' && inStr) { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if      (c === '{') stack.push('}');
    else if (c === '[') stack.push(']');
    else if ((c === '}' || c === ']') && stack.length) stack.pop();
  }
  return t + stack.reverse().join('');
}

// ─── Extraer JSON robusto ─────────────────────────────────────────────────────
function extraerJSON(respuesta: string): AnalisisIALicitacion {
  const ini = respuesta.indexOf('{');
  const fin = respuesta.lastIndexOf('}');
  const sliceJSON = ini !== -1 ? respuesta.slice(ini, fin !== -1 ? fin + 1 : undefined) : respuesta;

  const candidatos = [
    respuesta.trim(),
    respuesta.match(/```(?:json)?\s*([\s\S]*?)\s*```/)?.[1]?.trim(),
    fin !== -1 ? sliceJSON : null,
    // Si viene truncado, intentar repararlo
    repararJSONTruncado(sliceJSON),
    repararJSONTruncado(respuesta.trim()),
  ].filter(Boolean) as string[];

  for (const c of candidatos) {
    try {
      const parsed = JSON.parse(c);
      if (typeof parsed === 'object' && parsed !== null) return parsed as AnalisisIALicitacion;
    } catch { /* siguiente candidato */ }
  }

  console.error('[deepseek] No se pudo parsear JSON. Primeros 500 chars:', respuesta.slice(0, 500));
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
