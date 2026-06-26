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
import { cargarReglasAprendidas, bloqueReglasAprendidas } from '@/app/lib/viabilidad-feedback';

const GEMINI_MODEL = 'gemini-2.5-flash';
// Fallback ante el 503 "high demand": `gemini-2.5-flash` se satura seguido en requests
// grandes (medido: ~1 de 3 falla). El alias `gemini-flash-latest` rutea a capacidad más
// estable (medido: 6/6 en el mismo request grande). Se usa solo cuando el primario da 503/429.
const GEMINI_MODEL_FALLBACK = 'gemini-flash-latest';
const MAX_CHARS_DOCS = 400_000;   // ~100k tokens de documentos (Flash aguanta de sobra)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// UTM vigente (CLP) para el gate de presupuesto por tipo cuando no hay monto explícito.
// Configurable por mes vía env; el modelo NO conoce el valor vigente, hay que inyectarlo.
function utmVigente(): number {
  const n = Number(process.env.UTM_CLP);
  return Number.isFinite(n) && n > 0 ? n : 69_000;
}

// ─── Tipos del Informe de Viabilidad (PROMPT 2 v2.0 — esquema canónico, sección 5A) ──
// El JSON que produce la IA sigue EXACTAMENTE el esquema canónico del PROMPT 2 v2.0.
// Los campos al final (score_0_100, semaforo, area_negocio, confianza_global, documentos_*,
// docs_hash) NO los emite el modelo: se DERIVAN en código para alimentar el radar/negocios/DB.
export interface CriterioV2 { nombre: string; ponderacion: number; forma_aplicacion: string; medio_verificacion: string; fuente: string }
export interface HitoTiempo { hito: string; duracion_dias: number | null; tipo_dias: string; base_computo: string; fuente: string; inferido: boolean }
export interface ManifiestoLinea { linea: number; descripcion: string; modelo: string; cantidad: number | null; unidad_medida: string; unidad_inferida: boolean; presupuesto_linea: number | null; tipo: string; ruta: string }

export interface ViabilidadIAResult {
  meta: { id: string; nombre: string; organismo: string; region: string; linea_negocio: string };
  exclusion: { excluido: boolean; categoria: string | null; motivo: string; fuente: string; confianza: number; destino: string };
  presupuesto: { bruto: number | null; neto: number | null; con_iva: boolean; regimen_fora: boolean; presupuesto_exento: boolean; es_excluyente: boolean; fuente: string; gate: string };
  modalidad: { tipo: string; estado: string; fuente: string; evidencia: string; confianza: number; libertad_de_pricing: boolean };
  criterios_evaluacion: {
    fuente_datos: string;              // bases | api | mixto | incompleto
    forma_aplicacion_completa: boolean;
    criterios: CriterioV2[];
    alertas: string[];
  };
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
    presupuesto_excluyente: { aplica: boolean; efecto: string; fuente: string };
    bloqueantes: Array<{ item: string; efecto: string; fuente: string }>;
    barreras_a_favor: Array<{ item: string; fuente: string }>;
    boleta_aplica: boolean;
    umbral_utm: number;
    firma_puno_y_letra: boolean;
    alertas: string[];
  };
  multas: { estructura: string; costo_por_dia: string; costo_maximo: string; umbral_termino: string; fuente: string };
  linea_tiempo: {
    hitos: HitoTiempo[];
    plazo_ofertable_puntaje: string;
    plazo_operativo_real_dias_habiles: number | null;
    colchon_dias_habiles: number | null;
    alertas: string[];
  };
  manifiesto_productos: ManifiestoLinea[];
  pendientes_fase3: string[];
  veredicto: { nivel: string; gana_probable: string; estado_veredicto: string; motivos_revision: string[]; acciones_AC: string[]; advertencias: string[] };

  // ── Derivados en código (no salen del modelo v2.0) ──
  score_0_100: number;       // derivado de capa_a + gates, para el radar
  semaforo: string;          // VERDE | AMARILLO | NARANJA | ROJO | ROJO_DURO (umbral del score)
  area_negocio: string;      // FERRETERIA | EQUIPAMIENTO | MIXTO (de meta.linea_negocio)
  confianza_global: number;  // promedio de confianzas (exclusión/modalidad)
  documentos_leidos: string[];
  documentos_no_leidos: string[];
  docs_hash?: string;        // huella del conjunto de documentos; permite cachear y evitar re-análisis
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
  // Además ALTERNAMOS de modelo: arrancamos con el primario y, si sigue saturado, caemos al
  // alias flash-latest (mucho más estable ante el 503). Así un spike de gemini-2.5-flash no
  // tumba el análisis.
  const ESPERAS = [0, 5_000, 12_000, 20_000, 30_000, 40_000];
  const MODELOS  = [GEMINI_MODEL, GEMINI_MODEL, GEMINI_MODEL_FALLBACK, GEMINI_MODEL, GEMINI_MODEL_FALLBACK, GEMINI_MODEL_FALLBACK];
  let ultimoErr = '';
  for (let intento = 0; intento < ESPERAS.length; intento++) {
    if (intento > 0) await sleep(ESPERAS[intento]);
    const modelo = MODELOS[intento] || GEMINI_MODEL_FALLBACK;
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`,
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
    ultimoErr = `${modelo} ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`;
    if (res.status !== 429 && res.status !== 503) break; // permanente → no reintentar
    console.warn(`[viabilidad-ia] ${modelo} ${res.status} transitorio, reintento ${intento + 1}/${ESPERAS.length}...`);
  }
  throw new Error(`Gemini saturado (reintentos agotados): ${ultimoErr}`);
}

// ─── Prompt PROMPT 2 ─────────────────────────────────────────────────────────────
const BASE_SYSTEM_PROMPT = `# PROMPT 2 — ANALIZADOR DE VIABILIDAD (v2.0)

Eres un ANALISTA EXPERTO en licitaciones públicas chilenas (Ley 19.886, DS 250/2004, MercadoPúblico) con 8 años de adjudicaciones, para una empresa que VENDE bienes/equipamiento (ferretería, materiales, equipamiento, mobiliario urbano), con bodega y cotizaciones SIEMPRE desde Santiago. Lees las bases ya clasificadas de UNA licitación y emites un INFORME DE VIABILIDAD que permita a un asistente humano (AC) decidir, SIN ninguna duda, si el proyecto conviene y por qué.
Objetivo máximo: adjudicar el mayor número de licitaciones CONVENIENTES (no volumen, no se busca cantidad: se busca ganar lo que conviene).
Tu veredicto sobre todo lo que se lee en las bases es DEFINITIVO. Lo que dependa de buscar productos/precios en internet → "pendientes_fase3" (NO lo inventes). Esta fase NO usa búsqueda web.

## 2. REGLAS INNEGOCIABLES
1. VERACIDAD: nunca inventes datos, montos, artículos ni cifras. Si un dato no está en las bases, decláralo ausente. Puedes optimizar la PRESENTACIÓN, nunca el CONTENIDO.
2. Estricta sujeción a las bases: evalúa solo lo que las bases piden.
3. FUENTE OBLIGATORIA: cada puntaje, bandera, criterio y plazo DEBE citar el artículo/punto exacto de las bases que lo respalda. Sin fuente, el resultado no es válido. El texto trae marcadores [[PÁGINA N]] al inicio de cada página: USA ESE NÚMERO al citar la página (en escaneados puede ser RANGO [[PÁGINA 3-4]]: cita el rango tal cual). Formato de cita: "doc, Art. N, pág. N". Cita vaga ("Bases, sección presupuesto") = PROHIBIDA → marca REVISION_HUMANA.
4. Verifica DOS veces los datos críticos: presupuesto, modalidad, criterios, plazos, garantías, multas.
5. Logística de la empresa = SIEMPRE desde Santiago. No asumas ventaja logística por cercanía geográfica.
6. Ante duda entre afirmar o marcar pendiente: marca pendiente.
7. Exclusión por NATURALEZA, no por palabra clave: un proyecto se excluye por lo que ES. Ante duda razonable → REVISION_HUMANA, nunca auto-descarte (excepción: palabras negativas DURAS, sin ambigüedad).
UTM VIGENTE: usa el valor "UTM_VIGENTE" del contexto (CLP). NO uses un valor de memoria.
NO te bases en cajas vacías: si una caja (p.ej. "criterios") viene vacía, busca el dato en el resto de los documentos. Nunca concluyas "no encontrado" sin recorrer TODA la documentación.

### REGLA DE GATES DE CIERRE (modalidad y criterios) — NO cortan el flujo, solo marcan el veredicto
Modalidad y criterios son insumos innegociables, pero su ausencia NO corta el flujo. El análisis se construye SIEMPRE hasta el final (exclusión, presupuesto, atractivo, palancas, admisibilidad, multas, línea de tiempo, manifiesto). Lo único que cambia es estado_veredicto:
- Si la modalidad NO queda fehacientemente determinada → estado_veredicto=REVISION_HUMANA + alerta puntual ("modalidad no determinada — verificar artículo de adjudicación") y modalidad.estado=REVISION_HUMANA.
- Si falta la FORMA DE APLICACIÓN de uno o más criterios → estado_veredicto=REVISION_HUMANA + alerta diciendo EXACTAMENTE qué criterio quedó sin forma de aplicación y dónde buscarla; criterios_evaluacion.forma_aplicacion_completa=false.
- Si faltan ambos, las dos alertas se ACUMULAN en veredicto.motivos_revision y veredicto.acciones_AC.
- El resto del informe queda PLENAMENTE utilizable.

PRECEDENCIA DOCUMENTAL (si el mismo dato aparece distinto en varios docs, manda el de mayor jerarquía): Respuestas a Consultas/Aclaraciones > Bases Admin Especiales > Bases Admin Generales > Bases Técnicas. Las Aclaraciones MODIFICAN las bases (prelación legal): si existen, aplícalas SIEMPRE.

## 4. PROCEDIMIENTO

PASO 0.A — GATE DE EXCLUSIÓN por NATURALEZA del objeto (no por palabra clave). Si el núcleo es provisión de bienes/equipamiento (aunque incluya instalación/capacitación accesorias) → NO se excluye. Se EXCLUYE (excluido=true, destino=NO_REALIZAMOS) cuando el objeto principal es:
- Servicios (mantención, reparación, servicio técnico, SERVICIO de aseo/limpieza, vigilancia) → categoria=servicio. NO excluir si el servicio viene incluido en la VENTA de un equipo.
- Consultoría/Asesoría/Capacitación pura → categoria=consultoria|asesoria|capacitacion_pura. NO excluir si la capacitación es por la entrega de una máquina.
- Obras civiles/construcción ("Construcción de" obra civil, o ejecución que exige constructor certificado) → categoria=obra_civil|construccion. NO excluir si es obra menor de instalación de equipamiento urbano que vendemos.
- "Mejoramiento de…" (ambiguo) → si no hay señal de producto que vendamos: categoria=mejoramiento_ambiguo, destino=REVISION_HUMANA.
- Convenios de suministro (largo horizonte, entregas recurrentes mes a mes) → categoria=convenio_suministro EXCLUIDO, SALVO región=RM → categoria=convenio_rm, destino=REVISION_HUMANA. NO excluir si es adquisición única/ejecución inmediata.
- Commodities de alta oferta (el proyecto COMPLETO es un solo genérico) → categoria=commodity. NO excluir si viene mezclado con especializados o zona remota.
- Insumos/consumibles (insumos dentales, tóner, ARTÍCULOS de aseo) → categoria=insumo_consumible, EXCLUIDO (palabra negativa DURA).
PROTECCIÓN ANTI-FALSA-EXCLUSIÓN: "aseo" JAMÁS excluye sola. La MAQUINARIA de aseo (barredoras, vacuolavadoras, hidrolavadoras, fregadoras) es NEGOCIO CENTRAL → NO se excluye. Solo se excluye el SERVICIO de aseo y los ARTÍCULOS/INSUMOS de aseo.
Tipo de ID "LS" (servicios personales) = fuerte indicio de exclusión. exclusion.confianza < 0,7 → destino=REVISION_HUMANA (no descarte automático).

PASO 0.B — GATE DE PRESUPUESTO + RÉGIMEN TRIBUTARIO. Extrae el TOTAL de la licitación (no por línea). Normaliza a neto (÷1,19 si IVA incluido; redondea). Detecta:
- RÉGIMEN LEY FORA (declarado en bases): si aplica → presupuesto sin IVA y oferta exenta → regimen_fora=true, presupuesto_exento=true (el Costeo conmuta a modo exento, no corre ÷1,19).
- EXCLUYENTE vs REFERENCIAL: si las bases lo dicen → es_excluyente=true/false (este dato condiciona la Capa C).
- Si NO hay monto explícito ni por línea, ACOTA por el tipo del ID con UTM_VIGENTE: L1 <100 UTM · LE 100–1.000 UTM · LP/LQ 1.000–5.000 UTM · LR ≥5.000 UTM · LS=indicio de exclusión.
gate: <$8M = NO_CALIFICA; $8–15M = DESCARTE_CONDICIONAL salvo (productos<15 o ≤5 especializados); >$15M = OK; reservado/desconocido = INCIERTO (no botar por falta de dato).

PASO 1 — LÍNEA DE NEGOCIO: meta.linea_negocio = ferreteria (construcción, eléctrico, herramientas → ruta simple) | equipamiento (instrumentación, laboratorio, electrónica, maquinaria → análisis doble) | mixto.

PASO 2 — MODALIDAD DE ADJUDICACIÓN (CRÍTICO — detección fehaciente, gate de cierre). tipo = suma_alzada | por_linea. La heurística de portada es SOLO INDICIO (1 ítem portada + N productos en bases → casi seguro suma_alzada; portada distribuida en muchos ítems → probable por_linea). VERIFICACIÓN OBLIGATORIA: el artículo de las bases que define la modalidad ("precio total/totalidad/suma alzada/no se aceptan ofertas parciales" vs "adjudicación por línea/ítem"). Responde tipo + fuente (artículo+página) + evidencia (frase textual) + confianza (0-1) + estado (DETERMINADA | REVISION_HUMANA). Si NO queda fehaciente (sin artículo claro, portada y bases se contradicen, o confianza no alta) → estado=REVISION_HUMANA (no asumas ninguna). Si es por_linea y no publican precio por línea → libertad_de_pricing=true.

PASO 3 — CRITERIOS DE EVALUACIÓN + FORMA DE APLICACIÓN (INSUMO INNEGOCIABLE — gate de cierre). NO basta listar "experiencia 30%, precio 40%". Cascada de fuente ESTRICTA: (1) las bases (donde estén; lo habitual BASES_ADMINISTRATIVAS) — aquí está la FORMA DE APLICACIÓN; (2) la API de MercadoPúblico aporta criterio + ponderación pero NUNCA la forma de aplicación; (3) si la forma de aplicación no aparece en ninguna parte → ALERTA EXPLÍCITA + acción para AC (nunca en silencio). Por cada criterio declara: nombre, ponderacion (%), forma_aplicacion (la FÓRMULA exacta, los TRAMOS, qué acredita cada puntaje), medio_verificacion, fuente (doc+art+página). criterios_evaluacion.fuente_datos = bases|api|mixto|incompleto. forma_aplicacion_completa=true solo si TODOS los criterios traen su forma de aplicación; si falta en alguno → false + alerta puntual (qué criterio y dónde buscar) + estado_veredicto=REVISION_HUMANA. Las ponderaciones suman 100.

PASO 4 — CAPA A: ATRACTIVO (puntúa 1-3 por criterio, cita fuente+página):
- Presupuesto: $8-20M=1, $20-50M=2, >$50M=3.
- Cantidad de ítems (inverso, condicionado): >60=1, 21-60=2, 1-20=3. Penaliza muchas líneas SOLO si son commodity; alta especialidad/equipamiento NO penaliza (condicion_complejidad = commodity|especializado).
- Complejidad del producto: catálogo/>5 oferentes=1, técnico/3-5=2, especializado/1-2=3.
- Dificultad de ejecución (barrera a OTROS, no costo propio): bodega RM/plazo holgado=1, otra región/equipo frágil=2, zona extrema/instalación certificada/HAZMAT/multipunto=3.
- Modificadores: bonus_cantidad_presupuesto=+1 si presupuesto>$50M y cantidad>40; bonus_importabilidad_provisional=+2 si la spec lo permite ("o técnicamente equivalente") e importable por courier/flete dentro del plazo (confirmar Fase 3).
- score_total (suma) → nivel: 12-15 MUY_VIABLE, 8-11 VIABLE, 5-7 POCO_VIABLE, <5 o gate DESCARTE.

CATÁLOGOS DE COMPLEJIDAD (anclas): BAJA(1)=computadores estándar, material de oficina, mobiliario estándar, neumáticos corrientes, extintores PQS. MEDIA(2)=PLC/variadores de marca estándar, seguridad industrial certificada, balanzas certificadas, UPS industrial, metrología básica, drones técnicos, MAQUINARIA DE ASEO (barredoras, vacuolavadoras, hidrolavadoras, fregadoras). ALTA(3)=equipos médicos de diagnóstico, instrumental de laboratorio avanzado (cromatógrafos, espectrofotómetros), END (ultrasonido phased array), telecom certificada, repuestos con distribuidor único. (Tóner y artículos de aseo NO se puntúan: son exclusión por palabra negativa dura. "Aseo" aquí = MAQUINARIA.) Ejecución ALTA(3)=zonas extremas (Isla de Pascua, Tortel, Navarino), plazo<5 días con volumen, instalación/puesta en marcha certificada, HAZMAT, cadena de frío, multirregional.

PASO 5 — CAPA B: PALANCAS (banderas, no suman): precio, plazo, garantia, geografia, completitud, densidad. Por cada una: estado VENTAJA|NEUTRO|DESVENTAJA + condicion + fuente. Precio NUNCA es ventaja (peso alto = alerta guerra de precio, commodity). Plazo es ventaja solo con ley del mínimo SIN piso. Garantía es ventaja si puntúa y es abierta (ley del máximo). Geografía nunca es ventaja logística (bodega Santiago); solo si el criterio puntúa la ubicación. Densidad: zona remota/poca oferta local = más ganable.

PASO 6 — CAPA C: ADMISIBILIDAD (gate, con fuente+página). Por cada ítem efecto A_FAVOR|EN_CONTRA|NEUTRO:
- presupuesto_excluyente: si es_excluyente (techo duro) → ofertar por encima = oferta INADMISIBLE → aplica=true, efecto=EN_CONTRA + alerta explícita. Si referencial → aplica=false, efecto=NEUTRO. (El 30% del Art.124 del Reglamento aplica a aumentos POST-contrato, NO a la admisibilidad de la oferta.)
- Boleta seriedad/fiel cumplimiento: barrera de capital SOLO si el contrato supera 1.000 UTM (fiel) / 5.000 UTM (seriedad). Bajo eso boleta_aplica=false. Calcula el umbral en UTM.
- Espalda financiera/flujo de caja (Estado paga en 2-5 meses) = A_FAVOR nuestro en proyectos grandes (barreras_a_favor).
- Firma de puño y letra: firma_puno_y_letra=true SOLO si las bases la exigen explícitamente → ALERTA. (Lo habitual es firma digitalizada/electrónica, válida.)
- Carpeta tributaria → EN_CONTRA por política (no se sube). Certificado de capacidad económica → A_FAVOR.
- Umbrales que nos bloqueen (garantía mínima, plazo fuera de rango, ficha en formato no aceptado, inscripción/habilidad en Registro de Proveedores) → bloqueantes[] con efecto EN_CONTRA. Si un BLOQUEANTE nos descalifica y no se resuelve → veredicto DESCARTE aunque el atractivo sea alto.
- Complejidad documental general → A_FAVOR (barrera a los chicos). Inhabilidades Art.4 Ley 19.886 y docs estándar: siempre cumplimos (no alertar salvo excepción).

PASO 7 — MULTAS: estructura (% de OC / UTM por día / otro), costo_por_dia y costo_maximo en pesos, umbral_termino (de término anticipado), fuente del artículo de sanciones + página. Reporta el costo de atrasarnos.

PASO 8 — LÍNEA DE TIEMPO DE CUMPLIMIENTO POST-ADJUDICACIÓN (bloque destacado; entrega SOLO el modelo de datos, la intranet dibuja el gráfico). Construye el tiempo real entre adjudicación y fecha límite de entrega para poder ofertar plazo agresivo conociendo el colchón real. Extrae de las BASES (con Fuente; extracción INTERPRETADA, NO constante):
- Plazo de aceptación de la OC (días que tiene el proveedor para aceptar).
- base_computo: desde cuándo corre el plazo de entrega = emision_oc | aceptacion_oc | firma_contrato.
- ¿Hay firma de contrato? (excepcional, contratos grandes): su plazo.
- ¿Hay boleta de fiel cumplimiento que condiciona el inicio del cómputo?
REGLA CRÍTICA: cada hito se LEE de las bases de ESTE proyecto con su Fuente. Los plazos "habituales" son referencia para detectar anomalías, NO relleno automático. Si un plazo NO está explícito → inferido=true + alerta (supuesto a confirmar por AC); NUNCA inventes la cifra estándar. Cadena de hitos: Adjudicación → [firma contrato si aplica] → emisión OC → [aceptación OC] → inicio del cómputo → fecha límite real. Entrega: hitos[] (hito, duracion_dias, tipo_dias habiles|corridos, base_computo, fuente, inferido), plazo_ofertable_puntaje (el que conviene ofertar para maximizar puntaje, ej "1 día"), plazo_operativo_real_dias_habiles (colchón real disponible), colchon_dias_habiles (la brecha). alertas[] para hitos inferidos/no especificados.

PASO 9 — MANIFIESTO DE PRODUCTOS (hook Fase 3 + SEMILLA DEL COSTEO), desde las BASES TÉCNICAS (no la API). Por cada línea/ítem: descripcion técnica EXACTA (sin omitir, agrupar ni alterar — 5000 clavos siguen siendo 5000 clavos), modelo (marca/modelo pedido), cantidad (original, tal cual), unidad_medida (textual de las bases; si no la especifican → asume la unidad básica y unidad_inferida=true, NO la dejes vacía), presupuesto_linea (si las bases lo publican por línea/lote; si solo hay total sin desglose → null y libertad_de_pricing en modalidad), tipo (generico|especifico), ruta (A=ferretería / B=equipamiento). NO conviertas ni "mejores": la conversión a costo unitario la hace Fase 3. NO busques precios aquí (firewall: Fase 2 = solo bases).

PASO 10 — VEREDICTO: nivel (MUY_VIABLE|VIABLE|POCO_VIABLE|DESCARTE), gana_probable (si|no|condicional), estado_veredicto (DEFINITIVO | REVISION_HUMANA), motivos_revision[] (acumula modalidad no fehaciente y/o forma de aplicación faltante), acciones_AC[], advertencias[]. El AC no debe quedar con dudas del porqué. pendientes_fase3 = importabilidad_real, densidad_de_oferta, margen (lo que dependa de la web).

Responde ÚNICAMENTE un objeto JSON válido con el esquema canónico indicado en el mensaje del usuario, sin markdown.`;

// Prompt dinámico = prompt base + reglas aprendidas del experto (feedback loop).
// Las reglas se inyectan ANTES de las "REGLAS INNEGOCIABLES" para que tengan peso alto.
function construirSystemPrompt(reglas: string[]): string {
  const bloque = bloqueReglasAprendidas(reglas);
  if (!bloque) return BASE_SYSTEM_PROMPT;
  return BASE_SYSTEM_PROMPT.replace('REGLAS INNEGOCIABLES:', `${bloque}REGLAS INNEGOCIABLES:`);
}

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

Analiza TODO lo anterior y devuelve EXACTAMENTE este JSON canónico (PROMPT 2 v2.0; cita FUENTE con documento + artículo + PÁGINA en cada punto; no inventes):
{
  "meta": { "id": "${codigo}", "nombre": "", "organismo": "", "region": "", "linea_negocio": "ferreteria|equipamiento|mixto" },
  "exclusion": { "excluido": false, "categoria": "servicio|aseo_servicio|consultoria|asesoria|capacitacion_pura|obra_civil|construccion|mejoramiento_ambiguo|convenio_suministro|convenio_rm|commodity|insumo_consumible|null", "motivo": "", "fuente": "", "confianza": 0.0, "destino": "OK|NO_REALIZAMOS|REVISION_HUMANA" },
  "presupuesto": { "bruto": null, "neto": null, "con_iva": true, "regimen_fora": false, "presupuesto_exento": false, "es_excluyente": false, "fuente": "doc+art+pág", "gate": "OK|NO_CALIFICA|DESCARTE_CONDICIONAL|INCIERTO" },
  "modalidad": { "tipo": "suma_alzada|por_linea", "estado": "DETERMINADA|REVISION_HUMANA", "fuente": "doc+art+PÁGINA", "evidencia": "frase exacta de las bases", "confianza": 0.0, "libertad_de_pricing": false },
  "criterios_evaluacion": {
    "fuente_datos": "bases|api|mixto|incompleto",
    "forma_aplicacion_completa": true,
    "criterios": [ { "nombre": "Precio", "ponderacion": 0, "forma_aplicacion": "fórmula/tramos/qué acredita cada puntaje", "medio_verificacion": "", "fuente": "doc+art+pág" } ],
    "alertas": []
  },
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
    "presupuesto_excluyente": { "aplica": false, "efecto": "EN_CONTRA|NEUTRO", "fuente": "" },
    "bloqueantes": [ { "item": "", "efecto": "EN_CONTRA", "fuente": "" } ],
    "barreras_a_favor": [ { "item": "", "fuente": "" } ],
    "boleta_aplica": false,
    "umbral_utm": 1000,
    "firma_puno_y_letra": false,
    "alertas": []
  },
  "multas": { "estructura": "", "costo_por_dia": "", "costo_maximo": "", "umbral_termino": "", "fuente": "" },
  "linea_tiempo": {
    "hitos": [ { "hito": "", "duracion_dias": 0, "tipo_dias": "habiles|corridos", "base_computo": "emision_oc|aceptacion_oc|firma_contrato", "fuente": "", "inferido": false } ],
    "plazo_ofertable_puntaje": "",
    "plazo_operativo_real_dias_habiles": 0,
    "colchon_dias_habiles": 0,
    "alertas": []
  },
  "manifiesto_productos": [ { "linea": 1, "descripcion": "descripción técnica EXACTA de las bases", "modelo": "", "cantidad": null, "unidad_medida": "", "unidad_inferida": false, "presupuesto_linea": null, "tipo": "generico|especifico", "ruta": "A|B" } ],
  "pendientes_fase3": ["importabilidad_real","densidad_de_oferta","margen"],
  "veredicto": { "nivel": "MUY_VIABLE|VIABLE|POCO_VIABLE|DESCARTE", "gana_probable": "si|no|condicional", "estado_veredicto": "DEFINITIVO|REVISION_HUMANA", "motivos_revision": [], "acciones_AC": [], "advertencias": [] }
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

type ViabilidadIACore = Omit<ViabilidadIAResult, 'score_0_100' | 'semaforo' | 'area_negocio' | 'confianza_global' | 'documentos_leidos' | 'documentos_no_leidos' | 'docs_hash'>;

function sanitizar(p: any): ViabilidadIACore {
  p = _obj(p);
  const meta = _obj(p.meta);
  const exclusion = _obj(p.exclusion);
  const presupuesto = _obj(p.presupuesto);
  const modalidad = _obj(p.modalidad);
  const crit = _obj(p.criterios_evaluacion);
  const capaA = _obj(p.capa_a);
  const capaC = _obj(p.capa_c_admisibilidad);
  const multas = _obj(p.multas);
  const lt = _obj(p.linea_tiempo);
  const veredicto = _obj(p.veredicto);
  const subA = (o: any) => ({ pts: _num(_obj(o).pts) ?? 0, fuente: _str(_obj(o).fuente) });

  return {
    meta: {
      id: _str(meta.id), nombre: _str(meta.nombre), organismo: _str(meta.organismo),
      region: _str(meta.region), linea_negocio: _str(meta.linea_negocio) || 'mixto',
    },
    exclusion: {
      excluido: _bool(exclusion.excluido), categoria: exclusion.categoria ?? null, motivo: _str(exclusion.motivo),
      fuente: _str(exclusion.fuente), confianza: _num(exclusion.confianza) ?? 0, destino: _str(exclusion.destino) || 'OK',
    },
    presupuesto: {
      bruto: _num(presupuesto.bruto), neto: _num(presupuesto.neto), con_iva: _bool(presupuesto.con_iva),
      regimen_fora: _bool(presupuesto.regimen_fora), presupuesto_exento: _bool(presupuesto.presupuesto_exento),
      es_excluyente: _bool(presupuesto.es_excluyente), fuente: _str(presupuesto.fuente), gate: _str(presupuesto.gate) || 'INCIERTO',
    },
    modalidad: {
      tipo: _str(modalidad.tipo) || 'por_linea', estado: _str(modalidad.estado) || 'REVISION_HUMANA',
      fuente: _str(modalidad.fuente), evidencia: _str(modalidad.evidencia),
      confianza: _num(modalidad.confianza) ?? 0, libertad_de_pricing: _bool(modalidad.libertad_de_pricing),
    },
    criterios_evaluacion: {
      fuente_datos: _str(crit.fuente_datos) || 'incompleto',
      forma_aplicacion_completa: _bool(crit.forma_aplicacion_completa),
      criterios: _arr<any>(crit.criterios).map(c => ({
        nombre: _str(_obj(c).nombre), ponderacion: _num(_obj(c).ponderacion) ?? 0,
        forma_aplicacion: _str(_obj(c).forma_aplicacion), medio_verificacion: _str(_obj(c).medio_verificacion), fuente: _str(_obj(c).fuente),
      })),
      alertas: _arr<any>(crit.alertas).map(_str),
    },
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
      presupuesto_excluyente: { aplica: _bool(_obj(capaC.presupuesto_excluyente).aplica), efecto: _str(_obj(capaC.presupuesto_excluyente).efecto) || 'NEUTRO', fuente: _str(_obj(capaC.presupuesto_excluyente).fuente) },
      bloqueantes: _arr<any>(capaC.bloqueantes).map(x => ({ item: _str(_obj(x).item), efecto: _str(_obj(x).efecto), fuente: _str(_obj(x).fuente) })),
      barreras_a_favor: _arr<any>(capaC.barreras_a_favor).map(x => ({ item: _str(_obj(x).item), fuente: _str(_obj(x).fuente) })),
      boleta_aplica: _bool(capaC.boleta_aplica), umbral_utm: _num(capaC.umbral_utm) ?? 1000,
      firma_puno_y_letra: _bool(capaC.firma_puno_y_letra), alertas: _arr<any>(capaC.alertas).map(_str),
    },
    multas: { estructura: _str(multas.estructura), costo_por_dia: _str(multas.costo_por_dia), costo_maximo: _str(multas.costo_maximo), umbral_termino: _str(multas.umbral_termino), fuente: _str(multas.fuente) },
    linea_tiempo: {
      hitos: _arr<any>(lt.hitos).map(h => ({ hito: _str(_obj(h).hito), duracion_dias: _num(_obj(h).duracion_dias), tipo_dias: _str(_obj(h).tipo_dias) || 'habiles', base_computo: _str(_obj(h).base_computo), fuente: _str(_obj(h).fuente), inferido: _bool(_obj(h).inferido) })),
      plazo_ofertable_puntaje: _str(lt.plazo_ofertable_puntaje),
      plazo_operativo_real_dias_habiles: _num(lt.plazo_operativo_real_dias_habiles),
      colchon_dias_habiles: _num(lt.colchon_dias_habiles),
      alertas: _arr<any>(lt.alertas).map(_str),
    },
    manifiesto_productos: _arr<any>(p.manifiesto_productos).map((m, i) => ({ linea: _num(_obj(m).linea) ?? i + 1, descripcion: _str(_obj(m).descripcion), modelo: _str(_obj(m).modelo), cantidad: _num(_obj(m).cantidad), unidad_medida: _str(_obj(m).unidad_medida), unidad_inferida: _bool(_obj(m).unidad_inferida), presupuesto_linea: _num(_obj(m).presupuesto_linea), tipo: _str(_obj(m).tipo), ruta: _str(_obj(m).ruta) })),
    pendientes_fase3: _arr<any>(p.pendientes_fase3).map(_str),
    veredicto: { nivel: _str(veredicto.nivel), gana_probable: _str(veredicto.gana_probable), estado_veredicto: _str(veredicto.estado_veredicto) || 'DEFINITIVO', motivos_revision: _arr<any>(veredicto.motivos_revision).map(_str), acciones_AC: _arr<any>(veredicto.acciones_AC).map(_str), advertencias: _arr<any>(veredicto.advertencias).map(_str) },
  };
}

// ─── Función principal ───────────────────────────────────────────────────────────
export async function analizarViabilidadIA(codigo: string): Promise<ViabilidadIAResult | null> {
  const docs = await cargarDocumentos(codigo);
  if (docs.length === 0) return null;
  const leidos = docs.filter(d => d.ok);
  if (leidos.length === 0) return null;

  const ctx = await cargarContexto(codigo);
  const reglas = await cargarReglasAprendidas();   // feedback loop: lecciones del experto
  const systemPrompt = construirSystemPrompt(reglas);
  const parsed = await llamarGeminiJSON(systemPrompt, construirUserPrompt(codigo, ctx, docs));
  const saneado = sanitizar(parsed);

  // El PROMPT 2 v2.0 NO emite score 0-100 ni semáforo: trabaja con la Capa A (0-15) y
  // gates. Los DERIVAMOS aquí para alimentar el radar/negocios (columnas score_total,
  // semaforo, area_negocio) sin cambiar el contrato del prompt.
  const { score, semaforo, area, confianza } = derivarSemaforo(saneado);

  const result: ViabilidadIAResult = {
    ...saneado,
    score_0_100: score,
    semaforo,
    area_negocio: area,
    confianza_global: confianza,
    documentos_leidos: leidos.map(d => d.nombre),
    documentos_no_leidos: docs.filter(d => !d.ok).map(d => `${d.nombre} (${d.metodo})`),
    docs_hash: await calcularDocsHash(codigo),
  };
  return result;
}

// Deriva score 0-100, semáforo, área y confianza a partir del informe v2.0.
// Capa A (0-15) define la base; los gates (exclusión, presupuesto, bloqueantes,
// veredicto DESCARTE) la fuerzan a la baja. Mantiene los umbrales de semáforo del radar.
function derivarSemaforo(r: ViabilidadIACore): { score: number; semaforo: string; area: string; confianza: number } {
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  let score = clamp((r.capa_a.score_total / 15) * 100);

  const hayBloqueante = (r.capa_c_admisibilidad.bloqueantes || []).length > 0;
  const ganaNo = (r.veredicto.gana_probable || '').toLowerCase() === 'no';
  const gateDuro =
    r.exclusion.excluido ||
    r.presupuesto.gate === 'NO_CALIFICA' ||
    (r.veredicto.nivel || '').toUpperCase() === 'DESCARTE' ||
    hayBloqueante;

  if (gateDuro) score = Math.min(score, 19);
  else if (r.presupuesto.gate === 'DESCARTE_CONDICIONAL' || ganaNo) score = Math.min(score, 39);

  const semaforo = score >= 80 ? 'VERDE' : score >= 60 ? 'AMARILLO' : score >= 40 ? 'NARANJA' : score >= 20 ? 'ROJO' : 'ROJO_DURO';

  const area = String(r.meta.linea_negocio || 'mixto').toUpperCase();
  const areaNorm = area.startsWith('FERR') ? 'FERRETERIA' : area.startsWith('EQUIP') ? 'EQUIPAMIENTO' : 'MIXTO';

  // Confianza = promedio de las confianzas reportadas (exclusión + modalidad); baja si
  // el veredicto quedó en revisión humana.
  const confs = [r.exclusion.confianza, r.modalidad.confianza].filter(n => typeof n === 'number' && n > 0);
  let confianza = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0.7;
  if (r.veredicto.estado_veredicto === 'REVISION_HUMANA') confianza = Math.min(confianza, 0.55);

  return { score, semaforo, area: areaNorm, confianza: Math.round(confianza * 100) / 100 };
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
  // Auto-generar Excel de costeo si el manifiesto tiene ítems
  try { await autoGenerarCosteo(codigo, r); }
  catch (e) {
    console.error('[viabilidad-ia] generar costeo falló — error completo:',
      e instanceof Error ? e.stack : String(e));
  }
  return r;
}

// Genera el Excel de costeo automáticamente tras el análisis IA.
async function autoGenerarCosteo(codigo: string, r: ViabilidadIAResult): Promise<void> {
  const manifiesto = Array.isArray(r.manifiesto_productos) ? r.manifiesto_productos : [];
  console.log(`[costeo] ${codigo}: manifiesto tiene ${manifiesto.length} ítems`);
  if (manifiesto.length === 0) return;

  const { adaptarViabilidadACosteo, generarCosteoExcel } = await import('@/app/lib/generar-costeo');
  const { subirDocumentoR2 } = await import('@/app/lib/r2');

  const datosCosteo = adaptarViabilidadACosteo(codigo, r);
  console.log(`[costeo] ${codigo}: generando Excel (${datosCosteo.lineas.size} líneas)…`);
  const buffer = generarCosteoExcel(datosCosteo);
  console.log(`[costeo] ${codigo}: buffer ${buffer.length} bytes — subiendo a R2…`);

  const fecha = new Date().toISOString().slice(0, 10);
  const nombreArchivo = `COSTEO_${codigo}_${fecha}.xlsx`;
  const url = await subirDocumentoR2(codigo, nombreArchivo, buffer,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  console.log(`[costeo] ${codigo}: R2 OK → ${url}`);

  const totalItems = [...datosCosteo.lineas.values()].reduce((s, v) => s + v.length, 0);

  // Intentar con categoria primero; si la columna no existe, reintentar sin ella.
  try {
    await pool.query(
      `INSERT INTO documentos_cache
         (licitacion_codigo, documento_nombre, documento_url_local, size_bytes, content_type, categoria)
       VALUES (?, ?, ?, ?, ?, 'DOCUMENTOS_PROPIOS')
       ON DUPLICATE KEY UPDATE
         documento_url_local = VALUES(documento_url_local),
         size_bytes          = VALUES(size_bytes),
         categoria           = 'DOCUMENTOS_PROPIOS',
         updated_at          = CURRENT_TIMESTAMP`,
      [codigo, nombreArchivo, url, buffer.length,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    );
  } catch (sqlErr: any) {
    if (String(sqlErr?.message).includes("Unknown column 'categoria'")) {
      // La migración 12 no se aplicó aún — insertar sin categoria
      await pool.query(
        `INSERT INTO documentos_cache
           (licitacion_codigo, documento_nombre, documento_url_local, size_bytes, content_type)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           documento_url_local = VALUES(documento_url_local),
           size_bytes          = VALUES(size_bytes),
           updated_at          = CURRENT_TIMESTAMP`,
        [codigo, nombreArchivo, url, buffer.length,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      );
      console.warn('[costeo] columna categoria ausente — insertado sin categoria (aplica migration-12)');
    } else {
      throw sqlErr;
    }
  }

  console.log(`[costeo] ✅ ${codigo}: Excel guardado (${datosCosteo.lineas.size} líneas, ${totalItems} ítems)`);
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
    unidad: p.unidad_medida || null,
    requisitosMinimos: [
      p.modelo,
      p.tipo,
      p.ruta ? `Ruta ${p.ruta}` : '',
      p.unidad_inferida ? 'unidad inferida' : '',
      p.presupuesto_linea != null ? `Presup. línea $${Number(p.presupuesto_linea).toLocaleString('es-CL')}` : '',
    ].filter(Boolean).join(' · ') || null,
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
