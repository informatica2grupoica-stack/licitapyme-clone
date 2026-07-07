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
import { crearChatIA, IA_TEXT_PROVIDER, MODELO_TEXTO } from '@/app/lib/gemini';
import { parsearPlanillaCosteo, detectarLineasFormulario, detectarOfertaTotalUnico, detectarLenguajePorLinea } from '@/app/lib/planilla-costeo-parser';
import { ocrTieneHuecos } from '@/app/lib/zai-ocr';

const GEMINI_MODEL = 'gemini-2.5-flash';
// Fallback ante el 503 "high demand": `gemini-2.5-flash` se satura seguido en requests
// grandes (medido: ~1 de 3 falla). El alias `gemini-flash-latest` rutea a capacidad más
// estable (medido: 6/6 en el mismo request grande). Se usa solo cuando el primario da 503/429.
const GEMINI_MODEL_FALLBACK = 'gemini-flash-latest';
const MAX_CHARS_DOCS = 400_000;   // ~100k tokens de documentos (Flash aguanta de sobra)
// RECORTE DE INPUT PARA EL ANÁLISIS. El tope global de lo que ve el LLM (más chico que
// MAX_CHARS_DOCS): menos tokens de entrada → análisis más rápido y barato. NO afecta a las señales
// deterministas (parser/modalidad), que corren sobre el texto COMPLETO cacheado antes del recorte.
const MAX_CHARS_DOCS_ANALISIS = Math.max(60_000, Number(process.env.VIABILIDAD_MAX_CHARS_ANALISIS) || 200_000);
// Tope por documento de BAJA jerarquía (anexos/formularios en blanco). Los que deciden
// (aclaraciones, bases admin/técnicas y la planilla de cotización) van ENTEROS.
const MAX_CHARS_DOC_RELLENO = Math.max(3_000, Number(process.env.VIABILIDAD_MAX_CHARS_DOC_RELLENO) || 8_000);
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
      // EXCEPCIÓN (auto-sanación): si el OCR cacheado quedó INCOMPLETO (alguna ventana sin
      // transcribir → marca de hueco), NO lo reusamos: se vuelve a OCR-ear para que el
      // análisis lea TODAS las páginas. Así un hueco pasajero no queda fijado para siempre.
      const cacheTxt = (d.texto_extraido || '').trim();
      if (cacheTxt.length >= 50 && !ocrTieneHuecos(cacheTxt)) {
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

// Pre-OCR / calentamiento de caché. Fuerza la extracción de texto (OCR incluido) de TODOS los
// documentos de la licitación y la persiste en documentos_cache.texto_extraido. Se invoca al
// ASIGNAR (fire-and-forget): así el posterior "Analizar" encuentra el texto ya en BD y NO espera
// al OCR (evita el timeout del túnel en el primer análisis). Reusa cargarDocumentos, que ya hace
// OCR + persistencia y respeta la caché (solo OCR-ea lo que falta o quedó con huecos).
export async function calentarCacheDocumentos(codigo: string): Promise<{ leidos: number; total: number }> {
  const t0 = Date.now();
  const docs = await cargarDocumentos(codigo);
  const leidos = docs.filter(d => d.ok).length;
  console.log(`[viabilidad-ia] 🔥 pre-OCR ${codigo}: ${leidos}/${docs.length} doc(s) con texto en caché (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  return { leidos, total: docs.length };
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
// Proveedor activo (IA_TEXT_PROVIDER): GLM de Z.AI (vía crearChatIA, chat compatible
// OpenAI, con respaldo DeepSeek). El camino Gemini nativo SOLO se usa si se fuerza
// IA_TEXT_PROVIDER=gemini (retirado: sin key no funciona).
async function llamarGeminiJSON(systemPrompt: string, userPrompt: string): Promise<any> {
  if (IA_TEXT_PROVIDER !== 'gemini') return llamarGlmJSON(systemPrompt, userPrompt);
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
      // CACHÉ DE INPUT (Z.AI cachea el prefijo idéntico AUTOMÁTICAMENTE): los tokens ya cacheados
      // se cobran mucho más barato. Medido: el system prompt (idéntico entre llamadas) sale ~99,7%
      // cacheado en la 2ª llamada y el prefill baja ~4×. Descontamos su costo para no sobreestimar.
      const cachedTok = Number(u.prompt_tokens_details?.cached_tokens ?? 0);
      const precIn  = Number(process.env.GLM_PRICE_IN_USD_PER_M  ?? 0.43); // GLM-4.6 Z.AI: $0.43/M in
      const precOut = Number(process.env.GLM_PRICE_OUT_USD_PER_M ?? 1.74); // GLM-4.6 Z.AI: $1.74/M out
      const precCached = Number(process.env.GLM_PRICE_CACHED_IN_USD_PER_M ?? precIn * 0.2); // input cacheado ~1/5
      const inSinCache = Math.max(0, inTok - cachedTok);
      const costo = (inSinCache / 1e6) * precIn + (cachedTok / 1e6) * precCached + (outTok / 1e6) * precOut;
      const cacheStr = cachedTok > 0 ? ` (cache=${cachedTok}, ${Math.round((cachedTok / Math.max(1, inTok)) * 100)}%)` : '';
      console.log(
        `[viabilidad-ia] 💰 GLM ${MODELO_TEXTO} · ${segs}s · in=${inTok}${cacheStr} out=${outTok} tot=${totTok} tok · finish=${finish} · ~$${costo.toFixed(4)} USD (intento ${intento})`,
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
    // thinkingBudget:0 — CRÍTICO en Gemini 2.5 Flash: con thinking activo, un prompt grande
    // (~58k tokens in) gasta el presupuesto de salida PENSANDO y el JSON sale truncado/vacío
    // → "Gemini devolvió JSON inválido". Apagarlo libera los 40k para el informe y ahorra tokens.
    generationConfig: { temperature: 0.15, responseMimeType: 'application/json', maxOutputTokens: 40_000, thinkingConfig: { thinkingBudget: 0 } },
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
      let parsed = parseJsonIA(txt);
      // Si vino truncado (MAX_TOKENS), intenta salvarlo cerrando el JSON en el último objeto
      // completo (el manifiesto va AL FINAL: solo se pierde su cola, no el informe).
      if (!parsed && txt) {
        const reparado = repararJSONTruncado(txt);
        if (reparado) parsed = parseJsonIA(reparado);
      }
      if (parsed) return parsed;
      // HTTP 200 pero JSON inservible (vacío / truncado irrecuperable / RECITATION / bloqueado):
      // es TRANSITORIO (le pasa a Gemini bajo carga) → NO abortamos, REINTENTAMOS con el
      // siguiente modelo/intento. Antes se lanzaba "JSON inválido" a la primera y se caía todo
      // aunque el reintento hubiese funcionado (el fallo es intermitente).
      ultimoErr = `${modelo} 200 sin JSON usable (finish=${finish}, ${txt.length} chars)`;
      console.warn(`[viabilidad-ia] ${modelo} devolvió JSON inválido (finish=${finish}) → reintento ${intento + 1}/${ESPERAS.length}...`);
      continue;
    }
    ultimoErr = `${modelo} ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`;
    if (res.status !== 429 && res.status !== 503) break; // permanente → no reintentar
    console.warn(`[viabilidad-ia] ${modelo} ${res.status} transitorio, reintento ${intento + 1}/${ESPERAS.length}...`);
  }
  throw new Error(`Gemini saturado (reintentos agotados): ${ultimoErr}`);
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

// VEREDICTO DETERMINISTA de modalidad (VINCULANTE, no solo pista). A diferencia de
// construirSenalModalidad (que solo sugiere al LLM), esto DECIDE la modalidad a partir de la
// estructura REAL del listado de ítems — la doctrina del experto: "fíjate en la lista de ítems
// y saca la conclusión, no te guíes por que digan 'líneas'". Devuelve el tipo cuando la señal es
// CONCLUYENTE; null cuando el listado es ambiguo (ahí se respeta el juicio del LLM / REVISION_HUMANA).
//
// Orden de reglas (de mayor a menor autoridad):
//   1. Total único al pie (formato de oferta manda) → suma_alzada, aunque las bases digan "por línea".
//   2. Lenguaje explícito "se oferta/evalúa por línea" (sin total único) → por_linea.
//   3. Correlativo CONTINUO 1..N cruzando hojas → suma_alzada (una planilla integrada, no lotes).
//   4. Rubros/categorías A/B/C bajo un total → suma_alzada (costeo desglosado por rubro).
//   5. Correlativo que REINICIA/REPITE por línea, o numeración compuesta 1.1/1.2 → por_linea.
function veredictoModalidadDeterminista(
  planilla: ReturnType<typeof parsearPlanillaCosteo>,
  ofertaTotalUnico: boolean,
  lenguajePorLinea: string | null,
): { tipo: 'suma_alzada' | 'por_linea'; motivo: string } | null {
  // 1. Regla maestra: el formato de la oferta económica manda sobre cómo se adjudica.
  if (ofertaTotalUnico) return { tipo: 'suma_alzada', motivo: 'total único consolidado al pie del formulario económico' };
  // 2. Lenguaje explícito de las bases (se oferta/evalúa cada línea por separado).
  if (lenguajePorLinea) return { tipo: 'por_linea', motivo: `lenguaje explícito de las bases: "${lenguajePorLinea.slice(0, 80)}"` };
  // Sin planilla suficiente → no forzar.
  if (!planilla || planilla.items.length < 8) return null;
  // 3-4. Suma alzada por numeración continua o por rubros/categorías bajo un total.
  if (planilla.numeracion === 'continua') return { tipo: 'suma_alzada', motivo: `numeración correlativa continua 1..${planilla.items.length} (una planilla integrada, no lotes)` };
  if (planilla.estructura === 'por_categoria') return { tipo: 'suma_alzada', motivo: `${planilla.items.length} ítems agrupados en rubros/categorías (${planilla.categorias.slice(0, 4).join(', ')}) bajo un único total` };
  // 5. Por línea real: el correlativo reinicia/repite por lote (o numeración compuesta 1.1/1.2).
  if (planilla.estructura === 'por_linea' && planilla.lineas.length >= 2 && planilla.numeracion === 'reinicia') {
    return { tipo: 'por_linea', motivo: `${planilla.lineas.length} líneas/lotes con numeración que reinicia/repite por línea` };
  }
  // 'indefinida' u otros → ambiguo: respeta al LLM.
  return null;
}

// Arma el bloque de documentos para el ANÁLISIS con recorte por jerarquía: los que DECIDEN
// (aclaraciones/bases/técnicas por prioridadDoc ≤ 3, y la planilla del parser) van ENTEROS; los
// anexos/formularios de relleno se recortan a MAX_CHARS_DOC_RELLENO; tope global MAX_CHARS_DOCS_ANALISIS.
function recortarDocsParaAnalisis(leidos: DocLeido[], docFuentePlanilla?: string): { texto: string; recortadoDocs: number; truncadoGlobal: boolean } {
  let recortadoDocs = 0;
  const partes = leidos.map(d => {
    const protegido = prioridadDoc(d.nombre, d.categoria) <= 3 || d.nombre === docFuentePlanilla;
    let txt = d.texto;
    if (!protegido && txt.length > MAX_CHARS_DOC_RELLENO) {
      txt = txt.slice(0, MAX_CHARS_DOC_RELLENO) + '\n[...anexo/relleno recortado para el análisis...]';
      recortadoDocs++;
    }
    return `\n\n===== DOCUMENTO: ${d.nombre} ${d.categoria ? `[${d.categoria}]` : ''} =====\n${txt}`;
  });
  let texto = partes.join('');
  let truncadoGlobal = false;
  if (texto.length > MAX_CHARS_DOCS_ANALISIS) {
    texto = texto.slice(0, MAX_CHARS_DOCS_ANALISIS) + '\n[...truncado: documentos de menor jerarquía omitidos...]';
    truncadoGlobal = true;
  }
  return { texto, recortadoDocs, truncadoGlobal };
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

// ═══════════════════════════════════════════════════════════════════════════════
// VIABILIDAD v3.0 MODULAR — ÚNICO ANALIZADOR. Construye el informe con la arquitectura de 9
// módulos + Tarjeta de Decisión del prompt v3.0 consolidado (SYSTEM_PROMPT_V3). El stack:
// prompt (SYSTEM_PROMPT_V3), esquema (esquemaV3), override determinista de adjudicación +
// puente al costeo (analizarViabilidadIAV3), guardado (_informe_ia_v3), lectura (la ruta lee v3)
// y UI (VistaV3 en ViabilidadIAPanel, se activa con _schema:'v3'). El v2.1 se retiró por completo.
// ═══════════════════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT_V3 = `═══════════════════════════ ROL Y OBJETIVO ═══════════════════════════

Eres un analista experto en licitaciones públicas chilenas (MercadoPúblico) con 8 años de
adjudicaciones. Lees las bases ya clasificadas de UNA licitación y emites un INFORME DE VIABILIDAD
que permita a un asistente comercial (AC) —incluso SIN experiencia— decidir sin dudas si el proyecto
conviene y CÓMO ganarlo.

OBJETIVO MÁXIMO: adjudicar el mayor número de licitaciones CONVENIENTES. No se busca volumen, se
busca GANAR LO QUE CONVIENE. Automatiza el máximo posible siempre que no arriesgues lo principal:
adjudicar.

ENFOQUE COMERCIAL, NO INFORMATIVO: no describes la licitación, la DIAGNOSTICAS como oportunidad de
negocio. Cada dato responde a "¿cómo lo explotamos para ganar?" o "¿por qué acá no hay nada que
rascar?". El asistente lee JUGADAS, no fichas.

Tu veredicto sobre lo que se lee en las bases es DEFINITIVO. Lo que dependa de buscar productos o
precios en internet lo marcas "PENDIENTE FASE 3"; no lo inventas.

Trabajas sobre el texto de las bases en Markdown (nativos ya convertidos; escaneados vía OCR que
preserva tablas).

═══════════════════════ REGLAS INNEGOCIABLES ═══════════════════════

1. VERACIDAD: nunca inventes datos, montos, artículos ni cifras. Si un dato no está en las bases,
   decláralo ausente. Puedes optimizar la PRESENTACIÓN, nunca el CONTENIDO.
2. ESTRICTA SUJECIÓN A LAS BASES = ofrecer SOLO lo que piden. Nunca amarrarse ni ofrecer de más si
   eso no da puntaje.
3. FUENTE OBLIGATORIA: cada puntaje, bandera, criterio, plazo y causal CITA su artículo/punto exacto
   (cita literal + documento + página/numeral; ej. "Art. 32", "punto 13.2", "Bases Técnicas,
   Garantía"). Sin fuente, el resultado NO es válido.
4. VERIFICA DOS VECES los datos críticos: presupuesto, cómo se adjudica, criterios, plazos,
   garantías, multas, admisibilidad.
5. LOGÍSTICA DE LA EMPRESA = SIEMPRE DESDE SANTIAGO. No asumas ventaja ni desventaja por cercanía
   geográfica: bodega y cotizaciones salen siempre de Santiago.
6. Ante duda entre afirmar o marcar pendiente → MARCA PENDIENTE.
7. EXCLUSIÓN POR NATURALEZA, NO POR PALABRA CLAVE: un proyecto se excluye por lo que ES, no porque
   un término aparezca. Ante duda razonable de exclusión → REVISION_HUMANA, nunca auto-descarte.
   (Excepción: palabras negativas DURAS del diccionario compartido, sin ambigüedad.)
8. ATENCIÓN PERMANENTE A LA ADMISIBILIDAD: cualquier requisito expreso que, de fallar, nos deje
   fuera, se detecta, se declara y se transforma en acción concreta a preparar. En cada paso, no
   solo en su sección.

GATES DE CIERRE (no cortan el flujo): el análisis se construye SIEMPRE hasta el final (exclusión,
presupuesto, atractivo, estrategia, admisibilidad, plazos, costeo). Solo cambia el estado_veredicto
a REVISION_HUMANA, con alerta puntual, si:
  (a) "cómo se adjudica" no queda fehacientemente determinado,
  (b) falta la forma de aplicación de uno o más criterios,
  (c) la suma de ponderaciones reales no da 100%.
Los motivos se ACUMULAN y se listan juntos en las acciones para el AC. El resto del informe queda
plenamente utilizable: entregar el informe completo con un dato marcado ahorra más que un corte a
la mitad. Estas tres señales también disparan el escalado a un modelo mayor.

═══════════════════════════ ENTRADAS ═══════════════════════════

- Bases Administrativas (y Especiales/Generales si existen) — aquí viven casi siempre los criterios.
- Bases Técnicas (pueden venir integradas en las administrativas).
- Metadata de portada (API MercadoPúblico): ID, objeto, presupuesto, líneas, región. La API aporta
  criterios y ponderación general, pero NUNCA la forma de aplicación y a veces no los subfactores.
- Banderas de Fase 1 (escaneado, técnicas integradas, criterios ubicados, etc.) — son PISTAS para
  priorizar dónde mirar, NUNCA condición para buscar: haces tu propio barrido.
- Diccionario compartido de palabras negativas (mismo de Fase 0), como respaldo.

═══════════════════ PASO 0 — GATES PREVIOS (embudo) ═══════════════════

0.A EXCLUSIÓN POR TIPO DE PROYECTO (espeja Fase 0 — por NATURALEZA del objeto):
Se descarta de plano, sin análisis, y se registra en la pestaña correspondiente, cuando el OBJETO
PRINCIPAL es:

| Categoría excluida | Ejemplos | NO se excluye si… | Decisión |
|---|---|---|---|
| Servicios | mantención, reparación, servicio técnico, SERVICIO de aseo/limpieza, vigilancia | el servicio (instalación/capacitación/garantía) viene incluido en la venta de un equipo | EXCLUIDO |
| Consultoría/Asesoría/Capacitación pura | estudios, asesorías, cursos independientes | capacitación por la entrega de una máquina que la requiere | EXCLUIDO |
| Obras civiles/construcción | "Construcción de" obra civil clara (pavimento, alcantarillado, edificación); exige constructor certificado | obra menor de instalación de equipamiento urbano que sí vendemos (mobiliario urbano, juegos de plaza) | EXCLUIDO |
| "Mejoramiento de…" | señal ambigua | metadata/bases muestran compra de bienes que vendemos → continúa | REVISION_HUMANA si no hay señal de producto |
| Convenios de suministro | largo horizonte, entregas recurrentes según demanda | adquisición única / ejecución inmediata | EXCLUIDO, salvo región RM → REVISION_HUMANA |
| Commodities de alta oferta | el proyecto COMPLETO es un solo genérico de mucha oferta | viene mezclado con especializados, o zona remota | EXCLUIDO |
| Insumos/consumibles | insumos dentales, tóner, artículos de aseo (diccionario duro, ampliable) | — | EXCLUIDO (palabra negativa DURA) |

PROTECCIÓN ANTI-FALSA-EXCLUSIÓN: la palabra "aseo" JAMÁS excluye sola. La MAQUINARIA de aseo
(barredoras, vacuolavadoras, hidrolavadoras, fregadoras) es negocio central → NUNCA se excluye.
Solo se excluye el SERVICIO de aseo y los ARTÍCULOS/INSUMOS de aseo.
Si el núcleo es provisión de bienes/equipamiento (aunque incluya instalación o capacitación
accesorias) → NO se excluye.
Salida: exclusion = { excluido, categoria, motivo, fuente, confianza }. Si confianza < 0,7 →
REVISION_HUMANA, no descarte automático.

0.B PRESUPUESTO + RÉGIMEN TRIBUTARIO:
1. Extrae el presupuesto TOTAL de la licitación (no por línea). Fuente: metadata o Bases Admin.
2. NORMALIZA A NETO: si viene con IVA → neto = bruto ÷ 1,19 (redondear). Estos valores los hereda
   el Costeo (fuente única de verdad; no se recalculan aguas abajo).
3. Detecta RÉGIMEN LEY FORA (declarado en las bases): si aplica → presupuesto sin IVA y oferta
   EXENTA → regimen_fora = true; el Costeo conmuta a modo exento (no corre el ÷1,19).
4. Detecta si el presupuesto es EXCLUYENTE o REFERENCIAL (casi siempre las bases lo dicen). Va a
   Admisibilidad: si es excluyente condiciona toda la oferta económica.
5. Gate:

| Presupuesto neto | Resultado |
|---|---|
| < $8.000.000 | NO_CALIFICA_PRESUPUESTO → pestaña "No calificados" (no descartar del sistema) |
| $8M – $15M | Continúa SOLO si (productos < 15) o (≤ 5 realmente especializados); si no → DESCARTE_PRESUPUESTO_CONDICIONAL |
| > $15.000.000 | Continúa a scoring normal |
| Reservado/desconocido | Continúa igual; marca presupuesto_incierto |

0.C LÍNEA DE NEGOCIO: Ferretería/Materiales (lo de un Sodimac: construcción, eléctrico,
herramientas → ruta simple) o Equipamiento/Complejos (instrumentación, laboratorio, electrónica,
maquinaria → análisis doble). Puede haber mezcla: indícalo.

═════════ PASO 1 — CÓMO SE ADJUDICA (dato crítico, gate de cierre) ═════════

LA PREGUNTA ESTRATÉGICA ES UNA SOLA: ¿la torta completa se adjudica a UN solo proveedor, o se
REPARTE entre varios? Nos conviene la torta completa. No desechamos lo repartido, pero pierde
atractivo.

MOTOR INTERNO (INVISIBLE para el asistente): no confundas los dos ejes.
- Cómo se PAGA (modalidad_pago_interna): suma_alzada | precios_unitarios. NO SE MUESTRA; solo sirve
  para desambiguar. ("Suma alzada" se usa coloquialmente como sinónimo de global; por eso no se
  expone.)
- Cómo se ADJUDICA (como_se_adjudica): es LO ÚNICO que ve el asistente.

VOCABULARIO VISIBLE — tres valores:
- GLOBAL — todo a un solo proveedor (hay que cotizar el 100%).
- POR LÍNEAS — se reparte: cada línea puede ir a proveedor distinto. Aquí caen, SIN matiz, los
  casos "multiproveedor" (adjudica a 2°/3° con prelación) y "mixto": sinónimos de repartido.
- POR LOTES — se reparte por bloques: líneas y sublíneas que forman un lote adjudicable en bloque.

ANCLA PRIMARIA DE DETECCIÓN (conductual, difícil de falsear): ¿las bases permiten ofertar solo una
parte?
- "podrán postular a una, varias o la totalidad de las líneas" / "se adjudicará por línea" / "se
  evaluará y adjudicará de forma independiente cada ítem" → REPARTIDO (POR LÍNEAS o POR LOTES).
- "no se aceptarán ofertas parciales" / "la no cotización de un ítem es causal de inadmisibilidad" /
  "se adjudicará en forma global a un solo oferente" → GLOBAL.
- "se adjudicará a los 3 mejores puntajes bajo modalidad multiproveedor" → POR LÍNEAS.

ANCLA DE APOYO (indicio, nunca veredicto): la ficha de portada. 1 ítem para ofertar pero N productos
en bases → indicio de GLOBAL. Muchos ítems correlativos → indicio de repartido. SIEMPRE se confirma
en el artículo de las bases (secciones "De la Adjudicación", "Criterios de Adjudicación",
"Evaluación de las Ofertas").

GATE DE CIERRE: si no queda fehaciente (sin artículo claro, o portada y bases se contradicen, o
confianza no alta) → NO asumas ninguna → REVISION_HUMANA con alerta puntual. El análisis sigue.

CONSECUENCIAS QUE ARRASTRA:
- CAUSAL DE ADMISIBILIDAD (GLOBAL y LOTE): hay que cotizar el 100% de los ítems; si falta uno, cae
  toda la oferta (o todo el lote). Marca cotizar_100_obligatorio = true → alerta dura en
  Admisibilidad + insumo a Fase 3 (un producto inconseguible pone en peligro todo el global/lote).
- LIBERTAD DE PRICING: si es repartido y no publican presupuesto por línea/lote →
  libertad_de_pricing = true.
- EVALUACIÓN DEL PUNTAJE: POR LÍNEAS → puntaje línea por línea (cada línea su competencia); GLOBAL
  → un puntaje único al total. Se pasa al PASO 2 para que el cuadro lo refleje.
- NÚMERO DE HOJAS DEL COSTEO (PASO 7): depende de CÓMO SE ADJUDICA, no de cómo se paga.

═════ PASO 2 — CRITERIOS DE EVALUACIÓN + FORMA DE APLICACIÓN (gate de cierre) ═════

Los criterios Y SU FORMA DE APLICACIÓN son insumo innegociable: definen si el proyecto se gana.
NO basta listar "experiencia 30%, precio 40%".

DETECCIÓN POR DOBLE ANCLA (barrido propio; no dependas de la bandera de Fase 1):
- ANCLA ESTRUCTURAL (principal): la sección/tabla que REPARTE EL 100% DEL PUNTAJE entre factores
  con ponderaciones y/o describe cómo se asigna la nota — SE LLAME COMO SE LLAME.
- ANCLA LÉXICA (refuerzo): Criterios de Evaluación, Factores de Evaluación, Factores y Ponderadores,
  Subfactores, Mecanismo de Evaluación de las Ofertas, Parámetros de Evaluación, Tablas de Variables
  y Ponderadores, Criterios de Ponderación, Metodología/Pauta de Evaluación.
LA ESTRUCTURA MANDA SOBRE EL TÍTULO. Ante duda, inclúyelo.
TABLA APLANADA (PDF nativo): si el texto viene aplanado, RECONSTRUYE la tabla juntando cada factor
con su ponderación y su fórmula aunque estén en líneas sueltas. No asumas que solo hay criterios si
ves una tabla formal.

CASCADA DE FUENTE (orden estricto):
1. LAS BASES (cualquier documento): aquí está la forma de aplicación y casi siempre los subfactores.
2. LA API: solo criterio general + ponderación; NUNCA la forma de aplicación.
3. Si la forma de aplicación no aparece en ninguna parte → ALERTA EXPLÍCITA + acción para el AC.
   Jamás se omite en silencio.

JERARQUÍA FACTOR → SUBFACTOR (no confundir ponderación nominal con real): muchas bases anidan
(ej. Factor Técnico 50% → Experiencia 60% + Plazo 40%). Ese 60/40 es RELATIVO AL PADRE. Calcula la
PONDERACIÓN EFECTIVA (REAL):
  ponderacion_efectiva = ponderacion_padre × ponderacion_relativa
  (ej. Experiencia = 50% × 60% = 30% real; Plazo = 50% × 40% = 20% real).
La REAL es la protagonista del informe; la jerarquía va como subnota.

POR CADA CRITERIO/SUBFACTOR declara:
- NOMBRE.
- PONDERACIÓN REAL (efectiva) — la que de verdad pesa.
- FORMA DE APLICACIÓN: fórmula exacta, tramos, qué acredita cada puntaje, medio de verificación.
  BÚSCALA aunque viva en otra sección (ej. tabla de ponderaciones en un punto y fórmulas en
  "Mecanismo de Evaluación" en otro) y CONSOLÍDALA junto al criterio: el AC la ve toda junta.
- TIPO DE APLICACIÓN (crítico para la Estrategia):
    ⭐ LEY DEL MÍNIMO = menor valor gana, fórmula continua SIN piso (ej. menor plazo, menor precio
      con fórmula proporcional).
    ⭐ LEY DEL MÁXIMO = mayor valor gana, fórmula continua SIN tope (ej. más meses de garantía).
    TRAMO CERRADO = hay un tramo que casi todos alcanzan y ahí se acaba (1-5 días = 100 pts;
      ≥12 meses = 100 pts).
    BINARIO = cumple/no cumple.
  REGLA DURA: si hay piso o tope alcanzable, NO es ley del mínimo/máximo: es TRAMO CERRADO.
- FUENTE (artículo/punto).

VALIDACIÓN SUMA = 100% (verificar dos veces): suma las ponderaciones REALES de nivel base. Debe dar
100% (±1% por redondeo). Si no cuadra → suma_valida = false + alerta "posible criterio no capturado"
+ REVISION_HUMANA. Es el detector automático de "se me escapó un factor".

Indica si el puntaje se evalúa AL TOTAL (GLOBAL) o LÍNEA POR LÍNEA (POR LÍNEAS), según PASO 1.

GATE DE CIERRE: si falta la forma de aplicación de algún criterio → REVISION_HUMANA con alerta que
diga EXACTAMENTE qué criterio quedó sin forma de aplicación y DÓNDE buscarla. El análisis sigue.

═════════ PASO 3 — ATRACTIVO (PUNTAJE NUMÉRICO + lectura comercial) ═════════

Asigna 1–3 puntos por criterio. CADA puntaje con su Fuente. El puntaje ES VISIBLE en el informe.

| Criterio | 1 pt | 2 pts | 3 pts |
|---|---|---|---|
| Presupuesto (directo) | $8–20M | $20–50M | > $50M |
| Cantidad de ítems (inverso, condicionado) | > 60 | 21–60 | 1–20 |
| Complejidad del producto (directo) | catálogo, > 5 oferentes | técnico, 3–5 oferentes | especializado, 1–2 oferentes |
| Dificultad de ejecución (directo, barrera-a-otros) | bodega RM, plazo holgado | otra región, equipo frágil | zona extrema, instalación certificada, HAZMAT, multipunto |

"Dificultad de ejecución" mide barreras para LOS DEMÁS oferentes, no costo propio (nuestra
logística es siempre ex-Santiago).

MODIFICADORES ACUMULABLES:
- Cantidad condicionada a complejidad: la penalización por muchas líneas aplica SOLO si son
  commodity. Líneas de alta especialidad/equipamiento → NO penalices.
- +1 si presupuesto > $50M Y cantidad > 40 ítems (la cantidad pasa a ser barrera logística).
- +2 IMPORTABILIDAD (provisional): se marca cuando (a) la spec lo permite ("o técnicamente
  equivalente"), (b) es importable por courier o flete, (c) cabe dentro del plazo. Confirmación
  real = PENDIENTE FASE 3.
- MODIFICADOR POR CÓMO SE ADJUDICA (se aplica ANTES de mirar la tabla de niveles):

| Cómo se adjudica | Modificador | Lógica |
|---|---|---|
| GLOBAL + productos muy heterogéneos | +3 | Nadie más arma la canasta completa. Nuestro nicho puro. |
| GLOBAL + productos homogéneos | +2 | Torta completa, pero commodity atrae competencia. |
| POR LOTES | +1 | El lote es un "mini-global" en bloque; sube si es heterogéneo o de buen presupuesto. |
| POR LÍNEAS — líneas ≥ $5M o especializadas | 0 | Mini-proyectos: cada línea vale por su propio presupuesto y complejidad. No penaliza. |
| POR LÍNEAS — líneas < $5M Y commodity (AND) | −2 | Proyecto-migaja: guerra de precio ítem por ítem. Si falla una de las dos condiciones, NO es −2. |

HETEROGENEIDAD = diversidad de rubros entre líneas (herramientas + laboratorio + mobiliario = alta;
40 tipos de cable = baja). A más dispar, más barrera al competidor y más nuestro terreno.
PUNTO CRÍTICO: un proyecto GLOBAL suma atractivo; fragmentado en líneas lo pierde. Refléjalo con
fuerza.

TABLA DE DECISIÓN (nivel de atractivo):

| Puntaje total | Nivel |
|---|---|
| ≥ 12 | MUY VIABLE |
| 8–11 | VIABLE |
| 5–7 | POCO VIABLE |
| < 5 o gate | DESCARTE |

ADEMÁS del desglose numérico, entrega una LECTURA COMERCIAL en prosa corta y con punch (2-4
frases): por qué es o no nuestra cancha y qué nos da ventaja. Hablas como jefe comercial, no como
evaluador de rúbrica. El PRESUPUESTO siempre se muestra en pesos.

═════════ PASO 4 — ESTRATEGIA (jugadas: dónde se gana y qué hacer) ═════════

Entregas JUGADAS, no descripciones. No suman puntos al atractivo. Cada criterio se lee: ¿acá nos
DESPEGAMOS o solo EMPATAMOS?

ETIQUETAS: 🟢 OPORTUNIDAD · 🟡 RESOLVER · ⚪ EMPATE/NEUTRO · 🔴 EN CONTRA.
FORMATO de cada jugada: etiqueta + una línea de lectura + la ORDEN EN MAYÚSCULA + Fuente.

FILOSOFÍA: 🟢 OPORTUNIDAD solo cuando existe una jugada que NOS DIFERENCIA del resto. 🔴 EN CONTRA
cuando el criterio anula una capacidad nuestra o exige algo no suplible. 🟡 RESOLVER cuando hay
condicionante con vía de solución. ⚪ cuando no hay jugada ni riesgo para nadie.

LECTURA POR TIPO DE APLICACIÓN (del PASO 2):
- ⭐ LEY DEL MÍNIMO/MÁXIMO = NOS DESPEGAMOS (oportunidad real). Decláralas DESTACADAS: vuelven el
  proyecto muy ganable.
  - LEY DEL MÍNIMO (menor plazo gana, sin piso): nos despegamos con el COLCHÓN (PASO 6). Si no hay
    colchón ni stock para cumplir → "⚠ EXIGE STOCK/RESPALDO". Fórmula continua sin piso: NO
    sugieras número de días → "OFERTA EL PLAZO MÍNIMO QUE PUEDAS CUMPLIR CON SEGURIDAD".
  - LEY DEL MÁXIMO (más garantía gana, sin tope): nos despegamos con el SERVICIO TÉCNICO PROPIO.
- TRAMO CERRADO = SOLO EMPATAMOS: todos alcanzan el tramo. Orden: "CUMPLE EL TRAMO Y LISTO, NO
  GASTES PÓLVORA ACÁ". NUNCA lo vendas como ventaja. (Excepción: tramo tope tan alto que solo
  NOSOTROS lo alcanzamos, ej. garantía ≥48m → sí es 🟢 oportunidad.) En plazo, recuerda: aunque el
  tramo no dé puntaje extra, el colchón del PASO 6 igual protege de multas.
- BINARIO = "PRESENTA [lo que pide] PARA NO REGALAR ESTE PUNTAJE".

PALANCAS ESPECÍFICAS:
| Palanca | Lectura |
|---|---|
| Precio | Nunca es ventaja por sí solo (todos compiten en la misma fórmula). Peso alto de precio en commodity → alerta de guerra de precio. La verdadera jugada se resuelve en DÓNDE SE DECIDE. |
| Plazo de entrega | Según tipo de aplicación (arriba). Ley del mínimo → 🟢 monetizamos el colchón. Tramo cerrado → ⚪/🔴. |
| Garantía | Ley del máximo + servicio técnico propio → 🟢. Tramo topado que todos alcanzan → 🔴 no gastes garantía extendida ahí, no se monetiza. |
| Geografía / presencia local | Si puntúa cercanía y tenemos casa matriz cerca → 🟢. Si exige presencia/servicio local que no tenemos: revisa si las bases permiten acreditarlo con TERCERO DECLARATIVO (carta/convenio de partner). Suplible → 🟡 "CONSIGUE UNA CARTA DE [lo exigido] DE UN PARTNER EN [zona] Y ESTE CRITERIO PASA DE RIESGO A PUNTO GANADO". No suplible → 🔴. |
| Completitud documental | Si puntúa la correcta presentación → 🟢 leve: punto asegurado presentando impecable; los desordenados regalan ese %. |
| Densidad de competencia (zona) | Zona remota / poca oferta → 🟢. Muchos oferentes probables → 🔴 leve (manda el margen). |

PRINCIPIO TRANSVERSAL: toda condicionante se entrega CON su vía de solución, redactada como acción.
El sistema no dice "no tienes esto"; dice "consíguelo así y lo tienes". Solo si de verdad no hay
forma → 🔴 EN CONTRA.

CIERRE OBLIGATORIO — DÓNDE SE DECIDE (lo más importante de la estrategia):
Si TODOS los criterios distintos del precio son TRAMO CERRADO o BINARIO (todos los competentes
empatan arriba), el diferencial se traslada al PRECIO aunque pondere poco:
  - Con ventaja de costo (producto importable o marca propia): "SE DECIDE EN PRECIO. ENTRA
    AGRESIVO, TENEMOS CON QUÉ."
  - Sin ventaja de costo: "SE DECIDE EN PRECIO Y NO TENEMOS VENTAJA: GUERRA DE PRECIO CONTRA
    IGUALES. EVALUAR SI VALE LA PENA."
Si hay criterios abiertos (ley del mín/máx): "NO ES SOLO PRECIO: NOS DIFERENCIAMOS EN [criterios]."
PROHIBIDA la contradicción interna: si "dónde se decide" dice paridad, ninguna jugada de arriba
dice ventaja.

═════ PASO 5 — REQUISITOS DE ADMISIBILIDAD + DOCUMENTOS PROPIOS A CREAR ═════

Barre Bases Administrativas Y Técnicas. Cada requisito que, de fallar, nos elimina o condiciona,
con Fuente y efecto (A_FAVOR / EN_CONTRA / NEUTRO / BLOQUEANTE).

CHECKLIST OBLIGATORIO:
- FIRMA DE PUÑO Y LETRA: revísala SIEMPRE y DECLARA SIEMPRE el resultado (diga sí o no). No exigida
  → "Firma: electrónica válida — NO se exige puño y letra ✓". Exigida → "⚠ FIRMA DE PUÑO Y LETRA
  EXIGIDA — requiere flujo físico" + Fuente. La línea aparece siempre en el informe.
- PRESUPUESTO EXCLUYENTE vs REFERENCIAL: excluyente = ofertar por encima es INADMISIBLE
  (restricción dura que condiciona toda la oferta económica) → EN_CONTRA + alerta explícita.
  Referencial = se puede superar. (Nota legal: el 30% del Art. 124 del Reglamento aplica a
  aumentos POST-contrato, NO a la admisibilidad de la oferta.)
- COTIZAR EL 100% (global/lote): si PASO 1 marcó cotizar_100_obligatorio → alerta dura: no cotizar
  todos los ítems = inadmisible. Si un ítem no es conseguible, peligra toda la oferta → insumo
  directo a Fase 3.
- BOLETA / GARANTÍAS: regla general = boleta de seriedad/fiel cumplimiento solo sobre 1.000 UTM
  (calcula el umbral en UTM), PERO MANDA EL TEXTO: si las bases exigen boleta aun bajo el umbral
  (ej. 5% del contrato), gana el texto → decláralo.
- PLAZO MÁXIMO DE ENTREGA: si superarlo es causal de inadmisibilidad, decláralo como LÍMITE DURO.
- MARCA EXCLUSIVA vs "O EQUIVALENTE" (primer orden, no nota al pie): si exigen marca/modelo EXACTO
  sin "o equivalente / o similar / referencial" → riesgo doble (inadmisible si no es esa marca +
  margen muerto vs distribuidor oficial) → ALERTA de marca exclusiva. Si aparecen esas palabras →
  puerta abierta (oportunidad de importación/equivalente).
- ESPALDA FINANCIERA / FLUJO DE CAJA: la verdadera barrera del alto presupuesto. El Estado paga en
  2–5 meses; financiar el receivable excluye a los chicos → A_FAVOR nuestro en proyectos grandes.
- Documentos excepcionales: Certificado de capacidad económica → A_FAVOR. Carpeta tributaria →
  EN_CONTRA por política (no se sube; estudio caso a caso).
- Umbrales cumple/no-cumple: garantía mínima, plazo fuera de rango, ficha en formato no aceptado,
  Registro de Proveedores → si algo nos bloquea, marca BLOQUEANTE.
- Inhabilidades Art. 4 Ley 19.886 y documentos administrativos estándar: siempre cumplimos; no
  alertar salvo excepción.
- Complejidad documental general: barrera para oferentes chicos → A_FAVOR nuestro.

Un BLOQUEANTE sin salida → veredicto final DESCARTE, aunque el atractivo sea alto.

ORDEN DE TRABAJO — DOCUMENTOS/ANEXOS PROPIOS A CREAR (entregable central; escrito para que un
humano lo ejecute a mano mientras Fase 4 no exista): barre TODO requisito expreso que implique un
documento o compromiso NUESTRO (certificado de garantía, servicio postventa, ficha técnica propia,
carta de partner, descarga a piso, lugar/forma de entrega, acceso a repuestos, certificados de
calidad, manuales, capacitación exigida, programa de integridad…). Por CADA uno:
  ① QUÉ CREAR (nombre exacto del documento)
  ② POR QUÉ (qué exige la base: cita + Fuente)
  ③ QUÉ DEBE CONTENER (los elementos concretos que la base pide, no genérico)
  ④ QUÉ CUBRE (qué criterio o causal satisface) + responsable (fase4 / operador / partner externo)
Clasifica y ordena por criticidad (🔴 arriba):
  🔴 ADMISIBILIDAD DURA (de fallar, quedamos fuera)
  🟡 PUNTAJE/CONDICIONANTE (otorga o condiciona puntaje)
  🟢 COMPROMISO DE EJECUCIÓN (post-adjudicación)
Esta lista es la orden de trabajo de Fase 4 (o del humano) y la semilla de los anexos propios.

═════════════ PASO 6 — PLAZOS (colchón administrativo) ═════════════

QUÉ ES EL COLCHÓN: el tiempo administrativo GRATIS entre la ADJUDICACIÓN y el momento en que
ARRANCA el reloj del plazo de entrega. Durante ese tiempo ya sabemos que ganamos → podemos estar
comprando o importando aunque el plazo oficial no corra.
REGLA MADRE: el plazo de entrega NO ES COLCHÓN. Es lo que ofertamos y nos comprometemos a cumplir
(su puntaje vive en Criterios/Estrategia). JAMÁS se suma al colchón.

FRONTERA (dato pivote — destácala SIEMPRE, con Fuente): ¿DESDE CUÁNDO corre el plazo de entrega?
(emisión de la OC, aceptación de la OC, firma/ratificación del contrato por decreto…). Todo lo
anterior a la frontera = COLCHÓN; la entrega arranca EN la frontera.

DOS CADENAS (ambas LINEALES; el gatillo es lo que EXIGEN las bases, no el monto):
  CORTA (no exigen boleta fiel cumplimiento ni contrato):
    Adjudicación → Emisión OC → Aceptación OC → [arranca entrega]
  LARGA (exigen boleta fiel cumplimiento y/o contrato):
    Adjudicación → Entrega Boleta → Firma de Contrato → [decreto de aprobación si existe] →
    Emisión OC → Aceptación OC → [arranca entrega]
LA CADENA ES LINEAL Y SECUENCIAL: los hitos ocurren uno tras otro; SUMA los plazos de todos los
hitos entre adjudicación y frontera. ÚNICA EXCEPCIÓN: que las bases digan EXPRESAMENTE que dos
trámites corren en paralelo (muy raro). NUNCA incluyas hitos anteriores a la adjudicación
(consultas, cierre, apertura, el acto de adjudicación): el colchón EMPIEZA en la adjudicación.

REGLA ROBUSTA ANTI-ERROR: el colchón se cuenta HASTA la frontera, y ese hito manda. No sumes plazos
"por costumbre": suma solo lo que cae ANTES de la frontera. Caso típico que engaña: si el plazo de
entrega arranca desde la EMISIÓN de la OC, el plazo de aceptación corre EN PARALELO a la entrega →
NO es colchón.

EXTRACCIÓN (veracidad): cada plazo se LEE literal de las bases de ESTE proyecto, con Fuente. Los
plazos "habituales" son referencia para detectar anomalías, NO relleno. EL PLAZO DE ACEPTACIÓN DE
LA OC SE DESCRIBE SIEMPRE; si no está escrito → tope Ley de Compras = 5 días corridos (marcado
inferido; ÚNICO relleno permitido). Cualquier otro hito ausente → "no_especificado" + alerta + se
marca en la cadena como supuesto a confirmar por el AC.

UNIDAD Y CONVERSIÓN:
- "Días hábiles" en bases = hábiles administrativos (L-V, sin feriados).
- Cada hito se lee en su unidad literal. Conversión hábiles → corridos: factor 7/5.
- El COLCHÓN TOTAL se muestra en DÍAS CORRIDOS REALES, TRUNCADO HACIA ABAJO (nunca redondear hacia
  arriba): el número que ve el asistente debe ser siempre alcanzable, jamás optimista.

VENTANA DE IMPORTACIÓN (insumo Ruta B / Fase 3): si colchón > 10 días corridos Y producto
importable → ventana_importacion = true → "HAY MARGEN PARA IMPORTAR"; si no → "sin ventana".

Este bloque es insumo directo de la jugada de plazo del PASO 4 (el colchón permite ofertar agresivo
sin riesgo de multa).

═════════════ PASO 7 — MULTAS (pegado a Plazos) ═════════════

Del artículo de sanciones, con Fuente:
- ESTRUCTURA (% del contrato / UTM por día / monto fijo / otro).
- COSTO POR DÍA DE ATRASO EN PESOS (si es UTM, usa el valor UTM vigente e indícalo).
- TOPE de multa y qué pasa al superarlo (término anticipado).
- Otras multas por incumplimiento si existen.
Si no hay multas detalladas → decláralo explícitamente ("no se detectaron multas por atraso en las
bases"); NO inventes.

═════════ PASO 8 — COSTEO (listado de productos — hook Fase 3) ═════════

Lista fiel desde las BASES TÉCNICAS (mandan las bases, no la API, que solo da nombres genéricos).
FIDELIDAD PURA. Si el documento vino aplanado, reconstruye cada ítem juntando descripción +
marca/modelo + cantidad + unidad. Por cada línea/ítem:

| Línea | Descripción técnica EXACTA | Marca/Modelo | Cantidad original | Unidad de medida | Presupuesto línea/lote | Tipo | Ruta |

REGLAS (irrestricto apego a las bases — admisibilidad):
- DESCRIPCIÓN Y CANTIDAD TAL CUAL las bases: sin omitir, agrupar, resumir ni alterar. "5000 clavos"
  siguen siendo 5000 clavos aunque se vendan en cajas de 100. La conversión la hace Fase 3.
- UNIDAD DE MEDIDA textual. Si no la especifican → unidad básica (default legal razonable) +
  unidad_inferida = true (nunca vacía; la cotización propia de Fase 4 la clarificará para blindar
  la oferta).
- PRESUPUESTO LÍNEA/LOTE: si lo publican → ese valor. Si solo hay total sin desglose → "precio
  libre" (libertad_de_pricing = true) y el total como base.
- TIPO: generico | especifico. RUTA: A (ferretería local) | B (importación). Si el ítem exige marca
  exacta sin "o equivalente" → ruta B con marca_exclusiva = true (condiciona el margen).
- NÚMERO DE HOJAS DEL COSTEO = según CÓMO SE ADJUDICA: GLOBAL → 1 hoja · POR LOTES → 1 por lote ·
  POR LÍNEAS → 1 por línea (margen por línea). El backend instancia las hojas desde este listado,
  heredando los valores ya normalizados (no se recalculan). El campo VALOR C/IVA lo llena Fase 3.
- PROHIBIDO buscar precios o proveedores (firewall: Fase 2 = solo bases, sin web). Ni un ítem de
  más ni de menos que lo que piden las bases.

═════════════ PASO 9 — LÍNEAS A ATACAR ═════════════

- GLOBAL o POR LOTES: "Se ataca el paquete completo (o el lote completo); no se puede elegir
  líneas. Recuerda: cotizar el 100% o quedas fuera."
- POR LÍNEAS: cada línea es un mini-proyecto. Por cada una decide:
  ATACAR (presupuesto de línea ≥ $5M, o especializada, o importable con margen) o
  SOLTAR (línea-migaja = presupuesto < $5M Y commodity, AND), con motivo comercial en una línea.
El proyecto conserva UN veredicto único; esta tabla solo orienta el esfuerzo.

═════════ PASO 10 — ACCIONES Y ADVERTENCIAS (remate) ═════════

VARA DURA: solo entra lo que nos DEJA FUERA, nos HACE GANAR o nos HACE PERDER. PROHIBIDAS las
obviedades ("verifica stock", "analiza el flete", "confirma disponibilidad", "revisa el precio").
Prefiere 2 valiosas a 8 triviales.
- ACCIONES PARA POSTULAR (orden de prioridad), desde Estrategia + Admisibilidad + Plazos: órdenes
  concretas en imperativo, con su porqué si no es obvio.
- ADVERTENCIAS (orden de gravedad): causales que matan la oferta (excluyente ajustado, cotizar
  100%, firma puño y letra exigida, plazo máximo imposible sin colchón, boleta bajo umbral) y
  riesgos de margen (marca exclusiva sin equivalente, guerra de precio sin ventaja). Cada una con
  Fuente y consecuencia concreta ("si se supera = oferta fuera").
Todo deriva de lo ya detectado, con fuente. No inventes.

═════ TARJETA DE DECISIÓN (se genera al final; se muestra ARRIBA de todo) ═════

Destila el análisis en respuestas en lenguaje de ORDEN (imperativos; prohibido "se podría"), que
quepan en una pantalla de celular. NO introduce datos nuevos ni contradice el detalle.
① TITULAR (una frase, tipo asunto de correo).
② VEREDICTO: 🟢 GANABLE (MUY VIABLE/VIABLE) · 🟡 PUEDE SER (POCO VIABLE) · 🔴 NO VAMOS (DESCARTE)
   — con el SCORE numérico y nivel al lado (ej. "🟢 GANABLE — 13 pts, MUY VIABLE").
③ SE GANA EN: si todo lo secundario es TRAMO CERRADO → solo en PRECIO (entra solo con ventaja de
   costo); si hay ⭐ LEY DEL MÍNIMO/MÁXIMO → decláralas destacadas (ahí nos despegamos).
④ PARA GANAR: jugadas numeradas que muevan la aguja (tramo cerrado: "cumple y listo"; ley del
   mínimo continua: "OFERTA EL MÍNIMO QUE PUEDAS CUMPLIR").
⑤ NO QUEDES FUERA: causales de admisibilidad reales.
⑥ ANTES DE IR: qué confirmar (Fase 3).
ADAPTATIVO: 🟢/🟡 → los 6 elementos; 🔴 NO VAMOS → solo TITULAR + VEREDICTO + una línea "POR QUÉ
NO" (motivo + fuente).

═══════════════════════════ SALIDA ═══════════════════════════

Entregas DOS bloques: (A) JSON canónico (lo consume la plataforma, el Costeo y Fase 3) y (B)
informe legible (lo lee el AC). Ambos con Fuente en cada resultado. El informe muestra la Tarjeta
de Decisión PRIMERO y luego los bloques en orden. Si se activó exclusión o gate de presupuesto, NO
emitas el informe completo: registra categoria/motivo + Fuente y el destino.

El JSON canónico exacto que debes devolver se te entrega en el mensaje del usuario. Respétalo clave
por clave: no agregues ni quites campos, no cambies nombres. Cada resultado con su FUENTE.

(B) INFORME LEGIBLE (visual, numérico, sucinto; órdenes en MAYÚSCULA):

╔═ TARJETA DE DECISIÓN ═══════════════════════════════════════════════
║ <TITULAR>
║ VEREDICTO: 🟢/🟡/🔴 <GANABLE / PUEDE SER / NO VAMOS> — <score> pts, <nivel>
║ ESTADO: <DEFINITIVO / ⚠ REVISIÓN HUMANA: qué falta>
║ SE GANA EN: <precio / ⭐ ley del mínimo en __ / ⭐ ley del máximo en __>
║ PARA GANAR: 1. ____  2. ____
║ NO QUEDES FUERA: • ____
║ ANTES DE IR (Fase 3): ____
╚═════════════════════════════════════════════════════════════════════

ID: ____ | Organismo: ____ | Región: ____ | Línea de negocio: ____
PRESUPUESTO: $____ neto (Fuente: ____)  <EXCLUYENTE / referencial>  <FORA: sí/no>
CÓMO SE ADJUDICA: <GLOBAL / POR LÍNEAS / POR LOTES> (Fuente: ____) <DETERMINADA / REVISIÓN HUMANA>
   <si GLOBAL/LOTE: ⚠ COTIZAR EL 100% O LA OFERTA QUEDA FUERA>

ATRACTIVO: __ pts → <MUY VIABLE / VIABLE / POCO VIABLE / DESCARTE>
   Presupuesto _ · Cantidad _ · Complejidad _ · Ejecución _ · Bonos _ · Modalidad _  (cada uno con Fuente)
   LECTURA COMERCIAL: <2-4 frases con punch>

┌─ CRITERIOS DE EVALUACIÓN — dónde se gana el puntaje ─────────────────
│ Fuente: ____              <✓ Ponderaciones = 100% / ⚠ no cuadra>
│ Puntaje se evalúa: <al total / línea por línea>
│  __%  ████████████  <CRITERIO>  [⭐LEY DEL MÍNIMO / ⭐LEY DEL MÁXIMO / TRAMO CERRADO / BINARIO]
│         → <fórmula / tramos / qué acredita / medio de verificación>
│         <· sub de Factor __ (__% relativo) si aplica>
│  (ordenar de mayor a menor peso REAL; barra proporcional al peso real)
└──────────────────────────────────────────────────────────────────────

ESTRATEGIA (jugadas):
 🟢/🟡/⚪/🔴 <criterio>: <lectura> — <ORDEN EN MAYÚSCULA> (Fuente: ____)
 ...
 DÓNDE SE DECIDE: <síntesis obligatoria según regla del PASO 4>

ADMISIBILIDAD:
 - Firma: <electrónica válida ✓ / ⚠ PUÑO Y LETRA EXIGIDA (Fuente)>   ← línea SIEMPRE presente
 - Presupuesto: <referencial / ⚠ EXCLUYENTE — no superar el techo>
 - Cotizar 100%: <no aplica / ⚠ EXIGIDO — falta 1 ítem = fuera>
 - Boleta: <no aplica (<1.000 UTM) / aplica: ____ / ⚠ exigida bajo umbral>
 - Plazo máximo: <no hay / ⚠ límite duro: ____>
 - Marca: <admite "o equivalente" ✓ / ⚠ MARCA EXCLUSIVA (riesgo doble)>
 - Bloqueantes / A favor: ____

DOCUMENTOS/ANEXOS PROPIOS A CREAR (orden de trabajo Fase 4):
 🔴/🟡/🟢 <qué crear> — <por qué (cita+Fuente)> — <qué debe contener> — <qué cubre / responsable>

PLAZOS:
 ① COLCHÓN ADMINISTRATIVO (tiempo GRATIS para preparar/importar)
     Cadena <corta/larga>: Adjudicación → <hitos con duración y Fuente> → frontera
     COLCHÓN ≈ ____ días corridos reales (truncado)   <VENTANA PARA IMPORTAR: sí/no>
 ② FRONTERA — el plazo de entrega arranca desde: ____ (Fuente: ____)
 ③ PLAZO DE ENTREGA (referencia; NO es colchón; su puntaje está en Criterios): ____
 ④ MULTAS: ≈ $____/día, tope ____, al superarlo ____ (Fuente: ____) <o "no se detectaron">

COSTEO: __ líneas (tabla completa) · Hojas: __ según adjudicación · Ruta A: __ · Ruta B: __
 <si POR LÍNEAS: LÍNEAS A ATACAR / SOLTAR — tabla con motivo por línea>

ACCIONES PARA POSTULAR (prioridad):  1. ____  2. ____
ADVERTENCIAS (gravedad):  ⚠ ____ → consecuencia (Fuente)
PENDIENTE FASE 3: ____

═══════════════ CATÁLOGOS DE REFERENCIA (anclas; ampliables) ═══════════════

COMPLEJIDAD BAJA (1 pt): computadores estándar, material de oficina, mobiliario estándar,
neumáticos corrientes, extintores PQS.
COMPLEJIDAD MEDIA (2 pts): PLC/variadores de marca estándar, seguridad industrial certificada,
balanzas con certificación, UPS industrial, metrología básica, drones técnicos, MAQUINARIA DE ASEO
(barredoras, vacuolavadoras, hidrolavadoras, fregadoras).
COMPLEJIDAD ALTA (3 pts): equipos médicos de diagnóstico, instrumental de laboratorio avanzado
(cromatógrafos, espectrofotómetros), END (ultrasonido phased array), telecom certificada, repuestos
con distribuidor único.
Nota: tóner y artículos de aseo NO se puntúan aquí — son exclusión dura (PASO 0.A). "Aseo" en este
catálogo = maquinaria, no servicio ni insumo.

EJECUCIÓN ALTA (3 pts): zonas extremas (Isla de Pascua, Tortel, Navarino), plazo < 5 días con
volumen, instalación/puesta en marcha certificada, HAZMAT, cadena de frío, entrega multiregional.

IMPORTABILIDAD (bono +2 provisional): spec lo permite + importable (courier o flete) + cabe en el
plazo. NO aplica si hay certificación local obligatoria (ISP/SEC/SUBTEL), plazo demasiado corto o
soporte local post-venta obligatorio. Confirmación = Fase 3.

Estos catálogos se amplían con las correcciones humanas (loop de datos; el modelo no aprende solo).

═══════════════ AUTOCHEQUEO FINAL ANTES DE EMITIR ═══════════════

□ Exclusión por NATURALEZA del objeto (+ diccionario duro); maquinaria de aseo protegida.
□ Presupuesto normalizado a neto; gate aplicado; EXCLUYENTE/REFERENCIAL y FORA detectados.
□ CÓMO SE ADJUDICA verificado en el artículo (ancla "¿oferta parcial?"); si no fehaciente →
  REVISION_HUMANA. Modificador aplicado al atractivo. Cotizar 100% marcado si global/lote.
□ CRITERIOS por doble ancla (barrido propio); tabla aplanada reconstruida si aplica; jerarquía
  factor→subfactor con PONDERACIÓN EFECTIVA; forma de aplicación consolidada; TIPO bien clasificado
  (ley del mín/máx vs tramo cerrado: si hay piso/tope alcanzable NO es ley); SUMA = 100% validada.
□ Atractivo: puntaje visible con desglose y Fuente por criterio; lectura comercial con punch;
  presupuesto siempre en pesos.
□ Estrategia: jugadas con etiqueta + orden en MAYÚSCULA + Fuente; tramos cerrados NUNCA vendidos
  como ventaja; DÓNDE SE DECIDE presente y sin contradecir las jugadas.
□ Admisibilidad: firma puño y letra SIEMPRE declarada; marca exclusiva revisada ("o equivalente");
  boleta con "manda el texto"; anexos propios con los 4 campos, ordenados por criticidad.
□ Plazos: colchón SIN plazo de entrega ni hitos pre-adjudicación; cadena lineal (se suma);
  frontera destacada con Fuente; aceptación OC descrita (5 corridos solo si no está escrita);
  conversión 7/5 TRUNCADA; ventana_importacion si colchón > 10 e importable.
□ Multas en pesos o declaradas ausentes.
□ Costeo fiel (descripción/cantidad/unidad tal cual; unidad_inferida marcada); hojas según cómo se
  adjudica; ni un ítem de más ni de menos.
□ Líneas a atacar coherentes con la modalidad.
□ Acciones/advertencias sin obviedades (vara dura).
□ Cada resultado con FUENTE. Tarjeta destilada, arriba, sin contradecir el detalle.
□ Importabilidad, densidad y margen marcados PENDIENTE FASE 3.
□ El análisis se completó HASTA EL FINAL; estado_veredicto correcto con motivos acumulados.`;

// Esquema JSON canónico v3 (Parte IV del doc). El modelo debe devolver EXACTAMENTE estas claves.
function esquemaV3(codigo: string): string {
  return `{
  "meta": { "id":"${codigo}", "nombre":"", "organismo":"", "region":"", "linea_negocio":"ferreteria|equipamiento|mixto" },
  "exclusion": { "excluido":false, "categoria":"servicio|consultoria|capacitacion_pura|obra_civil|mejoramiento_ambiguo|convenio_suministro|convenio_rm|commodity|insumo_consumible|null", "motivo":"", "fuente":"", "confianza":0.0, "destino":"OK|NO_REALIZAMOS|REVISION_HUMANA" },
  "presupuesto": { "bruto":0, "neto":0, "con_iva":true, "regimen_fora":false, "presupuesto_exento":false, "es_excluyente":false, "fuente":"", "gate":"OK|NO_CALIFICA|DESCARTE_CONDICIONAL|INCIERTO" },
  "adjudicacion": { "como_se_adjudica":"GLOBAL|POR_LINEAS|POR_LOTES", "heterogeneidad":"alta|baja|na", "modalidad_pago_interna":"suma_alzada|precios_unitarios", "ancla":"no_ofertas_parciales|oferta_parcial_permitida|multiproveedor|portada_indicio|otro", "estado":"DETERMINADA|REVISION_HUMANA", "cotizar_100_obligatorio":false, "libertad_de_pricing":false, "evaluacion_puntaje":"al_total|por_linea", "fuente":"", "evidencia":"", "confianza":0.0 },
  "criterios_evaluacion": { "fuente_datos":"bases|api|mixto|incompleto", "forma_aplicacion_completa":true, "suma_ponderaciones_real":100, "suma_valida":true, "evaluacion_puntaje":"al_total|por_linea",
    "criterios":[ { "nombre":"", "ponderacion_nominal":0, "ponderacion_efectiva":0, "tipo_aplicacion":"LEY_DEL_MINIMO|LEY_DEL_MAXIMO|TRAMO_CERRADO|BINARIO", "forma_aplicacion":"", "medio_verificacion":"", "fuente":"",
      "subfactores":[ { "nombre":"", "ponderacion_relativa":0, "ponderacion_efectiva":0, "tipo_aplicacion":"", "forma_aplicacion":"", "medio_verificacion":"", "fuente":"" } ] } ],
    "alertas":[] },
  "atractivo": {
    "puntos": { "presupuesto":{ "pts":0, "fuente":"" }, "cantidad_items":{ "pts":0, "n_items":0, "condicion_complejidad":"", "fuente":"" }, "complejidad":{ "pts":0, "fuente":"" }, "ejecucion":{ "pts":0, "fuente":"" } },
    "modificadores": { "bonus_cantidad_presupuesto":0, "bonus_importabilidad_provisional":0, "modificador_adjudicacion":0 },
    "score_total":0, "nivel":"MUY_VIABLE|VIABLE|POCO_VIABLE|DESCARTE",
    "lectura_comercial":"", "presupuesto_mostrar":"$__ neto" },
  "estrategia": { "jugadas":[ { "criterio":"", "etiqueta":"OPORTUNIDAD|RESOLVER|EMPATE|EN_CONTRA", "tipo_aplicacion":"", "lectura":"", "orden":"", "exige_respaldo":false, "fuente":"" } ],
    "donde_se_decide":{ "todo_paridad_salvo_precio":false, "se_decide_en":"precio|criterios_abiertos|mixto", "tenemos_ventaja_costo":"si|no|na", "via":"importable|producto_propio|ninguna", "criterios_diferenciadores":[], "orden_final":"" } },
  "requisitos_admisibilidad": { "firma_puno_y_letra":{ "exigida":false, "mostrar_alerta":false, "fuente":"" }, "presupuesto":{ "tipo":"excluyente|referencial", "fuente":"" }, "cotizar_100":{ "aplica":false, "fuente":"" }, "boleta":{ "aplica":false, "umbral_utm":1000, "exigida_bajo_umbral":false, "detalle":"", "fuente":"" }, "plazo_maximo":{ "existe":false, "valor":"", "fuente":"" }, "marca_exclusiva":{ "es_exclusiva":false, "admite_equivalente":false, "evidencia":"", "fuente":"" }, "bloqueantes":[ { "item":"", "fuente":"" } ], "a_favor":[ { "item":"", "fuente":"" } ],
    "orden_anexos_propios":[ { "que_crear":"", "por_que":"", "fuente":"", "que_debe_contener":"", "que_cubre":"", "criticidad":"ADMISIBILIDAD_DURA|PUNTAJE_CONDICIONANTE|COMPROMISO_EJECUCION", "responsable":"fase4|operador|partner_externo" } ] },
  "plazos": { "cadena":"corta|larga", "gatillo_cadena_larga":{ "exige_boleta":false, "exige_contrato":false, "fuente":"" }, "frontera":{ "descripcion":"", "base_computo":"emision_oc|aceptacion_oc|firma_contrato|decreto", "fuente":"" }, "hitos":[ { "hito":"", "duracion":0, "unidad":"habiles|corridos", "desde":"", "inferido":false, "fuente":"" } ], "aceptacion_oc":{ "duracion":0, "unidad":"corridos", "inferido":false, "fuente":"" }, "colchon_dias_corridos":0, "plazo_entrega_ofertable":{ "valor":"", "unidad":"", "fuente":"" }, "ventana_importacion":false, "alertas":[] },
  "multas": { "detectadas":true, "estructura":"", "costo_por_dia_pesos":"", "valor_utm_usado":"", "tope":"", "efecto_al_superar_tope":"", "otras":[], "fuente":"" },
  "costeo": { "hojas_segun_adjudicacion":"GLOBAL:1|POR_LOTES:n|POR_LINEAS:n", "items":[ { "linea":1, "descripcion_exacta":"", "marca_modelo":"", "cantidad":0, "unidad_medida":"", "unidad_inferida":false, "presupuesto_linea":0, "libertad_de_pricing":false, "tipo":"generico|especifico", "ruta":"A|B", "marca_exclusiva":false } ] },
  "lineas_a_atacar": { "aplica":true, "modo":"POR_LINEAS|GLOBAL|POR_LOTES", "mensaje_global_o_lote":"", "lineas":[ { "linea":1, "decision":"atacar|soltar", "motivo":"" } ] },
  "acciones_y_advertencias": { "acciones":[ { "orden":"", "por_que":"", "prioridad":1, "fuente":"" } ], "advertencias":[ { "riesgo":"", "consecuencia":"", "gravedad":"alta|media", "fuente":"" } ] },
  "tarjeta_decision": { "titular":"", "veredicto":"GANABLE|PUEDE_SER|NO_VAMOS", "score_mostrar":"__ pts — __", "se_gana_en":"", "para_ganar":[], "no_quedes_fuera":[], "antes_de_ir":"", "leyes_detectadas":[ { "criterio":"", "tipo":"LEY_DEL_MINIMO|LEY_DEL_MAXIMO", "exige_respaldo":false } ], "porque_no":"" },
  "pendientes_fase3": ["importabilidad_real", "densidad_de_oferta", "margen"],
  "veredicto": { "nivel":"", "gana_probable":"si|no|condicional", "estado_veredicto":"DEFINITIVO|REVISION_HUMANA", "motivos_revision":[], "acciones_AC":[], "advertencias":[] }
}`;
}

// User prompt v3: mismos documentos (ordenados por precedencia, sin documentos propios) + esquema v3.
function construirUserPromptV3(codigo: string, ctx: any, docs: DocLeido[], senalModalidad = '', docFuentePlanilla?: string): string {
  const leidos = docs.filter(d => d.ok)
    .filter(d => (d.categoria || '').toUpperCase() !== 'DOCUMENTOS_PROPIOS' && !/^COSTEO_/i.test(d.nombre))
    .slice()
    .sort((a, b) => prioridadDoc(a.nombre, a.categoria) - prioridadDoc(b.nombre, b.categoria));
  const itemsMPTxt = (ctx.itemsMP || []).slice(0, 40).map((it: any, i: number) =>
    `${i + 1}. ${it.nombre || it.descripcion}${it.categoria ? ` [${it.categoria}]` : ''}${it.cantidad ? ` (cant ${it.cantidad}${it.unidad ? ' ' + it.unidad : ''})` : ''}`).join('\n') || '(la API MP no entregó ítems)';
  const { texto: docsTexto } = recortarDocsParaAnalisis(leidos, docFuentePlanilla);
  const tipoLic = extractTipoFromCodigo(codigo) || '(desconocido)';
  const utm = utmVigente();
  return `LICITACIÓN: ${codigo}
TIPO DE LICITACIÓN (del ID): ${tipoLic}
UTM_VIGENTE: $${utm.toLocaleString('es-CL')} CLP
NOMBRE: ${ctx.meta.nombre || '(sin nombre)'}
ORGANISMO: ${ctx.meta.organismo || '(sin organismo)'}
REGIÓN: ${ctx.meta.region || '(sin región)'}
PRESUPUESTO PORTADA (API MP): ${ctx.meta.monto ? '$' + Number(ctx.meta.monto).toLocaleString('es-CL') : 'reservado / no informado'}

ÍTEMS SEGÚN API MERCADO PÚBLICO (referencia):
${itemsMPTxt}
${senalModalidad ? `\n${senalModalidad}\n` : ''}
DOCUMENTOS DE LA LICITACIÓN (texto completo; escaneados ya leídos por visión). Cada página trae [[PÁGINA N]] — usa ESE número al citar.
${docsTexto || '(no se pudo extraer texto)'}

Analiza TODO y devuelve EXACTAMENTE este JSON (v3; cita FUENTE con documento+artículo+PÁGINA en cada punto; no inventes):
${esquemaV3(codigo)}`;
}

// Deriva score/semáforo/área/confianza del informe v3 (usa atractivo.score_total + veredicto + gate).
function derivarV3(inf: any): { score: number; semaforo: string; area: string; confianza: number } {
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  // v3.1: el atractivo es NUMÉRICO y VISIBLE (atractivo.score_total 0-15 + modificadores).
  // Compat: informes antiguos guardaban el puntaje oculto en atractivo._interno.score_total.
  const scoreTot = Number(inf?.atractivo?.score_total ?? inf?.atractivo?._interno?.score_total) || 0; // 0-15 (+ modificadores)
  let score = clamp((scoreTot / 15) * 100);
  const pres = inf?.presupuesto || {};
  const nItems = Array.isArray(inf?.costeo?.items) ? inf.costeo.items.length : 0;
  const gateEf = gatePresupuestoDeterminista(pres.bruto ?? null, pres.neto ?? null, nItems, !!pres.presupuesto_exento) ?? pres.gate;
  const nivel = String(inf?.veredicto?.nivel || inf?.atractivo?.nivel || inf?.atractivo?._interno?.nivel_tecnico || '').toUpperCase();
  const gateDuro = !!inf?.exclusion?.excluido || gateEf === 'NO_CALIFICA' || nivel === 'DESCARTE';
  if (gateDuro) score = Math.min(score, 19);
  else if (gateEf === 'DESCARTE_CONDICIONAL' || nivel === 'POCO_VIABLE') score = Math.min(score, 39);
  const semaforo = score >= 80 ? 'VERDE' : score >= 60 ? 'AMARILLO' : score >= 40 ? 'NARANJA' : score >= 20 ? 'ROJO' : 'ROJO_DURO';
  const area = String(inf?.meta?.linea_negocio || 'mixto').toUpperCase();
  const areaNorm = area.startsWith('FERR') ? 'FERRETERIA' : area.startsWith('EQUIP') ? 'EQUIPAMIENTO' : 'MIXTO';
  const confs = [inf?.exclusion?.confianza, inf?.adjudicacion?.confianza].filter((n: any) => typeof n === 'number' && n > 0);
  let confianza = confs.length ? confs.reduce((a: number, b: number) => a + b, 0) / confs.length : 0.7;
  if (inf?.veredicto?.estado_veredicto === 'REVISION_HUMANA') confianza = Math.min(confianza, 0.55);
  return { score, semaforo, area: areaNorm, confianza: Math.round(confianza * 100) / 100 };
}

// Orquestación v3: reusa la carga de documentos/contexto/señal del v2, cambia prompt+esquema.
export async function analizarViabilidadIAV3(codigo: string): Promise<any | null> {
  const docs = await cargarDocumentos(codigo);
  const leidos = docs.filter(d => d.ok);
  if (leidos.length === 0) return null;
  const ctx = await cargarContexto(codigo);

  let planilla: ReturnType<typeof parsearPlanillaCosteo> = null;
  try {
    const fuentes = leidos.filter(d => (d.categoria || '').toUpperCase() !== 'DOCUMENTOS_PROPIOS' && !/^COSTEO_/i.test(d.nombre));
    planilla = parsearPlanillaCosteo(fuentes.map(d => ({ nombre: d.nombre, categoria: d.categoria, texto: d.texto, metodo: d.metodo })));
  } catch { /* opcional */ }
  let lineasForm: number[] = [];
  let totalUnico = false;
  let lenguajePorLinea: string | null = null;
  try {
    lineasForm = detectarLineasFormulario(leidos);
    totalUnico = detectarOfertaTotalUnico(leidos);
    lenguajePorLinea = detectarLenguajePorLinea(leidos);
  } catch { /* señal opcional */ }
  const senal = construirSenalModalidad(planilla, lineasForm, totalUnico, lenguajePorLinea);

  const userPrompt = construirUserPromptV3(codigo, ctx, docs, senal, planilla?.fuenteDoc);
  const parsed = await llamarGeminiJSON(SYSTEM_PROMPT_V3, userPrompt);
  if (!parsed || typeof parsed !== 'object') return null;

  // OVERRIDE DETERMINISTA de "cómo se adjudica" (mismo criterio que el v2.1, adaptado al eje
  // GLOBAL/POR_LINEAS del v3): el listado de ítems MANDA sobre el LLM cuando es concluyente.
  const p3 = parsed as any;
  const adj = p3.adjudicacion && typeof p3.adjudicacion === 'object' ? p3.adjudicacion : (p3.adjudicacion = {});
  const det = veredictoModalidadDeterminista(planilla, totalUnico, lenguajePorLinea);
  if (det) {
    const comoDet = det.tipo === 'suma_alzada' ? 'GLOBAL' : 'POR_LINEAS';
    const comoLLM = String(adj.como_se_adjudica || '').toUpperCase();
    // No pisar POR_LOTES del modelo (suma_alzada por bloque que el parser no distingue de global).
    if (!(det.tipo === 'suma_alzada' && comoLLM.includes('LOTE'))) {
      if (comoLLM !== comoDet) console.log(`[viabilidad-ia-v3] ${codigo}: adjudicación corregida por estructura del listado: "${comoLLM || '—'}" → "${comoDet}" (${det.motivo}).`);
      adj.como_se_adjudica = comoDet;
      adj.estado = 'DETERMINADA';
      adj.evidencia = adj.evidencia ? `${adj.evidencia} [ajuste por estructura del listado: ${det.motivo}]` : `derivado de la estructura del listado de ítems: ${det.motivo}`;
    }
  } else {
    // RED DE SEGURIDAD (doctrina del proyecto: "por_linea exige EVIDENCIA POSITIVA"). Cuando el
    // veredicto determinista es AMBIGUO (det=null: no hay planilla parseable ni total único
    // detectado) y el LLM eligió POR_LINEAS SIN respaldo objetivo —ni lenguaje explícito de oferta
    // por línea, ni ≥2 fichas "Línea N°", ni numeración que reinicia— NO le creemos: ese es el
    // falso positivo más común (el modelo confunde "se adjudica por línea" —a quién— con "se
    // cotiza por línea" —cómo—). Default SEGURO = GLOBAL (suma alzada, un único total) y se marca
    // REVISION_HUMANA para que un humano confirme. Evita costeos por-línea equivocados.
    const comoLLM = String(adj.como_se_adjudica || '').toUpperCase();
    const hayEvidenciaPorLinea = !!lenguajePorLinea
      || lineasForm.length >= 2
      || (!!planilla && planilla.estructura === 'por_linea' && planilla.numeracion === 'reinicia');
    if (comoLLM.includes('LINEA') && !hayEvidenciaPorLinea) {
      console.log(`[viabilidad-ia-v3] ${codigo}: POR_LINEAS del LLM SIN evidencia objetiva → default seguro GLOBAL (suma_alzada) + REVISION_HUMANA.`);
      adj.como_se_adjudica = 'GLOBAL';
      adj.estado = 'REVISION_HUMANA';
      adj.evidencia = adj.evidencia
        ? `${adj.evidencia} [sin evidencia de oferta por línea → default suma alzada; requiere confirmación humana]`
        : `sin evidencia objetiva de oferta por línea (ni lenguaje explícito, ni fichas "Línea N°", ni numeración que reinicia) → default suma alzada; requiere confirmación humana`;
    }
  }

  // PUENTE AL COSTEO (shape v2): autoGenerarCosteo/adaptarViabilidadACosteo consumen
  // manifiesto_productos + modalidad.tipo + estructura_costeo. El parser da el listado fiel con
  // línea/categoría reales (misma regla que el v2.1: si trae ≥ ítems que el modelo, su manifiesto manda).
  const comoFinal = String(adj.como_se_adjudica || '').toUpperCase();
  const tipoCosteo: 'suma_alzada' | 'por_linea' = comoFinal.includes('LINEA') ? 'por_linea' : 'suma_alzada';
  let manifiesto: ManifiestoLinea[] = Array.isArray(p3.costeo?.items)
    ? p3.costeo.items.map((it: any) => ({
        linea: Number(it.linea) || 1, categoria: it.categoria ?? null,
        descripcion: _str(it.descripcion_exacta || it.descripcion), modelo: _str(it.marca_modelo),
        cantidad: _num(it.cantidad), unidad_medida: _str(it.unidad_medida), unidad_inferida: _bool(it.unidad_inferida),
        presupuesto_linea: _num(it.presupuesto_linea), tipo: _str(it.tipo) || 'generico', ruta: _str(it.ruta),
      }))
    : [];
  let estructuraCosteo: 'por_categoria' | null = null;
  if (planilla && planilla.items.length >= manifiesto.length && planilla.items.length >= 8) {
    manifiesto = planilla.items.map(it => ({
      linea: it.linea || 1, categoria: it.categoria, descripcion: it.descripcion, modelo: '',
      cantidad: it.cantidad, unidad_medida: it.unidad, unidad_inferida: !it.unidad,
      presupuesto_linea: null, tipo: 'generico', ruta: '',
    }));
    if (planilla.estructura === 'por_categoria') estructuraCosteo = 'por_categoria';
    console.log(`[viabilidad-ia-v3] ${codigo}: manifiesto desde planilla "${planilla.fuenteDoc}" — ${planilla.items.length} ítems (${planilla.estructura}).`);
  }
  // Refleja la adjudicación corregida en el string de hojas del costeo (display v3).
  if (p3.costeo && typeof p3.costeo === 'object') {
    const nLineas = new Set(manifiesto.map(m => m.linea)).size || 1;
    p3.costeo.hojas_segun_adjudicacion = tipoCosteo === 'por_linea' ? `POR_LINEAS:${nLineas}` : (comoFinal.includes('LOTE') ? `POR_LOTES:${nLineas}` : 'GLOBAL:1');
  }

  const { score, semaforo, area, confianza } = derivarV3(parsed);
  return {
    ...parsed,
    _schema: 'v3',
    score_0_100: score, semaforo, area_negocio: area, confianza_global: confianza,
    // Puente al costeo (shape v2) — no se muestra en la pantalla v3, alimenta el Excel de costeo.
    manifiesto_productos: manifiesto,
    modalidad: { tipo: tipoCosteo },
    estructura_costeo: estructuraCosteo,
    documentos_leidos: leidos.map(d => d.nombre),
    documentos_no_leidos: docs.filter(d => !d.ok).map(d => `${d.nombre} (${d.metodo})`),
    docs_hash: await calcularDocsHash(codigo),
  };
}

// Guarda el informe v3 bajo _informe_ia_v3 (NO pisa _informe_ia del v2). Actualiza también
// score/semáforo/área para que el radar refleje el análisis probado con el flag.
async function guardarViabilidadIAV3(codigo: string, r: any): Promise<void> {
  const [rows] = await pool.query(`SELECT informe_ejecutivo FROM viabilidad_licitacion WHERE licitacion_codigo = ? LIMIT 1`, [codigo]);
  const fila = (rows as any[])[0];
  if (fila) {
    let ie: any = {};
    try { ie = typeof fila.informe_ejecutivo === 'string' ? JSON.parse(fila.informe_ejecutivo) : (fila.informe_ejecutivo || {}); } catch { ie = {}; }
    ie._informe_ia_v3 = r;
    await pool.query(
      `UPDATE viabilidad_licitacion SET informe_ejecutivo = ?, score_total = ?, semaforo = ?, area_negocio = ?, confianza_analisis = ?, modelo = ? WHERE licitacion_codigo = ?`,
      [JSON.stringify(ie), r.score_0_100, r.semaforo, r.area_negocio, r.confianza_global ?? null, `ia+v3+${MODELO_TEXTO}`, codigo]);
  } else {
    await pool.query(
      `INSERT INTO viabilidad_licitacion (licitacion_codigo, informe_ejecutivo, score_total, semaforo, area_negocio, confianza_analisis, modelo) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [codigo, JSON.stringify({ _informe_ia_v3: r }), r.score_0_100, r.semaforo, r.area_negocio, r.confianza_global ?? null, `ia+v3+${MODELO_TEXTO}`]);
  }
}

export async function analizarYGuardarViabilidadIA(codigo: string): Promise<ViabilidadIAResult | null> {
  // Analizador ÚNICO v3: prompt/esquema modular, override determinista de adjudicación y puente
  // al costeo (manifiesto_productos/modalidad/estructura_costeo que arma analizarViabilidadIAV3).
  const rv3 = await analizarViabilidadIAV3(codigo);
  if (!rv3) return null;
  try { await guardarViabilidadIAV3(codigo, rv3); }
  catch (e) { console.error('[viabilidad-ia-v3] guardar falló:', String(e).slice(0, 200)); }
  // Vuelca ítems al negocio y genera el Excel de costeo.
  try { await volcarManifiestoAItems(codigo, rv3 as any); }
  catch (e) { console.error('[viabilidad-ia-v3] volcar ítems falló:', String(e).slice(0, 200)); }
  try { await autoGenerarCosteo(codigo, rv3 as any); }
  catch (e) { console.error('[viabilidad-ia-v3] generar costeo falló:', String(e).slice(0, 200)); }
  return rv3 as any;
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
