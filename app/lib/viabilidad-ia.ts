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
import { parseJsonIA } from '@/app/lib/json-ia';
import { getMercadoPublicoClient } from '@/app/lib/mercado-publico';
import { extractTipoFromCodigo } from '@/app/lib/tipos-licitacion';
import { cargarReglasAprendidas, bloqueReglasAprendidas } from '@/app/lib/viabilidad-feedback';
import { crearChatIA, IA_TEXT_PROVIDER, iaTextoConfigurada, MODELO_TEXTO } from '@/app/lib/gemini';
import { parsearPlanillaCosteo, detectarLineasFormulario, detectarOfertaTotalUnico, detectarLenguajePorLinea } from '@/app/lib/planilla-costeo-parser';

const GEMINI_MODEL = 'gemini-2.5-flash';
// Fallback ante el 503 "high demand": `gemini-2.5-flash` se satura seguido en requests
// grandes (medido: ~1 de 3 falla). El alias `gemini-flash-latest` rutea a capacidad más
// estable (medido: 6/6 en el mismo request grande). Se usa solo cuando el primario da 503/429.
const GEMINI_MODEL_FALLBACK = 'gemini-flash-latest';
const MAX_CHARS_DOCS = 400_000;   // ~100k tokens de documentos (Flash aguanta de sobra)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── Debug verboso (activable con VIABILIDAD_DEBUG=1) ─────────────────────────────
// Muestra en consola TODO lo que hace el análisis: documentos leídos y su tamaño, tamaño
// del prompt, proveedor que respondió, gate/score derivado y manifiesto de ítems. Además
// vuelca el prompt y el JSON crudo a archivos en el temp del SO para inspección.
const VIAB_DEBUG = process.env.VIABILIDAD_DEBUG === '1';
const dbg = (...a: any[]) => { if (VIAB_DEBUG) console.log('[viab-dbg]', ...a); };
async function volcarDebug(codigo: string, sufijo: string, contenido: string): Promise<void> {
  if (!VIAB_DEBUG) return;
  try {
    const os = await import('os'); const path = await import('path'); const fs = await import('fs/promises');
    const f = path.join(os.tmpdir(), `viab_${codigo.replace(/[^\w.-]/g, '_')}_${sufijo}`);
    await fs.writeFile(f, contenido, 'utf8');
    console.log(`[viab-dbg] volcado → ${f} (${contenido.length} chars)`);
  } catch (e) { console.warn('[viab-dbg] no se pudo volcar', e instanceof Error ? e.message : e); }
}

// UTM vigente (CLP) para el gate de presupuesto por tipo cuando no hay monto explícito.
// Configurable por mes vía env; el modelo NO conoce el valor vigente, hay que inyectarlo.
function utmVigente(): number {
  const n = Number(process.env.UTM_CLP);
  return Number.isFinite(n) && n > 0 ? n : 69_000;
}

// ─── Tipos del Informe de Viabilidad (PROMPT 2 v2.1 — esquema canónico) ──────────────
// El JSON que produce la IA sigue el esquema del PROMPT 2 v2.1. Los campos v2.1 son
// ADITIVOS sobre v2.0: se conservan las claves antiguas (modalidad, linea_tiempo,
// manifiesto_productos) que consumen el parser de costeo / la BD / el radar, y se AGREGAN
// los bloques nuevos (adjudicacion enriquecida, donde_se_decide, documentos_infaltables,
// colchón corregido, líneas a atacar). Los campos al final (score_0_100, semaforo, …) NO
// los emite el modelo: se DERIVAN en código para alimentar el radar/negocios/DB.
export interface SubfactorV2 { nombre: string; ponderacion_efectiva: number; abierto_o_topado: string; forma_aplicacion: string; medio_verificacion: string; fuente: string }
export interface CriterioV2 { nombre: string; ponderacion: number; abierto_o_topado: string; forma_aplicacion: string; medio_verificacion: string; fuente: string; subfactores: SubfactorV2[] }
export interface HitoTiempo { hito: string; duracion_dias: number | null; tipo_dias: string; base_computo: string; fuente: string; inferido: boolean }
export interface ManifiestoLinea { linea: number; categoria: string | null; descripcion: string; modelo: string; cantidad: number | null; unidad_medida: string; unidad_inferida: boolean; presupuesto_linea: number | null; tipo: string; ruta: string }
export interface DocInfaltable { exige: string; fuente: string; tipo: string; cubre: string; responsable: string }
export interface LineaAtacar { linea: number; decision: string; motivo: string }

export interface ViabilidadIAResult {
  meta: { id: string; nombre: string; organismo: string; region: string; linea_negocio: string };
  exclusion: { excluido: boolean; categoria: string | null; motivo: string; fuente: string; confianza: number; destino: string };
  presupuesto: { bruto: number | null; neto: number | null; con_iva: boolean; regimen_fora: boolean; presupuesto_exento: boolean; es_excluyente: boolean; fuente: string; gate: string };
  // modalidad = eje "cómo se cotiza" (tipo suma_alzada|por_linea, lo consume el costeo).
  // v2.1: se enriquece con "cómo se adjudica" (GLOBAL|POR_LINEAS|POR_LOTES) y sus derivados.
  modalidad: {
    tipo: string; estado: string; fuente: string; evidencia: string; confianza: number; libertad_de_pricing: boolean;
    como_se_adjudica: string;          // GLOBAL | POR_LINEAS | POR_LOTES
    heterogeneidad: string;            // alta | baja | na
    cotizar_100_obligatorio: boolean;  // causal de admisibilidad del global/lote
    evaluacion_puntaje: string;        // al_total | por_linea
  };
  criterios_evaluacion: {
    fuente_datos: string;              // bases | api | mixto | incompleto
    forma_aplicacion_completa: boolean;
    suma_ponderaciones_real: number;   // v2.1: suma de las ponderaciones efectivas
    suma_valida: boolean;              // v2.1: true si la suma da ~100%
    criterios: CriterioV2[];
    alertas: string[];
  };
  capa_a: {
    presupuesto: { pts: number; fuente: string; justificacion: string };
    cantidad_items: { pts: number; n_items: number; fuente: string; condicion_complejidad: string; justificacion: string };
    complejidad: { pts: number; fuente: string; justificacion: string };
    ejecucion: { pts: number; fuente: string; justificacion: string };
    modificadores: { bonus_cantidad_presupuesto: number; bonus_importabilidad_provisional: number; modificador_adjudicacion: number };
    score_total: number;
    nivel: string;
  };
  capa_b_palancas: Array<{ palanca: string; estado: string; jugada: string; condicion: string; fuente: string }>;
  // v2.1: síntesis de la Capa B — dónde se gana realmente el proyecto.
  donde_se_decide: {
    todos_secundarios_topados: boolean;
    se_decide_en: string;              // precio | criterios_abiertos | mixto
    tenemos_ventaja_costo: string;     // si | no | na
    via: string;                       // importable | producto_propio | ninguna
    criterios_abiertos_diferenciadores: string[];
    mensaje: string;
  };
  capa_c_admisibilidad: {
    presupuesto_excluyente: { aplica: boolean; efecto: string; fuente: string };
    cotizar_100_obligatorio: { aplica: boolean; efecto: string; fuente: string };  // v2.1
    bloqueantes: Array<{ item: string; efecto: string; fuente: string }>;
    barreras_a_favor: Array<{ item: string; fuente: string }>;
    boleta_aplica: boolean;
    umbral_utm: number;
    firma_puno_y_letra: boolean;
    alertas: string[];
  };
  // v2.1: orden de trabajo de Fase 4 (barrido de requisitos-entregables).
  documentos_infaltables: DocInfaltable[];
  multas: { estructura: string; costo_por_dia: string; costo_maximo: string; umbral_termino: string; fuente: string };
  linea_tiempo: {
    hitos: HitoTiempo[];
    frontera_inicio_computo: { descripcion: string; base_computo: string; fuente: string };  // v2.1
    caso_cadena: string;               // v2.1: garantia_contrato | solo_garantia | solo_contrato | oc_directa
    plazo_ofertable_puntaje: string;
    plazo_operativo_real_dias_habiles: number | null;
    colchon_dias_habiles: number | null;
    colchon_dias_corridos: number | null;  // v2.1: colchón administrativo en días corridos reales
    ventana_importacion: boolean;      // v2.1: colchón > 10 días corridos e importable
    alertas: string[];
  };
  manifiesto_productos: ManifiestoLinea[];
  lineas_a_atacar: LineaAtacar[];      // v2.1: solo para POR_LINEAS de mini-proyectos
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
  // Estructura del Excel de costeo. 'por_categoria' SOLO cuando el parser detectó rubros de
  // producto reales (encabezados A/B/C tipo FERRETERIA/PINTURA). Si las categorías las puso
  // la IA (p.ej. programas PDTI/PRODESAL), NO parte el costeo (queda null → sigue modalidad).
  estructura_costeo?: 'por_categoria' | null;
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
  if (VIAB_DEBUG) {
    console.log(`[viab-dbg] ${codigo}: ${out.length} documento(s) en documentos_cache:`);
    for (const d of out) {
      console.log(`[viab-dbg]   ${d.ok ? 'OK ' : 'NO '} ${String(d.texto.length).padStart(7)} chars · ${(d.metodo || '?').padEnd(20)} · ${(d.categoria || 'sin-cat').padEnd(22)} · ${d.nombre}`);
    }
    const leg = out.filter(d => d.ok).length;
    console.log(`[viab-dbg] ${codigo}: ${leg}/${out.length} legibles (≥50 chars). Total texto: ${out.reduce((s, d) => s + d.texto.length, 0).toLocaleString('es-CL')} chars`);
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

// Repara un JSON truncado (corte por MAX_TOKENS): recorre el texto llevando la pila de
// llaves/corchetes (ignorando lo que va dentro de strings), corta en el ÚLTIMO objeto
// cerrado y cierra las estructuras que queden abiertas. Devuelve un JSON parseable que
// conserva todo lo emitido hasta el último ítem completo, o null si no hay nada que salvar.
function repararJSONTruncado(txt: string): string | null {
  let inStr = false, esc = false;
  const stack: string[] = [];
  let lastObjClose = -1;
  let stackAtClose: string[] = [];
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']') {
      stack.pop();
      if (c === '}') { lastObjClose = i; stackAtClose = stack.slice(); }
    }
  }
  if (lastObjClose < 0) return null;
  let head = txt.slice(0, lastObjClose + 1);
  // Cerrar en orden inverso lo que quedó abierto tras el último objeto completo.
  for (let k = stackAtClose.length - 1; k >= 0; k--) head += stackAtClose[k] === '[' ? ']' : '}';
  return head;
}

// ─── Llamada al LLM (JSON forzado) ───────────────────────────────────────────────
// Proveedor activo (IA_TEXT_PROVIDER): GLM de Z.AI por defecto (chat compatible OpenAI),
// o Gemini nativo si se revierte a deepseek/Gemini. GLM evita el 429 crónico de Gemini.
async function llamarGeminiJSON(systemPrompt: string, userPrompt: string): Promise<any> {
  if (IA_TEXT_PROVIDER === 'zai') return llamarGlmJSON(systemPrompt, userPrompt);
  return llamarGeminiNativoJSON(systemPrompt, userPrompt);
}

// GLM (Z.AI) con JSON forzado y reparación de truncado. El manifiesto va al final del
// esquema, así que si se corta por longitud solo se pierde su cola (score/veredicto intactos).
async function llamarGlmJSON(systemPrompt: string, userPrompt: string): Promise<any> {
  const ESPERAS = [0, 5_000, 12_000];
  let ultimoErr = '';
  for (let intento = 0; intento < ESPERAS.length; intento++) {
    if (intento > 0) await sleep(ESPERAS[intento]);
    try {
      const t0 = Date.now();
      const completion: any = await crearChatIA({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.15,
        stream: false,
        max_tokens: 32_000,
        response_format: { type: 'json_object' },
      }, { timeoutMs: 280_000 }); // el informe completo (~90k tokens in) tarda; GLM cae con 120s
      const finish = completion.choices?.[0]?.finish_reason;
      // ── Telemetría SIEMPRE visible: tiempo + tokens + costo estimado ─────────────
      // Es la señal clave para optimizar: cuánto tardó, cuántos tokens de entrada/salida
      // y el costo. Tarifas GLM configurables por env (por defecto GLM-4.6 de Z.AI, USD/millón).
      const segs = ((Date.now() - t0) / 1000).toFixed(1);
      const u = completion.usage ?? {};
      const inTok  = Number(u.prompt_tokens ?? 0);
      const outTok = Number(u.completion_tokens ?? 0);
      const totTok = Number(u.total_tokens ?? (inTok + outTok));
      const precIn  = Number(process.env.GLM_PRICE_IN_USD_PER_M  ?? 0.43); // GLM-4.6 Z.AI: $0.43/M in
      const precOut = Number(process.env.GLM_PRICE_OUT_USD_PER_M ?? 1.74); // GLM-4.6 Z.AI: $1.74/M out
      const costo = (inTok / 1e6) * precIn + (outTok / 1e6) * precOut;
      console.log(
        `[viabilidad-ia] 💰 GLM ${MODELO_TEXTO} · ${segs}s · in=${inTok} out=${outTok} tot=${totTok} tok · finish=${finish} · ~$${costo.toFixed(4)} USD (intento ${intento})`,
      );
      dbg(`llamarGlmJSON: respuesta finish=${finish} · usage=${JSON.stringify(completion.usage ?? {})}`);
      const txt = String(completion.choices?.[0]?.message?.content ?? '');
      // Parser tolerante compartido: sanea caracteres de control y repara truncado.
      const parsed = parseJsonIA(txt);
      if (parsed) return parsed;
      throw new Error(`GLM devolvió JSON inválido (finish=${finish})`);
    } catch (e: any) {
      const status = e?.status ?? 0;
      ultimoErr = `${MODELO_TEXTO} ${status || ''}: ${String(e?.message ?? e).slice(0, 150)}`;
      // Transitorios (429/503/timeout) → reintentar; permanentes → abortar.
      const transitorio = status === 429 || status === 503 || status === 0 || /timeout|ETIMEDOUT/i.test(String(e?.message ?? ''));
      if (!transitorio) break;
      console.warn(`[viabilidad-ia] ${MODELO_TEXTO} transitorio, reintento ${intento + 1}/${ESPERAS.length}...`);
    }
  }
  throw new Error(`GLM no respondió: ${ultimoErr}`);
}

async function llamarGeminiNativoJSON(systemPrompt: string, userPrompt: string): Promise<any> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY no configurada');

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ parts: [{ text: userPrompt }] }],
    // maxOutputTokens MODERADO a propósito: un tope enorme hace que la generación tarde
    // tanto que se cuelga (timeout = NADA que reparar). Un tope moderado RETORNA rápido; si
    // el manifiesto no cupo, queda finishReason=MAX_TOKENS y lo salvamos con
    // repararJSONTruncado() (manifiesto va AL FINAL: solo se pierde su cola, no el informe).
    generationConfig: { temperature: 0.15, responseMimeType: 'application/json', maxOutputTokens: 40_000 },
  });

  // Paciente ante el 503 "high demand" (overload de Google), el 429 (límite/min) Y el
  // TIMEOUT de generación: con muchos documentos (medido: 12 docs ≈ 200k chars) Gemini
  // tarda ~3 min en producir el JSON completo, y un timeout corto abortaba el análisis y
  // lo devolvía como 500 genérico. Ahora:
  //  - El modelo ESTABLE va PRIMERO (gemini-flash-latest da muchos menos 503 que 2.5-flash).
  //  - Timeout amplio por intento (240s), pero acotado a un PRESUPUESTO GLOBAL (~285s, por
  //    debajo del maxDuration=300 de la ruta) para no pasarnos y devolver limpio si no da.
  //  - El timeout/fallo de red se trata como TRANSITORIO (reintenta con el otro modelo), no
  //    como error fatal.
  // Todos los intentos con el alias ESTABLE/rápido (flash-latest): 2.5-flash es más lento
  // y al generar el JSON grande se colgaba. El 503 "high demand" es de Google y solo se
  // cura reintentando, así que damos varios intentos cortos dentro del presupuesto global.
  const ESPERAS = [0, 5_000, 10_000, 18_000, 28_000];
  const MODELOS  = [GEMINI_MODEL_FALLBACK, GEMINI_MODEL_FALLBACK, GEMINI_MODEL_FALLBACK, GEMINI_MODEL_FALLBACK, GEMINI_MODEL];
  const TIMEOUT_MAX = 200_000;
  const DEADLINE = Date.now() + 290_000;
  let ultimoErr = '';
  for (let intento = 0; intento < ESPERAS.length; intento++) {
    if (intento > 0) await sleep(ESPERAS[intento]);
    const restante = DEADLINE - Date.now();
    if (restante < 30_000) break; // sin margen para otro intento útil
    const modelo = MODELOS[intento] || GEMINI_MODEL_FALLBACK;
    let res: Response;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(Math.min(TIMEOUT_MAX, restante)) },
      );
    } catch (e) {
      // Timeout de generación o fallo de red → transitorio: reintenta con el otro modelo.
      ultimoErr = `${modelo} timeout/red: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`;
      console.warn(`[viabilidad-ia] ${modelo} timeout/red, reintento ${intento + 1}/${ESPERAS.length}...`);
      continue;
    }
    if (res.ok) {
      const data = await res.json();
      const finish = data.candidates?.[0]?.finishReason;
      const txt = String(data.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
      // Parser tolerante compartido: sanea caracteres de control y repara truncado (el
      // manifiesto va al final del esquema, así que si se corta solo se pierde su cola).
      const parsed = parseJsonIA(txt);
      if (parsed) return parsed;
      if (finish && finish !== 'STOP') throw new Error(`Respuesta de Gemini incompleta (finishReason=${finish}).`);
      throw new Error(`Gemini devolvió JSON inválido`);
    }
    ultimoErr = `${modelo} ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`;
    if (res.status !== 429 && res.status !== 503) break; // permanente → no reintentar
    console.warn(`[viabilidad-ia] ${modelo} ${res.status} transitorio, reintento ${intento + 1}/${ESPERAS.length}...`);
  }
  throw new Error(`Gemini saturado (reintentos agotados): ${ultimoErr}`);
}

// ─── Prompt PROMPT 2 ─────────────────────────────────────────────────────────────
const BASE_SYSTEM_PROMPT = `# PROMPT 2 — ANALIZADOR DE VIABILIDAD (v2.1)

Eres un ANALISTA EXPERTO en licitaciones públicas chilenas (Ley 19.886, DS 250/2004, MercadoPúblico) con 8 años de adjudicaciones, para una empresa que VENDE bienes/equipamiento (ferretería, materiales, equipamiento, mobiliario urbano), con bodega y cotizaciones SIEMPRE desde Santiago. Lees las bases ya clasificadas de UNA licitación y emites un INFORME DE VIABILIDAD que permita a un asistente humano (AC) decidir, SIN ninguna duda, si el proyecto conviene y por qué.
ENFOQUE COMERCIAL, NO INFORMATIVO: no describes la licitación, la DIAGNOSTICAS como oportunidad de negocio. Cada dato responde a "¿cómo lo explotamos para ganar?" o "¿por qué aquí no hay nada que rascar?". El AC debe leer JUGADAS, no fichas.
Objetivo máximo: adjudicar el mayor número de licitaciones CONVENIENTES (no volumen, no se busca cantidad: se busca ganar lo que conviene).
Tu veredicto sobre todo lo que se lee en las bases es DEFINITIVO. Lo que dependa de buscar productos/precios en internet → "pendientes_fase3" (NO lo inventes). Esta fase NO usa búsqueda web.

CAMBIOS v2.1 (cuatro módulos afinados con expertise de terreno):
- Módulo A (Criterios): detección por DOBLE ANCLA (estructural + léxica), captura de jerarquía FACTOR→SUBFACTOR con PONDERACIÓN EFECTIVA (real), validación SUMA = 100%, y forma de aplicación consolidada aunque viva en otra sección.
- Módulo B (Cómo se adjudica): se corrige la confusión entre CÓMO SE PAGA y CÓMO SE ADJUDICA. Lo estratégico es si la torta se adjudica a UN solo proveedor (GLOBAL) o se REPARTE (POR LÍNEAS / POR LOTES). La modalidad modula el atractivo. Causal de admisibilidad del global/lote: cotizar el 100% o quedar fuera.
- Módulo C (Plazos): el COLCHÓN es SOLO el tiempo administrativo gratis PREVIO al inicio del cómputo de entrega; el plazo de entrega NO contamina el colchón.
- Módulo D (Palancas): cada palanca es una JUGADA accionable (VENTAJA/RESOLVER/NEUTRO/EN CONTRA) con su vía de solución; cierre "DÓNDE SE DECIDE".

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

PASO 2 — MODALIDAD DE ADJUDICACIÓN (CRÍTICO — detección fehaciente, gate de cierre). tipo = suma_alzada | por_linea.
MÓDULO B — CÓMO SE ADJUDICA (la pregunta estratégica): ¿la torta completa se adjudica a UN SOLO proveedor, o se REPARTE entre varios? A nosotros nos conviene la torta completa. Tres formas conceptuales, que MAPEAS al campo tipo así:
 · GLOBAL (todo a un solo proveedor; hay que cotizar el 100%) → tipo=suma_alzada.
 · POR LOTES (se reparte por bloques; cada lote es un "mini-global" que se cotiza en bloque) → tipo=suma_alzada (con líneas por lote en el manifiesto).
 · POR LÍNEAS (se reparte: cada línea puede ir a un proveedor distinto; incluye "multiproveedor" y "mixto") → tipo=por_linea.
ANCLA PRIMARIA DE DETECCIÓN (conductual, difícil de falsear): ¿las bases permiten ofertar SOLO UNA PARTE? "podrán postular a una, a varias o a la totalidad de las líneas" / "se adjudicará por línea" / "se evaluará y adjudicará de forma independiente cada ítem" → REPARTIDO (por_linea, o suma_alzada si el reparto es por lotes en bloque). "no se aceptarán ofertas parciales" / "la no cotización de un ítem es causal de inadmisibilidad" / "se adjudicará en forma global a un solo oferente" → GLOBAL (suma_alzada).
CAUSAL DE ADMISIBILIDAD (GLOBAL y LOTE): para ganar la torta (o el lote) hay que COTIZAR EL 100% de sus ítems; si falta uno, se cae toda la oferta (o todo el lote) → márcalo como alerta dura en Capa C e insumo para Fase 3 (si un solo producto no es conseguible, peligra el global/lote completo).
La heurística de portada es SOLO INDICIO (1 ítem portada + N productos en bases → casi seguro suma_alzada; portada distribuida en muchos ítems → probable por_linea). VERIFICACIÓN OBLIGATORIA: el artículo de las bases que define la modalidad ("precio total/totalidad/suma alzada/no se aceptan ofertas parciales" vs "adjudicación por línea/ítem"). Responde tipo + fuente (artículo+página) + evidencia (frase textual) + confianza (0-1) + estado (DETERMINADA | REVISION_HUMANA). Si NO queda fehaciente (sin artículo claro, portada y bases se contradicen, o confianza no alta) → estado=REVISION_HUMANA (no asumas ninguna). Si es por_linea y no publican precio por línea → libertad_de_pricing=true.
DISTINGUE DOS EJES QUE NO SON LO MISMO (error frecuente que INVALIDA la modalidad): (a) FORMA DE ADJUDICACIÓN = a cuántos proveedores se asigna ("adjudicación simple/única" vs "adjudicación múltiple", "por cada ítem/línea se seleccionará a un oferente", "adjudicación parcial/por línea o ítem"); (b) FORMA DE COTIZAR = cómo se ofertan los precios (suma alzada / total fijo global vs precio unitario por ítem/línea). La MODALIDAD que decides (tipo) es el EJE (b). Una cláusula de "adjudicación por línea/ítem/múltiple" por sí sola NO implica por_linea: es solo la opción de repartir la adjudicación.
REGLA DEL TOTAL CONSOLIDADO (la MÁS decisiva): si el FORMATO DE OFERTA ECONÓMICA (Anexo/Formato N°n que el proveedor firma y sube) pide UN ÚNICO TOTAL al pie ("TOTAL NETO", "TOTAL GENERAL OFERTA", "COSTO TOTAL DE LA OFERTA", "precio fijo", "cantidades inamovibles", "proveer íntegramente") sobre una lista de ítems → tipo=suma_alzada, AUNQUE exista columna de valor por ítem y AUNQUE las bases mencionen "adjudicación por línea/ítem/múltiple" (eso NO gatilla REVISION_HUMANA; anótalo como nota). Cita el formato como evidencia.
REGLA ESPEJO DEL PRECIO UNITARIO (para no marcar como suma_alzada lo que es por_linea): si las bases dicen EXPLÍCITAMENTE "se debe ofertar por la línea de producto", "se evaluará cada línea de manera individual", "podrá ofertar una o más líneas", o "se evaluarán únicamente las líneas que contengan información" (se pueden OMITIR líneas), o si el FORMATO DE OFERTA ECONÓMICA cotiza PRECIO UNITARIO por cada ítem SIN un único gran total al pie → tipo=por_linea, AUNQUE los ítems estén numerados CORRELATIVOS 1..N de corrido (la numeración continua NO prueba suma_alzada) y AUNQUE la planilla tenga una columna "TOTAL"/"TOTAL IVA INCLUIDO" por ítem (esa columna es el total POR FILA, no un total consolidado). Cita la frase o el formato como evidencia.
SEÑALES FALSAS que NO son por_linea: ítems en HOJAS/PÁGINAS/SECCIONES separadas pero con NUMERACIÓN CORRELATIVA CONTINUA 1..N (es UNA sola planilla integrada, no líneas independientes) SIEMPRE QUE el formato económico pida un total único al pie y las bases NO digan que se oferta/evalúa por línea; la mera columna de precio por ítem; la frase "adjudicación por línea o ítem" (a secas, sin "ofertar/evaluar por línea").
CUANDO LAS BASES NO DECLARAN LA MODALIDAD EN PALABRAS → decide por la ESTRUCTURA de los ítems (heurística del experto): (1) ítems CORRELATIVOS 1..N cada uno con su cantidad real, cerrando en un total único → suma_alzada; (2) ítems agrupados en LÍNEAS/LOTES distintos (cada línea con su propio título/subtotal/presupuesto, o su propia hoja, y la numeración se REINICIA dentro de cada línea) → por_linea; (3) catálogo con precio unitario independiente y SIN total único (convenio de suministro) → por_linea. Ejemplo suma_alzada: "1 ZINC, 2 POLIN, 3 CLAVO TECHO, 4 MALLA…" correlativos hasta el final. Ejemplo por_linea: "LÍNEA 1: implementos sanitarios [ítems]; LÍNEA 2: áridos [ítems]; LÍNEA 3: eléctricos [ítems]".

PASO 3 — CRITERIOS DE EVALUACIÓN + FORMA DE APLICACIÓN (INSUMO INNEGOCIABLE — gate de cierre, BÚSQUEDA OBLIGATORIA SI O SI). NO basta listar "experiencia 30%, precio 40%". BÚSQUEDA EXHAUSTIVA OBLIGATORIA: los criterios de evaluación y su ponderación (%) PUEDEN estar en CUALQUIER documento, NO solo en el que se llame "BASES_ADMINISTRATIVAS" — a veces aparecen en BASES_TECNICAS, en un documento "BASES" sin calificar, en ANEXOS, en aclaraciones, o con otro nombre de archivo. DEBES leer el texto COMPLETO de TODOS los documentos, PÁGINA POR PÁGINA (usa los marcadores [[PÁGINA N]]), buscando patrones como "criterios de evaluación", "la comisión evaluadora", "se evaluará de acuerdo a", "ponderación", "puntaje", junto a porcentajes (ej. "40%", "Precio de la oferta: 40%", tablas con letras a) b) c)...). NUNCA concluyas "no se encontraron criterios" sin haber recorrido el 100% de las páginas de TODOS los documentos disponibles — es un error grave dejar esto vacío si el dato existe en cualquier parte del texto entregado.
LA FORMA DE APLICACIÓN SUELE VENIR EN UNA TABLA, no en prosa: columnas tipo PARÁMETROS / CALIFICACIÓN / PUNTAJE / "x 0,20" con filas "Cumple … = 100 pts / No cumple … = 10 pts". Si un criterio aparece con su % pero NO ves su fórmula, BUSCA su tabla de puntajes en la MISMA página y en las adyacentes ANTES de declarar la forma de aplicación ausente. Un criterio con ponderación CASI SIEMPRE trae su tabla de calificación cerca de los otros criterios; declararla "no especificada" cuando otros criterios de la misma sección sí la tienen es un ERROR GRAVE (revisa de nuevo esa página). Solo marca forma_aplicacion ausente si REALMENTE no hay tabla ni descripción de puntajes en ninguna parte. Cascada de fuente ESTRICTA una vez ubicados: (1) las bases (donde estén; lo habitual BASES_ADMINISTRATIVAS, pero puede ser otro doc) — aquí está la FORMA DE APLICACIÓN; (2) la API de MercadoPúblico aporta criterio + ponderación pero NUNCA la forma de aplicación; (3) si la forma de aplicación no aparece en ninguna parte tras la búsqueda exhaustiva → ALERTA EXPLÍCITA + acción para AC (nunca en silencio). Por cada criterio declara: nombre, ponderacion (%), forma_aplicacion (la FÓRMULA exacta, los TRAMOS, qué acredita cada puntaje), medio_verificacion, fuente (doc+art+página EXACTA donde lo leíste). criterios_evaluacion.fuente_datos = bases|api|mixto|incompleto. forma_aplicacion_completa=true solo si TODOS los criterios traen su forma de aplicación; si falta en alguno → false + alerta puntual (qué criterio y dónde buscar) + estado_veredicto=REVISION_HUMANA. Las ponderaciones suman 100. Si tras revisar TODA la documentación realmente no hay ningún criterio (caso raro) → criterios=[] + alerta explícita "no se encontraron criterios de evaluación en ningún documento tras revisión exhaustiva".

MÓDULO A — DETECCIÓN POR DOBLE ANCLA (haz tu propio barrido; NO dependas de la bandera de Fase 1): (a) ANCLA ESTRUCTURAL (principal): localiza la sección que REPARTE EL 100% del puntaje entre factores con ponderaciones, se llame como se llame; (b) ANCLA LÉXICA (refuerzo): Criterios de Evaluación, Factores de Evaluación, Factores y Ponderadores, Subfactores, Mecanismo de Evaluación de las Ofertas, Parámetros de Evaluación, Tablas de Variables y Ponderadores, Criterios de Ponderación, Metodología/Pauta de Evaluación. LA ESTRUCTURA MANDA SOBRE EL TÍTULO.
JERARQUÍA FACTOR→SUBFACTOR (crítico: no confundir ponderación nominal con real): muchas bases anidan (ej. Factor Técnico 50% → Experiencia 60% + Plazo 40%). Ese 60/40 es RELATIVO al factor padre, no al total. Calcula la PONDERACIÓN EFECTIVA (real) de cada subfactor: efectiva = ponderacion_padre × ponderacion_subfactor_relativa (ej. Experiencia = 50%×60% = 30% real). En el campo criterios[].ponderacion reporta SIEMPRE la ponderación REAL (efectiva); si desglosas un factor en subfactores, emite una entrada por subfactor con su % real (y nombra "Factor › Subfactor").
VALIDACIÓN SUMA = 100% (red de seguridad — verifica dos veces): suma las ponderaciones REALES de todas las entradas de criterios. Debe dar 100% (±1% por redondeo). Si NO cuadra → agrega a criterios_evaluacion.alertas "posible criterio no capturado (la suma da X%, no 100%)" y estado_veredicto=REVISION_HUMANA. Es el detector automático de "se me escapó un factor".
ABIERTO O TOPADO: en la forma_aplicacion indica si el criterio es ABIERTO (a más agresivo más puntaje, sin tope) o TOPADO (un tramo que casi todos alcanzan) — la Capa B lo usa.

PASO 4 — CAPA A: ATRACTIVO (puntúa 1-3 por criterio, cita fuente+página):
- Presupuesto: $8-20M=1, $20-50M=2, >$50M=3.
- Cantidad de ítems (inverso, condicionado): >60=1, 21-60=2, 1-20=3. Penaliza muchas líneas SOLO si son commodity; alta especialidad/equipamiento NO penaliza (condicion_complejidad = commodity|especializado).
- Complejidad del producto: catálogo/>5 oferentes=1, técnico/3-5=2, especializado/1-2=3.
- Dificultad de ejecución (barrera a OTROS, no costo propio): bodega RM/plazo holgado=1, otra región/equipo frágil=2, zona extrema/instalación certificada/HAZMAT/multipunto=3.
- Modificadores: bonus_cantidad_presupuesto=+1 si presupuesto>$50M y cantidad>40; bonus_importabilidad_provisional=+2 si la spec lo permite ("o técnicamente equivalente") e importable por courier/flete dentro del plazo (confirmar Fase 3).
- MODIFICADOR POR CÓMO SE ADJUDICA (Módulo B — modula el atractivo con fuerza; SÚMALO al score_total, no crea campo nuevo): GLOBAL + productos muy heterogéneos (diversidad de rubros entre líneas) = +3 (nadie más arma la canasta completa, nuestro nicho puro); GLOBAL + productos homogéneos = +2 (torta completa pero commodity → más competencia); POR LOTES = +1 (el lote es un mini-global que se cotiza en bloque); POR LÍNEAS con líneas ≥$5M o especializadas = 0 (cada línea es un mini-proyecto, su atractivo lo da su propio presupuesto/complejidad); POR LÍNEAS con líneas <$5M Y commodity (AND) = −2 (proyecto-migaja: guerra de precio ítem por ítem). Explica el modificador aplicado en la justificacion de cantidad_items o complejidad.
- score_total (suma) → nivel: 12-15 MUY_VIABLE, 8-11 VIABLE, 5-7 POCO_VIABLE, <5 o gate DESCARTE.
- justificacion (OBLIGATORIA por cada uno de los 4 criterios): 1 frase corta y concreta que explique POR QUÉ ese puntaje, citando el valor real que lo determina (ej. presupuesto "neto $25M cae en el tramo $20-50M → 2/3"; cantidad "59 ítems especializados, no se penaliza por especialidad → 2/3"; complejidad "equipamiento técnico con 3-5 oferentes → 2/3"; ejecución "entrega multipunto en región fuera de RM → 2/3"). NUNCA dejes la justificacion vacía: el humano debe entender el porqué sin abrir las bases.
CAPA B — además del estado, la "condicion" de cada palanca DEBE ser una frase corta que explique POR QUÉ es VENTAJA/NEUTRO/DESVENTAJA (ej. plazo "se evalúa por ley del mínimo sin piso → ventaja"; precio "pondera 72%, riesgo de guerra de precio → neutro/alerta"). No la dejes vacía.

CATÁLOGOS DE COMPLEJIDAD (anclas): BAJA(1)=computadores estándar, material de oficina, mobiliario estándar, neumáticos corrientes, extintores PQS. MEDIA(2)=PLC/variadores de marca estándar, seguridad industrial certificada, balanzas certificadas, UPS industrial, metrología básica, drones técnicos, MAQUINARIA DE ASEO (barredoras, vacuolavadoras, hidrolavadoras, fregadoras). ALTA(3)=equipos médicos de diagnóstico, instrumental de laboratorio avanzado (cromatógrafos, espectrofotómetros), END (ultrasonido phased array), telecom certificada, repuestos con distribuidor único. (Tóner y artículos de aseo NO se puntúan: son exclusión por palabra negativa dura. "Aseo" aquí = MAQUINARIA.) Ejecución ALTA(3)=zonas extremas (Isla de Pascua, Tortel, Navarino), plazo<5 días con volumen, instalación/puesta en marcha certificada, HAZMAT, cadena de frío, multirregional.

PASO 5 — CAPA B: PALANCAS (banderas, no suman): precio, plazo, garantia, geografia, completitud, densidad. Por cada una: estado VENTAJA|NEUTRO|DESVENTAJA + condicion + fuente. Precio NUNCA es ventaja (peso alto = alerta guerra de precio, commodity). Plazo es ventaja solo con ley del mínimo SIN piso. Garantía es ventaja si puntúa y es abierta (ley del máximo). Geografía nunca es ventaja logística (bodega Santiago); solo si el criterio puntúa la ubicación. Densidad: zona remota/poca oferta local = más ganable.
MÓDULO D — CADA PALANCA ES UNA JUGADA ACCIONABLE (la condicion se redacta como jugada, no como descripción): VENTAJA (🟢 OPORTUNIDAD) solo cuando hay una jugada que nos diferencia del resto (monetizar el colchón en plazo, servicio técnico propio en garantía extendida real, llegar a un tope alto que pocos alcanzan pero nosotros SÍ). DESVENTAJA (🔴 EN CONTRA) cuando el criterio anula una capacidad que teníamos o exige algo que no tenemos a mano y NO es suplible; o cuando el tope lo alcanzan casi todos (nuestra agresividad no suma). NEUTRO cuando no hay jugada ni riesgo, O cuando es una condicionante SUPLIBLE (🟡 RESOLVER): en ese caso la condicion DEBE traer la vía de solución como acción que invita a moverse (ej. geografía: "consigue una carta de servicio técnico de un partner en Valparaíso y este 8% pasa de riesgo a punto ganado"). PRINCIPIO TRANSVERSAL: el sistema no dice "no tienes esto"; dice "consíguelo así y lo tienes". Solo si de verdad no hay forma → DESVENTAJA.
CIERRE OBLIGATORIO "DÓNDE SE DECIDE" (agrégalo como una entrada de palanca con palanca="precio" y/o en veredicto.advertencias): evalúa si TODOS los criterios secundarios están topados (todos los oferentes competentes empatarán arriba). Si es así, el diferencial neto se traslada al PRECIO aunque su ponderación sea baja: si tenemos ventaja de costo (producto IMPORTABLE o PROPIO/marca propia) → JUGADA: entrar agresivo en precio; si NO la tenemos → ALERTA: sin diferenciador es guerra de precio contra iguales, evaluar si vale la pena. Si NO todos los secundarios están topados → indica EN QUÉ criterios abiertos podemos diferenciarnos (la pelea no es solo precio).

PASO 6 — CAPA C: ADMISIBILIDAD (gate, con fuente+página). Por cada ítem efecto A_FAVOR|EN_CONTRA|NEUTRO:
- presupuesto_excluyente: si es_excluyente (techo duro) → ofertar por encima = oferta INADMISIBLE → aplica=true, efecto=EN_CONTRA + alerta explícita. Si referencial → aplica=false, efecto=NEUTRO. (El 30% del Art.124 del Reglamento aplica a aumentos POST-contrato, NO a la admisibilidad de la oferta.)
- Cotización del 100% (GLOBAL / LOTE): si el PASO 2 determinó adjudicación GLOBAL o POR LOTES (tipo=suma_alzada por torta/bloque cerrado), NO cotizar todos los ítems = oferta inadmisible → agrégalo a bloqueantes[] SOLO si hay un ítem realmente no conseguible (insumo directo a Fase 3); si todo es conseguible, va como alerta informativa, no como bloqueante.
- DOCUMENTOS INFALTABLES (Módulo D — barrido único de Bases Administrativas Y Técnicas): captura TODO requisito expreso que implique un entregable/compromiso nuestro (certificado de garantía, servicio postventa, descarga a piso, lugar/forma de entrega, certificados de calidad, manuales, capacitación exigida). Los DUROS (de fallar nos dejan fuera) van a bloqueantes[] solo si no los cubrimos; el resto (compromisos de ejecución y puntaje-condicionantes que SÍ preparamos) van como ítems concretos en veredicto.acciones_AC ("preparar X — Fuente Art./pág"), que es la orden de trabajo de Fase 4. NUNCA los omitas en silencio.
- Boleta seriedad/fiel cumplimiento: barrera de capital SOLO si el contrato supera 1.000 UTM (fiel) / 5.000 UTM (seriedad). Bajo eso boleta_aplica=false. Calcula el umbral en UTM.
- Espalda financiera/flujo de caja (Estado paga en 2-5 meses) = A_FAVOR nuestro en proyectos grandes (barreras_a_favor).
- Firma de puño y letra: firma_puno_y_letra=true SOLO si las bases la exigen explícitamente → ALERTA. (Lo habitual es firma digitalizada/electrónica, válida.)
- Carpeta tributaria → EN_CONTRA por política (no se sube). Certificado de capacidad económica → A_FAVOR.
- Umbrales que nos bloqueen (garantía mínima, plazo fuera de rango, ficha en formato no aceptado, inscripción/habilidad en Registro de Proveedores) → bloqueantes[] con efecto EN_CONTRA. Si un BLOQUEANTE nos descalifica y no se resuelve → veredicto DESCARTE aunque el atractivo sea alto.
- NO ES BLOQUEANTE (no lo pongas en bloqueantes[]): el PUNTAJE MÍNIMO / UMBRAL DE ADMISIBILIDAD de la oferta (ej. "se adjudica solo si el total ponderado ≥70%", "oferta admisible 70-100%"). Es una barra COMPETITIVA que aplica a TODOS los oferentes por igual, no algo que nos descalifique a priori; va como nota/alerta informativa, NUNCA como bloqueante. Bloqueante = requisito que NOS deja fuera de entrada (algo que no tenemos o no cumplimos), no un puntaje a alcanzar compitiendo. Marcar el puntaje mínimo como bloqueante es un ERROR (hunde el veredicto de una licitación viable).
- Complejidad documental general → A_FAVOR (barrera a los chicos). Inhabilidades Art.4 Ley 19.886 y docs estándar: siempre cumplimos (no alertar salvo excepción).
DEFINICIÓN ESTRICTA DE BLOQUEANTE (CRÍTICO — no inflar): bloqueantes[] es SOLO para requisitos que NOS DEJAN FUERA de entrada y que NO podemos resolver. La mayoría de las licitaciones NO tiene ningún bloqueante real para nosotros. NO son bloqueantes (NO los pongas en bloqueantes[], son trámite estándar que SIEMPRE cumplimos): garantía/boleta de fiel cumplimiento (salvo que supere nuestra capacidad), garantía del producto que ofrecemos (12, 24 meses, etc.), Programa de Integridad / declaración de ética, presentación de formularios/anexos (N°1..N°6), carpeta tributaria, puntaje mínimo / umbral de admisibilidad, declaraciones juradas estándar, inscripción en ChileProveedores (la tenemos), garantía de seriedad. SÍ son bloqueantes (solo si aplican y no se resuelven): naturaleza = obra civil/servicio que NO hacemos, exigencia de profesional residente/constructor certificado, certificación específica que NO poseemos (ISO, SEC clase, etc.) cuando es OBLIGATORIA y excluyente, experiencia mínima acreditada que NO tenemos, plazo de entrega imposible, presupuesto EXCLUYENTE que no podemos cumplir. Ante duda de si un ítem nos descalifica de verdad → NO es bloqueante (va como alerta/nota). Inflar bloqueantes hunde el score de licitaciones perfectamente ganables: es un ERROR GRAVE.

PASO 7 — MULTAS: estructura (% de OC / UTM por día / otro), costo_por_dia y costo_maximo en pesos, umbral_termino (de término anticipado), fuente del artículo de sanciones + página. Reporta el costo de atrasarnos.

PASO 8 — LÍNEA DE TIEMPO / MÓDULO PLAZOS (bloque destacado; entrega SOLO el modelo de datos, la intranet dibuja el gráfico).
MÓDULO C — QUÉ ES EL COLCHÓN (concepto CORRECTO, no confundir): el COLCHÓN es el tiempo administrativo GRATIS que transcurre entre la adjudicación y el momento en que ARRANCA el reloj del plazo de entrega (la FRONTERA). Durante ese tiempo ya sabemos que ganamos, así que podemos estar comprando o importando el producto aunque el plazo oficial todavía no corra. ERROR QUE SE CORRIGE: el PLAZO DE ENTREGA NO ES COLCHÓN — es lo que ofertamos y nos comprometemos a cumplir (su puntaje vive en Criterios/Capa B). JAMÁS sumes el plazo de entrega al colchón. DATO PIVOTE (la FRONTERA): ¿desde cuándo corre el plazo de entrega? (emisión de OC, aceptación de OC, firma/decreto de contrato). Todo lo que ocurre ANTES de la frontera → colchón (gratis); el plazo de entrega arranca EN la frontera → NO es colchón. REGLA ANTI-ERROR: si el plazo de entrega arranca desde la EMISIÓN de la OC, entonces la aceptación de la OC corre EN PARALELO a la entrega → NO es colchón. Cuatro casos de cadena hasta la frontera: (1) Garantía+Contrato: Adj→firma contrato→boleta→[decreto]→OC→aceptación→arranca; (2) Solo Garantía: Adj→boleta→OC→aceptación→arranca; (3) Solo Contrato: Adj→firma contrato→OC→aceptación→arranca; (4) OC directa: Adj→OC→aceptación→arranca. Construye el tiempo real entre adjudicación y fecha límite de entrega para poder ofertar plazo agresivo conociendo el colchón real. Extrae de las BASES (con Fuente; extracción INTERPRETADA, NO constante):
- Plazo de aceptación de la OC (días que tiene el proveedor para aceptar).
- base_computo: desde cuándo corre el plazo de entrega = emision_oc | aceptacion_oc | firma_contrato.
- ¿Hay firma de contrato? (excepcional, contratos grandes): su plazo.
- ¿Hay boleta de fiel cumplimiento que condiciona el inicio del cómputo?
REGLA CRÍTICA: cada hito se LEE de las bases de ESTE proyecto con su Fuente. Los plazos "habituales" son referencia para detectar anomalías, NO relleno automático (única excepción: el tope legal de 5 días corridos para la aceptación de la OC cuando NO está escrita). Si un plazo NO está explícito → inferido=true + alerta (supuesto a confirmar por AC); NUNCA inventes la cifra estándar. Cadena de hitos: Adjudicación → [firma contrato si aplica] → [boleta] → emisión OC → [aceptación OC] → FRONTERA (inicio del cómputo) → fecha límite real. Entrega: hitos[] (hito, duracion_dias, tipo_dias habiles|corridos, base_computo, fuente, inferido). MAPEO AL ESQUEMA (Módulo C): colchon_dias_habiles = SOLO el colchón administrativo previo a la frontera (los hitos ANTES del inicio del cómputo; NUNCA sumes el plazo de entrega); plazo_ofertable_puntaje = el plazo de entrega que conviene ofertar para maximizar puntaje (ej "1 día"); plazo_operativo_real_dias_habiles = el mismo colchón administrativo disponible para preparar/comprar/importar antes de que arranque el reloj. Si el colchón resulta > 10 días e importable, dilo en alertas[] ("hay margen para importar"). alertas[] para hitos inferidos/no especificados.

PASO 9 — MANIFIESTO DE PRODUCTOS (hook Fase 3 + SEMILLA DEL COSTEO), desde las BASES TÉCNICAS (no la API). Por cada línea/ítem: descripcion técnica EXACTA (sin omitir, agrupar ni alterar — 5000 clavos siguen siendo 5000 clavos), modelo (marca/modelo pedido), cantidad (original, tal cual), unidad_medida (textual de las bases; si no la especifican → asume la unidad básica y unidad_inferida=true, NO la dejes vacía), presupuesto_linea (si las bases lo publican por línea/lote; si solo hay total sin desglose → null y libertad_de_pricing en modalidad), tipo (generico|especifico), ruta (A=ferretería / B=equipamiento). NO conviertas ni "mejores": la conversión a costo unitario la hace Fase 3. NO busques precios aquí (firewall: Fase 2 = solo bases).
ASIGNACIÓN DEL NÚMERO DE LÍNEA (CRÍTICO — SEMILLA DEL COSTEO; hay DOS versiones de costeo: "Costeo" para suma alzada y "Costeo en línea" para por_linea). El campo 'linea' de cada ítem NO es un correlativo del ítem: es el NÚMERO DE LA LÍNEA/LOTE a la que ese ítem pertenece. Muchas licitaciones agrupan los productos en LÍNEAS o LOTES, cada uno con su propio título y a veces su propio presupuesto (ej. "LÍNEA 1: SUMINISTRO DE IMPLEMENTOS SANITARIOS", "LÍNEA 2: ÁRIDOS", "LÍNEA 3: ELÉCTRICOS…", "Lote N°2", "Ítem 3", o secciones/hojas/páginas separadas una por línea). En ese caso DEBES leer esa estructura (recorriendo TODOS los documentos, sobre todo la ETT y el formato de oferta económica) y asignar a CADA producto el número de la línea que lo contiene: todos los productos bajo "LÍNEA 1" → linea=1; los de "LÍNEA 2" → linea=2; y así sucesivamente, en orden y sin saltarte productos. Cuando un mismo encabezado de línea agrupa muchos productos, TODOS esos productos comparten ese mismo número de línea (ej. si la Línea 3 tiene 144 materiales eléctricos, los 144 llevan linea=3). Regla ESPEJO con la modalidad del PASO 2: si modalidad.tipo=por_linea DEBEN existir ≥2 números de línea distintos en el manifiesto (uno por cada línea/lote real); si modalidad.tipo=suma_alzada (una sola lista corrida, o un único total consolidado, sin agrupación en líneas/lotes) TODOS los ítems llevan linea=1. NO inventes líneas: agrúpalas SOLO si las bases o el formato económico las declaran explícitamente (título "LÍNEA/LOTE N", presupuesto por línea, u hoja/sección separada por línea). Esta asignación es la que decide si el Excel de costeo sale como una sola hoja "Costeo" (suma alzada) o como una hoja por línea "Costeo en línea" (por_linea).

PASO 10 — VEREDICTO: nivel (MUY_VIABLE|VIABLE|POCO_VIABLE|DESCARTE), gana_probable (si|no|condicional), estado_veredicto (DEFINITIVO | REVISION_HUMANA), motivos_revision[] (acumula modalidad no fehaciente y/o forma de aplicación faltante), acciones_AC[], advertencias[]. El AC no debe quedar con dudas del porqué. pendientes_fase3 = importabilidad_real, densidad_de_oferta, margen (lo que dependa de la web).

Responde ÚNICAMENTE un objeto JSON válido con el esquema canónico indicado en el mensaje del usuario, sin markdown.`;

// Prompt dinámico = prompt base + reglas aprendidas del experto (feedback loop).
// Las reglas se inyectan ANTES de las "REGLAS INNEGOCIABLES" para que tengan peso alto.
// El ancla debe coincidir EXACTAMENTE con el encabezado del prompt ("## 2. REGLAS
// INNEGOCIABLES"); si no coincide, replace() no hace nada y el bloque aprendido se pierde
// en silencio. Fallback: si el ancla no aparece, anteponemos el bloque al inicio del prompt.
function construirSystemPrompt(reglas: string[]): string {
  const bloque = bloqueReglasAprendidas(reglas);
  if (!bloque) return BASE_SYSTEM_PROMPT;
  const ANCLA = '## 2. REGLAS INNEGOCIABLES';
  if (BASE_SYSTEM_PROMPT.includes(ANCLA)) {
    return BASE_SYSTEM_PROMPT.replace(ANCLA, `${bloque}${ANCLA}`);
  }
  return `${bloque}${BASE_SYSTEM_PROMPT}`;
}

// Señal DETERMINISTA de modalidad a partir de la estructura del listado (parser). Es un
// hecho calculado que se inyecta al prompt para aterrizar al modelo débil (no depende de
// que "capte el matiz"). No es vinculante: el modelo puede contradecirla con evidencia.
function construirSenalModalidad(
  planilla: ReturnType<typeof parsearPlanillaCosteo>,
  lineasFormulario: number[] = [],
  ofertaTotalUnico = false,
  lenguajePorLinea: string | null = null,
): string {
  // PRIORIDAD 0 — LENGUAJE EXPLÍCITO de las bases (la declaración más directa del "cómo se
  // cotiza"): "ofertar por la línea de producto", "se evaluará cada línea de manera
  // individual", "se evaluarán únicamente las líneas que…". Es la señal MÁS confiable: si
  // las bases dicen que se oferta/evalúa por línea, es por_linea (aunque la numeración de
  // ítems sea correlativa 1..N, que por sí sola NO decide).
  if (lenguajePorLinea) {
    const notaTotal = ofertaTotalUnico
      ? ' NOTA: el formato económico también trae la palabra "total"; verifica si es un ÚNICO gran total AL PIE (entonces reevalúa a suma_alzada) o solo la columna "total" de una planilla por-ítem (sigue por_linea).'
      : '';
    return `SEÑAL DETERMINISTA DE MODALIDAD (lenguaje explícito de las bases): el texto dice literalmente "${lenguajePorLinea}", lo que significa que se OFERTA y EVALÚA cada línea/producto por separado (se pueden omitir líneas). Esto determina modalidad = por_linea. OJO: NO te dejes confundir por la numeración correlativa 1..N de los ítems (un listado por-línea también numera de corrido cuando cada ítem se cotiza con su precio unitario) ni por la columna "TOTAL" de la planilla (es el total POR ÍTEM, no un gran total al pie).${notaTotal}`;
  }
  // REGLA MAESTRA del experto: el FORMATO DE LA OFERTA ECONÓMICA manda sobre cómo se
  // adjudica. Si el formulario económico es UNA planilla integrada con un ÚNICO total
  // consolidado ("Monto total neto/IVA incluido" al pie), la modalidad es SUMA ALZADA,
  // aunque las bases digan "se podrá adjudicar por línea" (eso es adjudicación múltiple
  // —a quién—, no cómo se cotiza) y aunque los productos vengan rotulados "LÍNEA N".
  if (ofertaTotalUnico) {
    return `SEÑAL DETERMINISTA DE MODALIDAD (calculada del FORMULARIO DE OFERTA ECONÓMICA): el formulario económico es UNA planilla integrada con TODOS los productos de corrido y un ÚNICO total consolidado al pie ("Monto total neto" / "Monto total IVA incluido"). Esto determina modalidad = suma_alzada. OJO: NO te confundas con frases como "se podrá adjudicar a un solo proveedor por línea" (eso es adjudicación múltiple — a quién se adjudica — y NO cambia cómo se cotiza) ni con productos rotulados "LÍNEA N" en fichas técnicas o listados (es solo el correlativo del ítem). El formato de la oferta económica MANDA: modalidad = suma_alzada.`;
  }
  if (!planilla || planilla.items.length < 8) {
    // Sin planilla de cotización parseable, pero los documentos traen VARIAS fichas
    // "FORMULARIO Línea N°X" (una por producto) → señal fuerte de adjudicación por línea.
    if (lineasFormulario.length >= 2) {
      return `SEÑAL DETERMINISTA DE MODALIDAD (calculada de la estructura documental): los documentos contienen ${lineasFormulario.length} formularios/fichas técnicas independientes titulados "Línea N°X" (líneas ${lineasFormulario.slice(0, 8).join(', ')}${lineasFormulario.length > 8 ? '…' : ''}), cada una con su propio producto. Esto indica modalidad = por_linea (se oferta y adjudica por línea), SALVO que el formato de oferta económica exija un ÚNICO total consolidado. Verifícalo y decide. OJO: las tablas "Ítem | Características técnicas | Cumple Sí/No" son requisitos de cumplimiento, NO productos: el manifiesto de productos debe tener UNA entrada por línea (el equipo/producto de esa línea con su cantidad), no las filas del checklist.`;
    }
    return '';
  }
  // por_linea REAL: el correlativo se reinicia/repite por lote (no basta con títulos "Línea N").
  if (planilla.estructura === 'por_linea' && planilla.lineas.length >= 2 && planilla.numeracion === 'reinicia') {
    return `SEÑAL DETERMINISTA DE MODALIDAD (calculada de la estructura del listado): los ítems vienen agrupados en ${planilla.lineas.length} LÍNEAS/LOTES distintos y la NUMERACIÓN SE REINICIA/REPITE por línea (cada línea vuelve a empezar en 1 o un mismo número agrupa varios ítems). Esto indica modalidad = por_linea, SALVO que el formato de oferta económica exija un ÚNICO total consolidado (entonces suma_alzada). Verifícalo y decide.`;
  }
  // Rubros/categorías de producto bajo un mismo total → suma alzada (costeo desglosado por rubro).
  if (planilla.estructura === 'por_categoria') {
    return `SEÑAL DETERMINISTA DE MODALIDAD (calculada de la estructura del listado): los ${planilla.items.length} ítems están agrupados en ${planilla.categorias.length} RUBROS/CATEGORÍAS de producto (${planilla.categorias.slice(0, 4).join(', ')}${planilla.categorias.length > 4 ? '…' : ''}), numerados por rubro pero SIN lotes de adjudicación independientes. Esto indica modalidad = suma_alzada (un único total, con el costeo desglosado por rubro), NO por_linea. Verifícalo con el formato de oferta económica y decide.`;
  }
  // Numeración CORRELATIVA CONTINUA 1..N (de corrido) → INDICIO de suma alzada, aunque venga
  // partida en hojas/secciones tituladas "Línea N" (son una MISMA planilla integrada, no lotes).
  // OJO: la numeración continua por sí sola NO es concluyente — un listado POR LÍNEA también
  // numera 1..N cuando cada ítem se cotiza con precio unitario y se pueden omitir líneas. Manda
  // el FORMATO DE LA OFERTA ECONÓMICA (total único al pie = suma_alzada; precio unitario por
  // ítem sin gran total = por_linea) y el lenguaje explícito de las bases.
  return `SEÑAL DETERMINISTA DE MODALIDAD (calculada de la estructura del listado): los ${planilla.items.length} ítems tienen numeración CORRELATIVA CONTINUA 1..N (de corrido, no se reinicia por línea), aunque el documento venga partido en hojas/secciones tituladas "Línea N". Esto es INDICIO de suma_alzada (las hojas separadas NO son lotes de adjudicación), PERO la numeración por sí sola NO decide: si el FORMATO DE OFERTA ECONÓMICA cotiza precio UNITARIO por ítem sin un gran total al pie, o las bases dicen "se oferta/evalúa por línea", es por_linea. Verifícalo con el formato de oferta económica y el lenguaje de las bases, y decide.`;
}

function construirUserPrompt(codigo: string, ctx: any, docs: DocLeido[], senalModalidad = ''): string {
  // Ordenar por PRECEDENCIA documental antes de concatenar/truncar: lo soberano
  // (Aclaraciones/Especiales) va primero y sobrevive al recorte; los planos al final.
  const leidos = docs.filter(d => d.ok)
    // No re-alimentar nuestra PROPIA salida (Excel de costeo / documentos propios) al análisis:
    // es ruido, infla el prompt y puede sesgar al modelo. El análisis se hace SOLO sobre las bases.
    .filter(d => (d.categoria || '').toUpperCase() !== 'DOCUMENTOS_PROPIOS' && !/^COSTEO_/i.test(d.nombre))
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

${senalModalidad ? `\n${senalModalidad}\n` : ''}
DOCUMENTOS DE LA LICITACIÓN (texto completo; los escaneados ya fueron leídos por visión).
IMPORTANTE: cada página viene marcada con [[PÁGINA N]] — usa ESE número para citar la página de cada dato.
${docsTexto || '(no se pudo extraer texto de los documentos)'}

Analiza TODO lo anterior y devuelve EXACTAMENTE este JSON canónico (PROMPT 2 v2.1; cita FUENTE con documento + artículo + PÁGINA en cada punto; no inventes):
{
  "meta": { "id": "${codigo}", "nombre": "", "organismo": "", "region": "", "linea_negocio": "ferreteria|equipamiento|mixto" },
  "exclusion": { "excluido": false, "categoria": "servicio|aseo_servicio|consultoria|asesoria|capacitacion_pura|obra_civil|construccion|mejoramiento_ambiguo|convenio_suministro|convenio_rm|commodity|insumo_consumible|null", "motivo": "", "fuente": "", "confianza": 0.0, "destino": "OK|NO_REALIZAMOS|REVISION_HUMANA" },
  "presupuesto": { "bruto": null, "neto": null, "con_iva": true, "regimen_fora": false, "presupuesto_exento": false, "es_excluyente": false, "fuente": "doc+art+pág", "gate": "OK|NO_CALIFICA|DESCARTE_CONDICIONAL|INCIERTO" },
  "modalidad": { "tipo": "suma_alzada|por_linea", "estado": "DETERMINADA|REVISION_HUMANA", "fuente": "doc+art+PÁGINA", "evidencia": "frase exacta de las bases", "confianza": 0.0, "libertad_de_pricing": false, "como_se_adjudica": "GLOBAL|POR_LINEAS|POR_LOTES", "heterogeneidad": "alta|baja|na", "cotizar_100_obligatorio": false, "evaluacion_puntaje": "al_total|por_linea" },
  "criterios_evaluacion": {
    "fuente_datos": "bases|api|mixto|incompleto",
    "forma_aplicacion_completa": true,
    "suma_ponderaciones_real": 100,
    "suma_valida": true,
    "criterios": [ { "nombre": "Precio", "ponderacion": 0, "abierto_o_topado": "abierto|topado", "forma_aplicacion": "fórmula/tramos/qué acredita cada puntaje", "medio_verificacion": "", "fuente": "doc+art+pág", "subfactores": [ { "nombre": "", "ponderacion_efectiva": 0, "abierto_o_topado": "abierto|topado", "forma_aplicacion": "", "medio_verificacion": "", "fuente": "" } ] } ],
    "alertas": []
  },
  "capa_a": {
    "presupuesto": { "pts": 0, "fuente": "", "justificacion": "por qué ese puntaje en 1 frase (el valor real y el tramo)" },
    "cantidad_items": { "pts": 0, "n_items": 0, "fuente": "", "condicion_complejidad": "commodity|especializado", "justificacion": "por qué ese puntaje en 1 frase (nº ítems y si penaliza)" },
    "complejidad": { "pts": 0, "fuente": "", "justificacion": "por qué ese puntaje en 1 frase (qué producto y nivel)" },
    "ejecucion": { "pts": 0, "fuente": "", "justificacion": "por qué ese puntaje en 1 frase (qué barrera de ejecución)" },
    "modificadores": { "bonus_cantidad_presupuesto": 0, "bonus_importabilidad_provisional": 0, "modificador_adjudicacion": 0 },
    "score_total": 0,
    "nivel": "MUY_VIABLE|VIABLE|POCO_VIABLE|DESCARTE"
  },
  "capa_b_palancas": [ { "palanca": "precio|plazo|garantia|geografia|completitud|densidad", "estado": "VENTAJA|NEUTRO|DESVENTAJA", "jugada": "jugada accionable en 1 línea (cómo explotarla o vía de solución)", "condicion": "por qué es ventaja/neutro/desventaja", "fuente": "" } ],
  "donde_se_decide": { "todos_secundarios_topados": false, "se_decide_en": "precio|criterios_abiertos|mixto", "tenemos_ventaja_costo": "si|no|na", "via": "importable|producto_propio|ninguna", "criterios_abiertos_diferenciadores": [], "mensaje": "dónde se gana realmente el proyecto, en 1-2 frases" },
  "capa_c_admisibilidad": {
    "presupuesto_excluyente": { "aplica": false, "efecto": "EN_CONTRA|NEUTRO", "fuente": "" },
    "cotizar_100_obligatorio": { "aplica": false, "efecto": "EN_CONTRA|NEUTRO", "fuente": "" },
    "bloqueantes": [ { "item": "", "efecto": "EN_CONTRA", "fuente": "" } ],
    "barreras_a_favor": [ { "item": "", "fuente": "" } ],
    "boleta_aplica": false,
    "umbral_utm": 1000,
    "firma_puno_y_letra": false,
    "alertas": []
  },
  "documentos_infaltables": [ { "exige": "requisito-entregable literal", "fuente": "doc+art+pág", "tipo": "admisibilidad_dura|puntaje_condicionante|compromiso_ejecucion", "cubre": "qué documento lo satisface", "responsable": "fase4|operador|partner_externo" } ],
  "multas": { "estructura": "", "costo_por_dia": "", "costo_maximo": "", "umbral_termino": "", "fuente": "" },
  "linea_tiempo": {
    "hitos": [ { "hito": "", "duracion_dias": 0, "tipo_dias": "habiles|corridos", "base_computo": "emision_oc|aceptacion_oc|firma_contrato", "fuente": "", "inferido": false } ],
    "frontera_inicio_computo": { "descripcion": "desde cuándo arranca el plazo de entrega", "base_computo": "emision_oc|aceptacion_oc|firma_contrato|decreto_aprobacion", "fuente": "" },
    "caso_cadena": "garantia_contrato|solo_garantia|solo_contrato|oc_directa",
    "plazo_ofertable_puntaje": "",
    "plazo_operativo_real_dias_habiles": 0,
    "colchon_dias_habiles": 0,
    "colchon_dias_corridos": 0,
    "ventana_importacion": false,
    "alertas": []
  },
  "pendientes_fase3": ["importabilidad_real","densidad_de_oferta","margen"],
  "veredicto": { "nivel": "MUY_VIABLE|VIABLE|POCO_VIABLE|DESCARTE", "gana_probable": "si|no|condicional", "estado_veredicto": "DEFINITIVO|REVISION_HUMANA", "motivos_revision": [], "acciones_AC": [], "advertencias": [] },
  "manifiesto_productos": [ { "linea": 1, "categoria": "nombre del rubro/categoría si la planilla los agrupa (FERRETERIA/PINTURA…), si no null", "descripcion": "descripción técnica EXACTA de las bases", "modelo": "", "cantidad": null, "unidad_medida": "", "unidad_inferida": false, "presupuesto_linea": null, "tipo": "generico|especifico", "ruta": "A|B" } ],
  "lineas_a_atacar": [ { "linea": 1, "decision": "atacar|soltar", "motivo": "por qué (solo si modalidad por_linea/POR_LINEAS de mini-proyectos)" } ]
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
  const donde = _obj(p.donde_se_decide);
  const subA = (o: any) => ({ pts: _num(_obj(o).pts) ?? 0, fuente: _str(_obj(o).fuente), justificacion: _str(_obj(o).justificacion) });

  // Normaliza "cómo se adjudica" a GLOBAL | POR_LINEAS | POR_LOTES (acepta variantes del modelo).
  const normAdjudica = (v: string, tipo: string): string => {
    const s = v.toUpperCase().replace(/[\s-]+/g, '_');
    if (s.includes('GLOBAL')) return 'GLOBAL';
    if (s.includes('LOTE')) return 'POR_LOTES';
    if (s.includes('LINEA') || s.includes('LÍNEA')) return 'POR_LINEAS';
    // Sin dato explícito: deriva del eje "cómo se cotiza" (suma_alzada → GLOBAL; por_linea → POR_LINEAS).
    return tipo === 'suma_alzada' ? 'GLOBAL' : 'POR_LINEAS';
  };

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
    modalidad: (() => {
      const tipo = _str(modalidad.tipo) || 'por_linea';
      return {
        tipo, estado: _str(modalidad.estado) || 'REVISION_HUMANA',
        fuente: _str(modalidad.fuente), evidencia: _str(modalidad.evidencia),
        confianza: _num(modalidad.confianza) ?? 0, libertad_de_pricing: _bool(modalidad.libertad_de_pricing),
        como_se_adjudica: normAdjudica(_str(modalidad.como_se_adjudica), tipo),
        heterogeneidad: _str(modalidad.heterogeneidad) || 'na',
        cotizar_100_obligatorio: _bool(modalidad.cotizar_100_obligatorio),
        evaluacion_puntaje: _str(modalidad.evaluacion_puntaje) || (tipo === 'por_linea' ? 'por_linea' : 'al_total'),
      };
    })(),
    criterios_evaluacion: (() => {
      const criterios = _arr<any>(crit.criterios).map(c => {
        const co = _obj(c);
        return {
          nombre: _str(co.nombre), ponderacion: _num(co.ponderacion) ?? 0,
          abierto_o_topado: _str(co.abierto_o_topado),
          forma_aplicacion: _str(co.forma_aplicacion), medio_verificacion: _str(co.medio_verificacion), fuente: _str(co.fuente),
          subfactores: _arr<any>(co.subfactores).map(s => ({
            nombre: _str(_obj(s).nombre), ponderacion_efectiva: _num(_obj(s).ponderacion_efectiva) ?? 0,
            abierto_o_topado: _str(_obj(s).abierto_o_topado), forma_aplicacion: _str(_obj(s).forma_aplicacion),
            medio_verificacion: _str(_obj(s).medio_verificacion), fuente: _str(_obj(s).fuente),
          })),
        };
      });
      // Suma de ponderaciones REALES: si el modelo la reporta, se usa; si no, se calcula.
      const sumaModelo = _num(crit.suma_ponderaciones_real);
      const sumaCalc = criterios.reduce((s, c) => s + (c.ponderacion || 0), 0);
      const suma = sumaModelo != null && sumaModelo > 0 ? sumaModelo : sumaCalc;
      const sumaValida = crit.suma_valida != null ? _bool(crit.suma_valida) : (criterios.length === 0 || Math.abs(suma - 100) <= 1);
      return {
        fuente_datos: _str(crit.fuente_datos) || 'incompleto',
        forma_aplicacion_completa: _bool(crit.forma_aplicacion_completa),
        suma_ponderaciones_real: Math.round(suma),
        suma_valida: sumaValida,
        criterios,
        alertas: _arr<any>(crit.alertas).map(_str),
      };
    })(),
    capa_a: {
      presupuesto: subA(capaA.presupuesto),
      cantidad_items: { pts: _num(_obj(capaA.cantidad_items).pts) ?? 0, n_items: _num(_obj(capaA.cantidad_items).n_items) ?? 0, fuente: _str(_obj(capaA.cantidad_items).fuente), condicion_complejidad: _str(_obj(capaA.cantidad_items).condicion_complejidad), justificacion: _str(_obj(capaA.cantidad_items).justificacion) },
      complejidad: subA(capaA.complejidad),
      ejecucion: subA(capaA.ejecucion),
      modificadores: { bonus_cantidad_presupuesto: _num(_obj(capaA.modificadores).bonus_cantidad_presupuesto) ?? 0, bonus_importabilidad_provisional: _num(_obj(capaA.modificadores).bonus_importabilidad_provisional) ?? 0, modificador_adjudicacion: _num(_obj(capaA.modificadores).modificador_adjudicacion) ?? 0 },
      score_total: _num(capaA.score_total) ?? 0, nivel: _str(capaA.nivel),
    },
    capa_b_palancas: _arr<any>(p.capa_b_palancas).map(b => ({ palanca: _str(_obj(b).palanca), estado: _str(_obj(b).estado), jugada: _str(_obj(b).jugada), condicion: _str(_obj(b).condicion), fuente: _str(_obj(b).fuente) })),
    donde_se_decide: {
      todos_secundarios_topados: _bool(donde.todos_secundarios_topados),
      se_decide_en: _str(donde.se_decide_en),
      tenemos_ventaja_costo: _str(donde.tenemos_ventaja_costo),
      via: _str(donde.via),
      criterios_abiertos_diferenciadores: _arr<any>(donde.criterios_abiertos_diferenciadores).map(_str),
      mensaje: _str(donde.mensaje),
    },
    capa_c_admisibilidad: {
      presupuesto_excluyente: { aplica: _bool(_obj(capaC.presupuesto_excluyente).aplica), efecto: _str(_obj(capaC.presupuesto_excluyente).efecto) || 'NEUTRO', fuente: _str(_obj(capaC.presupuesto_excluyente).fuente) },
      cotizar_100_obligatorio: { aplica: _bool(_obj(capaC.cotizar_100_obligatorio).aplica), efecto: _str(_obj(capaC.cotizar_100_obligatorio).efecto) || 'NEUTRO', fuente: _str(_obj(capaC.cotizar_100_obligatorio).fuente) },
      bloqueantes: _arr<any>(capaC.bloqueantes).map(x => ({ item: _str(_obj(x).item), efecto: _str(_obj(x).efecto), fuente: _str(_obj(x).fuente) })),
      barreras_a_favor: _arr<any>(capaC.barreras_a_favor).map(x => ({ item: _str(_obj(x).item), fuente: _str(_obj(x).fuente) })),
      boleta_aplica: _bool(capaC.boleta_aplica), umbral_utm: _num(capaC.umbral_utm) ?? 1000,
      firma_puno_y_letra: _bool(capaC.firma_puno_y_letra), alertas: _arr<any>(capaC.alertas).map(_str),
    },
    documentos_infaltables: _arr<any>(p.documentos_infaltables).map(d => ({ exige: _str(_obj(d).exige), fuente: _str(_obj(d).fuente), tipo: _str(_obj(d).tipo), cubre: _str(_obj(d).cubre), responsable: _str(_obj(d).responsable) })).filter(d => d.exige),
    multas: { estructura: _str(multas.estructura), costo_por_dia: _str(multas.costo_por_dia), costo_maximo: _str(multas.costo_maximo), umbral_termino: _str(multas.umbral_termino), fuente: _str(multas.fuente) },
    linea_tiempo: (() => {
      const frontera = _obj(lt.frontera_inicio_computo);
      const colchonHab = _num(lt.colchon_dias_habiles);
      // Colchón en días corridos: si el modelo lo reporta, se usa; si no, se convierte (7/5,
      // truncado hacia abajo) desde los hábiles para que el número mostrado sea alcanzable.
      const colchonCorr = _num(lt.colchon_dias_corridos) ?? (colchonHab != null ? Math.floor(colchonHab * 7 / 5) : null);
      return {
        hitos: _arr<any>(lt.hitos).map(h => ({ hito: _str(_obj(h).hito), duracion_dias: _num(_obj(h).duracion_dias), tipo_dias: _str(_obj(h).tipo_dias) || 'habiles', base_computo: _str(_obj(h).base_computo), fuente: _str(_obj(h).fuente), inferido: _bool(_obj(h).inferido) })),
        frontera_inicio_computo: { descripcion: _str(frontera.descripcion), base_computo: _str(frontera.base_computo), fuente: _str(frontera.fuente) },
        caso_cadena: _str(lt.caso_cadena),
        plazo_ofertable_puntaje: _str(lt.plazo_ofertable_puntaje),
        plazo_operativo_real_dias_habiles: _num(lt.plazo_operativo_real_dias_habiles),
        colchon_dias_habiles: colchonHab,
        colchon_dias_corridos: colchonCorr,
        ventana_importacion: lt.ventana_importacion != null ? _bool(lt.ventana_importacion) : (colchonCorr != null && colchonCorr > 10),
        alertas: _arr<any>(lt.alertas).map(_str),
      };
    })(),
    manifiesto_productos: _arr<any>(p.manifiesto_productos).map((m, i) => ({ linea: _num(_obj(m).linea) ?? i + 1, categoria: _obj(m).categoria ? _str(_obj(m).categoria) : null, descripcion: _str(_obj(m).descripcion), modelo: _str(_obj(m).modelo), cantidad: _num(_obj(m).cantidad), unidad_medida: _str(_obj(m).unidad_medida), unidad_inferida: _bool(_obj(m).unidad_inferida), presupuesto_linea: _num(_obj(m).presupuesto_linea), tipo: _str(_obj(m).tipo), ruta: _str(_obj(m).ruta) })),
    lineas_a_atacar: _arr<any>(p.lineas_a_atacar).map((l, i) => ({ linea: _num(_obj(l).linea) ?? i + 1, decision: _str(_obj(l).decision), motivo: _str(_obj(l).motivo) })).filter(l => l.decision),
    pendientes_fase3: _arr<any>(p.pendientes_fase3).map(_str),
    veredicto: { nivel: _str(veredicto.nivel), gana_probable: _str(veredicto.gana_probable), estado_veredicto: _str(veredicto.estado_veredicto) || 'DEFINITIVO', motivos_revision: _arr<any>(veredicto.motivos_revision).map(_str), acciones_AC: _arr<any>(veredicto.acciones_AC).map(_str), advertencias: _arr<any>(veredicto.advertencias).map(_str) },
  };
}

// ─── Función principal ───────────────────────────────────────────────────────────
export async function analizarViabilidadIA(codigo: string): Promise<ViabilidadIAResult | null> {
  const tDocs = Date.now();
  const docs = await cargarDocumentos(codigo);
  if (docs.length === 0) return null;
  const leidos = docs.filter(d => d.ok);
  if (leidos.length === 0) return null;
  const charsTotal = leidos.reduce((s, d) => s + (d.texto?.length ?? 0), 0);
  console.log(
    `[viabilidad-ia] 📄 ${codigo}: ${docs.length} docs (${leidos.length} legibles, ${charsTotal.toLocaleString('es-CL')} chars ≈ ${Math.round(charsTotal / 4).toLocaleString('es-CL')} tok) cargados en ${((Date.now() - tDocs) / 1000).toFixed(1)}s`,
  );

  const ctx = await cargarContexto(codigo);
  const reglas = await cargarReglasAprendidas();   // feedback loop: lecciones del experto
  const systemPrompt = construirSystemPrompt(reglas);

  // PARSER DETERMINISTA de la planilla ANTES del LLM: nos da (1) el listado COMPLETO de ítems
  // con su línea real y (2) una SEÑAL de modalidad por estructura, que inyectamos al prompt
  // para que el modelo débil no confunda "adjudicación por línea" (a quién) con "cómo se cotiza".
  let planilla: ReturnType<typeof parsearPlanillaCosteo> = null;
  try {
    const fuentes = leidos.filter(d =>
      (d.categoria || '').toUpperCase() !== 'DOCUMENTOS_PROPIOS' && !/^COSTEO_/i.test(d.nombre));
    planilla = parsearPlanillaCosteo(fuentes.map(d => ({ nombre: d.nombre, categoria: d.categoria, texto: d.texto, metodo: d.metodo })));
  } catch { /* sin planilla → el modelo decide solo */ }

  let lineasForm: number[] = [];
  let totalUnico = false;
  let lenguajePorLinea: string | null = null;
  try {
    lineasForm = detectarLineasFormulario(leidos);
    totalUnico = detectarOfertaTotalUnico(leidos);
    lenguajePorLinea = detectarLenguajePorLinea(leidos);
  } catch { /* señal opcional */ }
  const senal = construirSenalModalidad(planilla, lineasForm, totalUnico, lenguajePorLinea);
  const userPrompt = construirUserPrompt(codigo, ctx, docs, senal);
  if (VIAB_DEBUG) {
    dbg(`${codigo}: prompt SYSTEM=${systemPrompt.length} chars · USER=${userPrompt.length} chars · monto portada=${ctx.meta.monto ?? 'reservado'} · señal=${senal ? senal.slice(0, 80) + '…' : '(ninguna)'}`);
    dbg(`${codigo}: planilla determinista → ${planilla ? `${planilla.items.length} ítems (${planilla.estructura}, ${planilla.lineas.length} línea(s), fuente "${planilla.fuenteDoc}")` : 'NO detectada'}`);
    await volcarDebug(codigo, 'prompt.txt', `===== SYSTEM =====\n${systemPrompt}\n\n===== USER =====\n${userPrompt}`);
  }
  const parsed = await llamarGeminiJSON(systemPrompt, userPrompt);
  await volcarDebug(codigo, 'raw.json', JSON.stringify(parsed, null, 2));
  const saneado = sanitizar(parsed);

  // CORRECCIÓN DE PRESUPUESTO. Los LLM se equivocan de MAGNITUD en montos grandes (le comen
  // un dígito: neto $16.304.620 → $1.630.462), lo que envenena el display, el gate y el
  // score (e incluso el veredicto del modelo). Dos redes:
  //  (a) PORTADA (API MP = autoridad): si trae monto y el del modelo se desvía ≥2x, manda la
  //      portada → bruto=portada, neto=÷1,19 (o =bruto si exento).
  //  (b) SIN portada: cross-check interno bruto↔neto. neto debe ser ~ bruto/1,19 (o =bruto si
  //      exento); si no, confiamos en el BRUTO (cifra titular publicada) y recomputamos neto.
  {
    const p = saneado.presupuesto;
    const exento = p.presupuesto_exento || p.regimen_fora;
    const netoDe = (b: number) => (exento ? b : Math.round(b / 1.19));
    const desviado = (v: number | null, esp: number) => v == null || v <= 0 || v / esp < 0.5 || v / esp > 2;
    const portada = ctx.meta.monto && Number(ctx.meta.monto) > 0 ? Number(ctx.meta.monto) : null;
    if (portada) {
      const netoEsp = netoDe(portada);
      if (desviado(p.bruto, portada) || desviado(p.neto, netoEsp)) {
        dbg(`${codigo}: presupuesto modelo (bruto=${p.bruto} neto=${p.neto}) NO cuadra con portada $${portada.toLocaleString('es-CL')} → CORRIGIENDO (bruto=portada, neto=${netoEsp})`);
        p.bruto = portada; p.neto = netoEsp;
        p.fuente = `${p.fuente || ''} [monto ajustado con portada MP]`.trim();
      }
    } else if (p.bruto && p.bruto > 0) {
      const netoEsp = netoDe(p.bruto);
      if (desviado(p.neto, netoEsp)) {
        dbg(`${codigo}: neto=${p.neto} inconsistente con bruto=${p.bruto.toLocaleString('es-CL')} (esperado ~${netoEsp.toLocaleString('es-CL')}) → RECOMPUTO neto del bruto`);
        p.neto = netoEsp;
        p.fuente = `${p.fuente || ''} [neto recomputado del bruto]`.trim();
      }
    }
  }
  if (VIAB_DEBUG) {
    const p = saneado.presupuesto, v = saneado.veredicto, ex = saneado.exclusion;
    dbg(`${codigo}: PRESUPUESTO bruto=${p.bruto ?? '—'} neto=${p.neto ?? '—'} gate=${p.gate} fuente="${(p.fuente || '').slice(0, 60)}"`);
    dbg(`${codigo}: EXCLUSIÓN excluido=${ex.excluido} (conf ${ex.confianza}) · VEREDICTO nivel=${v.nivel} gana=${v.gana_probable} estado=${v.estado_veredicto}`);
    dbg(`${codigo}: CAPA A score_total=${saneado.capa_a?.score_total}/15 · MODALIDAD ${saneado.modalidad?.tipo} (conf ${saneado.modalidad?.confianza})`);
  }

  // 'por_categoria' se activa SOLO si el parser detecta rubros de producto reales (A/B/C).
  let estructuraCosteo: 'por_categoria' | null = null;

  // MANIFIESTO desde la PLANILLA: enumera TODAS las filas con DESCRIPCIÓN completa, unidad,
  // cantidad, NÚMERO DE LÍNEA y CATEGORÍA reales. Si el parser trae ≥ ítems que la IA, su
  // manifiesto MANDA (más completo y fiel; línea/categoría son la semilla del costeo).
  if (planilla && planilla.items.length >= saneado.manifiesto_productos.length && planilla.items.length >= 8) {
    saneado.manifiesto_productos = planilla.items.map(it => ({
      linea: it.linea || 1,
      categoria: it.categoria,
      descripcion: it.descripcion,
      modelo: '',
      cantidad: it.cantidad,
      unidad_medida: it.unidad,
      unidad_inferida: !it.unidad,
      presupuesto_linea: null,
      tipo: 'generico',
      ruta: '',
    }));
    // Solo el parser (rubros A/B/C reales) habilita el costeo por pestañas de categoría.
    if (planilla.estructura === 'por_categoria') estructuraCosteo = 'por_categoria';
    console.log(`[viabilidad-ia] ${codigo}: manifiesto desde planilla "${planilla.fuenteDoc}" — ${planilla.items.length} ítems (${planilla.estructura}, ${planilla.lineas.length} línea(s)).`);
  }

  // El PROMPT 2 v2.0 NO emite score 0-100 ni semáforo: trabaja con la Capa A (0-15) y
  // gates. Los DERIVAMOS aquí para alimentar el radar/negocios (columnas score_total,
  // semaforo, area_negocio) sin cambiar el contrato del prompt.
  const { score, semaforo, area, confianza } = derivarSemaforo(saneado);
  if (VIAB_DEBUG) {
    const p = saneado.presupuesto, v = saneado.veredicto;
    const gateDet = gatePresupuestoDeterminista(p.bruto, p.neto, (saneado.manifiesto_productos || []).length);
    const gateEf = gateDet ?? p.gate;
    const gateDuro = saneado.exclusion.excluido || gateEf === 'NO_CALIFICA' || (v.nivel || '').toUpperCase() === 'DESCARTE';
    const gateSuave = gateEf === 'DESCARTE_CONDICIONAL' || (v.gana_probable || '').toLowerCase() === 'no';
    const base = Math.round((saneado.capa_a.score_total / 15) * 100);
    dbg(`${codigo}: GATE modelo=${p.gate} → determinista=${gateDet ?? '(respeta modelo)'} → efectivo=${gateEf}`);
    dbg(`${codigo}: SCORE base(capaA)=${base} → ${gateDuro ? 'GATE DURO ≤19' : gateSuave ? 'gate suave ≤39' : 'sin gate'} → FINAL=${score} (${semaforo})`);
    const mSrc = (planilla && planilla.items.length >= saneado.manifiesto_productos.length && planilla.items.length >= 8) ? `PLANILLA "${planilla.fuenteDoc}"` : 'MODELO (GLM)';
    dbg(`${codigo}: MANIFIESTO ${saneado.manifiesto_productos.length} ítems, fuente=${mSrc}. Primeras líneas:`);
    for (const m of saneado.manifiesto_productos.slice(0, 12)) {
      dbg(`   línea ${String(m.linea).padStart(3)} · ${(m.categoria || '—').padEnd(14)} · cant ${m.cantidad ?? '—'} ${m.unidad_medida || ''} · ${String(m.descripcion || '').slice(0, 70)}`);
    }
  }

  const result: ViabilidadIAResult = {
    ...saneado,
    score_0_100: score,
    semaforo,
    area_negocio: area,
    confianza_global: confianza,
    documentos_leidos: leidos.map(d => d.nombre),
    documentos_no_leidos: docs.filter(d => !d.ok).map(d => `${d.nombre} (${d.metodo})`),
    docs_hash: await calcularDocsHash(codigo),
    estructura_costeo: estructuraCosteo,
  };
  return result;
}

// Recalcula el gate de presupuesto con la regla de las bases (PROMPT 2, PASO 0.B). El piso
// se aplica SOBRE EL NETO: "Normaliza a neto (÷1,19) … < $8.000.000 → NO_CALIFICA". Por eso
// usamos NETO preferente; si el modelo solo trajo bruto (con IVA), derivamos el neto (÷1,19),
// salvo régimen exento/FORA donde neto = bruto. Devuelve null cuando no hay monto fiable → el
// llamador respeta el gate del modelo. El "salvo ≤5 especializados" no es computable aquí, así
// que solo aplicamos el "salvo <15 productos".
function gatePresupuestoDeterminista(bruto: number | null, neto: number | null, nProductos: number, exento = false): string | null {
  const montoNeto = (neto && neto > 0)
    ? neto
    : (bruto && bruto > 0) ? Math.round(exento ? bruto : bruto / 1.19) : null;
  if (montoNeto == null) return null;              // reservado/desconocido → respetar el modelo
  if (montoNeto < 8_000_000) return 'NO_CALIFICA';
  if (montoNeto <= 15_000_000) {
    if (nProductos > 0 && nProductos < 15) return 'OK'; // pocos productos: no lo condicionamos
    return 'DESCARTE_CONDICIONAL';
  }
  return 'OK';
}

// Deriva score 0-100, semáforo, área y confianza a partir del informe v2.0.
// Capa A (0-15) define la base; los gates (exclusión, presupuesto, bloqueantes,
// veredicto DESCARTE) la fuerzan a la baja. Mantiene los umbrales de semáforo del radar.
function derivarSemaforo(r: ViabilidadIACore): { score: number; semaforo: string; area: string; confianza: number } {
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  let score = clamp((r.capa_a.score_total / 15) * 100);

  // El score base es el ATRACTIVO (Capa A). Solo lo craterean los gates REALES de no-licitar:
  // exclusión por naturaleza, presupuesto que NO califica, o el veredicto DESCARTE del modelo
  // (que ya integra los bloqueantes GENUINOS, ver PASO 6 del prompt). Ya NO usamos la sola
  // presencia de "bloqueantes[]": el modelo los sobre-clasifica (garantía de fiel cumplimiento,
  // programa de integridad, anexos estándar, puntaje mínimo, carpeta tributaria... cosas que SÍ
  // cumplimos), lo que hundía casi todas las licitaciones a 19 aunque el veredicto fuera GANA.
  // GATE DE PRESUPUESTO DETERMINISTA: no confiamos en el `gate` del modelo (se equivoca:
  // aquí puso OK con neto $8M y 21 productos, cuando la regla lo hace DESCARTE_CONDICIONAL).
  // Cuando hay monto conocido, lo recalculamos en código con la regla de las bases:
  //   <$8M = NO_CALIFICA · $8-15M = DESCARTE_CONDICIONAL (salvo <15 productos) · >$15M = OK.
  // Si no hay monto (reservado), respetamos el gate del modelo (INCIERTO no bota por falta de dato).
  const gateEfectivo = gatePresupuestoDeterminista(
    r.presupuesto.bruto, r.presupuesto.neto, (r.manifiesto_productos || []).length,
  ) ?? r.presupuesto.gate;

  const ganaNo = (r.veredicto.gana_probable || '').toLowerCase() === 'no';
  const gateDuro =
    r.exclusion.excluido ||
    gateEfectivo === 'NO_CALIFICA' ||
    (r.veredicto.nivel || '').toUpperCase() === 'DESCARTE';

  if (gateDuro) score = Math.min(score, 19);
  else if (gateEfectivo === 'DESCARTE_CONDICIONAL' || ganaNo) score = Math.min(score, 39);

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
  console.log(`[costeo] ${codigo}: generando Excel (${datosCosteo.modalidad}, ${datosCosteo.grupos.length} hoja(s))…`);
  const buffer = await generarCosteoExcel(datosCosteo);
  console.log(`[costeo] ${codigo}: buffer ${buffer.length} bytes — subiendo a R2…`);

  const fecha = new Date().toISOString().slice(0, 10);
  const nombreArchivo = `COSTEO_${codigo}_${fecha}.xlsx`;
  const url = await subirDocumentoR2(codigo, nombreArchivo, buffer,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  console.log(`[costeo] ${codigo}: R2 OK → ${url}`);

  const totalItems = datosCosteo.grupos.reduce((s, g) => s + g.items.length, 0);

  // Inserción defensiva: descubre qué columnas opcionales existen antes de insertar.
  // Evita que columnas agregadas por migraciones pendientes (categoria, content_type,
  // usuario_id) rompan el flujo si aún no se aplicaron en la BD live.
  let colsExtra = '';
  let valsExtra = '';
  let updateExtra = '';
  const params: any[] = [codigo, nombreArchivo, url, buffer.length];

  try {
    const [cols] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'documentos_cache'
       AND COLUMN_NAME IN ('categoria','content_type')`,
    ) as any[];
    const existentes = new Set((cols as any[]).map((c: any) => c.COLUMN_NAME));

    if (existentes.has('content_type')) {
      colsExtra  += ', content_type';
      valsExtra  += ', ?';
      updateExtra += ', content_type = VALUES(content_type)';
      params.push('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    }
    if (existentes.has('categoria')) {
      colsExtra  += ', categoria';
      valsExtra  += ", 'DOCUMENTOS_PROPIOS'";
      updateExtra += ", categoria = 'DOCUMENTOS_PROPIOS'";
    }
  } catch { /* si falla la introspección, continúa sin columnas extra */ }

  await pool.query(
    `INSERT INTO documentos_cache
       (licitacion_codigo, documento_nombre, documento_url_local, size_bytes${colsExtra})
     VALUES (?, ?, ?, ?${valsExtra})
     ON DUPLICATE KEY UPDATE
       documento_url_local = VALUES(documento_url_local),
       size_bytes          = VALUES(size_bytes)${updateExtra},
       updated_at          = CURRENT_TIMESTAMP`,
    params,
  );

  console.log(`[costeo] ✅ ${codigo}: Excel guardado (${datosCosteo.modalidad}, ${datosCosteo.grupos.length} hoja(s), ${totalItems} ítems)`);
}

// Vuelca el manifiesto de productos (lo que la IA encontró en la documentación) a
// analisis_ia_licitacion.especificaciones_tecnicas, que es lo que la ficha del NEGOCIO
// ya muestra en "Ítems y cantidades". Así, al asignar la licitación a negocio, salen los
// ítems reales leídos de las bases. Solo sobrescribe si la IA trae MÁS ítems que lo guardado.
async function volcarManifiestoAItems(codigo: string, r: ViabilidadIAResult): Promise<void> {
  const manifiesto = Array.isArray(r.manifiesto_productos) ? r.manifiesto_productos : [];
  if (manifiesto.length === 0) return;

  const especs = manifiesto.map((p, i) => ({
    item: String(i + 1),                 // numeración corrida (varios ítems comparten línea/categoría)
    descripcion: p.descripcion || '',
    cantidad: p.cantidad ?? null,
    unidad: p.unidad_medida || null,
    requisitosMinimos: [
      p.categoria ? `Categoría: ${p.categoria}` : '',
      p.linea ? `Línea ${p.linea}` : '',
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
