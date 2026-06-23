// app/lib/viabilidad-ia.ts
// VIABILIDAD v2 — Analista IA (PROMPT 2).
// Gemini 2.5 lee TODOS los documentos de la licitación (los escaneados/imágenes ya
// llegan como texto vía Gemini visión en la extracción) y emite el Informe de
// Viabilidad COMPLETO con fuentes (artículo/punto) y veredicto GANA / NO GANA.
// DeepSeek aporta los datos duros (análisis exhaustivo) como materia prima de apoyo.
//
// Aprovecha el contexto enorme de Gemini Flash (~1M tokens): se le mandan los
// documentos COMPLETOS, sin el truncado agresivo que necesita DeepSeek.
//
// El score determinista 0-100 (viabilidad.ts) se conserva como CONTROL; este módulo
// añade el veredicto IA encima (decisión del usuario: "IA manda, score como control").

import { createHash } from 'crypto';
import pool from '@/app/lib/db';
import { descargarYExtraerTexto } from '@/app/lib/document-extraction';
import { getMercadoPublicoClient } from '@/app/lib/mercado-publico';
import { extractTipoFromCodigo } from '@/app/lib/tipos-licitacion';

const GEMINI_MODEL = 'gemini-2.5-flash';
const MAX_CHARS_DOCS = 400_000;   // ~100k tokens de documentos (Flash aguanta de sobra)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// UTM vigente (CLP) para el gate de presupuesto por tipo cuando no hay monto explícito.
// Configurable por mes vía env; el modelo NO conoce el valor vigente, hay que inyectarlo.
function utmVigente(): number {
  const n = Number(process.env.UTM_CLP);
  return Number.isFinite(n) && n > 0 ? n : 69_000;
}

// ─── Tipos del veredicto IA (subset operativo del PROMPT 2) ──────────────────────
// Esquema COMPLETO del PROMPT 2 (sección 5A) + extras (criterios % y plazo/garantías detallados).
export interface ViabilidadIAResult {
  // La IA es la fuente ÚNICA del veredicto: entrega el score 0-100 y el semáforo.
  score_0_100: number;
  semaforo: string; // VERDE | AMARILLO | NARANJA | ROJO | ROJO_DURO (derivado del score)
  area_negocio: string; // FERRETERIA | EQUIPAMIENTO | MIXTO
  meta: { id: string; nombre: string; organismo: string; region: string; linea_negocio: string; tipo_licitacion: string };
  exclusion: { excluido: boolean; categoria: string | null; motivo: string; fuente: string; confianza: number; destino: string };
  presupuesto: { bruto: number | null; neto: number | null; con_iva: boolean; estimado_por_tipo: boolean; rango_tipo: string; fuente: string; gate: string };
  // modalidad.general ∈ {suma_alzada, multiple, mixta, desconocida}. Si MIXTA:
  // nivel_lineas = multiple, nivel_intra_linea = suma_alzada.
  modalidad: { general: string; nivel_lineas: string; nivel_intra_linea: string; fuente: string; evidencia: string; confianza: number; libertad_de_pricing: boolean; revision_humana: boolean };
  criterios_evaluacion: Array<{ nombre: string; ponderacion_pct: number; tipo: string; fuente: string }>;
  criterios_no_encontrados: boolean;
  capa_a: {
    presupuesto: { pts: number; fuente: string };
    cantidad_items: { pts: number; n_items: number; fuente: string; condicion_complejidad: string };
    complejidad: { pts: number; fuente: string };
    ejecucion: { pts: number; fuente: string };
    modificadores: { bonus_cantidad_presupuesto: number; bonus_importabilidad_provisional: number };
    score_total: number;
    nivel: string;
  };
  capa_b_palancas: Array<{ palanca: string; estado: string; condicion: string; fuente: string }>;
  capa_c_admisibilidad: {
    bloqueantes: Array<{ item: string; efecto: string; fuente: string }>;
    barreras_a_favor: Array<{ item: string; fuente: string }>;
    boleta_aplica: boolean;
    umbral_utm: number;
    firma_puno_y_letra: boolean;
    alertas: string[];
  };
  multas: { estructura: string; costo_por_dia: string; costo_maximo: string; umbral_termino: string; fuente: string };
  plazo_entrega: { detalle: string; fuente: string };
  garantias: Array<{ tipo: string; detalle: string; fuente: string }>;
  manifiesto_productos: Array<{ linea: number; descripcion: string; modelo: string; cantidad: number | null; tipo: string; ruta: string; peso_provisional: string }>;
  pendientes_fase3: string[];
  veredicto: { nivel: string; gana_probable: string; por_que: string; acciones_AC: string[]; advertencias: string[] };
  confianza_global: number;
  documentos_leidos: string[];
  documentos_no_leidos: string[];
  docs_hash?: string; // huella del conjunto de documentos; permite cachear y evitar re-análisis
}

// ─── Carga de documentos COMPLETOS (texto + visión para escaneados) ──────────────
function noRequiereOCR(nombre: string): boolean {
  const n = nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return /plano|croquis|lamina|elevacion|planta|isometric|render|imagen|fotograf/.test(n)
    || /\.(jpg|jpeg|png|gif|bmp|tiff|webp|dwg)$/.test(n);
}

interface DocLeido { nombre: string; categoria: string | null; texto: string; metodo: string; ok: boolean }

// Precedencia documental del PROMPT 2: Aclaraciones > Bases Especiales > Generales >
// Técnicas > Anexos > resto > planos. Menor número = mayor prioridad: va PRIMERO en el
// contexto, de modo que si hay que truncar se sacrifica lo menos relevante (planos/anexos),
// NUNCA las Aclaraciones que el prompt declara soberanas. Heurística por nombre (robusta
// aunque `categoria` venga null) con respaldo en `categoria`.
function prioridadDoc(nombre: string, categoria: string | null): number {
  const n = `${nombre} ${categoria || ''}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/aclarac|respuesta|consulta|foro/.test(n)) return 0;
  if (/especial/.test(n)) return 1;
  if (/(administrativ|bases).*(general)|general.*(administrativ|bases)|administrativ/.test(n)) return 2;
  if (/tecnic/.test(n)) return 3;
  if (/anexo|formulario|declarac/.test(n)) return 5;
  if (/plano|croquis|lamina|elevacion|planta|isometric|render|imagen|fotograf/.test(n)) return 9;
  return 4; // resto (incl. bases sin calificar) entre técnicas y anexos
}

// Huella del conjunto de documentos de una licitación (nombres + tamaño del texto
// extraído). Si dos análisis ven el MISMO conjunto, el hash coincide y se puede reusar
// el informe IA sin volver a llamar a Gemini. Consulta ligera (no trae el texto entero).
export async function calcularDocsHash(codigo: string): Promise<string> {
  let filas: Array<{ documento_nombre: string; len?: number | null }> = [];
  try {
    const [rows] = await pool.query(
      `SELECT documento_nombre, LENGTH(texto_extraido) AS len
         FROM documentos_cache WHERE licitacion_codigo = ?`, [codigo]);
    filas = rows as any[];
  } catch {
    try {
      const [rows] = await pool.query(
        `SELECT documento_nombre FROM documentos_cache WHERE licitacion_codigo = ?`, [codigo]);
      filas = rows as any[];
    } catch { return ''; }
  }
  const base = filas
    .map(f => `${f.documento_nombre}:${f.len ?? 0}`)
    .sort()
    .join('|');
  return base ? createHash('sha1').update(base).digest('hex') : '';
}

async function cargarDocumentos(codigo: string): Promise<DocLeido[]> {
  // Trae el texto cacheado si existe (migración 22). Si la columna no existe aún, fallback.
  let docs: Array<{ documento_nombre: string; documento_url_local: string; categoria: string | null; texto_extraido?: string | null; metodo_extraccion?: string | null }>;
  try {
    const [rows] = await pool.query(
      `SELECT documento_nombre, documento_url_local, categoria, texto_extraido, metodo_extraccion
       FROM documentos_cache WHERE licitacion_codigo = ? ORDER BY created_at ASC`,
      [codigo],
    );
    docs = rows as any[];
  } catch {
    const [rows] = await pool.query(
      `SELECT documento_nombre, documento_url_local, categoria
       FROM documentos_cache WHERE licitacion_codigo = ? ORDER BY created_at ASC`,
      [codigo],
    );
    docs = rows as any[];
  }

  const out: DocLeido[] = [];
  // Concurrencia 2 para no disparar 429 de Gemini visión.
  for (let i = 0; i < docs.length; i += 2) {
    const batch = docs.slice(i, i + 2);
    const res = await Promise.all(batch.map(async (d) => {
      // CACHÉ: si ya leímos este documento antes, reusamos el texto (no re-OCR) → rápido.
      const cacheTxt = (d.texto_extraido || '').trim();
      if (cacheTxt.length >= 50) {
        return { nombre: d.documento_nombre, categoria: d.categoria, texto: cacheTxt, metodo: d.metodo_extraccion || 'cache', ok: true } as DocLeido;
      }
      const r = await descargarYExtraerTexto(d.documento_url_local, d.documento_nombre, { omitirOCR: noRequiereOCR(d.documento_nombre) }).catch(() => null);
      const texto = (r?.texto || '').replace(/\s+\n/g, '\n').trim();
      const metodo = r?.metodo || 'error';
      // Persistir el texto leído para no volver a hacer OCR la próxima vez (best-effort).
      if (texto.length >= 50) {
        pool.query(
          `UPDATE documentos_cache SET texto_extraido = ?, metodo_extraccion = ?, texto_extraido_at = NOW()
           WHERE licitacion_codigo = ? AND documento_nombre = ?`,
          [texto, metodo, codigo, d.documento_nombre],
        ).catch(() => { /* columna puede no existir aún */ });
      }
      return { nombre: d.documento_nombre, categoria: d.categoria, texto, metodo, ok: texto.length >= 50 } as DocLeido;
    }));
    out.push(...res);
  }
  return out;
}

// ─── Materia prima estructurada (DeepSeek / análisis exhaustivo + API MP) ─────────
async function cargarContexto(codigo: string) {
  let meta = { nombre: '', organismo: '', region: '', monto: null as number | null, cierre: null as any };
  try {
    const [r] = await pool.query(
      `SELECT licitacion_nombre, licitacion_organismo, licitacion_region, licitacion_monto, licitacion_cierre
       FROM alertas_licitaciones WHERE licitacion_codigo = ? ORDER BY created_at DESC LIMIT 1`, [codigo]);
    const a = (r as any[])[0];
    if (a) meta = { nombre: a.licitacion_nombre || '', organismo: a.licitacion_organismo || '', region: a.licitacion_region || '', monto: a.licitacion_monto ?? null, cierre: a.licitacion_cierre ?? null };
  } catch { /* noop */ }

  let estructurado: any = null;
  try {
    const [r] = await pool.query(`SELECT * FROM analisis_ia_licitacion WHERE licitacion_codigo = ? LIMIT 1`, [codigo]);
    estructurado = (r as any[])[0] || null;
  } catch { /* noop */ }

  let itemsMP: any[] = [];
  try {
    const lic = await getMercadoPublicoClient().obtenerPorCodigoRapido(codigo, 12_000);
    if (lic) {
      if (!meta.monto && lic.MontoEstimado) meta.monto = Number(lic.MontoEstimado);
      itemsMP = (lic.Items || []).map((it: any) => ({ nombre: it.NombreProducto || '', descripcion: it.Descripcion || '', categoria: it.Categoria || '', cantidad: it.Cantidad ?? null, unidad: it.Unidad || it.UnidadMedida || null })).filter((it: any) => it.nombre || it.descripcion);
    }
  } catch { /* noop */ }

  return { meta, estructurado, itemsMP };
}

// ─── Llamada a Gemini (JSON forzado) ─────────────────────────────────────────────
async function llamarGeminiJSON(systemPrompt: string, userPrompt: string): Promise<any> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY no configurada');

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ parts: [{ text: userPrompt }] }],
    // maxOutputTokens alto: el informe + manifiesto puede ser largo y un corte a mitad
    // dejaría el JSON inválido. gemini-2.5-flash admite hasta ~65k de salida.
    generationConfig: { temperature: 0.15, responseMimeType: 'application/json', maxOutputTokens: 60_000 },
  });

  // Paciente ante el 503 "high demand" de Gemini (overload de Google) y 429 (límite/min):
  // 6 intentos con backoff hasta 40s. Los errores permanentes (400/401/403) no se reintentan.
  const ESPERAS = [0, 5_000, 12_000, 20_000, 30_000, 40_000];
  let ultimoErr = '';
  for (let intento = 0; intento < ESPERAS.length; intento++) {
    if (intento > 0) await sleep(ESPERAS[intento]);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(180_000) },
    );
    if (res.ok) {
      const data = await res.json();
      const finish = data.candidates?.[0]?.finishReason;
      let txt = String(data.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
      // Quitar fences ```json ... ``` por si el modelo los añade pese a responseMimeType.
      txt = txt.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
      const ini = txt.indexOf('{'); const fin = txt.lastIndexOf('}');
      const candidato = ini !== -1 && fin > ini ? txt.slice(ini, fin + 1) : txt;
      try {
        return JSON.parse(candidato);
      } catch (e) {
        if (finish && finish !== 'STOP') throw new Error(`Respuesta de Gemini incompleta (finishReason=${finish}).`);
        throw new Error(`Gemini devolvió JSON inválido: ${String(e).slice(0, 120)}`);
      }
    }
    ultimoErr = `${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`;
    if (res.status !== 429 && res.status !== 503) break; // permanente → no reintentar
    console.warn(`[viabilidad-ia] Gemini ${res.status} transitorio, reintento ${intento + 1}/${ESPERAS.length}...`);
  }
  throw new Error(`Gemini saturado (reintentos agotados): ${ultimoErr}`);
}

// ─── Prompt PROMPT 2 ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Eres un ANALISTA EXPERTO en licitaciones públicas chilenas (Ley 19.886, DS 250/2004, Mercado Público) con 8 años adjudicando, para una empresa que VENDE bienes/equipamiento (ferretería, materiales, equipamiento, mobiliario urbano), con bodega y cotizaciones SIEMPRE desde Santiago. Lees las bases de UNA licitación y emites el INFORME DE VIABILIDAD (PROMPT 2 v2.0). Objetivo: adjudicar el mayor número de licitaciones CONVENIENTES (no volumen). Esta fase NO usa búsqueda web: lo que dependa de productos/precios → "pendientes_fase3".

REGLA MAESTRA — TODO SALE DE LA DOCUMENTACIÓN:
- Prohibido emitir cualquier dato/puntaje/bandera/veredicto sin respaldo en una cita literal de los documentos. Cada resultado lleva: (a) cita textual breve, (b) nombre del documento, (c) artículo y/o PÁGINA.
- El texto que recibes trae marcadores [[PÁGINA N]] al inicio de cada página. USA ESE NÚMERO al citar la página. En documentos ESCANEADOS el marcador puede ser un RANGO ([[PÁGINA 3-4]]): cita el rango tal cual, NO inventes una página puntual. Si un dato no tiene respaldo documental → no lo inventes: márcalo REVISION_HUMANA con el motivo.

EJEMPLO DE CITA CORRECTA (formato exacto que debes producir en cada "fuente"/"evidencia"):
  modalidad → { "general": "suma_alzada", "evidencia": "se adjudicará al oferente que presente la oferta más conveniente, no aceptándose ofertas parciales", "fuente": "Bases Administrativas Especiales, Art. 18, pág. 7" }
EJEMPLO DE CITA PROHIBIDA (vaga, sin artículo ni página → NO la emitas, marca REVISION_HUMANA):
  "fuente": "Bases, sección presupuesto"   ·   "fuente": "documento técnico"

UTM VIGENTE: usa el valor "UTM_VIGENTE" que recibes en el contexto del usuario (en CLP). NO uses un valor de memoria: el vigente solo está en ese dato.
- NO te bases en cajas vacías. Si una caja (p.ej. "criterios") viene vacía, busca el dato en el resto de los documentos. Nunca concluyas "no encontrado" sin recorrer toda la documentación.

REGLAS INNEGOCIABLES:
- VERACIDAD: nunca inventes datos/montos/artículos/páginas. Optimiza la presentación, jamás el contenido.
- Verifica DOS veces los datos críticos: presupuesto, modalidad, criterios, plazo, garantía, multas.
- Logística SIEMPRE desde Santiago: no asumas ventaja por cercanía geográfica.
- Exclusión por NATURALEZA del objeto, no por palabra clave. Ante duda → REVISION_HUMANA.
- SIEMPRE debe haber veredicto. Si no hay certeza, entrega el resultado MÁS PROBABLE citando fuente+página y márcalo de baja confianza. Ningún campo crítico queda "indefinido".

PRECEDENCIA DOCUMENTAL (si el mismo dato aparece distinto en varios docs, manda el de mayor jerarquía): Respuestas a Consultas/Aclaraciones > Bases Admin Especiales > Bases Admin Generales > Bases Técnicas. Las Aclaraciones MODIFICAN las bases (prelación legal): si existen, aplícalas SIEMPRE.

PASO 0.A — EXCLUSIÓN por NATURALEZA: excluir solo si el objeto principal es servicio puro (mantención/reparación), obra civil/construcción o alta ejecución técnica certificada, capacitación pura, consultoría/asesoría, o convenio de suministro de largo horizonte. NO excluir si el núcleo es venta de bienes (aunque incluya instalación/capacitación accesorias). Tipo de ID "LS" (servicios personales) = fuerte indicio de exclusión. Confianza < 0,7 → REVISION_HUMANA. destino = OK | NO_REALIZAMOS | REVISION_HUMANA.

PASO 0.B — PRESUPUESTO (con acotamiento por tipo): extrae el TOTAL (no por línea). Normaliza a neto (÷1,19 si IVA incluido). Si NO hay monto explícito ni por línea, ACOTA por el tipo de licitación del ID (define el techo) y marca estimado_por_tipo=true, rango_tipo: L1 <100 UTM · LE 100–1.000 UTM · LP 1.000–5.000 UTM · LR ≥5.000 UTM · LS = indicio de exclusión. (convierte los UTM a CLP con UTM_VIGENTE del contexto; LQ se trata como LP). gate: <$8M = NO_CALIFICA; $8–15M = DESCARTE_CONDICIONAL salvo (productos<15 o ≤5 especializados); >$15M = OK; reservado/sin tipo útil = INCIERTO.

PASO 2 — MODALIDAD de ADJUDICACIÓN (CRÍTICO, veredicto SIEMPRE obligatorio). Tres opciones (NO confundir con el TIPO LP/LE/LR):
- SUMA_ALZADA: todo el proyecto se adjudica a UN solo oferente ("se adjudicará al oferente" en singular, "la totalidad", "no se aceptan ofertas parciales", "precio total"). Es donde sacamos ventaja → identificarla es prioridad.
- MULTIPLE: se gana una o varias líneas, distintos adjudicatarios por línea ("adjudicación por línea/ítem", "uno o más oferentes", "Opción 1/Opción 2").
- MIXTA: varias líneas adjudicables por separado, pero cada línea agrupa productos a un solo proveedor (suma alzada dentro de la línea). Si MIXTA → nivel_lineas=multiple, nivel_intra_linea=suma_alzada.
Responde con cita literal + documento + PÁGINA. Si los indicios chocan, manda el artículo de adjudicación de las bases. Si no hay certeza, entrega el más probable con fuente+página y marca revision_humana=true + confianza baja. Si es por línea y no publican precio por línea → libertad_de_pricing=true.

PASO 3 — CRITERIOS DE EVALUACIÓN (siempre, buscados en CASCADA): no los busques solo en la caja de criterios (suele venir vacía). Recórrelos en Admin Generales → Especiales → Técnicas, aplicando la precedencia (Aclaraciones > Especiales > Generales > Técnicas). Para cada criterio: nombre, ponderación % (suman 100), fórmula/tabla y fuente (doc+art+página). NO puede existir una licitación sin criterios: si tras la cascada no aparecen en NINGÚN documento → criterios_no_encontrados=true + REVISION_HUMANA (situación anómala, destácala).

PASO 4 — CAPA A (puntúa 1-3 por criterio, cita fuente+página):
- Presupuesto: $8-20M=1, $20-50M=2, >$50M=3.
- Cantidad de ítems (inverso): >60=1, 21-60=2, 1-20=3. Penaliza muchas líneas SOLO si son commodity; alta especialidad NO penaliza.
- Complejidad del producto: catálogo/>5 oferentes=1, técnico/3-5=2, especializado/1-2=3.
- Dificultad de ejecución (barrera a OTROS, no costo propio): bodega RM/plazo holgado=1, otra región/equipo frágil=2, zona extrema/instalación certificada/HAZMAT/multipunto=3.
- Modificadores: +1 si presupuesto>$50M y cantidad>40; +2 importabilidad PROVISIONAL si la spec lo permite ("o equivalente") e importable en plazo (confirmar Fase 3).
- score_total (suma) → nivel: 12-15 MUY_VIABLE, 8-11 VIABLE, 5-7 POCO_VIABLE, <5 o gate DESCARTE.

CATÁLOGOS DE COMPLEJIDAD (anclas): BAJA(1)=computadores estándar, tóner, oficina, aseo, mobiliario estándar, neumáticos, extintores PQS. MEDIA(2)=PLC/variadores, seguridad industrial certificada, balanzas certificadas, UPS industrial, metrología básica. ALTA(3)=equipos médicos de diagnóstico, instrumental de laboratorio (cromatógrafos, espectrofotómetros), END, telecom certificada, repuestos con distribuidor único. Ejecución ALTA(3)=zonas extremas, plazo corto con volumen, instalación/puesta en marcha certificada, HAZMAT, cadena de frío, multirregional.

PASO 5 — CAPA B PALANCAS (banderas, no suman): precio, plazo, garantia, geografia, completitud, densidad. Por cada una: estado VENTAJA|NEUTRO|DESVENTAJA + condicion + fuente. Precio nunca es ventaja (peso alto = alerta guerra de precio, commodity). Plazo es ventaja solo con ley del mínimo SIN piso. Garantía es ventaja si puntúa y es abierta (ley del máximo). Geografía nunca es ventaja logística (bodega Santiago); solo si el criterio puntúa la ubicación. Densidad: zona remota/poca oferta = más ganable.

PASO 6 — CAPA C ADMISIBILIDAD (gate, con fuente+página). Garantías por UMBRALES SEPARADOS (Decreto 661): fiel cumplimiento es barrera de capital SOLO si el contrato supera 1.000 UTM; seriedad de la oferta exigible SOLO sobre 5.000 UTM; bajo esos umbrales NO aplican. Espalda financiera (Estado paga en 2-5 meses) = A_FAVOR nuestro en proyectos grandes. Firma de puño y letra → ALERTA explícita si la exigen. Carpeta tributaria → no se sube por política (EN_CONTRA, estudiar caso). Umbrales que nos bloqueen (garantía mínima, plazo fuera de rango, inscripción/habilidad en Registro de Proveedores) → BLOQUEANTE → DESCARTE aunque el atractivo sea alto. Complejidad documental → A_FAVOR (barrera a los chicos). Inhabilidades Art.4 Ley 19.886 y docs estándar: siempre cumplimos.

PASO 7 — MULTAS: estructura (% OC / UTM por día / otro), costo_por_dia y costo_maximo en pesos, umbral de término anticipado, fuente del artículo de sanciones + página. Reporta el costo de atrasarnos.

PASO 8 — MANIFIESTO de productos + PESO POR LÍNEA (para Fase 3): por cada línea, descripción técnica EXACTA (sin omitir ni alterar), marca/modelo pedido, cantidad, tipo (generico|especifico), ruta (A=ferretería local / B=equipamiento). Diferencia SIEMPRE presupuesto y peso por línea: si hay presupuesto por línea úsalo; si no, estima peso_provisional por cantidad/especialización y deja el peso fino (cantidad×precio) como pendiente Fase 3. El gate y la Capa A van sobre el TOTAL; el peso por línea es dato estratégico (qué líneas atacar), no cambia el puntaje.

PASO 9 — VEREDICTO claro: nivel + gana_probable (si|no|condicional), por qué fundamentado en las bases (con página), acciones_AC y advertencias. Si falta un documento clave → REVISION_HUMANA señalando el faltante.

SCORE FINAL 0-100 (tú lo decides, es el dato principal): integra capa A (atractivo), criterios, admisibilidad y riesgos. Guía: 80-100 muy conveniente (VERDE), 60-79 conveniente (AMARILLO), 40-59 medio (NARANJA), 20-39 bajo (ROJO), 0-19 descarte (ROJO_DURO). Si hay bloqueante irresoluble o gate de exclusión/presupuesto → score ≤ 19. Entrega también area_negocio (FERRETERIA|EQUIPAMIENTO|MIXTO).

Responde ÚNICAMENTE un objeto JSON válido con el esquema indicado, sin markdown.`;

function construirUserPrompt(codigo: string, ctx: any, docs: DocLeido[]): string {
  // Ordenar por PRECEDENCIA documental antes de concatenar/truncar: lo soberano
  // (Aclaraciones/Especiales) va primero y sobrevive al recorte; los planos al final.
  const leidos = docs.filter(d => d.ok)
    .slice()
    .sort((a, b) => prioridadDoc(a.nombre, a.categoria) - prioridadDoc(b.nombre, b.categoria));
  const itemsMPTxt = (ctx.itemsMP || []).slice(0, 40).map((it: any, i: number) =>
    `${i + 1}. ${it.nombre || it.descripcion}${it.categoria ? ` [${it.categoria}]` : ''}${it.cantidad ? ` (cant ${it.cantidad}${it.unidad ? ' ' + it.unidad : ''})` : ''}`).join('\n') || '(la API MP no entregó ítems)';

  let docsTexto = leidos.map(d => `\n\n===== DOCUMENTO: ${d.nombre} ${d.categoria ? `[${d.categoria}]` : ''} =====\n${d.texto}`).join('');
  if (docsTexto.length > MAX_CHARS_DOCS) docsTexto = docsTexto.slice(0, MAX_CHARS_DOCS) + '\n[...truncado: documentos de menor jerarquía omitidos...]';

  const tipoLic = extractTipoFromCodigo(codigo) || '(desconocido)';
  const utm = utmVigente();

  return `LICITACIÓN: ${codigo}
TIPO DE LICITACIÓN (del ID): ${tipoLic}
UTM_VIGENTE: $${utm.toLocaleString('es-CL')} CLP (úsalo para convertir los rangos UTM del gate de presupuesto)
NOMBRE: ${ctx.meta.nombre || '(sin nombre)'}
ORGANISMO: ${ctx.meta.organismo || '(sin organismo)'}
REGIÓN: ${ctx.meta.region || '(sin región)'}
PRESUPUESTO PORTADA (API MP): ${ctx.meta.monto ? '$' + Number(ctx.meta.monto).toLocaleString('es-CL') : 'reservado / no informado'}

ÍTEMS SEGÚN API MERCADO PÚBLICO (referencia de líneas):
${itemsMPTxt}

DOCUMENTOS DE LA LICITACIÓN (texto completo; los escaneados ya fueron leídos por visión).
IMPORTANTE: cada página viene marcada con [[PÁGINA N]] — usa ESE número para citar la página de cada dato.
${docsTexto || '(no se pudo extraer texto de los documentos)'}

Analiza TODO lo anterior y devuelve EXACTAMENTE este JSON (cita FUENTE con documento + artículo + PÁGINA en cada punto; no inventes):
{
  "score_0_100": 0,
  "semaforo": "VERDE|AMARILLO|NARANJA|ROJO|ROJO_DURO",
  "area_negocio": "FERRETERIA|EQUIPAMIENTO|MIXTO",
  "meta": { "id": "${codigo}", "nombre": "", "organismo": "", "region": "", "linea_negocio": "ferreteria|equipamiento|mixto", "tipo_licitacion": "${tipoLic}" },
  "exclusion": { "excluido": false, "categoria": "servicio|obra_civil|capacitacion_pura|consultoria|convenio_suministro|null", "motivo": "", "fuente": "", "confianza": 0.0, "destino": "OK|NO_REALIZAMOS|REVISION_HUMANA" },
  "presupuesto": { "bruto": null, "neto": null, "con_iva": false, "estimado_por_tipo": false, "rango_tipo": "", "fuente": "doc+art+pág", "gate": "OK|NO_CALIFICA|DESCARTE_CONDICIONAL|INCIERTO" },
  "modalidad": { "general": "suma_alzada|multiple|mixta|desconocida", "nivel_lineas": "", "nivel_intra_linea": "", "fuente": "doc+art+PÁGINA", "evidencia": "frase exacta de las bases", "confianza": 0.0, "libertad_de_pricing": false, "revision_humana": false },
  "criterios_evaluacion": [ { "nombre": "Precio", "ponderacion_pct": 0, "tipo": "economico|tecnico|experiencia|otros", "fuente": "doc+art+pág" } ],
  "criterios_no_encontrados": false,
  "capa_a": {
    "presupuesto": { "pts": 0, "fuente": "" },
    "cantidad_items": { "pts": 0, "n_items": 0, "fuente": "", "condicion_complejidad": "commodity|especializado" },
    "complejidad": { "pts": 0, "fuente": "" },
    "ejecucion": { "pts": 0, "fuente": "" },
    "modificadores": { "bonus_cantidad_presupuesto": 0, "bonus_importabilidad_provisional": 0 },
    "score_total": 0,
    "nivel": "MUY_VIABLE|VIABLE|POCO_VIABLE|DESCARTE"
  },
  "capa_b_palancas": [ { "palanca": "precio|plazo|garantia|geografia|completitud|densidad", "estado": "VENTAJA|NEUTRO|DESVENTAJA", "condicion": "", "fuente": "" } ],
  "capa_c_admisibilidad": {
    "bloqueantes": [ { "item": "", "efecto": "EN_CONTRA", "fuente": "" } ],
    "barreras_a_favor": [ { "item": "", "fuente": "" } ],
    "boleta_aplica": false,
    "umbral_utm": 1000,
    "firma_puno_y_letra": false,
    "alertas": []
  },
  "multas": { "estructura": "", "costo_por_dia": "", "costo_maximo": "", "umbral_termino": "", "fuente": "" },
  "plazo_entrega": { "detalle": "", "fuente": "" },
  "garantias": [ { "tipo": "seriedad|fiel_cumplimiento|otra", "detalle": "monto/% y plazo, o 'No exige'", "fuente": "" } ],
  "manifiesto_productos": [ { "linea": 1, "descripcion": "descripción técnica EXACTA de las bases", "modelo": "", "cantidad": null, "tipo": "generico|especifico", "ruta": "A|B", "peso_provisional": "alto|medio|bajo o % estimado" } ],
  "pendientes_fase3": ["importabilidad_real","densidad_de_oferta","margen"],
  "veredicto": { "nivel": "MUY_VIABLE|VIABLE|POCO_VIABLE|DESCARTE", "gana_probable": "si|no|condicional", "por_que": "2-4 oraciones fundamentadas con fuente", "acciones_AC": [], "advertencias": [] },
  "confianza_global": 0.0
}`;
}

// ─── Saneamiento de la salida del modelo ─────────────────────────────────────────
// La salida de Gemini es no confiable: claves faltantes, tipos cambiados, arrays como
// objetos. En vez de un responseSchema gigante (que si queda mal devuelve 400 y rompe
// la feature), normalizamos en código garantizando la FORMA del esquema. Así la BD y el
// front (que usa `?.` por todas partes) nunca reciben algo que reviente.
const _arr = <T,>(x: any): T[] => (Array.isArray(x) ? x : []);
const _obj = (x: any): any => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
const _str = (x: any): string => (typeof x === 'string' ? x : x == null ? '' : String(x));
const _num = (x: any): number | null => (x == null || x === '' ? null : Number.isFinite(Number(x)) ? Number(x) : null);
const _bool = (x: any): boolean => x === true || x === 'true' || x === 1;

function sanitizar(p: any): Omit<ViabilidadIAResult, 'score_0_100' | 'semaforo' | 'area_negocio' | 'documentos_leidos' | 'documentos_no_leidos' | 'docs_hash'> {
  p = _obj(p);
  const meta = _obj(p.meta);
  const exclusion = _obj(p.exclusion);
  const presupuesto = _obj(p.presupuesto);
  const modalidad = _obj(p.modalidad);
  const capaA = _obj(p.capa_a);
  const capaC = _obj(p.capa_c_admisibilidad);
  const multas = _obj(p.multas);
  const plazo = _obj(p.plazo_entrega);
  const veredicto = _obj(p.veredicto);
  const subA = (o: any) => ({ pts: _num(_obj(o).pts) ?? 0, fuente: _str(_obj(o).fuente) });

  return {
    meta: {
      id: _str(meta.id), nombre: _str(meta.nombre), organismo: _str(meta.organismo),
      region: _str(meta.region), linea_negocio: _str(meta.linea_negocio), tipo_licitacion: _str(meta.tipo_licitacion),
    },
    exclusion: {
      excluido: _bool(exclusion.excluido), categoria: exclusion.categoria ?? null, motivo: _str(exclusion.motivo),
      fuente: _str(exclusion.fuente), confianza: _num(exclusion.confianza) ?? 0, destino: _str(exclusion.destino) || 'OK',
    },
    presupuesto: {
      bruto: _num(presupuesto.bruto), neto: _num(presupuesto.neto), con_iva: _bool(presupuesto.con_iva),
      estimado_por_tipo: _bool(presupuesto.estimado_por_tipo), rango_tipo: _str(presupuesto.rango_tipo),
      fuente: _str(presupuesto.fuente), gate: _str(presupuesto.gate) || 'INCIERTO',
    },
    modalidad: {
      general: _str(modalidad.general) || 'desconocida', nivel_lineas: _str(modalidad.nivel_lineas),
      nivel_intra_linea: _str(modalidad.nivel_intra_linea), fuente: _str(modalidad.fuente), evidencia: _str(modalidad.evidencia),
      confianza: _num(modalidad.confianza) ?? 0, libertad_de_pricing: _bool(modalidad.libertad_de_pricing), revision_humana: _bool(modalidad.revision_humana),
    },
    criterios_evaluacion: _arr<any>(p.criterios_evaluacion).map(c => ({
      nombre: _str(_obj(c).nombre), ponderacion_pct: _num(_obj(c).ponderacion_pct) ?? 0, tipo: _str(_obj(c).tipo), fuente: _str(_obj(c).fuente),
    })),
    criterios_no_encontrados: _bool(p.criterios_no_encontrados),
    capa_a: {
      presupuesto: subA(capaA.presupuesto),
      cantidad_items: { pts: _num(_obj(capaA.cantidad_items).pts) ?? 0, n_items: _num(_obj(capaA.cantidad_items).n_items) ?? 0, fuente: _str(_obj(capaA.cantidad_items).fuente), condicion_complejidad: _str(_obj(capaA.cantidad_items).condicion_complejidad) },
      complejidad: subA(capaA.complejidad),
      ejecucion: subA(capaA.ejecucion),
      modificadores: { bonus_cantidad_presupuesto: _num(_obj(capaA.modificadores).bonus_cantidad_presupuesto) ?? 0, bonus_importabilidad_provisional: _num(_obj(capaA.modificadores).bonus_importabilidad_provisional) ?? 0 },
      score_total: _num(capaA.score_total) ?? 0, nivel: _str(capaA.nivel),
    },
    capa_b_palancas: _arr<any>(p.capa_b_palancas).map(b => ({ palanca: _str(_obj(b).palanca), estado: _str(_obj(b).estado), condicion: _str(_obj(b).condicion), fuente: _str(_obj(b).fuente) })),
    capa_c_admisibilidad: {
      bloqueantes: _arr<any>(capaC.bloqueantes).map(x => ({ item: _str(_obj(x).item), efecto: _str(_obj(x).efecto), fuente: _str(_obj(x).fuente) })),
      barreras_a_favor: _arr<any>(capaC.barreras_a_favor).map(x => ({ item: _str(_obj(x).item), fuente: _str(_obj(x).fuente) })),
      boleta_aplica: _bool(capaC.boleta_aplica), umbral_utm: _num(capaC.umbral_utm) ?? 1000,
      firma_puno_y_letra: _bool(capaC.firma_puno_y_letra), alertas: _arr<any>(capaC.alertas).map(_str),
    },
    multas: { estructura: _str(multas.estructura), costo_por_dia: _str(multas.costo_por_dia), costo_maximo: _str(multas.costo_maximo), umbral_termino: _str(multas.umbral_termino), fuente: _str(multas.fuente) },
    plazo_entrega: { detalle: _str(plazo.detalle), fuente: _str(plazo.fuente) },
    garantias: _arr<any>(p.garantias).map(g => ({ tipo: _str(_obj(g).tipo), detalle: _str(_obj(g).detalle), fuente: _str(_obj(g).fuente) })),
    manifiesto_productos: _arr<any>(p.manifiesto_productos).map((m, i) => ({ linea: _num(_obj(m).linea) ?? i + 1, descripcion: _str(_obj(m).descripcion), modelo: _str(_obj(m).modelo), cantidad: _num(_obj(m).cantidad), tipo: _str(_obj(m).tipo), ruta: _str(_obj(m).ruta), peso_provisional: _str(_obj(m).peso_provisional) })),
    pendientes_fase3: _arr<any>(p.pendientes_fase3).map(_str),
    veredicto: { nivel: _str(veredicto.nivel), gana_probable: _str(veredicto.gana_probable), por_que: _str(veredicto.por_que), acciones_AC: _arr<any>(veredicto.acciones_AC).map(_str), advertencias: _arr<any>(veredicto.advertencias).map(_str) },
    confianza_global: _num(p.confianza_global) ?? 0.7,
  };
}

// ─── Función principal ───────────────────────────────────────────────────────────
export async function analizarViabilidadIA(codigo: string): Promise<ViabilidadIAResult | null> {
  const docs = await cargarDocumentos(codigo);
  if (docs.length === 0) return null;
  const leidos = docs.filter(d => d.ok);
  if (leidos.length === 0) return null;

  const ctx = await cargarContexto(codigo);
  const parsed = await llamarGeminiJSON(SYSTEM_PROMPT, construirUserPrompt(codigo, ctx, docs));
  const saneado = sanitizar(parsed);

  // Score 0-100 de la IA (dato principal) y semáforo derivado por umbrales consistentes.
  const score = Math.max(0, Math.min(100, Math.round(Number((parsed as any)?.score_0_100) || 0)));
  const semaforo = score >= 80 ? 'VERDE' : score >= 60 ? 'AMARILLO' : score >= 40 ? 'NARANJA' : score >= 20 ? 'ROJO' : 'ROJO_DURO';
  const area = String((parsed as any)?.area_negocio || saneado.meta.linea_negocio || 'MIXTO').toUpperCase();

  const result: ViabilidadIAResult = {
    ...saneado,
    score_0_100: score,
    semaforo,
    area_negocio: ['FERRETERIA', 'EQUIPAMIENTO', 'MIXTO'].includes(area) ? area : 'MIXTO',
    documentos_leidos: leidos.map(d => d.nombre),
    documentos_no_leidos: docs.filter(d => !d.ok).map(d => `${d.nombre} (${d.metodo})`),
    confianza_global: saneado.confianza_global,
    docs_hash: await calcularDocsHash(codigo),
  };
  return result;
}

// ─── Persistencia ────────────────────────────────────────────────────────────────
// Sin cambios de esquema: el informe IA se anida en el JSON `informe_ejecutivo` bajo
// la clave `_informe_ia` (mismo patrón que `_riesgo_comercial`). Si ya hay fila de
// viabilidad determinista, se hace MERGE; si no, se crea una fila mínima.
export async function guardarViabilidadIA(codigo: string, r: ViabilidadIAResult): Promise<void> {
  const [rows] = await pool.query(
    `SELECT informe_ejecutivo FROM viabilidad_licitacion WHERE licitacion_codigo = ? LIMIT 1`, [codigo]);
  const fila = (rows as any[])[0];

  // La IA es la fuente única: su score/semáforo/área alimentan las columnas que lee el radar.
  if (fila) {
    let ie: any = {};
    try { ie = typeof fila.informe_ejecutivo === 'string' ? JSON.parse(fila.informe_ejecutivo) : (fila.informe_ejecutivo || {}); } catch { ie = {}; }
    ie._informe_ia = r;
    ie._modelo_ia = GEMINI_MODEL;
    await pool.query(
      `UPDATE viabilidad_licitacion
         SET informe_ejecutivo = ?, score_total = ?, semaforo = ?, area_negocio = ?, confianza_analisis = ?, modelo = ?
       WHERE licitacion_codigo = ?`,
      [JSON.stringify(ie), r.score_0_100, r.semaforo, r.area_negocio, r.confianza_global ?? null, `ia+${GEMINI_MODEL}`, codigo]);
  } else {
    await pool.query(
      `INSERT INTO viabilidad_licitacion (licitacion_codigo, informe_ejecutivo, score_total, semaforo, area_negocio, confianza_analisis, modelo)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [codigo, JSON.stringify({ _informe_ia: r, _modelo_ia: GEMINI_MODEL }), r.score_0_100, r.semaforo, r.area_negocio, r.confianza_global ?? null, `ia+${GEMINI_MODEL}`]);
  }
}

export async function analizarYGuardarViabilidadIA(codigo: string): Promise<ViabilidadIAResult | null> {
  const r = await analizarViabilidadIA(codigo);
  if (!r) return null;
  try { await guardarViabilidadIA(codigo, r); }
  catch (e) { console.error('[viabilidad-ia] guardar falló:', String(e).slice(0, 200)); }
  try { await volcarManifiestoAItems(codigo, r); }
  catch (e) { console.error('[viabilidad-ia] volcar ítems falló:', String(e).slice(0, 200)); }
  return r;
}

// Vuelca el manifiesto de productos (lo que la IA encontró en la documentación) a
// analisis_ia_licitacion.especificaciones_tecnicas, que es lo que la ficha del NEGOCIO
// ya muestra en "Ítems y cantidades". Así, al asignar la licitación a negocio, salen los
// ítems reales leídos de las bases. Solo sobrescribe si la IA trae MÁS ítems que lo guardado.
async function volcarManifiestoAItems(codigo: string, r: ViabilidadIAResult): Promise<void> {
  const manifiesto = Array.isArray(r.manifiesto_productos) ? r.manifiesto_productos : [];
  if (manifiesto.length === 0) return;

  const especs = manifiesto.map(p => ({
    item: String(p.linea ?? ''),
    descripcion: p.descripcion || '',
    cantidad: p.cantidad ?? null,
    unidad: null as string | null,
    requisitosMinimos: [p.modelo, p.tipo, p.ruta ? `Ruta ${p.ruta}` : ''].filter(Boolean).join(' · ') || null,
  }));

  // ¿Cuántos ítems hay hoy? Solo reemplazamos si la IA trae igual o más (suele ser más completa).
  let actuales = 0;
  try {
    const [ex] = await pool.query(`SELECT especificaciones_tecnicas FROM analisis_ia_licitacion WHERE licitacion_codigo = ? LIMIT 1`, [codigo]);
    const cur = (ex as any[])[0];
    if (cur?.especificaciones_tecnicas) {
      const a = typeof cur.especificaciones_tecnicas === 'string' ? JSON.parse(cur.especificaciones_tecnicas) : cur.especificaciones_tecnicas;
      actuales = Array.isArray(a) ? a.length : 0;
    }
  } catch { /* fila/tabla puede no existir */ }
  if (especs.length < actuales) return;

  await pool.query(
    `INSERT INTO analisis_ia_licitacion (licitacion_codigo, especificaciones_tecnicas, modelo)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE especificaciones_tecnicas = VALUES(especificaciones_tecnicas)`,
    [codigo, JSON.stringify(especs), GEMINI_MODEL],
  );
}
