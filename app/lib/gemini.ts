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

  // Backoff CORTO: ante 429 por cuota agotada reintentar no ayuda (es límite diario),
  // y un backoff largo cuelga toda la petición cuando se OCR-ea por bloques. Fallar rápido.
  const ESPERAS = [0, 4_000]; // 2 intentos, máx ~4s extra
  for (let intento = 0; intento < ESPERAS.length; intento++) {
    if (intento > 0) await sleep(ESPERAS[intento]);

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: reqBody,
        signal: AbortSignal.timeout(120_000),
      }
    );

    if (res.ok) {
      const data = await res.json();
      const texto = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      console.log(`[gemini-vision] OCR completado: ${texto.length} chars (intento ${intento})`);
      return texto;
    }

    const errBody = await res.text().catch(() => '');
    // 429 por cuota → fallar de inmediato (reintentar es inútil y cuelga el request).
    if (res.status === 429) {
      throw new Error(`Gemini Vision 429 (cuota agotada): ${errBody.slice(0, 200)}`);
    }
    if (res.status === 503) {
      console.warn(`[gemini-vision] 503 temporal, reintentando...`);
      continue;
    }
    throw new Error(`Gemini Vision ${res.status}: ${errBody.slice(0, 300)}`);
  }

  throw new Error('Gemini Vision no respondió (rate-limit/temporal)');
}
const sleep  = (ms: number) => new Promise(r => setTimeout(r, ms));

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
