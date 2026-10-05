// app/lib/viabilidad-ia.ts
// VIABILIDAD v4.0 + NIVEL DE ATRACTIVO v4.1 (02-oct-2026) — "el modelo extrae; el código decide".
// El prompt v4.0 (viabilidad-v4/prompt-v4.ts) solo EXTRAE datos con su cita {documento, numeral,
// frase}; el código decide adjudicación (tabla de decisión), exclusión por suministro, plazo
// previo, multa en pesos, conteos, admisibilidad y el NIVEL (score-viabilidad.ts). El prompt v3.4
// quedó sin uso en viabilidad-prompt-v3-respaldo.ts.
//
// (Historia, v3.1) Analista IA (PROMPT 2 consolidado).
// STACK ACTUAL (2026-07): GLM de Z.AI end-to-end. El ANÁLISIS lo hace MODELO_TEXTO
// (glm-4.7-flashx, respaldo DeepSeek) vía crearChatIA; los documentos ESCANEADOS se leen con
// GLM-OCR (IA_OCR_PROVIDER=zai) que preserva tablas y numera cada página con [[PÁGINA N]].
//
// GEMINI ESTÁ RETIRADO: los caminos gemini (llamarGeminiNativoJSON, extracción por visión)
// solo corren si se reactiva a propósito (IA_TEXT_PROVIDER=gemini / GEMINI_HABILITADO=1 + key).
// Sin eso son código dormido; NO intervienen en el análisis ni en el OCR de hoy.
//
// El score determinista 0-100 (viabilidad.ts) se conserva como CONTROL; este módulo
// añade el veredicto IA encima (decisión del usuario: "IA manda, score como control").

import { createHash } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import pool from '@/app/lib/db';
import { descargarYExtraerTexto } from '@/app/lib/document-extraction';
import { parseJsonIA, parseJsonIAConTraza } from '@/app/lib/json-ia';
import { getMercadoPublicoClient } from '@/app/lib/mercado-publico';
import { extractTipoFromCodigo } from '@/app/lib/tipos-licitacion';
import { crearChatIA, IA_TEXT_PROVIDER, MODELO_TEXTO, conAcumuladorCostoIA, costoAcumuladoActual } from '@/app/lib/gemini';
import { leerClausulaAdjudicacion } from '@/app/lib/clausulas-adjudicacion';
import { parsearPlanillaCosteo, detectarOfertaTotalUnico, detectarLenguajePorLinea, detectarParticipacionParcialPorLinea, detectarPresupuestoPorLinea, detectarOfertaSubconjuntoItems, detectarCuadroEconomicoPorLinea, extraerSeccionesLineaProducto, seccionesSonFichasDeCaracteristicas, detectarFormulariosEconomicosPorArchivo, detectarTipoAdjudicacionMultiple, detectarLicitacionTipoMultiple, extraerPresupuestoPorLineaTabla, extraerListadoCanonicoBases, decidirReemplazoPorCanonica, esFilaNoProducto } from '@/app/lib/planilla-costeo-parser';

// Re-export para no romper a quien lo importaba desde acá (el filtro vive ahora en
// planilla-costeo-parser.ts, módulo PURO sin dependencias, para que generar-costeo.ts también
// pueda usarlo sin crear una importación circular — ver el comentario de la función).
export { esFilaNoProducto };
import { planillaReconoceElListado } from '@/app/lib/fila-no-producto';
import { desplegarItemsDesdeCaracteristicas } from '@/app/lib/manifiesto-desde-caracteristicas';
import { seccionesDeEquipos } from '@/app/lib/caracteristicas-seccion';
import { evaluarCoberturaLectura, resumirCobertura, esFormatoLegible, esDocumentoCritico } from '@/app/lib/lectura-documentos';
import { ocrTieneHuecos, esTextoBasuraOCR, numeracionTablaIncompleta, leidoConOcrLocal, glmOcrDisponible } from '@/app/lib/zai-ocr';
import { cargarReglasLectura, bloqueReglasLectura, cargarReglasAprendidasConId, bloqueReglasAprendidas, cargarReglasLecturaConFirma, bloqueReglasLecturaSimilares, calcularFirmaDocumentos, firmasSimilares } from '@/app/lib/viabilidad-feedback';
import { anularPuntajesMinimosCero, validarInformeViabilidad, autocorregirHallazgos, escalarARevisionHumana, validarNivelV27 } from '@/app/lib/validador-viabilidad';
import { analizarRemisionACriterios, hayTablaDeCriterios, motivoCriteriosNoConfiables, extraerSeccionCriteriosEvaluacion } from '@/app/lib/criterios-en-anexo';
import { obtenerTipoCambio } from '@/app/lib/tipo-cambio';
import { calcularNivel } from '@/app/lib/score-viabilidad';
import { nombresFamilias } from '@/app/lib/viabilidad-v4/config';
import { cargarConfigViabilidad } from '@/app/lib/viabilidad-v4/cargar-config';
import { PROMPT_VERSION_V4, SYSTEM_PROMPT_V4, BLOQUE_BARRIDO_V4, construirUserPromptV4 } from '@/app/lib/viabilidad-v4/prompt-v4';
import { LocalizadorCitas, localizarCitasInforme } from '@/app/lib/viabilidad-v4/citas';
import { CATALOGO, decidirAdjudicacion, deduplicarEvidencias, evidenciasDeDetectores, evidenciasDelModelo, marcarEvidenciasQueCuentan, type EvidenciaAdj, type SenalesDetectores } from '@/app/lib/viabilidad-v4/adjudicacion';
import { HITO_LABEL, NOTA_ACEPTACION_OC, calcularPlazoPrevio, detectarNegaciones, feriadosPara, normalizarHitos, type HitoInforme } from '@/app/lib/viabilidad-v4/plazo-previo';
import { calcularMulta, indicadorNecesario } from '@/app/lib/viabilidad-v4/multa';
import { NOTA_ART_32, interpretarMonto, interpretarPorLinea, normalizarCaracter, sumaLineasCuadra } from '@/app/lib/viabilidad-v4/presupuesto';
import { barridoConsecuencias, decidirSuministro, detectarSenalesSuministro, esObviedad } from '@/app/lib/viabilidad-v4/admisibilidad';
import { normalizarTextosInforme } from '@/app/lib/viabilidad-v4/textos';
import { reasignarLineasPorTablaDeMontos, construirListaUnica, conteoCruzado, problemasCalidadManifiesto, verificarCaracteristicasLiterales } from '@/app/lib/viabilidad-v4/productos';
import { verificarSemantica, type ParSemantico } from '@/app/lib/viabilidad-v4/verificador-semantico';

const GEMINI_MODEL = 'gemini-2.5-flash';
// Fallback ante el 503 "high demand": `gemini-2.5-flash` se satura seguido en requests
// grandes (medido: ~1 de 3 falla). El alias `gemini-flash-latest` rutea a capacidad más
// estable (medido: 6/6 en el mismo request grande). Se usa solo cuando el primario da 503/429.
const GEMINI_MODEL_FALLBACK = 'gemini-flash-latest';
const MAX_CHARS_DOCS = 400_000;   // ~100k tokens de documentos (Flash aguanta de sobra)
// RECORTE DE INPUT PARA EL ANÁLISIS. El tope global de lo que ve el LLM. glm-4.7-flashx tiene un
// contexto grande (~128k tokens), así que subimos el default a 350k chars (~95k tokens): que NO se
// pierdan criterios/presupuesto por truncar documentos. NO afecta a las señales deterministas
// (parser/modalidad), que corren sobre el texto COMPLETO cacheado antes del recorte.
const MAX_CHARS_DOCS_ANALISIS = Math.max(60_000, Number(process.env.VIABILIDAD_MAX_CHARS_ANALISIS) || 350_000);
// Tope por documento de BAJA jerarquía (anexos/formularios en blanco). Los que deciden
// (aclaraciones, bases admin/técnicas y la planilla de cotización) van ENTEROS. Subido a 15k para
// no cortar anexos donde a veces vive un criterio o el presupuesto por línea.
const MAX_CHARS_DOC_RELLENO = Math.max(3_000, Number(process.env.VIABILIDAD_MAX_CHARS_DOC_RELLENO) || 15_000);
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

  // ── Derivados en código (no salen del modelo) ──
  // v4.1: el score 0-100 y el semáforo de la IA salieron; entra el NIVEL de atractivo (score-viabilidad.ts).
  score?: import('@/app/lib/score-viabilidad').ScoreV4;
  area_negocio: string;      // FERRETERIA | EQUIPAMIENTO | MIXTO (de meta.linea_negocio)
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
  //
  // LOG EN TIEMPO REAL, SIEMPRE ACTIVO (14-ago-2026, pedido explícito del usuario: "quiero saber
  // qué hace en tiempo real"). Antes el único log de lectura de documentos era el resumen de
  // `VIAB_DEBUG` al FINAL de este bucle completo (línea de abajo) — mientras la fase
  // "leyendo_documentos" estaba en curso (puede tardar minutos con OCR de por medio) no salía NADA
  // a la consola, indistinguible de un proceso colgado. Estas dos líneas (inicio/fin de CADA
  // documento) no dependen de ninguna env var — son el rastro mínimo para saber, mirando el log en
  // vivo, en qué documento puntual está el análisis y si avanza.
  for (let i = 0; i < docs.length; i += 2) {
    const batch = docs.slice(i, i + 2);
    const res = await Promise.all(batch.map(async (d, j) => {
      const pos = i + j + 1;
      const cacheTxt = (d.texto_extraido || '').trim();
      // CACHÉ: si ya leímos este documento antes, reusamos el texto (no re-OCR) → rápido.
      // EXCEPCIÓN (auto-sanación): si el OCR cacheado quedó INCOMPLETO (marca de hueco) o
      // es BASURA (capa de texto ilegible del escáner — caso 2731-21-LE26), NO lo reusamos:
      // se re-extrae (document-extraction ahora enruta la basura a GLM-OCR) y se persiste.
      // También se re-lee si quedó por OCR local (Tesseract) o con la numeración de la tabla rota
      // (ítems 1..N que empiezan en 24): ahí el relleno tapó un hueco real. Solo si GLM-OCR responde.
      const sospechoso = glmOcrDisponible() && (leidoConOcrLocal(d.metodo_extraccion) || numeracionTablaIncompleta(cacheTxt));
      if (cacheTxt.length >= 50 && !ocrTieneHuecos(cacheTxt) && !esTextoBasuraOCR(cacheTxt) && !sospechoso) {
        console.log(`[viabilidad-ia] ${codigo}: [${pos}/${docs.length}] "${d.documento_nombre}" — ya está en caché (${cacheTxt.length} chars), no se vuelve a leer.`);
        return { nombre: d.documento_nombre, categoria: d.categoria, texto: cacheTxt, metodo: d.metodo_extraccion || 'cache', ok: true } as DocLeido;
      }
      const omiteOCR = noRequiereOCR(d.documento_nombre);
      console.log(`[viabilidad-ia] ${codigo}: [${pos}/${docs.length}] leyendo "${d.documento_nombre}"${omiteOCR ? '' : ' (puede necesitar OCR si es escaneado — puede tardar 1-2 min)'}…`);
      const t0doc = Date.now();
      const r = await descargarYExtraerTexto(d.documento_url_local, d.documento_nombre, { omitirOCR: omiteOCR }).catch(() => null);
      const texto = (r?.texto || '').replace(/\s+\n/g, '\n').trim();
      const metodo = r?.metodo || 'error';
      const segs = ((Date.now() - t0doc) / 1000).toFixed(1);
      // Re-lectura por "sospechoso" que falló: no se pierde el texto que ya había.
      if (sospechoso && texto.length < 50 && cacheTxt.length >= 50) {
        console.warn(`[viabilidad-ia] ${codigo}: [${pos}/${docs.length}] "${d.documento_nombre}" — la re-lectura falló, se conserva el texto en caché.`);
        return { nombre: d.documento_nombre, categoria: d.categoria, texto: cacheTxt, metodo: d.metodo_extraccion || 'cache', ok: true } as DocLeido;
      }
      console.log(texto.length >= 50
        ? `[viabilidad-ia] ${codigo}: [${pos}/${docs.length}] "${d.documento_nombre}" leído en ${segs}s → ${texto.length} chars (método=${metodo}).`
        : `[viabilidad-ia] ${codigo}: [${pos}/${docs.length}] "${d.documento_nombre}" NO se pudo leer (${segs}s, método=${metodo}) — queda sin texto.`);
      // Persistir SIEMPRE el resultado de la lectura — el éxito con su texto, y el FALLO con su
      // método. (26-ago-2026.) Antes esto solo se guardaba cuando había ≥50 chars: un documento
      // que no se pudo leer quedaba con metodo_extraccion=NULL, indistinguible de uno que nunca
      // se intentó. Así se acumularon 1.889 fallos invisibles en 375 licitaciones que igual
      // entregaron informe. Dejar escrito "se intentó y salió pdf-sin-texto" es lo que permite
      // detectarlo, contarlo y avisar en vez de seguir de largo.
      if (texto.length >= 50) {
        pool.query(
          `UPDATE documentos_cache SET texto_extraido = ?, metodo_extraccion = ?, texto_extraido_at = NOW()
           WHERE licitacion_codigo = ? AND documento_nombre = ?`,
          [texto, metodo, codigo, d.documento_nombre],
        ).catch(() => { /* columna puede no existir aún */ });
      } else {
        pool.query(
          `UPDATE documentos_cache SET metodo_extraccion = ?, texto_extraido_at = NOW()
           WHERE licitacion_codigo = ? AND documento_nombre = ?`,
          [metodo || 'error', codigo, d.documento_nombre],
        ).catch(() => { /* best-effort: el aviso al usuario no depende de esto */ });
      }
      return { nombre: d.documento_nombre, categoria: d.categoria, texto, metodo, ok: texto.length >= 50 } as DocLeido;
    }));
    out.push(...res);
  }
  // ─── SEGUNDA PASADA sobre los CRÍTICOS que no se pudieron leer ───────────────────────────
  // (26-ago-2026.) Un documento crítico sin texto invalida el informe entero, así que antes de
  // gastar una llamada de IA se reintenta acá mismo — dentro del análisis, no en un re-análisis
  // posterior, que costaría IA de nuevo. El reintento fuerza el OCR: la primera pasada puede
  // haberlo salteado por `noRequiereOCR` (que decide por el NOMBRE del archivo y se equivoca
  // cuando unas bases vienen escaneadas con un nombre que parece de plano).
  // Leer es barato comparado con analizar: Word y Excel salen en décimas de segundo y sin gastar
  // cuota. Al medir los 1.889 fallos históricos, 9 de cada 10 se leyeron a la primera al
  // reintentarlos — eran recuperables y nadie los volvió a mirar.
  const aReintentar = out.filter(d => !d.ok && esFormatoLegible(d.nombre) && esDocumentoCritico(d.categoria, d.nombre));
  if (aReintentar.length) {
    console.warn(`[viabilidad-ia] ${codigo}: ${aReintentar.length} documento(s) CRÍTICOS sin texto — segunda pasada forzando OCR…`);
    const porNombre = new Map(docs.map(d => [d.documento_nombre, d.documento_url_local]));
    for (const doc of aReintentar) {
      const url = porNombre.get(doc.nombre);
      if (!url) continue;
      const t0 = Date.now();
      const r = await descargarYExtraerTexto(url, doc.nombre, {}).catch(() => null);
      const texto = (r?.texto || '').replace(/\s+\n/g, '\n').trim();
      const segs = ((Date.now() - t0) / 1000).toFixed(1);
      if (texto.length >= 50) {
        doc.texto = texto; doc.metodo = r?.metodo || 'reintento'; doc.ok = true;
        console.log(`[viabilidad-ia] ${codigo}: ✔ recuperado en 2ª pasada "${doc.nombre}" → ${texto.length} chars (${doc.metodo}, ${segs}s).`);
        pool.query(
          `UPDATE documentos_cache SET texto_extraido = ?, metodo_extraccion = ?, texto_extraido_at = NOW()
           WHERE licitacion_codigo = ? AND documento_nombre = ?`,
          [texto, doc.metodo, codigo, doc.nombre],
        ).catch(() => { /* best-effort */ });
      } else {
        doc.metodo = r?.metodo || 'error';
        console.error(`[viabilidad-ia] ${codigo}: ✘ "${doc.nombre}" NO se pudo leer ni en 2ª pasada (${doc.metodo}, ${segs}s) — el informe quedará marcado como incompleto.`);
      }
    }
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
  let meta = { nombre: '', organismo: '', region: '', monto: null as number | null, cierre: null as any, fechaAdjudicacion: null as string | null };
  try {
    const [r] = await pool.query(
      `SELECT licitacion_nombre, licitacion_organismo, licitacion_region, licitacion_monto, licitacion_cierre
       FROM alertas_licitaciones WHERE licitacion_codigo = ? ORDER BY created_at DESC LIMIT 1`, [codigo]);
    const a = (r as any[])[0];
    if (a) meta = { ...meta, nombre: a.licitacion_nombre || '', organismo: a.licitacion_organismo || '', region: a.licitacion_region || '', monto: a.licitacion_monto ?? null, cierre: a.licitacion_cierre ?? null };
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
      // v4.0 (P3): el plazo previo se suma desde la adjudicación estimada que publica MP.
      const fAdj = (lic as any).Fechas?.FechaAdjudicacion;
      if (fAdj) meta.fechaAdjudicacion = String(fAdj);
      itemsMP = (lic.Items || []).map((it: any) => ({ nombre: it.NombreProducto || '', descripcion: it.Descripcion || '', categoria: it.Categoria || '', cantidad: it.Cantidad ?? null, unidad: it.Unidad || it.UnidadMedida || null })).filter((it: any) => it.nombre || it.descripcion);
    }
  } catch { /* noop */ }

  // Respaldo: si la API no respondió a tiempo (timeout de 12 s), las líneas de la última
  // sincronización siguen valiendo. Sin esto, la regla "1 línea en la API = GLOBAL" se apagaba en
  // silencio cada vez que la API fallaba (caso 2950-49-LE26: volvió a POR_LINEAS al reanalizar).
  if (itemsMP.length === 0) {
    try {
      const [r] = await pool.query(`SELECT items_json FROM licitaciones_cache WHERE codigo = ? LIMIT 1`, [codigo]);
      const arr = JSON.parse((r as any[])[0]?.items_json || '[]');
      if (Array.isArray(arr)) {
        itemsMP = arr.map((it: any) => ({ nombre: it.NombreProducto || '', descripcion: it.Descripcion || '', categoria: it.Categoria || '', cantidad: it.Cantidad ?? null, unidad: it.UnidadMedida || it.Unidad || null })).filter((it: any) => it.nombre || it.descripcion);
      }
    } catch { /* sin caché: la guardia queda apagada, como antes */ }
  }

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
// P11 · trazabilidad: qué modelo respondió de verdad y si el JSON vino cortado y se reparó.
export interface TrazaLlamada { modelo?: string; reparado?: boolean; gruposFallidos?: string[]; dividido?: boolean }
// ─── ANÁLISIS DIVIDIDO EN PARALELO (5-oct-2026, 1057448-45-LP26) ───────────────────────────────
// Una sola llamada pedía ~16.000 tokens de salida (57.000 caracteres de JSON) sobre ~100.000 de
// entrada: tardaba 150-780s, más que los topes por modelo (150s/240s) → los 3 primeros eslabones
// se mataban respondiendo bien y un JSON roto obligaba a repetir TODO. Ahora se hacen 4 llamadas
// en paralelo sobre el MISMO prompt, cada una con claves de primer nivel DISTINTAS (el sufijo va al
// final para que el prefijo —y su caché— sea idéntico). Cada una genera ~1/4 del JSON (< 60s) y si
// una falla se repite SOLO esa. Se apaga con VIABILIDAD_DIVIDIR=0 (vuelve a la llamada única).
const GRUPOS_ANALISIS: { nombre: string; claves: string[]; critico: boolean }[] = [
  { nombre: 'decisiones', critico: true, claves: ['meta', 'objeto_principal', 'exclusion', 'presupuesto', 'adjudicacion', 'plazos', 'multas'] },
  { nombre: 'productos', critico: true, claves: ['productos'] },
  { nombre: 'admisibilidad_criterios', critico: false, claves: ['requisitos_admisibilidad', 'criterios_evaluacion'] },
  { nombre: 'sintesis', critico: false, claves: ['atractivo', 'estrategia', 'acciones_y_advertencias', 'tarjeta_decision', 'pendientes_fase3', 'veredicto'] },
];

export function sufijoAlcance(claves: string[]): string {
  return `

═══ ALCANCE DE ESTA LLAMADA ═══
El JSON de arriba se produce en varias llamadas en paralelo. En ESTA llamada devuelve un único objeto JSON con SOLO estas claves de primer nivel: ${claves.map(c => `"${c}"`).join(', ')}.
NO incluyas ninguna otra clave de primer nivel (otras llamadas las producen). Cada clave que sí emitas sigue EXACTAMENTE el esquema indicado, con sus citas. Analiza igual TODOS los documentos.`;
}

export function fusionarGrupos(parciales: { claves: string[]; valor: any }[]): any {
  const out: any = {};
  for (const { claves, valor } of parciales) {
    if (!valor || typeof valor !== 'object') continue;
    for (const k of claves) if (valor[k] !== undefined) out[k] = valor[k];
  }
  return out;
}

// CHECKPOINT por grupo (5-oct-2026): si la corrida muere a mitad de camino (reinicio, bloqueo, tope), los
// grupos que ya terminaron se reutilizan al reintentar: el reintento tarda segundos, no 10 minutos, y no
// se paga la IA dos veces. La clave es el hash del prompt completo + el alcance, así que si cambia un
// documento o una regla, no se reutiliza nada viejo. Vive en el temporal del sistema, 3 h de vigencia.
// Se apaga con VIABILIDAD_CHECKPOINT=0.
const CHECKPOINT_VIGENCIA_MS = 3 * 60 * 60 * 1000;
function rutaCheckpoint(systemPrompt: string, userPrompt: string, claves: string[]): string {
  const h = createHash('sha256').update(systemPrompt).update('|').update(userPrompt).update('|').update(claves.join(',')).digest('hex').slice(0, 40);
  return join(tmpdir(), 'viab-ckpt', `${h}.json`);
}
function leerCheckpoint(ruta: string): { valor: any; modelo?: string; reparado?: boolean } | null {
  if (process.env.VIABILIDAD_CHECKPOINT === '0') return null;
  try {
    if (Date.now() - statSync(ruta).mtimeMs > CHECKPOINT_VIGENCIA_MS) return null;
    return JSON.parse(readFileSync(ruta, 'utf8'));
  } catch { return null; }
}
function escribirCheckpoint(ruta: string, dato: { valor: any; modelo?: string; reparado?: boolean }): void {
  if (process.env.VIABILIDAD_CHECKPOINT === '0') return;
  try {
    mkdirSync(dirname(ruta), { recursive: true });
    writeFileSync(ruta, JSON.stringify(dato));
    for (const f of readdirSync(dirname(ruta))) { // limpieza de lo vencido
      const r = join(dirname(ruta), f);
      try { if (Date.now() - statSync(r).mtimeMs > 24 * 60 * 60 * 1000) unlinkSync(r); } catch { /* otro proceso */ }
    }
  } catch { /* el checkpoint es una optimización: si no se puede escribir, se sigue sin él */ }
}

async function llamarAnalisisDividido(systemPrompt: string, userPrompt: string, traza?: TrazaLlamada): Promise<any> {
  const modelos = new Set<string>();
  let reparado = false;
  const fallidos: string[] = [];
  const resultados = await Promise.all(GRUPOS_ANALISIS.map(async g => {
    let ultimo = '';
    const ruta = rutaCheckpoint(systemPrompt, userPrompt, g.claves);
    const previo = leerCheckpoint(ruta);
    if (previo?.valor && g.claves.some(k => previo.valor[k] !== undefined && previo.valor[k] !== null)) {
      console.log(`[viabilidad-ia] grupo "${g.nombre}" reutilizado de un intento anterior (checkpoint, sin gastar IA).`);
      if (previo.modelo) modelos.add(previo.modelo);
      if (previo.reparado) reparado = true;
      return { claves: g.claves, valor: previo.valor };
    }
    for (let intento = 0; intento < 2; intento++) {
      const t: TrazaLlamada = {};
      const t0 = Date.now();
      try {
        const v = await llamarGlmJSON(systemPrompt, userPrompt + sufijoAlcance(g.claves), t);
        const traeAlgo = v && typeof v === 'object' && g.claves.some(k => v[k] !== undefined && v[k] !== null);
        if (traeAlgo) {
          if (t.modelo) modelos.add(t.modelo);
          if (t.reparado) reparado = true;
          console.log(`[viabilidad-ia] grupo "${g.nombre}" listo en ${((Date.now() - t0) / 1000).toFixed(0)}s (${t.modelo || '?'}${t.reparado ? ', reparado' : ''}).`);
          escribirCheckpoint(ruta, { valor: v, modelo: t.modelo, reparado: t.reparado });
          return { claves: g.claves, valor: v };
        }
        ultimo = 'respuesta sin ninguna de sus claves';
      } catch (e: any) { ultimo = String(e?.message || e).slice(0, 200); }
      console.warn(`[viabilidad-ia] grupo "${g.nombre}" falló (intento ${intento + 1}/2): ${ultimo}`);
    }
    fallidos.push(g.nombre);
    return { claves: g.claves, valor: null, critico: g.critico };
  }));
  const criticoFallo = resultados.some((r: any) => r.valor === null && r.critico);
  if (criticoFallo) throw new Error(`Análisis dividido: falló un grupo crítico (${fallidos.join(', ')})`);
  if (traza) { traza.modelo = [...modelos].join(' + '); traza.reparado = reparado; traza.gruposFallidos = fallidos; traza.dividido = true; }
  return fusionarGrupos(resultados as any);
}

async function llamarGeminiJSON(systemPrompt: string, userPrompt: string, traza?: TrazaLlamada): Promise<any> {
  if (IA_TEXT_PROVIDER !== 'gemini') return llamarGlmJSON(systemPrompt, userPrompt, traza);
  return llamarGeminiNativoJSON(systemPrompt, userPrompt);
}

// ─── EXTRACCIÓN DEDICADA de ítems por "LÍNEA DE PRODUCTO N°X" ─────────────────────
// Para bases técnicas donde los productos vienen en tablas EN PROSA (PDF) que el parser tabular
// no puede desenredar (nombres con palabras-unidad como "tira"/"caja"/"unidad") y que el LLM del
// análisis general RESUME a un ítem por línea. Aquí la tarea es ACOTADA y enfocada: se le pasa al
// modelo SOLO el texto de las secciones "LÍNEA DE PRODUCTO N°X" y se le exige listar TODAS las
// filas de producto de cada línea, sin resumir. Devuelve el manifiesto (o [] si no logra nada).
async function extraerItemsLineasProductoIA(
  secciones: { linea: number; nombre: string; texto: string }[],
): Promise<ManifiestoLinea[]> {
  if (secciones.length < 2) return [];
  const bloque = secciones
    .map(s => `\n===== LÍNEA ${s.linea}${s.nombre ? ` – ${s.nombre}` : ''} =====\n${s.texto}`)
    .join('\n')
    .slice(0, 42_000);

  const sys = `Eres un extractor EXHAUSTIVO de tablas de productos de bases técnicas de licitaciones públicas chilenas.
Te doy varias secciones tituladas "LÍNEA DE PRODUCTO N°X". Cada sección trae una tabla de productos con columnas Artículo/Descripción, Unidad de medida, Cantidad y Detalle. El texto viene de un PDF, así que las celdas pueden estar partidas en varias líneas o mezcladas (el "Detalle" empieza con "-").
TU ÚNICA TAREA: listar TODOS y CADA UNO de los productos de CADA línea. Reglas ESTRICTAS:
- NO resumas, NO agrupes, NO uses el NOMBRE de la línea/kit como si fuera un producto. Cada FILA de la tabla es un producto.
- Reconstruye el nombre completo del producto aunque esté partido en varias líneas (ej. "Canaleta PVC blanco tira 4 m P-25").
- "cantidad" = el número entero de la columna Cantidad. "unidad" = la unidad de medida (Unidad, Tira, Caja, Metros, etc.).
- Subtítulos como "1)Captación", "2)Kit Venturi", "3)Nodo de riego" son GRUPOS dentro de la línea: NO son productos, pero los productos que les siguen SÍ.
- Las CARACTERÍSTICAS / especificaciones técnicas de un producto (procesador, memoria, sistema operativo, pantalla, cables incluidos, conectividad…) NO son productos: son atributos del producto que las encabeza. Un notebook con su lista de specs es UN solo ítem.
- NO inventes productos que no estén en el texto. Si una cantidad no aparece, pon null.
Devuelve SOLO JSON válido: {"lineas":[{"linea":1,"items":[{"descripcion":"...","unidad":"...","cantidad":8}, ...]}, ...]}.`;

  const user = `Extrae TODOS los productos de estas secciones (una entrada por fila de producto, sin resumir):\n${bloque}`;

  let parsed: any;
  try { parsed = await llamarGeminiJSON(sys, user); } catch { return []; }
  if (!parsed || typeof parsed !== 'object') return [];

  const manifiesto: ManifiestoLinea[] = [];
  const lineas = Array.isArray(parsed.lineas) ? parsed.lineas : [];
  for (const l of lineas) {
    const nLinea = Number(l?.linea) || 1;
    const items = Array.isArray(l?.items) ? l.items : [];
    for (const it of items) {
      const desc = _str(it?.descripcion).trim();
      if (desc.length < 3 || !/[a-záéíóúñ]/i.test(desc)) continue;
      manifiesto.push({
        linea: nLinea, categoria: null, descripcion: desc, modelo: '',
        cantidad: _num(it?.cantidad), unidad_medida: _str(it?.unidad), unidad_inferida: !_str(it?.unidad),
        presupuesto_linea: null, tipo: 'generico', ruta: '',
      });
    }
  }
  return manifiesto;
}

// ─── SEGUNDA PASADA: TODOS los requisitos de cada equipo específico ───────────────────────────────
// El análisis general resume las `caracteristicas` cuando el equipo trae muchos requisitos repartidos en apartados (caso 2369-74-LR26: la
// cisterna tenía ~120 y el informe guardó 64; el minicargador ~60 y guardó 33). Aquí, por cada ítem específico, se recorta SU sección en las
// bases (caracteristicas-seccion.ts) y se pide la transcripción literal de TODAS las filas de TODOS los apartados.
// v4.0 (P8, prompt auxiliar C): la transcripción separa CARACTERÍSTICAS del equipo de REQUISITOS GENERALES (garantía, capacitación,
// manuales…), que van a `productos.requisitos_generales`. Ya NO gana "la lista más larga": la segunda pasada reemplaza la del análisis
// general y después el código verifica cada característica literal contra las bases (verificarCaracteristicasLiterales) — lo que no
// exista queda "no encontrada en bases" y no pasa al AUDITOR. Si la pasada falla o no devuelve nada, queda la lista del análisis general.
export async function completarCaracteristicasLiterales(items: any[], docs: DocLeido[], codigo: string, requisitosGenerales: any[] = []): Promise<void> {
  const candidatos = items.filter(it => /espec/i.test(String(it?.clasificacion || it?.tipo || '')) && _str(it?.nombre).length >= 4);
  if (!candidatos.length) return;
  const textos = docs.filter(d => d.ok && (d.categoria || '').toUpperCase() !== 'DOCUMENTOS_PROPIOS' && !/^COSTEO_/i.test(d.nombre));
  const nombres = candidatos.map(it => _str(it.nombre));
  let secciones = new Map<string, string>();
  for (const d of textos) {
    const m = seccionesDeEquipos(d.texto, nombres);
    // Una sola fuente: la que ubica más equipos (las bases técnicas), para no mezclar documentos.
    if (m.size > secciones.size) secciones = m;
  }
  if (!secciones.size) return;
  const sys = `Eres un transcriptor EXHAUSTIVO de requisitos técnicos de bases de licitaciones
públicas chilenas.
Recibes la sección de UN equipo. Su descripción está repartida en varios
apartados (antecedentes, características del vehículo, equipo, cabina, motor,
transmisión, seguridad, carrocería, equipamiento, documentación, garantía,
mantención, capacitación, tablas "Ítem | Característica mínima requerida",
viñetas, etc.). El texto viene de un PDF: las tablas pueden venir partidas en
renglones sueltos.
TAREA: devuelve TODOS los requisitos del equipo, en el orden del documento,
separados en dos listas:
- "caracteristicas": lo que describe al equipo mismo (medidas, potencia,
  capacidad, componentes, accesorios, materiales, desempeño).
- "requisitos_generales": lo que se exige alrededor del equipo (garantía,
  capacitación, manuales, documentación, certificados, mantenciones,
  inscripción, logos, servicio técnico, entrega).
Reglas ESTRICTAS:
- Lee la sección COMPLETA hasta el final: un título de apartado NO termina la
  lista; revisa cada apartado y cada viñeta.
- Copia cada requisito TAL CUAL las bases, con su valor ("Potencia mínima:
  140 HP"). NO resumas, NO agrupes varios requisitos en uno, NO omitas
  ninguno, NO inventes ninguno, NO corrijas palabras.
- Una fila de tabla "Ítem | Característica" es UN requisito ("Ítem: valor").
  Una viñeta es UN requisito. Si una viñeta lista varios elementos
  independientes (p. ej. extintor, baliza, cuñas), sepáralos.
- Incluye lo "deseable". Excluye solo prosa que no exige nada (introducciones,
  destino de uso).
- El sistema verifica que cada texto exista en las bases: lo que no esté
  literal queda marcado para revisión.
Devuelve SOLO JSON: {"caracteristicas":["..."],"requisitos_generales":["..."]}.`;
  await Promise.all(candidatos.map(async it => {
    const sec = secciones.get(_str(it.nombre));
    if (!sec) return;
    try {
      const r = await llamarGeminiJSON(sys, `EQUIPO: ${_str(it.nombre)}

SECCIÓN DE LAS BASES:
${sec}`);
      const limpiar = (arr: any) => (Array.isArray(arr) ? arr : []).map((c: any) => _str(c).trim()).filter((c: string) => c.length >= 3);
      const lista: string[] = limpiar(r?.caracteristicas);
      const generales: string[] = limpiar(r?.requisitos_generales);
      const antes = Array.isArray(it.caracteristicas) ? it.caracteristicas.length : 0;
      if (lista.length) {
        console.log(`[viabilidad-ia-v4] ${codigo}: "${_str(it.nombre)}" características transcritas en segunda pasada: ${antes} → ${lista.length}${generales.length ? ` (+${generales.length} requisitos generales aparte)` : ''}.`);
        it.caracteristicas = lista;
      }
      for (const g of generales) requisitosGenerales.push({ texto: g, producto: _str(it.nombre), cita: { documento: '', numeral: '', frase: g } });
    } catch (e) { console.warn(`[viabilidad-ia-v4] ${codigo}: segunda pasada de "${_str(it.nombre)}" falló:`, String(e).slice(0, 120)); }
  }));
}

// EXTRACCIÓN DEDICADA de la tabla de PONDERACIONES DE CRITERIOS DE EVALUACIÓN, para cuando la
// tabla SÍ está en el cuerpo de las bases (a diferencia de criterios-en-anexo.ts, que cubre el
// caso de un anexo AUSENTE) pero el modelo del análisis principal no la leyó bien — caso real
// 1079650-47-LE26: página marcada "[[PÁGINA 15 — OCR local, calidad menor]]" (Tesseract), texto
// muy destrozado, y con 133.000 caracteres de bases delante el modelo se distrajo y citó el
// formulario del OFERENTE (sin %) en vez de esta tabla. Mismo patrón que
// extraerItemsLineasProductoIA arriba: enfocar la lectura SOLO en la sección recortada
// (extraerSeccionCriteriosEvaluacion) hace mucho más fácil que el modelo la lea bien, aunque el
// OCR esté sucio. Usa GLM (crearChatIA), no Gemini —Gemini está retirado, ver nota en gemini.ts—.
async function extraerPonderacionesCriteriosIA(
  seccionTexto: string,
): Promise<{ nombre: string; ponderacion_pct: number }[]> {
  const sys = `Eres un extractor de tablas de ponderación de criterios de evaluación de licitaciones públicas chilenas.
Te doy la sección "CRITERIOS DE EVALUACIÓN" de unas bases, extraída de un PDF por OCR de baja calidad: puede traer fórmulas ilegibles, palabras partidas por saltos de columna o de página, y "N*" en vez de "N°". A pesar del ruido, el nombre de cada criterio numerado (1, 2, 3…) y su ponderación en % SIGUEN presentes en el texto.
IMPORTANTE: algunas bases (municipales/DAEM) NO usan "%" sino PUNTOS SOBRE 100 ("OFERTA ECONÓMICA 40 PTOS", "TOTAL: 100 PTOS") y fórmulas con "x 100 x 0,40" en vez de "%". Si la tabla suma 100 puntos, trata cada "N PTOS"/"N PUNTOS" como N% — es la misma ponderación, solo escrita distinto.
TU ÚNICA TAREA: listar cada criterio numerado con su nombre corto y su ponderación en % (o su equivalente en puntos sobre 100). Reglas ESTRICTAS:
- Usa el nombre del encabezado numerado ("1) Precio", "2) Plazo de entrega", etc.) para "nombre", no una frase suelta de alrededor.
- La ponderación de un criterio suele aparecer DOS VECES (junto al nombre y de nuevo en la frase "la ponderación asignada a este ítem es de: NN%") — es EL MISMO número, no lo sumes ni lo dupliques.
- Si un criterio numerado no muestra su % ni su puntaje en ninguna parte del texto, OMÍTELO — no inventes un número.
- NO inventes criterios que no estén en el texto. NO agregues el criterio "genérico" de requisitos administrativos si no aparece numerado como los demás.
Devuelve SOLO JSON válido: {"criterios":[{"nombre":"Precio","ponderacion_pct":45}, ...]}.`;
  const user = `Extrae los criterios y su ponderación de esta sección de bases:\n\n${seccionTexto}`;
  try {
    const completion = await crearChatIA({
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
      temperature: 0.1, stream: false, max_tokens: 2_000,
      response_format: { type: 'json_object' },
    }, { timeoutMs: 60_000, soloGlm: true });
    const txt = String(completion.choices?.[0]?.message?.content ?? '');
    const parsed = parseJsonIA<any>(txt);
    const arr = Array.isArray(parsed?.criterios) ? parsed.criterios : [];
    return arr
      .map((c: any) => ({ nombre: _str(c?.nombre).trim(), ponderacion_pct: Number(c?.ponderacion_pct) }))
      .filter((c: { nombre: string; ponderacion_pct: number }) =>
        c.nombre.length >= 2 && Number.isFinite(c.ponderacion_pct) && c.ponderacion_pct > 0 && c.ponderacion_pct <= 100);
  } catch (e) {
    console.warn('[viabilidad-ia-v3] extraerPonderacionesCriteriosIA falló:', String(e).slice(0, 140));
    return [];
  }
}

// GLM (Z.AI) con JSON forzado y reparación de truncado. El manifiesto va al final del
// esquema, así que si se corta por longitud solo se pierde su cola (score/veredicto intactos).
//
// 23-jul-2026 (caso real 2467-70-LE26, colgado ~1h sin terminar): antes este loop reintentaba
// la corrida COMPLETA hasta 3 veces, y cada una de esas 3 vueltas ya reintentaba el proveedor
// activo Y bajaba por TODA la cadena de respaldo dentro de crearChatIA — una explosión de hasta
// 3×(reintentos por modelo)×(N modelos en cadena), cada intento con un timeout de hasta 240s.
// Cuando GLM está realmente caído, eso significa colgarse por horas gastando cada vez más en
// llamadas que nunca iban a responder. crearChatIA YA baja por la cadena completa (ahora 3
// modelos: flashx → 4.7 → 4.5-air) con sus propios reintentos — si esa cadena entera se agota,
// reintentarla de nuevo acá no cambia nada. Este loop ahora SOLO reintenta cuando la llamada
// SÍ respondió pero el JSON vino inválido/truncado (ahí sí vale la pena una segunda pasada).
// UMBRAL DE PROMPT GRANDE (14-ago-2026, medido en vivo con 4563-10-LP26): con un prompt de
// 360.194 chars, el primario (flashx, timeout 130s) Y el primer respaldo (240s) se agotaron por
// timeout ANTES de llegar al modelo de contexto grande que sí respondió (glm-5.2, 201s) — 573 de
// los 600s del tope duro se gastaron solo en LLEGAR a una respuesta útil, sin margen para nada
// más (ni el reintento que hizo falta cuando el JSON salió truncado). El comentario de zai_alt3
// en gemini.ts YA documenta que ese modelo existe justo para el "caso raro" de prompts grandes —
// pero antes SIEMPRE se pagaba el timeout completo de los eslabones livianos antes de llegar a
// él. Con un prompt de este tamaño no es una apuesta: el propio código ya sabe que los modelos
// livianos fallan ahí. Configurable por si el umbral resulta muy agresivo/laxo en la práctica.
const UMBRAL_PROMPT_GRANDE_CHARS = Math.max(50_000, Number(process.env.VIABILIDAD_UMBRAL_PROMPT_GRANDE) || 200_000);

async function llamarGlmJSON(systemPrompt: string, userPrompt: string, traza?: TrazaLlamada): Promise<any> {
  const MAX_INTENTOS_JSON = 2; // 1 reintento si el modelo respondió pero el JSON salió roto
  const promptTotalChars = systemPrompt.length + userPrompt.length;
  // 20-ago-2026 (pedido explícito del usuario tras 3459-24-LE26): YA NO se salta directo a un
  // modelo "grande" cuando el prompt supera UMBRAL_PROMPT_GRANDE_CHARS. Ese salto (a glm-5.2, vía
  // GLM_TEXT_MODEL_FALLBACK3) dejaba afuera a los eslabones intermedios de la escalera —incluido
  // glm-4.5-air, que el usuario quiere que SIEMPRE se intente— y le daba al primario un margen
  // completo (240s) en vez del corto. Ahora, sea grande o no el prompt, se usa SIEMPRE la escalera
  // completa y en orden (flashx → GLM_TEXT_MODEL_FALLBACK → _FALLBACK2 → _FALLBACK3 → deepseek),
  // cada eslabón con su propio margen corto (ver timeoutMsRespaldoGlm más abajo): si uno da timeout,
  // pasa DE INMEDIATO al siguiente, sin esperar el margen completo. Esto ya es seguro desde que
  // timeoutMsRespaldoGlm (75s) capa lo que cuesta probar un eslabón que también falla — el problema
  // original que motivó el salto directo (497s quemados en 4928-23-LP26 antes de esa fecha) ya no
  // aplica. UMBRAL_PROMPT_GRANDE_CHARS queda sin uso activo (solo por si se necesita reactivar).
  if (promptTotalChars > UMBRAL_PROMPT_GRANDE_CHARS) {
    console.log(`[viabilidad-ia] prompt grande (${promptTotalChars} chars) — se usa la escalera completa en orden, sin saltos.`);
  }
  let ultimoErr = '';
  for (let intento = 0; intento < MAX_INTENTOS_JSON; intento++) {
    if (intento > 0) await sleep(5_000);
    let completion: any;
    const t0 = Date.now();
    try {
      // TIMEOUT PROPIO DE LOS RESPALDOS GLM (20-ago-2026, medido en vivo con 2422-144-LE26): un
      // respaldo GLM (misma cuenta Z.AI que el primario) que recibe el margen COMPLETO (240s) es
      // apostar a que un hermano del mismo modelo que ya no respondió sí lo haga — si Z.AI está
      // saturado/caído (como en esa corrida: primario Y los 2 respaldos GLM agotaron sus 240s
      // completos sin responder NADA), esos 240s×2 se comen TODO el presupuesto de la cadena y
      // DeepSeek —el único proveedor realmente distinto, con chance real de estar arriba— nunca
      // llega a intentarse. Más corto (no cero: sigue siendo un intento legítimo si el problema
      // era puntual de ESE modelo, no de la cuenta completa) deja presupuesto real para DeepSeek.
      const timeoutMsRespaldoGlm = Math.max(30_000, Number(process.env.VIABILIDAD_LLM_TIMEOUT_MS_RESPALDO_GLM) || 75_000);
      completion = await crearChatIA({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.15,
        stream: false,
        // 19-ago-2026: configurable. Con 32.000 fijos, una licitación con manifiesto largo (125
        // ítems en 4928-23-LP26) termina en finish=length y el JSON llega sin los últimos bloques
        // del esquema — veredicto, tarjeta_decision, lineas_a_atacar. El default no cambia; sube
        // VIABILIDAD_MAX_TOKENS cuando el modelo lo soporte y el informe se esté cortando.
        max_tokens: Math.max(8_000, Number(process.env.VIABILIDAD_MAX_TOKENS) || 32_000),
        response_format: { type: 'json_object' },
      }, {
        timeoutMs: timeoutMsRespaldoGlm,
        // 13-ago-2026 (pedido del usuario, medido en vivo con 1211839-58-LE26: flashx colgado
        // gastó 690s de los cuales la mayoría fue esperar su propio timeout antes de caer al
        // respaldo). El modelo PRINCIPAL (flashx, pensado para ser el rápido) tiene un margen
        // más corto — casos reales exitosos tardaron 4-93s; si no responde en ese margen, mejor
        // pasar pronto a la cadena de respaldo (que sí conserva el margen completo, 240s por
        // defecto, para los modelos de última instancia). Configurable con
        // VIABILIDAD_LLM_TIMEOUT_MS_PRIMARIO. Mismo margen corto aunque el prompt sea grande
        // (20-ago-2026: ya no se fuerza un modelo "grande" como principal — ver nota arriba).
        timeoutMsPrimario: Math.max(60_000, Number(process.env.VIABILIDAD_LLM_TIMEOUT_MS_PRIMARIO) || 130_000),
        // STREAMING + corte por inactividad (23-sep-2026, 966131-54-LP26: 63k tokens de entrada,
        // salida larga; los 6 eslabones "dieron timeout" aunque respondían — flashx tarda ~280s en
        // generar 16k tokens, más que los 130s/75s de arriba). Ahora esos timeouts solo cubren la
        // espera de cabeceras; mientras el modelo mande datos NO se corta, y si se queda callado
        // VIABILIDAD_STREAM_IDLE_MS (45s) se pasa al siguiente eslabón. Topes totales por eslabón:
        // primario 330s, respaldos 240s (siempre acotados por deadlineMs).
        streamIdleMs: Math.max(20_000, Number(process.env.VIABILIDAD_STREAM_IDLE_MS) || 45_000),
        streamCapMsPrimario: Math.max(120_000, Number(process.env.VIABILIDAD_STREAM_CAP_MS_PRIMARIO) || 200_000),
        streamCapMs: Math.max(90_000, Number(process.env.VIABILIDAD_STREAM_CAP_MS) || 300_000),
        soloGlm: true,
        // ÚLTIMO RECURSO DEEPSEEK (20-ago-2026, pedido explícito del usuario tras 2422-144-LE26:
        // glm-5.2 y glm-4.7 se agotaron por timeout y la licitación quedó SIN análisis). La
        // preferencia sigue siendo GLM —DeepSeek solo se toca cuando la escalera GLM completa se
        // agotó—, pero es mejor terminar el informe con deepseek-v4-flash que devolver un error.
        // Se apaga con VIABILIDAD_RESPALDO_DEEPSEEK=0.
        deepSeekUltimoRecurso: process.env.VIABILIDAD_RESPALDO_DEEPSEEK !== '0',
        // ESLABÓN FINAL GEMINI (31-ago-2026, pedido del usuario tras 2408-165-LE26 y
        // 1079650-68-LE26): DeepSeek —hasta ahora el último de la fila— estaba sin saldo, así que
        // la cadena moría con su 402 y la licitación quedaba sin análisis. Gemini va DETRÁS de
        // DeepSeek: es el tercer proveedor distinto, con cuota propia, y solo se toca cuando los 4
        // GLM y DeepSeek ya fallaron. Se apaga con VIABILIDAD_RESPALDO_GEMINI=0.
        geminiUltimoRecurso: process.env.VIABILIDAD_RESPALDO_GEMINI !== '0',
        // Tope de tiempo para la CADENA completa. OJO: por debajo del tope duro del JOB
        // (VIABILIDAD_JOB_TIMEOUT_MS en la ruta API, 600s por defecto — ver
        // app/api/licitacion-viabilidad-ia/[codigo]/route.ts) a propósito: si este deadline fuera
        // igual o mayor, la cadena podría seguir "intentando" justo cuando el job YA se marcó
        // error por tope duro, y el usuario vería "falló" aunque el análisis real llegara segundos
        // después. Con margen de 120s (para guardar el informe, regenerar el costeo, etc.), un
        // resultado real siempre llega ANTES de que el job se dé por vencido.
        // 25-sep-2026 (4305-18-LE26, prompt de 242k chars): con 480s y el primario gastando 330s, a los
        // respaldos les quedaban ~150s: glm-5 murió por presupuesto y DeepSeek/Gemini NUNCA se probaron.
        // Primario 150s + hasta 4 respaldos de 240s caben en 1080s; el tope del job (route.ts) queda 120s encima.
        deadlineMs: Math.max(180_000, Number(process.env.VIABILIDAD_LLM_DEADLINE_MS) || 1_080_000),
      });
    } catch (e: any) {
      // La CADENA completa (primario + los 2 respaldos GLM) ya se agotó dentro de crearChatIA —
      // reintentar el mismo bloque de nuevo no va a cambiar el resultado, solo suma minutos
      // muertos y gasto. Se propaga de inmediato en vez de darle otra vuelta completa.
      // 31-ago-2026: el rótulo decía "GLM no respondió" para CUALQUIER fallo de la cadena, incluido
      // el de DeepSeek (último eslabón, otro proveedor). En 2408-165-LE26 y 1079650-68-LE26 eso hizo
      // leer un "402 Insufficient Balance" de la cuenta DeepSeek como si los 4 modelos GLM estuvieran
      // sin saldo, cuando GLM respondía normal. El mensaje de crearChatIA ya viene desglosado por
      // eslabón (ver intentarCadena en gemini.ts), así que acá solo se nombra la cadena, no un
      // proveedor. 320 chars: el desglose de 5 eslabones no entra en 200.
      throw new Error(`La cadena de IA no respondió — ${String(e?.message ?? e).slice(0, 320)}`);
    }
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
    // MODELO REAL que respondió, no el primario configurado: cuando el primario se cuelga,
    // crearChatIA cae a la cadena de respaldo y responde OTRO modelo. Loguear MODELO_TEXTO
    // hacía que un análisis resuelto por DeepSeek apareciera como "GLM glm-4.7-flashx", con
    // el costo calculado a tarifa GLM — engañoso justo cuando se está diagnosticando lentitud.
    const modeloReal = String(completion.model || MODELO_TEXTO);
    const esPrimario = modeloReal === MODELO_TEXTO;
    console.log(
      `[viabilidad-ia] 💰 ${modeloReal}${esPrimario ? '' : ' (RESPALDO)'} · ${segs}s · in=${inTok}${cacheStr} out=${outTok} tot=${totTok} tok · finish=${finish} · ~$${costo.toFixed(4)} USD${esPrimario ? '' : ' [costo a tarifa GLM, aprox.]'} (intento ${intento})`,
    );
    dbg(`llamarGlmJSON: respuesta finish=${finish} · usage=${JSON.stringify(completion.usage ?? {})}`);
    const txt = String(completion.choices?.[0]?.message?.content ?? '');
    // Parser tolerante compartido: sanea caracteres de control y repara truncado. v4.0 (P11): si
    // hubo que reparar (o el modelo cortó por largo), queda registrado en la traza.
    const { valor: parsed, reparado } = parseJsonIAConTraza(txt);
    if (parsed) {
      if (traza) { traza.modelo = modeloReal; traza.reparado = reparado || finish === 'length'; }
      return parsed;
    }
    // Sin esto, un JSON inválido es indiagnosticable: deja ver QUÉ devolvió el modelo.
    console.warn(`[viabilidad-ia] JSON inválido (${txt.length} chars). Inicio: ${JSON.stringify(txt.slice(0, 250))} … Fin: ${JSON.stringify(txt.slice(-250))}`);
    try { JSON.parse(txt); } catch (e: any) {
      const pos = Number(String(e?.message).match(/position (\d+)/)?.[1]);
      if (Number.isFinite(pos)) console.warn(`[viabilidad-ia] JSON inválido — error en la posición ${pos}: ${JSON.stringify(txt.slice(Math.max(0, pos - 120), pos + 120))}`);
    }
    ultimoErr = `${modeloReal}: JSON inválido (finish=${finish})`;
    if (intento + 1 < MAX_INTENTOS_JSON) console.warn(`[viabilidad-ia] reintentando la llamada completa (${intento + 1}/${MAX_INTENTOS_JSON})...`);
  }
  throw new Error(`GLM devolvió JSON inválido tras ${MAX_INTENTOS_JSON} intentos: ${ultimoErr}`);
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

// VEREDICTO DETERMINISTA de COSTEO/COTIZACIÓN (VINCULANTE, no solo pista) — "¿CÓMO se cotiza?", NO
// "a quién se adjudica" (ver veredictoAdjudicacionDeterminista arriba, que es la única que decide
// adjudicación desde el 21-jul-2026). Esta función queda para reconectarse al decidir la
// ESTRUCTURA DEL COSTEO (cuántas hojas/líneas en el Excel) de forma independiente de la
// adjudicación — pendiente, "después vemos el costeo" (fase siguiente). A la fecha, tipoCosteo
// sigue derivándose de adj.como_se_adjudica más abajo; esta función no se llama todavía.
//
// Orden de reglas (de mayor a menor autoridad):
//   0. Se puede ofertar a un SUBCONJUNTO de ítems/líneas → por_linea. Manda incluso sobre el
//      total único: suma alzada es todo-o-nada, así que poder omitir ítems lo descarta.
//   1. Total único al pie (formato de oferta manda) → suma_alzada, aunque las bases digan "por línea".
//   2. Lenguaje explícito "se oferta/evalúa por línea" (sin total único) → por_linea.
//   3. Correlativo CONTINUO 1..N cruzando hojas → suma_alzada (una planilla integrada, no lotes).
//   4. Rubros/categorías A/B/C bajo un total → suma_alzada (costeo desglosado por rubro).
//   5. Correlativo que REINICIA/REPITE por línea, o numeración compuesta 1.1/1.2 → por_linea.
function veredictoModalidadDeterminista(
  planilla: ReturnType<typeof parsearPlanillaCosteo>,
  ofertaTotalUnico: boolean,
  lenguajePorLinea: string | null,
  presupuestoPorLinea: string | null = null,
  ofertaSubconjunto: string | null = null,
  cuadroPorLinea: string | null = null,
  formulariosPorArchivo: number[] = [],
  licitacionTipoMultiple: string | null = null,
): { tipo: 'suma_alzada' | 'por_linea'; motivo: string } | null {
  // 0.a EVIDENCIA ESTRUCTURAL MÁS FUERTE QUE CUALQUIER OTRA: archivos de formulario económico
  //     SEPARADOS por línea (uno por archivo). No hay forma de que exista un total único
  //     consolidado si cada línea vive en su propio archivo. Va ANTES que todo lo demás.
  if (formulariosPorArchivo.length >= 2) {
    return { tipo: 'por_linea', motivo: `${formulariosPorArchivo.length} formularios económicos en archivos separados, uno por línea (líneas ${formulariosPorArchivo.slice(0, 10).join(', ')})` };
  }
  // 0.a2 LICITACIÓN DECLARADA "DE TIPO MÚLTIPLE" (campo formal de MP): se puede ofertar todo o
  //     solo algunas líneas, cada una con su propio tope de monto disponible IVA incluido.
  if (licitacionTipoMultiple) {
    return { tipo: 'por_linea', motivo: `licitación declarada de tipo múltiple (se puede ofertar solo a algunas líneas, con tope de monto independiente por línea): "${licitacionTipoMultiple.slice(0, 120)}"` };
  }
  // 0. EXCEPCIÓN a la regla maestra: si el oferente puede postular solo a ALGUNOS ítems y omitir
  //    el resto, no es suma alzada (que es todo-o-nada) por más que el formulario cierre con
  //    "Subtotal/IVA/Total" — ese total es la suma de lo que CADA OFERENTE eligió, no un lote único.
  if (ofertaSubconjunto) {
    return { tipo: 'por_linea', motivo: `las bases permiten ofertar a un subconjunto de ítems/líneas: "${ofertaSubconjunto.slice(0, 80)}"` };
  }
  // 0.b. CUADRO ECONÓMICO POR LÍNEA: una tabla por línea, cada una con su PROPIO cierre
  //      TOTAL/IVA/TOTAL y sin gran total consolidado. Es la MISMA regla maestra (el formato
  //      de la oferta económica manda) aplicada al caso inverso: el formato ES por línea. Va
  //      ANTES que el detector de total único porque este detector ya verificó que NO hay
  //      gran total; si el trío Subtotal/IVA/Total dispara igual, es el cierre DE UNA línea
  //      (caso 1057489-203-LP26: 4 tablas "Línea N", cada una con su Total/IVA/Total).
  if (cuadroPorLinea) {
    return { tipo: 'por_linea', motivo: cuadroPorLinea };
  }
  // 1. Regla maestra: el formato de la oferta económica manda sobre cómo se adjudica.
  if (ofertaTotalUnico) return { tipo: 'suma_alzada', motivo: 'total único consolidado al pie del formulario económico' };
  // 2. Lenguaje explícito de las bases (se oferta/evalúa cada línea por separado).
  if (lenguajePorLinea) return { tipo: 'por_linea', motivo: `lenguaje explícito de las bases: "${lenguajePorLinea.slice(0, 80)}"` };
  // 2b. Presupuesto/monto MÁXIMO por línea con ≥2 líneas presupuestadas (cada una su total).
  //     Evidencia dura de lotes independientes → por_linea, aunque no haya planilla tabulable.
  if (presupuestoPorLinea) return { tipo: 'por_linea', motivo: `monto máximo por línea con presupuesto independiente por línea: "${presupuestoPorLinea.slice(0, 80)}"` };
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

// TEXTO "VERTICAL" (una palabra por línea) — recompactado SOLO para el prompt.
//
// Caso real 2422-144-LE26 (20-ago-2026): "BASES_ADMINISTRATIVAS.pdf" salió de pdf-text con
// 11.030 líneas y 6 caracteres de promedio por línea — cada palabra del documento en su propia
// línea. Eso hace dos daños: (a) infla los tokens del prompt muchísimo (cada salto de línea es un
// token y además parte las palabras en más piezas), que fue lo que llevó el prompt a 202.728
// chars y dejó a glm-5.2 y glm-4.7 en timeout sin poder analizar la licitación; y (b) le entrega
// la prosa despedazada al modelo, que ahí se pierde cláusulas enteras (en este caso "La licitación
// se realizará por líneas… cada oferente podrá ofertar por una o más de las siguientes líneas",
// justo el dato que define si el costeo va por línea o global).
//
// Se rearma pegando las palabras de cada página en párrafos. Los marcadores [[PÁGINA N]] quedan
// intactos y en su propia línea: las citas del informe se apoyan en ellos.
//
// OJO — esto es SOLO para el prompt. Los detectores deterministas y el parser de planilla siguen
// leyendo el texto ORIGINAL a propósito: varios de ellos (parsearItemizadoPdf, las tablas de
// Word) se apoyan justamente en que cada celda venga en su propia línea. Compactar ahí rompería
// la lectura del itemizado.
const RE_MARCA_PAGINA = /^\[\[P[ÁA]GINA[^\]]*\]\]$/i;
export function compactarTextoVertical(texto: string): string {
  const lineas = texto.split(/\r?\n/);
  if (lineas.length < 400) return texto;
  const utiles = lineas.filter(l => l.trim() && !RE_MARCA_PAGINA.test(l.trim()));
  if (utiles.length < 300) return texto;
  const promedio = utiles.reduce((a, l) => a + l.trim().length, 0) / utiles.length;
  if (promedio > 12) return texto; // texto normal (párrafos o tablas): no se toca

  const out: string[] = [];
  let buffer: string[] = [];
  const volcar = () => { if (buffer.length) { out.push(buffer.join(' ')); buffer = []; } };
  for (const cruda of lineas) {
    const l = cruda.trim();
    if (!l) continue;
    if (RE_MARCA_PAGINA.test(l)) { volcar(); out.push(l); continue; }
    buffer.push(l);
    // Corta el párrafo en el punto final: deja el texto en frases legibles en vez de un muro.
    if (/[.:;]$/.test(l)) volcar();
  }
  volcar();
  return out.join('\n');
}

// Arma el bloque de documentos para el ANÁLISIS con recorte por jerarquía: los que DECIDEN
// (aclaraciones/bases/técnicas por prioridadDoc ≤ 3, y la planilla del parser) van ENTEROS; los
// anexos/formularios de relleno se recortan a MAX_CHARS_DOC_RELLENO; tope global MAX_CHARS_DOCS_ANALISIS.
function recortarDocsParaAnalisis(leidos: DocLeido[], docFuentePlanilla?: string): { texto: string; recortadoDocs: number; truncadoGlobal: boolean } {
  let recortadoDocs = 0;
  const partes = leidos.map(d => {
    // La planilla puede venir de VARIOS formularios unidos ("A + B", ver parsearPlanillaCosteo):
    // todos son fuente y ninguno se recorta.
    const protegido = prioridadDoc(d.nombre, d.categoria) <= 3 || d.nombre === docFuentePlanilla
      || (docFuentePlanilla ?? '').split(' + ').includes(d.nombre);
    let txt = compactarTextoVertical(d.texto);
    if (txt.length !== d.texto.length) {
      console.log(`[viabilidad-ia] "${d.nombre}": texto vertical (una palabra por línea) recompactado para el prompt: ${d.texto.length} → ${txt.length} chars.`);
    }
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
// Nº de línea tolerante: v3.3 emite "L1"/"L12" (string); v3.2 y antes emitían 1 (número). Extrae
// los dígitos donde estén. Sin dígitos → 1 (default seguro, igual que el mapeo histórico).
const _lineaNum = (x: any): number => { const m = String(x ?? '').match(/\d+/); return m ? Number(m[0]) : 1; };


// ─── CORRECTOR DETERMINISTA DE PÁGINAS DE CITA ───────────────────────────────────
// El modelo cita a veces la página IMPRESA del PDF (footer "Página 7 de 36", que arranca tras
// portadas/decreto), NO la página física. Aunque el prompt lo prohíbe, el modelo débil la sigue
// usando → la cita manda al usuario a la página equivocada. Fix robusto: NO confiamos en el número
// del modelo; ubicamos la sección citada en el documento (por encabezado de artículo numerado o por
// keywords) y reescribimos la página al número del marcador [[PÁGINA N]] REAL. Solo se corrige
// cuando la ubicación es CONFIABLE (para no romper citas que ya estaban bien).
const _normCita = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
interface PagWin { pag: number; norm: string }
function ventanasPagina(texto: string): PagWin[] {
  const re = /\[\[P[ÁA]GINA\s*(\d+)(?:\s*-\s*\d+)?\]\]/gi;
  const marks: { pag: number; idx: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) marks.push({ pag: Number(m[1]), idx: m.index });
  if (!marks.length) return [];
  const out: PagWin[] = [];
  for (let i = 0; i < marks.length; i++) {
    const fin = i + 1 < marks.length ? marks[i + 1].idx : texto.length;
    out.push({ pag: marks[i].pag, norm: _normCita(texto.slice(marks[i].idx, fin)) });
  }
  return out;
}
// Mapa "número de artículo/punto" → primera página donde aparece su encabezado (## N. TÍTULO).
function mapaArticulos(texto: string): Map<string, number> {
  const map = new Map<string, number>();
  let pag = 0;
  for (const ln of texto.split('\n')) {
    const pm = ln.match(/\[\[P[ÁA]GINA\s*(\d+)/i);
    if (pm) { pag = Number(pm[1]); continue; }
    const hm = ln.match(/^#{0,4}\s*(\d{1,2}(?:\.\d{1,2})?)[.\-)]\s+[A-Za-zÁÉÍÓÚÑ]/);
    if (hm && pag > 0) { const n = hm[1]; if (!map.has(n)) map.set(n, pag); }
  }
  return map;
}
const _STOP_CITA = new Set(['de','la','el','los','las','del','y','o','a','en','para','por','con','se','un','una','al','que','su','sus','base','bases','oferta','ofertas','anexo','articulo','punto','numeral']);
function _tokensSeccion(sec: string): { nums: string[]; palabras: string[] } {
  const nums = (sec.match(/\d+(?:\.\d+)*/g) || []).filter(n => n.length <= 6);
  const palabras = _normCita(sec).split(' ').filter(w => w.length >= 4 && !_STOP_CITA.has(w) && !/^\d/.test(w));
  return { nums, palabras };
}
// Página real de una sección, o null si no se ubica con confianza suficiente.
function paginaRealSeccion(seccion: string, wins: PagWin[], arts: Map<string, number>): number | null {
  const tk = _tokensSeccion(seccion);
  // 1) Sección con nombre → match por keywords sobre las ventanas de página.
  if (tk.palabras.length) {
    let best = -1, bestScore = 0, second = 0;
    for (const w of wins) {
      let s = 0;
      for (const p of tk.palabras) if (w.norm.includes(p)) s++;
      for (const n of tk.nums) if (new RegExp(`(^|[^\\d.])${n.replace('.', '\\.')}([^\\d]|$)`).test(w.norm)) s += 1;
      if (s > bestScore) { second = bestScore; bestScore = s; best = w.pag; }
      else if (s > second) second = s;
    }
    // Exige match FUERTE y claramente único para no reescribir a ciegas una cita ya correcta.
    if (bestScore >= 3 && bestScore >= second + 2) return best;
    return null;
  }
  // 2) Sección = número de artículo pelado → mapa de encabezados (muy confiable).
  if (tk.nums.length === 1 && arts.has(tk.nums[0])) return arts.get(tk.nums[0])!;
  return null;
}
// Recorre el informe y corrige la página de cada "fuente". Muta el objeto in situ.
export function corregirPaginasCitas(inf: any, leidos: { nombre: string; texto: string }[]): { corregidas: number; total: number } {
  const porDoc = new Map<string, { wins: PagWin[]; arts: Map<string, number> }>();
  const normNombre = new Map<string, string>();
  for (const d of leidos) {
    if (!d.texto || !/\[\[P[ÁA]GINA/i.test(d.texto)) continue; // solo docs con marcadores
    porDoc.set(d.nombre, { wins: ventanasPagina(d.texto), arts: mapaArticulos(d.texto) });
    normNombre.set(_normCita(d.nombre), d.nombre);
  }
  let corregidas = 0, total = 0;
  if (!porDoc.size) return { corregidas, total };
  const walk = (o: any) => {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      if (k === 'fuente' && typeof v === 'string' && v.includes('·')) {
        const partes = v.split('·').map(s => s.trim());
        const pm = partes.length >= 2 ? partes[partes.length - 1].match(/p[áa]g\.?\s*(\d+)/i) : null;
        if (pm) {
          total++;
          const docCit = partes[0];
          let doc = porDoc.get(docCit);
          if (!doc) { const key = [...normNombre.keys()].find(kk => kk.includes(_normCita(docCit)) || _normCita(docCit).includes(kk)); if (key) doc = porDoc.get(normNombre.get(key)!); }
          if (doc) {
            const seccion = partes.slice(1, partes.length - 1).join(' · ');
            const real = paginaRealSeccion(seccion, doc.wins, doc.arts);
            if (real != null && real !== Number(pm[1])) {
              (o as any)[k] = v.replace(/p[áa]g\.?\s*\d+(\s*\(aprox[^)]*\))?/i, `pág. ${real}`);
              corregidas++;
            }
          }
        }
      } else walk(v);
    }
  };
  walk(inf);
  return { corregidas, total };
}

// ¿El informe trae un problema de MANIFIESTO que amerita reintentar el análisis completo antes de
// guardar? Dos reglas del validador comparten el mismo tratamiento porque las dos bloquean el
// Frente D (costeo) por completo si se guardan tal cual:
//   V-12 — manifiesto COLAPSADO (cada línea/lote resumida a un ítem genérico).
//   V-09 — manifiesto VACÍO (0 ítems, sin exclusión) — agregado 28-jul-2026, mismo nivel de
//   gravedad que V-12 (nada que costear), antes solo se guardaba en _validador sin reintentar nada.
//   V-23 — (v4.0, P8) calidad mínima del manifiesto: encabezados como producto, cantidades que son
//   el número de fila, sin unidades, texto cortado (Valdivia: 21 "ítems" que eran membretes).
function _reglaManifiestoQueFalla(r: any): 'V-09' | 'V-12' | 'V-23' | null {
  const hallazgos = r?._validador?.hallazgos;
  if (!Array.isArray(hallazgos)) return null;
  if (hallazgos.some((h: any) => h?.regla === 'V-12' && h?.severidad === 'error')) return 'V-12';
  if (hallazgos.some((h: any) => h?.regla === 'V-09' && h?.severidad === 'error')) return 'V-09';
  if (hallazgos.some((h: any) => h?.regla === 'V-23' && h?.severidad === 'error')) return 'V-23';
  return null;
}

// Orquestación (v4.0; el nombre analizarViabilidadIAV3 se conserva porque lo usan los scripts de
// regresión) + REINTENTO AUTOMÁTICO SI EL MANIFIESTO COLAPSÓ (Frente A.2, 21-jul-2026). Caso
// real 2920-30-LE26: el 1er intento cayó a un modelo de respaldo por timeout del principal y devolvió
// 6 ítems genéricos (uno por línea, "unidad_medida: Línea") en vez de los 117 productos reales — el
// validador (V-12) lo detecta, pero por sí solo NO arregla nada: hasta hoy se guardaba igual y el
// Excel de costeo salía con una fila por línea, inútil. Antes de aceptar ese resultado, se intenta
// UNA vez más completa (vuelve a leer documentos y a llamar al modelo desde cero — el mismo camino
// normal probar-primario-antes-de-caer-a-respaldo de siempre, no hay un modo "forzar primario"
// aparte: la única variable es si esta vez el modelo principal alcanza a responder a tiempo). Si el
// reintento sale limpio, se usa. Si TAMBIÉN colapsa, se guarda el menos degradado de los dos (más
// ítems) pero forzado a REVISION_HUMANA con un motivo explícito — nunca se guarda un colapso doble
// en silencio. Costo: hasta 2x SOLO en los casos que colapsan (la mayoría no dispara V-12).
//
// 23-jul-2026: envuelto en conAcumuladorCostoIA para poder loguear el TOTAL gastado en la corrida
// completa (puede ser 1 o 2 llamadas al modelo, más sus respaldos) — antes solo se veía el costo
// de cada llamada suelta, sin un total a la vista. Se loguea SIEMPRE al salir, incluso si la
// corrida termina en error (para ver cuánto se alcanzó a gastar antes de fallar).
// Tabla de montos por ítem de las bases (presupuesto.por_linea, cada fila con su frase literal): si hay ≥2
// filas con frase y monto, es evidencia determinista de que cada línea tiene su propio presupuesto, sin
// depender de que el modelo la reporte en adjudicacion.evidencias (1057448-45-LP26 salía "no claro").
function evidenciaPresupuestoPorLineaDeTabla(porLineaCrudo: unknown): EvidenciaAdj[] {
  const filas = (Array.isArray(porLineaCrudo) ? porLineaCrudo : []).filter((l: any) => l?.cita?.frase && String(l?.monto_texto || '').trim());
  if (filas.length < 2) return [];
  const c = filas[0].cita;
  return [{ tipo: 'PRESUPUESTO_POR_LINEA', origen: 'detector', cita: { documento: String(c.documento || ''), numeral: String(c.numeral || ''), frase: String(c.frase) } }];
}

export async function analizarViabilidadIAV3(codigo: string, onFase?: (fase: FaseAnalisisIA) => void): Promise<any | null> {
  // El log TOTAL debe leerse DENTRO del callback de conAcumuladorCostoIA (que corre dentro de
  // AsyncLocalStorage.run): fuera de ahí el contexto ya cerró y costoAcumuladoActual() da null.
  return conAcumuladorCostoIA(async () => {
    const t0 = Date.now();
    try {
      return await _orquestarAnalisisV3(codigo, onFase);
    } finally {
      const ac = costoAcumuladoActual();
      if (ac) {
        console.log(
          `[viabilidad-ia] 💰 TOTAL ${codigo}: ${ac.llamadas} llamada(s) IA · in=${ac.inTok} out=${ac.outTok} tok · ~$${ac.costoUSD.toFixed(4)} USD · ${((Date.now() - t0) / 1000).toFixed(1)}s`,
        );
      }
    }
  });
}

async function _orquestarAnalisisV3(codigo: string, onFase?: (fase: FaseAnalisisIA) => void): Promise<any | null> {
  console.log(`[viabilidad-ia] ${codigo}: ▶ arrancando análisis de viabilidad IA…`);
  const primero = await _analizarViabilidadIAV4Intento(codigo, onFase);
  const problemaPrimero = primero ? _reglaManifiestoQueFalla(primero) : null;
  if (!primero || !problemaPrimero) return primero;

  console.warn(`[viabilidad-ia-v3] ${codigo}: manifiesto de productos con problema (${problemaPrimero}) en el 1er intento → reintentando análisis completo una vez más antes de guardar.`);
  const segundo = await _analizarViabilidadIAV4Intento(codigo, onFase);
  if (!segundo) return primero; // el reintento no produjo nada (docs/red) → nos quedamos con el primero

  const problemaSegundo = _reglaManifiestoQueFalla(segundo);
  if (!problemaSegundo) {
    console.log(`[viabilidad-ia-v3] ${codigo}: el reintento resolvió el problema del manifiesto (${problemaPrimero} ya no aparece) — se usa el 2º intento.`);
    return segundo;
  }

  const nPrimero = Array.isArray(primero?.productos?.items) ? primero.productos.items.length : 0;
  const nSegundo = Array.isArray(segundo?.productos?.items) ? segundo.productos.items.length : 0;
  const elegido = nSegundo >= nPrimero ? segundo : primero;
  const problemaElegido = elegido === segundo ? problemaSegundo : problemaPrimero;
  console.warn(`[viabilidad-ia-v3] ${codigo}: el reintento TAMBIÉN falló (${problemaSegundo}) — se guarda el menos degradado de los dos (${Math.max(nPrimero, nSegundo)} ítems) forzado a REVISION_HUMANA.`);
  if (elegido.veredicto && typeof elegido.veredicto === 'object') {
    elegido.veredicto.estado_veredicto = 'REVISION_HUMANA';
    if (!Array.isArray(elegido.veredicto.motivos_revision)) elegido.veredicto.motivos_revision = [];
    const detalle = problemaElegido === 'V-09'
      ? 'manifiesto de productos VACÍO (V-09) tras 2 intentos de análisis — no hay base para costear; revisar el documento fuente.'
      : problemaElegido === 'V-23'
      ? 'el listado de productos no pasó el control de calidad (V-23) tras 2 intentos — revisar el documento fuente antes de costear.'
      : 'manifiesto de productos posiblemente colapsado por línea/lote (V-12) tras 2 intentos de análisis — confirmar contra el documento fuente antes de costear.';
    elegido.veredicto.motivos_revision.push(detalle);
  }
  // El nivel se recalcula sobre el informe elegido (por si el reintento cambió un dato que usa).
  try { await aplicarNivel(elegido, codigo); } catch { /* el nivel del intento queda igual */ }
  return elegido;
}

// Un intento completo de análisis v4.0 (lectura de documentos + UNA llamada al modelo que EXTRAE +
// el código que DECIDE + validador + nivel de atractivo). Especificación 1 (P1-P11) y 2 (score).
async function _analizarViabilidadIAV4Intento(codigo: string, onFase?: (fase: FaseAnalisisIA) => void): Promise<any | null> {
  console.log(`[viabilidad-ia] ${codigo}: === FASE leyendo_documentos ===`);
  try { onFase?.('leyendo_documentos'); } catch { /* noop */ }
  const docs = await cargarDocumentos(codigo);
  const leidos = docs.filter(d => d.ok);
  if (leidos.length === 0) return null;

  // ─── PORTERO DE LECTURA ──────────────────────────────────────────────────────────────────
  // (26-ago-2026.) Se mide la cobertura ANTES de gastar la primera llamada de IA. La cobertura viaja
  // al informe SIEMPRE (esté completa o no) para que el validador la pueda mirar y el usuario la vea.
  const cobertura = evaluarCoberturaLectura(docs.map(d => ({ nombre: d.nombre, categoria: d.categoria, texto: d.texto, metodo: d.metodo })));
  console.log(`[viabilidad-ia] ${codigo}: lectura — ${resumirCobertura(cobertura)}`);
  if (!cobertura.completa) {
    console.error(`[viabilidad-ia] ${codigo}: ⚠ EXPEDIENTE INCOMPLETO — el informe se marcará para revisión humana. `
      + `Sin leer: ${cobertura.criticosFaltantes.join(', ')}`);
  }

  const ctx = await cargarContexto(codigo);
  const cfg = await cargarConfigViabilidad();

  // FUENTES OFICIALES para las señales deterministas: NUNCA nuestros propios archivos (el Excel de
  // costeo que genera este sistema trae un total al pie por construcción y confirmaría lo que
  // nosotros mismos escribimos — bucle que se auto-refuerza).
  const fuentes = leidos.filter(d => (d.categoria || '').toUpperCase() !== 'DOCUMENTOS_PROPIOS' && !/^COSTEO_/i.test(d.nombre));

  let planilla: ReturnType<typeof parsearPlanillaCosteo> = null;
  try {
    planilla = parsearPlanillaCosteo(fuentes.map(d => ({ nombre: d.nombre, categoria: d.categoria, texto: d.texto, metodo: d.metodo })));
  } catch { /* opcional */ }
  // DETECTORES DE LA v3 → EVIDENCIAS de adjudicación (P1) y señales de costeo. Ya NO se inyectan
  // al prompt como "señal de modalidad": alimentan al código.
  const senales: SenalesDetectores = {
    tipoAdjudicacionMultiple: null, licitacionTipoMultiple: null, ofertaSubconjunto: null,
    participacionParcialPorLinea: null, lenguajePorLinea: null, presupuestoPorLinea: null,
    formulariosPorArchivo: [], cuadroPorLinea: null, totalUnico: false,
  };
  try {
    senales.totalUnico = detectarOfertaTotalUnico(fuentes);
    senales.lenguajePorLinea = detectarLenguajePorLinea(fuentes);
    senales.participacionParcialPorLinea = detectarParticipacionParcialPorLinea(fuentes);
    senales.presupuestoPorLinea = detectarPresupuestoPorLinea(fuentes);
    senales.ofertaSubconjunto = detectarOfertaSubconjuntoItems(fuentes);
    senales.cuadroPorLinea = detectarCuadroEconomicoPorLinea(fuentes);
    senales.formulariosPorArchivo = detectarFormulariosEconomicosPorArchivo(fuentes);
    senales.tipoAdjudicacionMultiple = detectarTipoAdjudicacionMultiple(fuentes);
    senales.licitacionTipoMultiple = detectarLicitacionTipoMultiple(fuentes);
  } catch { /* señal opcional */ }

  // ─── PROMPT v4.0 ───────────────────────────────────────────────────────────────────────────
  const ordenados = fuentes.slice().sort((a, b) => prioridadDoc(a.nombre, a.categoria) - prioridadDoc(b.nombre, b.categoria));
  const itemsMPTxt = (ctx.itemsMP || []).slice(0, 40).map((it: any, i: number) =>
    `${i + 1}. ${it.nombre || it.descripcion}${it.categoria ? ` [${it.categoria}]` : ''}${it.cantidad ? ` (cant ${it.cantidad}${it.unidad ? ' ' + it.unidad : ''})` : ''}`).join('\n') || '(la API MP no entregó ítems)';
  const { texto: docsTexto } = recortarDocsParaAnalisis(ordenados, planilla?.fuenteDoc);
  const userPrompt = construirUserPromptV4({ codigo, tipoLic: extractTipoFromCodigo(codigo) || '(desconocido)', meta: ctx.meta, itemsMPTxt, docsTexto });
  // Kill-switch del barrido: VIABILIDAD_BARRIDO_V35=0 lo quita (mismo interruptor que en la v3).
  let systemPrompt = SYSTEM_PROMPT_V4.replace('{{FAMILIAS}}', nombresFamilias(cfg))
    + (process.env.VIABILIDAD_BARRIDO_V35 === '0' ? '' : BLOQUE_BARRIDO_V4);
  // REGLAS APRENDIDAS (prompts auxiliares F.3-F.5): se agregan DESPUÉS del barrido. No cambian lo
  // que decide el código. Se guardan sus ids en el informe (`_reglas_activas`).
  const reglasActivas: number[] = [];
  try {
    const [reglasGlobal, reglasLecturaFirma] = await Promise.all([
      cargarReglasAprendidasConId('global'),
      cargarReglasLecturaConFirma(),
    ]);
    if (reglasGlobal.length) systemPrompt += '\n\n' + bloqueReglasAprendidas(reglasGlobal.map(r => r.regla));
    const firmaActual = calcularFirmaDocumentos(leidos.map(d => ({ texto: d.texto })));
    const similares: string[] = [];
    const genericas: string[] = [];
    for (const r of reglasLecturaFirma) {
      if (firmaActual && r.firma && firmasSimilares(firmaActual, r.firma)) similares.push(r.regla);
      else genericas.push(r.regla);
    }
    if (similares.length) systemPrompt += bloqueReglasLecturaSimilares(similares);
    if (genericas.length) systemPrompt += bloqueReglasLectura(genericas);
    reglasActivas.push(...reglasGlobal.map(r => r.id), ...reglasLecturaFirma.map(r => r.id));
    if (reglasActivas.length) {
      console.log(`[viabilidad-ia-v4] ${codigo}: reglas del experto inyectadas — ${reglasGlobal.length} de viabilidad, ${genericas.length} de lectura${similares.length ? `, ${similares.length} de lectura POR FORMATO PARECIDO` : ''}.`);
    }
  } catch { /* las reglas son opcionales: si fallan, se analiza igual con el prompt base */ }
  // P11 · trazabilidad: hash del system prompt COMPLETO (con barrido y reglas inyectadas).
  const promptHash = createHash('sha256').update(systemPrompt).digest('hex');

  console.log(`[viabilidad-ia] ${codigo}: === FASE analizando_ia === (prompt v4 ${userPrompt.length} chars, ${leidos.length} documento(s) legible(s)) — llamando al modelo…`);
  try { onFase?.('analizando_ia'); } catch { /* noop */ }
  const tIA0 = Date.now();
  const traza: TrazaLlamada = {};
  // Solo ESTA llamada (el informe completo) se divide; las auxiliares (verificadores, extracciones) son chicas.
  const parsed = (IA_TEXT_PROVIDER !== 'gemini' && process.env.VIABILIDAD_DIVIDIR !== '0')
    ? await llamarAnalisisDividido(systemPrompt, userPrompt, traza)
    : await llamarGeminiJSON(systemPrompt, userPrompt, traza);
  console.log(`[viabilidad-ia] ${codigo}: modelo ${traza.modelo || '?'} respondió en ${((Date.now() - tIA0) / 1000).toFixed(1)}s${parsed ? '' : ' — SIN respuesta utilizable'}${traza.reparado ? ' — JSON REPARADO' : ''}.`);
  if (!parsed || typeof parsed !== 'object') return null;
  console.log(`[viabilidad-ia] ${codigo}: === FASE verificando ===`);
  try { onFase?.('verificando'); } catch { /* noop */ }

  const p3 = normalizarTextosInforme(parsed as any);
  const obj = (k: string) => (p3[k] && typeof p3[k] === 'object' && !Array.isArray(p3[k]) ? p3[k] : (p3[k] = {}));
  const veredicto = obj('veredicto');
  if (!Array.isArray(veredicto.motivos_revision)) veredicto.motivos_revision = [];
  if (!veredicto.estado_veredicto) veredicto.estado_veredicto = 'DEFINITIVO';
  const aRevision = (motivo: string) => {
    veredicto.estado_veredicto = 'REVISION_HUMANA';
    if (!veredicto.motivos_revision.includes(motivo)) veredicto.motivos_revision.push(motivo);
  };
  // El esquema v4 ya no trae estos campos; si un modelo los repite, se quitan para que ninguna
  // pantalla vuelva a leer un score o un veredicto puestos por el modelo.
  delete p3.score_global; delete veredicto.score_global; delete veredicto.nivel; delete p3.lineas_a_atacar;
  if (p3.atractivo && typeof p3.atractivo === 'object') { delete p3.atractivo.veredicto; delete p3.atractivo._interno; }
  if (p3.tarjeta_decision && typeof p3.tarjeta_decision === 'object') { delete p3.tarjeta_decision.veredicto; delete p3.tarjeta_decision.porque_no; }
  if (p3.presupuesto && typeof p3.presupuesto === 'object') delete p3.presupuesto.gate;
  if (p3.productos && typeof p3.productos === 'object') { delete p3.productos.entregables_word; delete p3.productos.hojas_costeo_segun_adjudicacion; }
  if (traza.gruposFallidos?.length) {
    p3._grupos_fallidos = traza.gruposFallidos;
    aRevision(`La IA no pudo completar parte del análisis (${traza.gruposFallidos.join(', ')}): esa parte del informe viene vacía. Vuelve a analizar.`);
  }
  if (traza.reparado) {
    p3._json_reparado = true;
    aRevision('La respuesta de la IA llegó cortada y se reparó: puede faltar información al final del informe.');
  }

  // ─── P2 · PRESUPUESTO (el código interpreta el monto y el "M$") ───────────────────────────
  const pres = obj('presupuesto');
  pres.caracter = normalizarCaracter(pres.caracter);
  const exentoPres = !!pres.presupuesto_exento || !!pres.regimen_fora || pres.con_iva === false;
  {
    // Bruto desde el monto tal cual si el modelo no lo trajo (o lo trajo sin interpretar "M$").
    const it = interpretarMonto(pres.monto_texto);
    const brutoModelo = _num(pres.bruto);
    if (it.pesos && (brutoModelo == null || brutoModelo <= 0 || (it.miles && Math.abs(brutoModelo * 1000 - it.pesos) < 1000))) {
      if (brutoModelo !== it.pesos) console.log(`[viabilidad-ia-v4] ${codigo}: presupuesto desde "${pres.monto_texto}" → $${it.pesos.toLocaleString('es-CL')}${it.miles ? ' (M$ = miles de pesos)' : ''}.`);
      pres.bruto = it.pesos;
    }
  }
  try {
    // Respaldo: si el modelo no trajo total, la suma del desglose por línea de las bases (tabla).
    if (!(_num(pres.bruto) && Number(pres.bruto) > 0)) {
      const tabla = extraerPresupuestoPorLineaTabla(leidos.map(d => ({ texto: d.texto })));
      if (tabla && tabla.size >= 2) {
        pres.bruto = [...tabla.values()].reduce((a, b) => a + b, 0);
        console.log(`[viabilidad-ia-v4] ${codigo}: presupuesto.bruto desde la suma de ${tabla.size} línea(s) presupuestadas: $${Number(pres.bruto).toLocaleString('es-CL')}.`);
      }
    }
  } catch (e) { console.warn(`[viabilidad-ia-v4] ${codigo}: backfill de presupuesto total falló:`, String(e).slice(0, 140)); }
  // El NETO es un derivado del bruto (÷1,19 salvo exento/FORA), nunca un dato del modelo.
  {
    const bruto = _num(pres.bruto);
    if (bruto != null && bruto > 0) pres.neto = Math.round(exentoPres ? bruto : bruto / 1.19);
    else if (_num(pres.neto) != null && Number(pres.neto) > 0) pres.bruto = exentoPres ? Number(pres.neto) : Math.round(Number(pres.neto) * 1.19);
    if (_num(pres.bruto) && Number(pres.bruto) > 0) {
      const atr = obj('atractivo');
      atr.presupuesto_neto = pres.neto;
      atr.presupuesto_mostrar = `$${Number(pres.bruto).toLocaleString('es-CL')} ${exentoPres ? '(exento)' : 'IVA incl.'}`;
    }
  }
  // Presupuesto por línea: los montos tal cual del modelo; si no hay, la tabla de distribución.
  let porLinea = interpretarPorLinea(pres.por_linea, exentoPres);
  if (porLinea.length < 2) {
    try {
      const tabla = extraerPresupuestoPorLineaTabla(leidos.map(d => ({ texto: d.texto })));
      if (tabla && tabla.size >= 2) porLinea = interpretarPorLinea([...tabla.entries()].map(([l, m]) => ({ linea: `L${l}`, bruto: m })), exentoPres);
    } catch { /* opcional */ }
  }
  pres.por_linea_interpretado = porLinea;
  pres.suma_lineas_cuadra = sumaLineasCuadra(porLinea, _num(pres.bruto));
  if (pres.caracter !== 'EXCLUYENTE') pres.nota_art_32 = NOTA_ART_32;

  // ─── P5 · CITAS: el código ubica cada frase y pone la página ───────────────────────────────
  const loc = new LocalizadorCitas(fuentes.map(d => ({ nombre: d.nombre, texto: d.texto, categoria: d.categoria })));
  const statsCitas = localizarCitasInforme(p3, loc);
  // Respaldo de la heurística anterior: sin frase encontrada, la página del encabezado del numeral.
  respaldoPaginaPorNumeral(p3, fuentes);
  console.log(`[viabilidad-ia-v4] ${codigo}: citas — ${statsCitas.verificadas}/${statsCitas.total} verificadas en los documentos${statsCitas.sin_frase ? `, ${statsCitas.sin_frase} sin frase` : ''}.`);

  // ─── P3/P6 · Negaciones de garantías y contrato (detector en código) ──────────────────────
  const adm = obj('requisitos_admisibilidad');
  const garantias = adm.garantias && typeof adm.garantias === 'object' ? adm.garantias : (adm.garantias = {});
  const plazos = obj('plazos');
  plazos.hitos = normalizarHitos(plazos.hitos);
  const negaciones = detectarNegaciones(fuentes);
  for (const [clave, neg] of Object.entries(negaciones)) {
    if (!neg) continue;
    const g = garantias[clave] && typeof garantias[clave] === 'object' ? garantias[clave] : (garantias[clave] = {});
    if (String(g.estado || '').toUpperCase() !== 'NO_EXISTE') {
      console.log(`[viabilidad-ia-v4] ${codigo}: ${clave} → NO_EXISTE por negación en las bases: "${neg.frase}".`);
      g.corregido_por_negacion = g.estado || 'NO_INDICADO';
      g.estado = 'NO_EXISTE';
      g.cita = loc.localizar({ documento: neg.documento, numeral: '', frase: neg.frase });
    }
    const hitosAfectados = clave === 'fiel_cumplimiento' ? ['GARANTIA_FIEL_CUMPLIMIENTO'] : clave === 'contrato' ? ['FIRMA_CONTRATO_PROVEEDOR', 'FIRMA_CONTRATO_ORGANISMO'] : [];
    for (const h of plazos.hitos as HitoInforme[]) {
      if (hitosAfectados.includes(String(h.hito)) && String(h.estado || '').toUpperCase() !== 'NO_EXISTE') {
        h.corregido_por_negacion = String(h.estado || 'NO_INDICADO');
        h.estado = 'NO_EXISTE'; h.plazo = null;
        h.cita = loc.localizar({ documento: neg.documento, numeral: '', frase: neg.frase });
      }
    }
  }

  // ─── P1 · ADJUDICACIÓN: evidencias tipadas + chequeo semántico + tabla de decisión ─────────
  const adj = obj('adjudicacion');
  let evidencias: EvidenciaAdj[] = deduplicarEvidencias([
    ...evidenciasDelModelo(adj.evidencias, 'modelo'),
    ...evidenciasDeDetectores(senales).map(e => { if (e.cita.frase) loc.localizar(e.cita as any); return e; }),
    ...evidenciaPresupuestoPorLineaDeTabla(pres.por_linea),
  ]);
  // Señales de suministro: si el modelo no reportó ninguna, el detector del código.
  const exc = obj('exclusion');
  if (!Array.isArray(exc.senales_suministro) || !exc.senales_suministro.length) {
    exc.senales_suministro = detectarSenalesSuministro(fuentes).map(s => ({ ...s, cita: loc.localizar(s.cita), origen: 'detector' }));
  }

  // CHEQUEO SEMÁNTICO de los datos críticos — UNA llamada con todos los pares (prompt auxiliar B).
  const preguntarCorto = (s: string, u: string) => Promise.race([
    llamarGlmJSON(s, u),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout verificador de citas')), 120_000)),
  ]);
  anularPuntajesMinimosCero(p3.criterios_evaluacion);
  const pares = construirParesSemanticos(p3, evidencias);
  const sem = await verificarSemantica(pares, preguntarCorto);
  if (sem.fallo) console.warn(`[viabilidad-ia-v4] ${codigo}: chequeo semántico no disponible (${sem.fallo}) — las frases cuentan solo por existir literal.`);
  else if (pares.length) console.log(`[viabilidad-ia-v4] ${codigo}: chequeo semántico — ${sem.evaluados}/${pares.length} pares evaluados.`);
  p3._chequeo_semantico = { pares: pares.length, evaluados: sem.evaluados, fallo: sem.fallo };

  // Si el chequeo semántico REFUTA la frase que respalda el carácter del presupuesto (1057448-45-LP26: "se
  // certifica un presupuesto total… impuestos incluidos" no dice "referencial"), el dato no se sostiene:
  // según el prompt, sin evidencia expresa el carácter es NO_DECLARADO. No se deja un dato refutado.
  const presu = p3.presupuesto;
  if (presu && (presu.caracter === 'EXCLUYENTE' || presu.caracter === 'REFERENCIAL') && (presu.cita?.semantica === 'NO' || presu.cita?.verificada === false)) {
    presu.caracter_corregido = { antes: presu.caracter, motivo: presu.cita.motivo_semantica || (presu.cita.verificada === false ? 'la frase citada no se encontró en las bases' : 'la frase citada no sostiene el carácter') };
    presu.caracter = 'NO_DECLARADO';
  }

  marcarEvidenciasQueCuentan(evidencias);
  const lineasApi = Array.isArray(ctx.itemsMP) ? ctx.itemsMP.length : 0;
  const hayDecisiva = evidencias.some(e => e.cuenta && CATALOGO[e.tipo].peso === 'DECISIVA');
  if (!hayDecisiva && lineasApi !== 1) {
    // LECTOR DE CLÁUSULA (prompt auxiliar A): solo si nadie trajo evidencia decisiva. Recorre el texto
    // COMPLETO de todos los documentos y exige frase literal; tope de 90 s.
    const clausula = await leerClausulaAdjudicacion(
      fuentes.map(d => ({ nombre: d.nombre, texto: d.texto })),
      (s, u) => Promise.race([
        llamarGlmJSON(s, u),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout lector de cláusula')), 90_000)),
      ]),
    );
    if (clausula.evidencias.length) {
      const nuevas: EvidenciaAdj[] = clausula.evidencias.map(e => ({ tipo: e.tipo, origen: 'clausula', cita: loc.localizar({ ...e.cita }) }));
      const paresC = nuevas.map((e, i) => ({ id: i + 1, afirmacion: CATALOGO[e.tipo].afirmacion, documento: String(e.cita.documento || ''), numeral: String(e.cita.numeral || ''), frase: String(e.cita.frase || ''), cita: e.cita as any }));
      await verificarSemantica(paresC, preguntarCorto);
      evidencias = deduplicarEvidencias([...evidencias, ...marcarEvidenciasQueCuentan(nuevas)]);
      console.log(`[viabilidad-ia-v4] ${codigo}: lector de cláusula aportó ${nuevas.length} evidencia(s)${clausula.descartadas ? ` (${clausula.descartadas} frase(s) inventada(s) descartadas)` : ''}.`);
    }
  }
  const decision = decidirAdjudicacion(evidencias, lineasApi);
  Object.assign(adj, {
    evidencias,
    resultado: decision.resultado,
    regla_aplicada: decision.regla_aplicada,
    motivo: decision.motivo,
    cotizar_100: decision.cotizar_100,
    cotizar_100_texto: decision.cotizar_100_texto,
    pregunta_foro: decision.pregunta_foro,
  });
  delete adj.como_se_adjudica; delete adj.modalidad_pago_interna; delete adj.estado; delete adj.cotizar_100_obligatorio;
  delete adj.evaluacion_puntaje; delete adj.confianza; delete adj.libertad_de_pricing;
  console.log(`[viabilidad-ia-v4] ${codigo}: adjudicación ${decision.resultado} (regla ${decision.regla_aplicada}: ${decision.motivo}) — ${evidencias.filter(e => e.cuenta).length}/${evidencias.length} evidencia(s) válidas.`);
  if (decision.resultado === 'NO_CLARO') aRevision('No está claro cómo se adjudica: confirmar en las bases o preguntar en el foro antes de armar la oferta.');

  // ─── P2 · Exclusión por contrato de suministro (decide el código) ─────────────────────────
  const sum = decidirSuministro(exc.senales_suministro);
  const categoriaModelo = String(exc.categoria || '').toUpperCase().trim();
  if (sum.excluido) {
    exc.excluido = true;
    exc.categoria = 'CONTRATO_SUMINISTRO';
    if (categoriaModelo && categoriaModelo !== 'CONTRATO_SUMINISTRO') exc.categoria_modelo = categoriaModelo;
    exc.motivo = String(sum.senal?.cita?.frase || exc.motivo || '').slice(0, 220);
    exc.cita = sum.senal?.cita ?? exc.cita;
    console.log(`[viabilidad-ia-v4] ${codigo}: EXCLUIDO — contrato de suministro ("${exc.motivo.slice(0, 100)}").`);
  } else {
    exc.excluido = false;   // las demás categorías se muestran como aviso; el servicio lo toma el techo del nivel
  }

  // ─── P3 · PLAZO PREVIO (el código suma, en orden fijo) ────────────────────────────────────
  {
    const base = fechaBaseAdjudicacion(ctx.meta);
    const calc = calcularPlazoPrevio(plazos.hitos, plazos.inicio_plazo_entrega?.desfase, base.fecha, base.origen, feriadosPara(cfg, ctx.meta.region));
    plazos.plazo_previo = calc;
    const acept = (plazos.hitos as HitoInforme[]).find(h => h.hito === 'ACEPTACION_OC');
    if (acept && String(acept.estado || '').toUpperCase() === 'NO_INDICADO') plazos.nota_aceptacion_oc = NOTA_ACEPTACION_OC;
    delete plazos.cadena; delete plazos.gatillo_cadena_larga; delete plazos.frontera; delete plazos.aceptacion_oc;
    delete plazos.colchon_dias_corridos; delete plazos.plazo_entrega_ofertable; delete plazos.ventana_importacion;
  }

  // ─── P7 · MULTA POR ATRASO (el código calcula con UF/UTM oficial) ─────────────────────────
  try {
    const mul = obj('multas');
    const atraso = mul.atraso && typeof mul.atraso === 'object' ? mul.atraso : null;
    const ind = indicadorNecesario(atraso);
    const valorInd = ind ? await obtenerTipoCambio(ind) : null;
    if (atraso) atraso.calculo = calcularMulta(atraso, { bruto: _num(pres.bruto), neto: _num(pres.neto) }, valorInd);
  } catch (e) { console.warn(`[viabilidad-ia-v4] ${codigo}: cálculo de multa falló:`, String(e).slice(0, 140)); }

  // ─── PUENTE AL COSTEO: cómo se cotiza (eje aparte de la adjudicación) ──────────────────────
  // POR_LINEAS → una hoja por línea. GLOBAL o NO_CLARO → total único, salvo que el FORMATO de la
  // oferta económica tenga evidencia dura de por línea (veredictoModalidadDeterminista) o las
  // líneas sean heterogéneas con presupuesto propio. Esto NO vuelve a influir en la adjudicación.
  let tipoCosteo: 'suma_alzada' | 'por_linea' = decision.resultado === 'POR_LINEAS' ? 'por_linea' : 'suma_alzada';
  if (tipoCosteo === 'suma_alzada') {
    const detCosteo = veredictoModalidadDeterminista(planilla, senales.totalUnico, senales.lenguajePorLinea, senales.presupuestoPorLinea, senales.ofertaSubconjunto, senales.cuadroPorLinea, senales.formulariosPorArchivo, senales.licitacionTipoMultiple);
    if (detCosteo?.tipo === 'por_linea') {
      console.log(`[viabilidad-ia-v4] ${codigo}: costeo por línea aunque la adjudicación es ${decision.resultado} (${detCosteo.motivo}).`);
      tipoCosteo = 'por_linea';
    } else if (String(adj.heterogeneidad || '').toLowerCase() === 'alta' && porLinea.length >= 2 && porLinea.length <= 20) {
      console.log(`[viabilidad-ia-v4] ${codigo}: costeo por línea por líneas heterogéneas con presupuesto propio (${porLinea.length} líneas).`);
      tipoCosteo = 'por_linea';
    }
  }

  // ─── P8 · PRODUCTOS: segunda pasada literal + manifiesto + UNA SOLA LISTA ──────────────────
  const prod = obj('productos');
  const itemsFuenteCrudos: any[] = Array.isArray(prod.items) ? prod.items : [];
  const reqGenerales: any[] = Array.isArray(prod.requisitos_generales) ? prod.requisitos_generales : [];
  await completarCaracteristicasLiterales(itemsFuenteCrudos, docs, codigo, reqGenerales);
  for (const r of reqGenerales) if (r?.cita && typeof r.cita === 'object' && r.cita.verificada === undefined) loc.localizar(r.cita);
  prod.requisitos_generales = reqGenerales;
  // Cada característica debe existir LITERAL en las bases; las demás no pasan al AUDITOR.
  const lit = verificarCaracteristicasLiterales(itemsFuenteCrudos, loc);
  if (lit.no_encontradas) console.warn(`[viabilidad-ia-v4] ${codigo}: ${lit.no_encontradas}/${lit.revisadas} característica(s) no se encontraron literales en las bases — quedan marcadas y fuera del AUDITOR hasta revisarlas.`);
  // Listado real dejado como texto en `caracteristicas` de un ítem genérico sin cantidad (3477-80-LE26).
  const itemsDesplegados = desplegarItemsDesdeCaracteristicas(itemsFuenteCrudos);
  if (itemsDesplegados) console.log(`[viabilidad-ia-v4] ${codigo}: ${itemsFuenteCrudos.length} ítem(s) traían el listado como texto en "caracteristicas" → desplegados a ${itemsDesplegados.length} ítems.`);
  const itemsFuente = itemsDesplegados ?? itemsFuenteCrudos;
  const presupuestoDeLinea = (n: number) => porLinea.find(l => l.numero === n)?.monto_pesos ?? null;
  let manifiesto: ManifiestoLinea[] = itemsFuente.map((it: any) => ({
    linea: _lineaNum(it.linea), categoria: it.categoria ?? null,
    descripcion: _str(it.nombre || it.descripcion_exacta || it.descripcion),
    modelo: _str(it.marca_modelo_referencia || it.marca_modelo),
    cantidad: _num(it.cantidad), unidad_medida: _str(it.unidad_medida), unidad_inferida: _bool(it.unidad_inferida),
    // El modelo ya no escribe presupuesto_linea: lo llena el código desde presupuesto.por_linea.
    presupuesto_linea: presupuestoDeLinea(_lineaNum(it.linea)), tipo: _str(it.clasificacion || it.tipo) || 'generico', ruta: '',
  }));
  let origenManifiesto: 'modelo' | 'tabla_canonica' | 'planilla' | 'extraccion_lineas_producto' = 'modelo';
  {
    // Filas de la tabla de CRITERIOS coladas como productos (2345-128-LP26). Va ANTES del gate de la
    // planilla: con el manifiesto inflado, la planilla (fiel) perdía la comparación.
    const antes = manifiesto.length;
    const descartados = manifiesto.filter(m => esFilaNoProducto(m.descripcion));
    if (descartados.length) {
      manifiesto = manifiesto.filter(m => !esFilaNoProducto(m.descripcion));
      console.warn(`[viabilidad-ia-v4] ${codigo}: ${descartados.length}/${antes} "producto(s)" descartado(s) por ser filas de criterios o rótulos —`,
        descartados.slice(0, 8).map(d => `"${d.descripcion.slice(0, 60)}"`).join(', '));
    }
  }
  // CONTRASTE CONTRA LA TABLA CANÓNICA DE LAS BASES TÉCNICAS (17-ago / 3-sep-2026).
  try {
    const canonica = extraerListadoCanonicoBases(fuentes.map(d => ({ nombre: d.nombre, categoria: d.categoria, texto: d.texto, metodo: d.metodo })));
    if (canonica.length >= 3 && manifiesto.length > 0) {
      const dec = decidirReemplazoPorCanonica(manifiesto, canonica);
      if (dec.reemplazar) {
        console.warn(`[viabilidad-ia-v4] ${codigo}: el manifiesto traía ${manifiesto.length} ítems pero la tabla canónica de las bases lista ${canonica.length} (${dec.motivo}) → se recorta a la canónica.`);
        manifiesto = canonica.map(c => ({
          linea: 1, categoria: null, descripcion: c.descripcion, modelo: '',
          cantidad: c.cantidad, unidad_medida: '', unidad_inferida: true,
          presupuesto_linea: presupuestoDeLinea(1), tipo: 'generico', ruta: '',
        }));
        origenManifiesto = 'tabla_canonica';
      }
    }
  } catch (e) { console.warn(`[viabilidad-ia-v4] ${codigo}: contraste con tabla canónica falló:`, String(e).slice(0, 140)); }

  let estructuraCosteo: 'por_categoria' | null = null;
  // GATE DE CALIDAD para que el parser de planilla pise al modelo (2178-14-LE26, 2981-225-LE26,
  // 1057922-23-LE26): descripciones reales, sin rótulos, sin degradar las líneas, y que RECONOZCA el
  // listado que el modelo ya identificó.
  const planillaSana = !!planilla
    && planilla.items.filter(i => /[a-záéíóúñ]/i.test(i.descripcion)).length >= planilla.items.length * 0.7
    && planilla.items.filter(i => esFilaNoProducto(i.descripcion)).length < planilla.items.length * 0.1;
  const planillaDegradaLineas = !!planilla
    && tipoCosteo === 'por_linea'
    && new Set(planilla.items.map(i => i.linea || 1)).size < 2
    && new Set(manifiesto.map(m => m.linea)).size >= 2;
  const solape = planilla
    ? planillaReconoceElListado(planilla.items.map(i => i.descripcion), manifiesto.map(m => m.descripcion))
    : { reconoce: true, solape: 1, minimo: 0 };
  if (planilla && !solape.reconoce) {
    console.warn(`[viabilidad-ia-v4] ${codigo}: la planilla "${planilla.fuenteDoc}" (${planilla.items.length} filas) NO reconoce el listado del modelo `
      + `(solape ${Math.round(solape.solape * 100)}%, mínimo ${Math.round(solape.minimo * 100)}%) — no se usa para el manifiesto.`);
  }
  const planillaReconoceAlLLM = solape.reconoce;
  const planillaGanaManifiesto = !!(planilla && planillaSana && !planillaDegradaLineas && planillaReconoceAlLLM
      && planilla.items.length >= manifiesto.length && planilla.items.length >= 8);
  if (planillaGanaManifiesto) {
    manifiesto = planilla!.items.map(it => ({
      linea: it.linea || 1, categoria: it.categoria, descripcion: it.descripcion, modelo: '',
      cantidad: it.cantidad, unidad_medida: it.unidad, unidad_inferida: !it.unidad,
      presupuesto_linea: presupuestoDeLinea(it.linea || 1), tipo: 'generico', ruta: '',
    }));
    origenManifiesto = 'planilla';
    if (planilla!.estructura === 'por_categoria') estructuraCosteo = 'por_categoria';
    console.log(`[viabilidad-ia-v4] ${codigo}: manifiesto desde planilla "${planilla!.fuenteDoc}" — ${planilla!.items.length} ítems (${planilla!.estructura}).`);
  }
  // EXTRACCIÓN DEDICADA para bases técnicas "LÍNEA DE PRODUCTO N°X" (el modelo resume cada línea a un ítem).
  if (!(planilla && planilla.items.length >= 8)) {
    try {
      const secciones = extraerSeccionesLineaProducto(leidos.map(d => ({ nombre: d.nombre, texto: d.texto })));
      const sonFichas = seccionesSonFichasDeCaracteristicas(secciones);
      if (!sonFichas && secciones.length >= 2 && manifiesto.length <= secciones.length * 2) {
        const extra = await extraerItemsLineasProductoIA(secciones);
        if (extra.length > manifiesto.length && extra.length >= secciones.length * 2) {
          console.log(`[viabilidad-ia-v4] ${codigo}: extracción dedicada "LÍNEA DE PRODUCTO" → ${extra.length} ítems (antes ${manifiesto.length}), ${secciones.length} líneas.`);
          for (const m of extra) m.presupuesto_linea = presupuestoDeLinea(m.linea);
          manifiesto = extra;
          origenManifiesto = 'extraccion_lineas_producto';
        }
      }
    } catch (e) { console.warn(`[viabilidad-ia-v4] ${codigo}: extracción dedicada falló:`, String(e).slice(0, 140)); }
  }
  // UNA SOLA LISTA (P11): productos.items y manifiesto_productos salen de la misma lista final.
  {
    const r = reasignarLineasPorTablaDeMontos(manifiesto as any, porLinea as any);
    if (r.cambiado) {
      for (const m of manifiesto) m.presupuesto_linea = presupuestoDeLinea(m.linea);
      console.log(`[viabilidad-ia-v4] ${codigo}: líneas reasignadas por la tabla de montos de las bases — ${r.motivo}.`);
    }
  }
  prod.items = construirListaUnica(manifiesto, itemsFuente);
  p3.manifiesto_productos = manifiesto;
  prod.conteo_cruzado = conteoCruzado(prod, manifiesto.length, lineasApi);
  prod.problemas_calidad = problemasCalidadManifiesto(manifiesto);
  if (prod.problemas_calidad.length) console.warn(`[viabilidad-ia-v4] ${codigo}: calidad del manifiesto (V-23): ${prod.problemas_calidad.join('; ')}.`);

  // ─── P4 · CRITERIOS (anexo ausente / tabla presente leída en 0 / binarios falsos) ──────────
  // OVERRIDE — CRITERIOS QUE VIVEN EN UN ANEXO QUE NO LEÍMOS (2981-214-LE26): si las bases REMITEN
  // a un anexo y en ningún documento leído aparece una distribución de criterios, la lista del
  // modelo no puede haber salido del texto. Se descarta y va a revisión humana con la frase exacta.
  try {
    const remision = analizarRemisionACriterios(leidos.filter(d => /BASES/i.test(String(d.categoria || ''))).map(d => d.texto).join('\n\n'));
    const tablaEnAlgunDocumento = hayTablaDeCriterios(leidos.map(d => d.texto).join('\n\n'));
    if (remision.remite && !tablaEnAlgunDocumento) {
      const motivo = motivoCriteriosNoConfiables(remision);
      console.warn(`[viabilidad-ia-v4] ${codigo}: criterios remitidos a un anexo que no está en el texto — se descartan. ${motivo}`);
      p3.criterios_evaluacion = {
        ...(p3.criterios_evaluacion || {}), criterios: [], fuente_datos: 'incompleto', suma_ponderaciones_real: 0, suma_valida: false,
        alertas: [...(p3.criterios_evaluacion?.alertas || []), motivo],
        _descartado_por_anexo_ausente: p3.criterios_evaluacion?.criterios || [],
      };
      aRevision(`Criterios de evaluación: ${motivo}`);
    }
  } catch (e) { console.warn(`[viabilidad-ia-v4] ${codigo}: chequeo de criterios-en-anexo falló:`, String(e).slice(0, 140)); }
  // RECUPERACIÓN — TABLA DE PONDERACIONES QUE SÍ ESTÁ EN LAS BASES pero el modelo la leyó en 0
  // (1079650-47-LE26, OCR local de baja calidad): extracción enfocada de la sección.
  try {
    const textoBases = leidos.filter(d => /BASES/i.test(String(d.categoria || ''))).map(d => d.texto).join('\n\n');
    const remiteAAnexo = analizarRemisionACriterios(textoBases).remite;
    const tablaPresente = hayTablaDeCriterios(leidos.map(d => d.texto).join('\n\n'));
    const criteriosLLM: any[] = Array.isArray(p3?.criterios_evaluacion?.criterios) ? p3.criterios_evaluacion.criterios : [];
    const todosEnCero = tablaPresente && (criteriosLLM.length === 0 || criteriosLLM.every((c: any) => !(Number(c?.ponderacion_nominal) > 0)));
    if (!remiteAAnexo && todosEnCero) {
      const docsBases = leidos.filter(d => /BASES/i.test(String(d.categoria || ''))).map(d => ({ texto: d.texto }));
      const seccion = extraerSeccionCriteriosEvaluacion(docsBases.length ? docsBases : leidos.map(d => ({ texto: d.texto })));
      if (seccion) {
        const extraidos = await extraerPonderacionesCriteriosIA(seccion);
        const suma = extraidos.reduce((a, c) => a + c.ponderacion_pct, 0);
        if (extraidos.length >= 3 && Math.abs(suma - 100) <= 5) {
          console.log(`[viabilidad-ia-v4] ${codigo}: tabla de ponderaciones recuperada con lectura enfocada — ${extraidos.length} criterios (suma ${suma}%).`);
          const porNombre = new Map(criteriosLLM.map((c: any) => [_str(c?.nombre).toLowerCase(), c]));
          const nuevos = extraidos.map(e => {
            const clave = e.nombre.toLowerCase();
            const prev = porNombre.get(clave) ?? [...porNombre.values()].find((c: any) => {
              const n = _str(c?.nombre).toLowerCase();
              return n.length >= 3 && (n.includes(clave) || clave.includes(n));
            });
            return {
              clase: 'POR_TRAMOS', tema: 'OTRO', subfactores: [],
              tramo_max_puntaje: { descripcion: '', borde_comodo: '' }, rango_admisibilidad: { min: '', max: '' },
              medio_verificacion: '', forma_aplicacion: '', cita: { documento: '', numeral: '', frase: '' },
              ...(prev || {}),
              nombre: e.nombre, ponderacion_nominal: e.ponderacion_pct, ponderacion_efectiva: e.ponderacion_pct,
            };
          });
          p3.criterios_evaluacion = {
            ...(p3.criterios_evaluacion || {}), criterios: nuevos, fuente_datos: 'bases',
            suma_ponderaciones_real: Math.round(suma), suma_valida: true, forma_aplicacion_completa: false,
            alertas: [
              ...(p3.criterios_evaluacion?.alertas || []).filter((a: string) => !/no se encontr[oó] tabla de ponderaciones/i.test(a)),
              'Ponderaciones recuperadas con una lectura enfocada de la sección "CRITERIOS DE EVALUACIÓN" (la página venía con OCR de baja calidad) — verificar contra las bases antes de decidir.',
            ],
          };
        }
      }
    }
  } catch (e) { console.warn(`[viabilidad-ia-v4] ${codigo}: recuperación enfocada de criterios falló:`, String(e).slice(0, 140)); }

  // ─── P6 · ADMISIBILIDAD: requisitos del sistema + barrido de consecuencias + conteo ────────
  {
    const requisitos: any[] = (Array.isArray(adm.requisitos) ? adm.requisitos : []).filter((r: any) => r && typeof r === 'object').map((r: any) => ({ ...r, origen: 'modelo' }));
    const delSistema = (r: any) => requisitos.push({ que: '', cuanto: '', cuando: '', como: '', consecuencia: '', ...r, origen: 'sistema' });
    // Puntajes mínimos (P4) → requisito.
    const crit = p3.criterios_evaluacion || {};
    anularPuntajesMinimosCero(crit);
    const pmTotal = crit.puntaje_minimo_total;
    if (pmTotal && String(pmTotal.valor ?? '').trim()) delSistema({ que: `Puntaje mínimo total: ${pmTotal.valor} ${pmTotal.unidad || ''}`.trim(), consecuencia: pmTotal.consecuencia || 'bajo ese puntaje la oferta no se adjudica', cita: pmTotal.cita });
    for (const c of Array.isArray(crit.criterios) ? crit.criterios : []) {
      const pm = c?.puntaje_minimo;
      if (pm && String(pm.valor ?? '').trim()) delSistema({ que: `Puntaje mínimo en ${c.nombre}: ${pm.valor} ${pm.unidad || ''}`.trim(), consecuencia: pm.consecuencia || 'bajo ese puntaje la oferta queda fuera', cita: pm.cita ?? c.cita });
    }
    // Cotizar el 100 %: se deriva de P1 (solo si se reportó COTIZAR_TOTALIDAD).
    const totalidad = evidencias.find(e => e.cuenta && e.tipo === 'COTIZAR_TOTALIDAD');
    if (totalidad) delSistema({ que: 'Cotizar el 100 % de las líneas', consecuencia: 'si falta una línea la oferta queda fuera', cita: totalidad.cita });
    // Presupuesto excluyente.
    if (pres.caracter === 'EXCLUYENTE') delSistema({ que: 'No superar el presupuesto disponible', cuanto: atrMostrar(p3), consecuencia: 'sobre el presupuesto la oferta queda fuera de bases', cita: pres.cita });
    // Plazo de entrega fuera de rango.
    const pe = plazos.plazo_entrega;
    if (pe && pe.fuera_de_rango_inadmisible && (String(pe.min ?? '').trim() || String(pe.max ?? '').trim())) {
      delSistema({ que: 'Ofertar un plazo de entrega dentro del rango', cuanto: [pe.min ? `mínimo ${pe.min}` : '', pe.max ? `máximo ${pe.max}` : ''].filter(Boolean).join(' · ') + (pe.unidad ? ` ${pe.unidad}` : ''), consecuencia: 'fuera de rango la oferta es inadmisible', cita: pe.cita });
    }
    adm.requisitos = requisitos;
    adm.posibles_causales_sin_analizar = barridoConsecuencias(fuentes, requisitos, cfg)
      .map(c => ({ ...c, cita: loc.localizar({ ...c.cita }) }));
    adm.conteo = requisitos.length;
    // Campos de la v3 que ya no corresponden (se recalculan arriba o salen del esquema).
    for (const k of ['firma_puno_y_letra', 'marca_exclusiva', 'cotizar_100', 'presupuesto', 'boleta', 'bloqueantes', 'a_favor', 'plazo_entrega_rango', 'seriedad_oferta', 'fiel_cumplimiento', 'contrato', 'orden_anexos_propios']) delete adm[k];
  }
  completarAnexosPublicadosV4(p3, docs, codigo);

  // ─── P10 · Filtro de obviedades sobre acciones, advertencias y la tarjeta ─────────────────
  {
    const acc = obj('acciones_y_advertencias');
    let filtradas = 0;
    const filtrar = (arr: any, campo: (x: any) => string) => {
      if (!Array.isArray(arr)) return arr;
      const out = arr.filter(x => !esObviedad(campo(x), cfg));
      filtradas += arr.length - out.length;
      return out;
    };
    acc.acciones = filtrar(acc.acciones, x => `${x?.orden || ''} ${x?.por_que || ''}`);
    acc.advertencias = filtrar(acc.advertencias, x => `${x?.riesgo || ''}`);
    const t = p3.tarjeta_decision;
    if (t && typeof t === 'object') {
      t.para_ganar = filtrar(t.para_ganar, x => String(x));
      t.no_quedes_fuera = filtrar(t.no_quedes_fuera, x => String(x));
      if (t.antes_de_ir && esObviedad(t.antes_de_ir, cfg)) { t.antes_de_ir = ''; filtradas++; }
    }
    if (filtradas) console.log(`[viabilidad-ia-v4] ${codigo}: ${filtradas} obviedad(es) filtradas de acciones/advertencias.`);
  }

  // ─── VALIDADOR POST-FASE 2 (v4) ────────────────────────────────────────────────────────────
  // Corre sobre el informe YA armado. Autocorrige lo que tiene arreglo, re-valida y escala a
  // revisión humana lo que no. Ninguna regla escribe el nivel: solo calcularNivel (abajo).
  p3._schema = 'v4';
  p3._cobertura_lectura = cobertura;
  let _validador = validarInformeViabilidad(p3);
  const _correcciones = autocorregirHallazgos(p3, _validador.hallazgos);
  if (_correcciones.length > 0) {
    console.log(`[viabilidad-ia-v4] ${codigo}: validador auto-corrigió ${_correcciones.length} campo(s) —`, _correcciones.map(c => `${c.regla}: ${c.detalle}`).join(' | '));
    _validador = validarInformeViabilidad(p3);
  }
  const _reglasARevision = escalarARevisionHumana(p3, _validador.hallazgos);
  if (_reglasARevision.length > 0) console.warn(`[viabilidad-ia-v4] ${codigo}: validador escaló a REVISION_HUMANA por: ${_reglasARevision.join(', ')}.`);

  const resultado = {
    ...parsed,
    _schema: 'v4',
    _prompt_version: PROMPT_VERSION_V4,
    _prompt_hash: promptHash,
    _reglas_activas: reglasActivas,
    _modelo_respondio: traza.modelo ?? null,
    _json_reparado: !!traza.reparado,
    _citas: statsCitas,
    _validador,
    area_negocio: areaNegocio(p3),
    manifiesto_productos: p3.manifiesto_productos,
    _fuentes_manifiesto: {
      origen: origenManifiesto,
      elegida: origenManifiesto === 'planilla' ? planilla!.fuenteDoc
        : origenManifiesto === 'tabla_canonica' ? 'tabla canónica de las bases técnicas'
        : origenManifiesto === 'extraccion_lineas_producto' ? 'extracción dedicada de secciones "LÍNEA DE PRODUCTO"'
        : 'listado directo del modelo (sin planilla que lo reemplazara)',
      candidatos: planilla?.candidatos ?? [],
      discrepancias: planilla?.discrepancias ?? [],
      planillaRechazada: (planilla && !planillaGanaManifiesto) ? {
        fuenteDoc: planilla.fuenteDoc,
        items: planilla.items.length,
        motivo: !planillaSana ? 'trae filas que no son productos (rótulos, criterios, prosa)'
          : planillaDegradaLineas ? 'perdería las líneas del costeo por línea'
          : !planillaReconoceAlLLM ? `no reconoce el listado del modelo (solape ${Math.round(solape.solape * 100)}%, mínimo ${Math.round(solape.minimo * 100)}%)`
          : `trae menos ítems (${planilla.items.length}) que el modelo (${manifiesto.length})`,
      } : null,
    },
    // Con la adjudicación NO CLARA y sin evidencia de formato por línea, el costeo queda en total
    // único "por confirmar": el checklist pide al asesor resolverlo antes de cargar precios.
    modalidad: { tipo: tipoCosteo, ...(decision.resultado === 'NO_CLARO' && tipoCosteo === 'suma_alzada' ? { estado: 'REVISION_HUMANA' } : {}) },
    estructura_costeo: estructuraCosteo,
    documentos_leidos: leidos.map(d => d.nombre),
    documentos_no_leidos: docs.filter(d => !d.ok).map(d => `${d.nombre} (${d.metodo})`),
    _cobertura_lectura: cobertura,
    docs_hash: await calcularDocsHash(codigo),
  };
  // ─── NIVEL DE ATRACTIVO (v4.1): AL FINAL, después del validador y las escaladas ────────────
  await aplicarNivel(resultado, codigo, cfg);
  return resultado;
}

// Presupuesto que se muestra (con IVA) para textos de requisitos.
function atrMostrar(inf: any): string {
  return String(inf?.atractivo?.presupuesto_mostrar || '');
}

function areaNegocio(inf: any): string {
  const area = String(inf?.meta?.linea_negocio || 'mixto').toUpperCase();
  return area.startsWith('FERR') ? 'FERRETERIA' : area.startsWith('EQUIP') ? 'EQUIPAMIENTO' : 'MIXTO';
}

// Fecha desde la que se suma el plazo previo: la adjudicación estimada que publica Mercado Público;
// si no la hay, el cierre de la licitación; si tampoco, hoy. Va rotulada en el informe.
function fechaBaseAdjudicacion(meta: any): { fecha: Date; origen: string } {
  const valida = (x: any) => { const d = x ? new Date(x) : null; return d && !isNaN(d.getTime()) ? d : null; };
  const adj = valida(meta?.fechaAdjudicacion);
  if (adj) return { fecha: adj, origen: 'fecha estimada de adjudicación (Mercado Público)' };
  const cierre = valida(meta?.cierre);
  if (cierre) return { fecha: cierre, origen: 'fecha de cierre de la licitación (no hay fecha estimada de adjudicación)' };
  return { fecha: new Date(), origen: 'hoy (no hay fecha de adjudicación ni de cierre)' };
}

// Respaldo de la heurística de páginas (spec P5): una cita cuya frase NO se encontró, pero que trae
// el numeral, toma como página aproximada la del encabezado de ese numeral. Queda "no verificada".
function respaldoPaginaPorNumeral(inf: any, docs: { nombre: string; texto: string }[]): void {
  const mapas = new Map<string, Map<string, number>>();
  for (const d of docs) if (d.texto && /\[\[P[ÁA]GINA/i.test(d.texto)) mapas.set(d.nombre, mapaArticulos(d.texto));
  if (!mapas.size) return;
  const walk = (o: any) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    for (const [k, v] of Object.entries(o)) {
      if (k === 'cita' && v && typeof v === 'object' && !Array.isArray(v)) {
        const c = v as any;
        if (c.verificada === false && c.metodo === 'no_encontrada' && c.numeral) {
          const n = String(c.numeral).match(/\d{1,2}(?:\.\d{1,2})?/)?.[0];
          const mapa = mapas.get(c.documento) ?? [...mapas.values()][0];
          const pag = n ? mapa?.get(n) : undefined;
          if (pag) c.pagina_aprox = pag;
        }
      } else walk(v);
    }
  };
  walk(inf);
}

// Pares (afirmación, frase) de los DATOS CRÍTICOS para el chequeo semántico (prompt auxiliar B).
// Solo frases que el código ya encontró en los documentos: verificar una frase inexistente no sirve.
function construirParesSemanticos(inf: any, evidencias: EvidenciaAdj[]): ParSemantico[] {
  const pares: ParSemantico[] = [];
  const add = (afirmacion: string, cita: any) => {
    if (!cita || typeof cita !== 'object' || !cita.frase || cita.verificada !== true || !afirmacion) return;
    pares.push({ id: pares.length + 1, afirmacion, documento: String(cita.documento_real || cita.documento || ''), numeral: String(cita.numeral || ''), frase: String(cita.frase).slice(0, 400), cita });
  };
  for (const e of evidencias) if (e.tipo !== 'FORMULARIOS_SEPARADOS') add(CATALOGO[e.tipo].afirmacion, e.cita);
  const afirmSuministro: Record<string, string> = {
    VIGENCIA_CON_PEDIDOS: 'El contrato dura un periodo y las compras se hacen por pedidos u órdenes de compra según requerimiento',
    HASTA_AGOTAR_MONTO: 'El contrato rige hasta agotar el presupuesto',
    CANTIDADES_REFERENCIALES: 'Las cantidades son referenciales o estimadas',
  };
  for (const s of Array.isArray(inf?.exclusion?.senales_suministro) ? inf.exclusion.senales_suministro : []) add(afirmSuministro[String(s?.tipo || '').toUpperCase()] || '', s?.cita);
  const car = String(inf?.presupuesto?.caracter || '');
  if (car === 'EXCLUYENTE') add('Una oferta sobre el presupuesto queda fuera', inf?.presupuesto?.cita);
  if (car === 'REFERENCIAL') add('El presupuesto es estimado o referencial', inf?.presupuesto?.cita);
  const crit = inf?.criterios_evaluacion || {};
  const pm = (p: any) => p && String(p.valor ?? '').trim() ? `Se exige un mínimo de ${p.valor} ${p.unidad || ''} para ${p.consecuencia || 'ser evaluado o adjudicado'}` : '';
  add(pm(crit.puntaje_minimo_total), crit.puntaje_minimo_total?.cita);
  for (const c of Array.isArray(crit.criterios) ? crit.criterios : []) add(pm(c?.puntaje_minimo), c?.puntaje_minimo?.cita);
  for (const h of Array.isArray(inf?.plazos?.hitos) ? inf.plazos.hitos : []) {
    const nombre = HITO_LABEL[String(h?.hito) as keyof typeof HITO_LABEL] || String(h?.hito || '');
    const est = String(h?.estado || '').toUpperCase();
    if (est === 'EXISTE') add(`Se exige ${nombre.toLowerCase()} en ${h.plazo ?? '?'} ${h.unidad_original || ''} desde ${h.desde || 'el evento indicado'}`, h.cita);
    if (est === 'NO_EXISTE' && !h.corregido_por_negacion) add(`Las bases dicen que no se exige ${nombre.toLowerCase()}`, h.cita);
  }
  for (const r of Array.isArray(inf?.requisitos_admisibilidad?.requisitos) ? inf.requisitos_admisibilidad.requisitos : []) {
    if (r?.que) add(`Si no se cumple "${String(r.que).slice(0, 160)}", la oferta queda fuera`, r.cita);
  }
  const a = inf?.multas?.atraso;
  if (a && a.existe !== false && a.valor) add(`La multa por atraso es ${a.valor} ${a.unidad || ''} por ${String(a.periodo || 'día').toLowerCase().replace(/_/g, ' ')}`, a.cita);
  return pares.slice(0, 80);
}

// Agrega al informe el NIVEL DE ATRACTIVO v4.1 (y su chequeo V-27). Se usa al terminar el análisis
// y cada vez que cambia un dato que el nivel lee (confirmación del asistente, configuración).
export async function aplicarNivel(inf: any, codigo: string, cfg?: Awaited<ReturnType<typeof cargarConfigViabilidad>>): Promise<void> {
  const config = cfg ?? await cargarConfigViabilidad();
  let utm: number | null = null;
  try { utm = (await obtenerTipoCambio('UTM'))?.valor ?? null; } catch { /* sin UTM: solo afecta el aviso de rango */ }
  const confirmados: string[] = Array.isArray(inf?.score_confirmaciones) ? inf.score_confirmaciones.map((c: any) => String(c?.clave || '')).filter(Boolean) : [];
  inf.score = calcularNivel(inf, config, { codigo, utm, confirmados });
  const v27 = validarNivelV27(inf);
  if (v27 && inf._validador && Array.isArray(inf._validador.hallazgos)) {
    inf._validador.hallazgos = inf._validador.hallazgos.filter((h: any) => h?.regla !== 'V-27').concat(v27);
    inf._validador.ok = !inf._validador.hallazgos.some((h: any) => h?.severidad === 'error');
  }
  console.log(`[viabilidad-ia-v4] ${codigo}: nivel ${inf.score.nivel} · ${inf.score.accion_texto}${inf.score.datos_dudosos.length ? ` (dudoso: ${inf.score.datos_dudosos.map((d: any) => d.dato).join(', ')})` : ''}.`);
}

// ── El checklist de anexos se cruza contra los anexos REALMENTE PUBLICADOS ────────────────────
// El "orden de trabajo — documentos propios a crear" lo redacta el modelo leyendo las bases, y ahí
// se le escapan anexos: caso real 1057480-41-LP26 (Hospital San José de Melipilla), donde listó 7
// de los 11 publicados. Los 4 que faltaban (N°1 Identificación del Oferente, N°2 y N°3
// declaraciones juradas, N°4 UTP) no son un descuido menor: las bases dicen textualmente "Haber
// llenado y presentado los Anexos Administrativos N°1, N°2, N°3 y N°4 […] habilita al proveedor a
// participar". Lo que pasó es que el modelo enumeró los anexos ligados a un CRITERIO DE EVALUACIÓN
// (los que tienen % de puntaje) y dejó fuera los administrativos, que no puntúan pero sin los
// cuales la oferta no entra.
//
// La corrección no es afinar el prompt —cuántos anexos publicó el organismo no es una lectura ni
// un juicio, es un dato duro que ya tenemos en documentos_cache— sino cruzar: cualquier anexo con
// archivo publicado que el informe no nombre se agrega acá, marcado como agregado por el sistema y
// SIN inventarle criticidad ni fundamento (queda como PUNTAJE_CONDICIONANTE, el nivel medio, con
// el texto diciendo que hay que verificarlo en las bases). Nunca al revés: no se borra ni se
// reescribe nada de lo que el modelo sí encontró.
const RE_NUMERO_ANEXO = /anexo[\s_]*n?[°ºo]?\s*[.]?\s*(\d{1,2})\b/gi;

function numerosDeAnexoEn(texto: string): number[] {
  return [...String(texto || '').matchAll(RE_NUMERO_ANEXO)].map(m => Number(m[1])).filter(n => n > 0);
}

// Título real del anexo, sacado de su propio texto: estos documentos abren con "ANEXO N°1" y en la
// línea siguiente su nombre ("IDENTIFICACIÓN DEL OFERENTE"). Es un dato del archivo, no una
// suposición — si no se puede leer, se deja sin título en vez de inventarlo.
function tituloDeAnexo(texto: string): string {
  const lineas = String(texto || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const iCabecera = lineas.findIndex(l => /^#*\s*anexo\b/i.test(l));
  const siguiente = iCabecera >= 0 ? lineas[iCabecera + 1] : '';
  return siguiente && siguiente.length <= 120 && !/^#*\s*anexo\b/i.test(siguiente) ? siguiente : '';
}

// v4.0 (P10, Grupo 2 — anexos del organismo): el cruce se hace contra
// `requisitos_admisibilidad.documentos_solicitados` (los marcados como anexo del organismo). Los
// anexos publicados que el informe no nombra se agregan con `_agregado_por_cruce`, sin inventarles
// copias ni antigüedad. Los documentos A CREAR (Grupo 3) van aparte, en `documentos_a_crear`.
export function completarAnexosPublicadosV4(informe: any, docs: DocLeido[], codigo: string): void {
  const adm = informe?.requisitos_admisibilidad;
  if (!adm || typeof adm !== 'object') return;
  if (!Array.isArray(adm.documentos_solicitados)) adm.documentos_solicitados = [];

  const yaListados = new Set<number>(
    adm.documentos_solicitados.flatMap((d: any) => numerosDeAnexoEn(`${d?.nombre || ''}`)),
  );

  const publicados = new Map<number, DocLeido>();
  for (const d of docs) {
    const categoria = String(d.categoria || '').toUpperCase();
    if (categoria === 'DOCUMENTOS_PROPIOS') continue;   // el costeo/informe que genera este sistema
    const n = numerosDeAnexoEn(d.nombre)[0];
    if (n && !publicados.has(n)) publicados.set(n, d);
  }

  const faltantes = [...publicados.entries()].filter(([n]) => !yaListados.has(n)).sort((a, b) => a[0] - b[0]);
  if (!faltantes.length) return;

  for (const [n, doc] of faltantes) {
    const titulo = tituloDeAnexo(doc.texto);
    adm.documentos_solicitados.push({
      nombre: `Anexo N°${n}${titulo ? `: ${titulo}` : ''}`,
      anexo_del_organismo: true,
      copias: '',
      antiguedad_maxima: '',
      cita: { documento: doc.nombre, numeral: '', frase: '' },
      _agregado_por_cruce: true,
    });
  }
  console.log(`[viabilidad-ia-v4] ${codigo}: anexos del organismo completados con ${faltantes.length} anexo(s) publicado(s) que el informe no listaba: ${faltantes.map(([n]) => `N°${n}`).join(', ')}.`);
}

// Guarda el informe bajo `_informe_ia_v3` — la clave del "informe IA activo" que leen todos los
// módulos (Compras, Auditor, costeo, anexos); el esquema real va en `_schema: 'v4'`. NO pisa
// _informe_ia (v2).
// v4.1 (decisión del usuario, 02-oct-2026): el NIVEL va en columnas propias (migration-137);
// `score_total`/`semaforo` quedan con el puntaje del perfil inicial y el análisis IA ya no los pisa.
async function guardarViabilidadIAV4(codigo: string, r: any): Promise<void> {
  const [rows] = await pool.query(`SELECT informe_ejecutivo, desglose FROM viabilidad_licitacion WHERE licitacion_codigo = ? LIMIT 1`, [codigo]);
  const fila = (rows as any[])[0];
  const modelo = `ia+v4+${r?._modelo_respondio || MODELO_TEXTO}`.slice(0, 100);
  if (fila) {
    let ie: any = {};
    try { ie = typeof fila.informe_ejecutivo === 'string' ? JSON.parse(fila.informe_ejecutivo) : (fila.informe_ejecutivo || {}); } catch { ie = {}; }
    ie._informe_ia_v3 = r;
    // La tarjeta "Productos y modalidad" lee desglose.modalidad_adjudicacion (calculado solo con la
    // API MP). El análisis de las bases manda: global · por_linea · no_claro, sin "suma alzada"
    // como forma de adjudicar (P1).
    let desg: any = null;
    try { desg = typeof fila.desglose === 'string' ? JSON.parse(fila.desglose) : fila.desglose; } catch { desg = null; }
    const res = String(r?.adjudicacion?.resultado || '').toUpperCase();
    if (desg?.modalidad_adjudicacion && res) {
      const esPorLinea = res === 'POR_LINEAS';
      desg.modalidad_adjudicacion.modalidad = esPorLinea ? 'por_linea' : res === 'GLOBAL' ? 'global' : 'no_claro';
      desg.modalidad_adjudicacion.es_por_linea = esPorLinea;
      desg.modalidad_adjudicacion.notas = `${esPorLinea ? 'Por línea' : res === 'GLOBAL' ? 'Global' : 'No está claro cómo se adjudica'} — según análisis IA de las bases${r?.adjudicacion?.motivo ? ` (${String(r.adjudicacion.motivo).slice(0, 160)})` : ''}.`;
    }
    await pool.query(
      `UPDATE viabilidad_licitacion SET informe_ejecutivo = ?, desglose = COALESCE(?, desglose), area_negocio = ?, modelo = ? WHERE licitacion_codigo = ?`,
      [JSON.stringify(ie), desg ? JSON.stringify(desg) : null, r.area_negocio, modelo, codigo]);
  } else {
    await pool.query(
      `INSERT INTO viabilidad_licitacion (licitacion_codigo, informe_ejecutivo, area_negocio, modelo) VALUES (?, ?, ?, ?)`,
      [codigo, JSON.stringify({ _informe_ia_v3: r }), r.area_negocio, modelo]);
  }
  await guardarColumnasNivel(codigo, r?.score);
}

/** Escribe nivel/acción en sus columnas (migration-137). Sin la migración, solo avisa. */
export async function guardarColumnasNivel(codigo: string, score: any): Promise<void> {
  if (!score) return;
  try {
    await pool.query(
      `UPDATE viabilidad_licitacion SET nivel_atractivo = ?, nivel_num = ?, accion_asistente = ?, nivel_presupuesto_neto = ?, nivel_calculado_en = NOW() WHERE licitacion_codigo = ?`,
      [score.nivel, score.nivel_num, score.accion_asistente, score.presupuesto_neto_orden ?? null, codigo]);
  } catch (e) {
    console.warn(`[viabilidad-ia-v4] ${codigo}: no se pudieron guardar las columnas del nivel (¿falta aplicar migration-137?):`, String(e).slice(0, 140));
  }
}

// `onFase` es un hook OPCIONAL (best-effort, nunca lanza) para que el caller (la ruta API) pueda
// reportar progreso — hoy alimenta la barra de progreso del panel de viabilidad. Fases:
// leyendo_documentos → analizando_ia → verificando → guardando.
export type FaseAnalisisIA = 'leyendo_documentos' | 'analizando_ia' | 'verificando' | 'guardando';
export async function analizarYGuardarViabilidadIA(codigo: string, onFase?: (fase: FaseAnalisisIA) => void): Promise<ViabilidadIAResult | null> {
  // Analizador ÚNICO v4.0 + nivel v4.1: el modelo extrae, el código decide; puente al costeo
  // (manifiesto_productos/modalidad/estructura_costeo que arma el análisis).
  const rv3 = await analizarViabilidadIAV3(codigo, onFase);
  if (!rv3) return null;
  console.log(`[viabilidad-ia] ${codigo}: === FASE guardando === (informe v4 listo, nivel=${rv3.score?.nivel ?? '?'}, guardando en BD y generando costeo)…`);
  try { onFase?.('guardando'); } catch { /* noop */ }
  try { await guardarViabilidadIAV4(codigo, rv3); }
  catch (e) { console.error('[viabilidad-ia-v4] guardar falló:', String(e).slice(0, 200)); }
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

  // PRECIOS DE MERCADO en la viabilidad: DESACTIVADO por defecto para NO gastar tokens de Serper
  // en cada análisis. El costeo se genera aquí SIN precios; la búsqueda de productos (Serper) se
  // dispara bajo demanda con el botón "Productos a costeo" en Negocios (cuando el perfil trabaja la
  // licitación → estado En proceso), que llama a /api/documentos/generar-costeo con ?precios=1.
  // Para volver a cotizar en automático durante la viabilidad, pon COSTEO_PRECIOS_AUTO=1.
  if (process.env.COSTEO_PRECIOS_AUTO === '1') {
    try {
      const precios = await cotizarPreciosManifiesto(codigo, manifiesto, r);
      const conPrecio = precios.filter(p => p.precio_neto != null).length;
      if (conPrecio > 0) {
        (datosCosteo as any).precios = precios;
        console.log(`[costeo] ${codigo}: precios de mercado (auto) → ${conPrecio}/${precios.length} ítems cotizados`);
      }
    } catch (e) {
      console.error(`[costeo] ${codigo}: cotización de precios falló (se sigue sin precios):`, String(e).slice(0, 200));
    }
  }

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
      // El costeo (con o sin precios de mercado) queda como DOCUMENTOS_PROPIOS: visible para
      // cualquier perfil asignado a la licitación. La viabilidad la puede hacer cualquiera y
      // el costeo con precios se genera y se ve igual (ya no es exclusivo de admin).
      const categoriaDoc = 'DOCUMENTOS_PROPIOS';
      colsExtra  += ', categoria';
      valsExtra  += ', ?';
      updateExtra += ', categoria = VALUES(categoria)';
      params.push(categoriaDoc);
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

// Cotiza los ítems del manifiesto con el buscador de precios (Serper + caché) y devuelve
// los PrecioMercadoItem que el Excel de costeo casa por descripción. Región y rubro salen
// del meta de la licitación para afinar la búsqueda.
async function cotizarPreciosManifiesto(
  codigo: string,
  manifiesto: ManifiestoLinea[],
  r: ViabilidadIAResult,
): Promise<import('@/app/lib/generar-costeo').PrecioMercadoItem[]> {
  if (!process.env.SERPER_API_KEY) {
    console.warn(`[costeo] ${codigo}: SERPER_API_KEY ausente → sin precios de mercado`);
    return [];
  }
  const { cotizarManifiesto } = await import('@/app/lib/buscador-precios');

  const region = r.meta?.region || '';
  const contexto = r.meta?.linea_negocio || '';
  console.log(`[costeo] ${codigo}: cotizando ${manifiesto.length} ítems (región="${region}", rubro="${contexto}")…`);
  const t0 = Date.now();
  const precios = await cotizarManifiesto(manifiesto, { region, contexto });
  const segs = ((Date.now() - t0) / 1000).toFixed(1);
  const hits = precios.filter(p => p.tienda).length;
  const cacheHits = precios.filter(p => p.desde_cache).length;
  console.log(`[costeo] ${codigo}: cotización lista en ${segs}s — ${hits}/${precios.length} con match (${cacheHits} de caché)`);
  return precios;
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
    [codigo, JSON.stringify(especs), `ia+v3+${MODELO_TEXTO}`],
  );
}
