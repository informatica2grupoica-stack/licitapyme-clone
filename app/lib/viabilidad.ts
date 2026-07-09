// app/lib/viabilidad.ts
// Fase 2 — Analizador de Viabilidad (PROMPT 2).
// Motor HÍBRIDO:
//   • Scoring DETERMINISTA de los 5 criterios + penalizaciones (auditable, estable).
//   • Una llamada IA LIGERA solo para juicios cualitativos: área de negocio,
//     tipo de producto / especificación dirigida, descripción para búsqueda e informe.
// Reutiliza lo ya extraído en `analisis_ia_licitacion` (no vuelve a leer los PDFs).

import pool from '@/app/lib/db';
import { crearChatIA, iaTextoConfigurada, ViabilidadJuicioIA } from '@/app/lib/gemini';
import { parseJsonIA } from '@/app/lib/json-ia';
import { getMercadoPublicoClient } from '@/app/lib/mercado-publico';

// ─── Tipos ──────────────────────────────────────────────────────────────────────
export type Semaforo = 'VERDE' | 'AMARILLO' | 'NARANJA' | 'ROJO' | 'ROJO_DURO';
export type AreaNegocio = 'FERRETERIA' | 'EQUIPAMIENTO' | 'MIXTO';

export interface ViabilidadResult {
  licitacion_id: string;
  objeto: string;
  entidad_licitante: string;
  area_negocio: AreaNegocio;
  score_viabilidad: {
    total: number;
    semaforo: Semaforo;
    descalificacion_automatica: boolean;
    motivo_descalificacion: string | null;
    desglose: {
      presupuesto: { valor_extraido: string; valor_neto: number | null; con_iva: boolean; puntos: number; notas: string };
      lineas: { cantidad: number | null; puntos_base: number; ajuste_area: number; puntos_final: number; notas: string; fuente: 'mp' | 'pdf' | null; items: Array<{ nombre: string; descripcion?: string; categoria?: string; cantidad?: number | null; unidad?: string | null; requisitos?: string | null }> };
      modalidad_adjudicacion: { modalidad: string; modalidad_texto: string | null; es_por_linea: boolean; puntos: number; notas: string };
      criterios_evaluacion: { peso_precio_pct: number; criterios_acreditables: boolean; criterios_subjetivos_pct: number; puntos: number; detalle: Array<{ nombre: string; ponderacion_pct: number; acreditable: boolean }>; notas: string };
      tipo_producto: { descripcion: string; importable: boolean; especificacion_dirigida: boolean; puntos: number; notas: string };
    };
    penalizaciones: Array<{ motivo: string; puntos_restados: number }>;
    score_base: number;
    total_penalizaciones: number;
  };
  informe_ejecutivo: {
    resumen: string;
    presupuesto_display: string;
    plazo_presentacion: string | null;
    ventaja_competitiva: string;
    riesgos: string[];
    alertas: string[];
    campos_faltantes: string[];
    recomendacion: string;
  };
  trigger_busqueda: {
    activar: boolean;
    requiere_aprobacion_humana: boolean;
    area_negocio: AreaNegocio;
    descripcion_producto_para_busqueda: string;
    es_importable: boolean;
    motivo_no_activar: string | null;
  };
  confianza_analisis: number;
  notas_analista: string;
  riesgo_comercial?: RiesgoComercial;
}

// ─── Capa de Análisis de Riesgo Comercial (PROMPT 3) ──────────────────────────────
export type DecisionComercial = 'POSTULAR' | 'EVALUAR_CON_PROVEEDOR' | 'DESCARTAR';
export type NivelRiesgo = 'Alto' | 'Medio' | 'Bajo';
export type ImpactoFlete = 'Crítico' | 'Moderado' | 'Despreciable';

export interface RiesgoComercial {
  monto_neto_calculado_clp: number | null;
  score_viabilidad: number;               // 0.0 (inviable) – 1.0 (ideal)
  decision_sugerida: DecisionComercial;
  motivo_principal_decision: string;
  analisis_criterios: {
    modalidad_adjudicacion: { tipo: 'Suma Alzada' | 'Por Línea' | 'Desconocido'; nivel_riesgo: NivelRiesgo; justificacion_texto: string };
    experiencia_requerida: { exige_experiencia_publica: boolean; monto_minimo_exigido: string | null; alerta_bloqueo: string | null };
    garantias_y_seguros: { seriedad_oferta: string; fiel_cumplimiento: string; seguro_daños_terceros: string };
    logistica_y_plazos: { plazo_ejecucion_dias: number | null; zona_geografica: string; impacto_flete_y_operaciones: ImpactoFlete; justificacion_logistica: string };
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────────
function parseMaybeJSON<T>(v: any): T | null {
  if (v == null) return null;
  if (typeof v === 'object') return v as T;
  try { return JSON.parse(v) as T; } catch { return null; }
}

const sinTildes = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function fmtCLP(n: number): string {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
}

// Días HÁBILES (lun-vie) hasta la fecha de cierre. Lo calcula el preprocesador, no la IA.
function diasHabilesRestantes(cierre: string | Date | null): number | null {
  if (!cierre) return null;
  const target = new Date(cierre);
  if (isNaN(target.getTime())) return null;
  const cur = new Date(); cur.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  if (target <= cur) return 0;
  let count = 0;
  while (cur < target) {
    cur.setDate(cur.getDate() + 1);
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

// ─── Insumos desde BD ──────────────────────────────────────────────────────────────
interface CriterioEval { nombre: string; ponderacion: number; tipo?: string; descripcion?: string }
interface EspecTecnica { item?: string; descripcion?: string; cantidad?: number | null; unidad?: string | null; requisitosMinimos?: string | null }
interface Garantia { tipo: string; porcentaje?: number | null; montoFijo?: number | null }
// Ítem tal como lo entrega la API de Mercado Público (fuente fiable de líneas + categoría UNSPSC).
interface ItemMP { nombre: string; descripcion?: string; categoria?: string; cantidad?: number | null; unidad?: string | null }

interface Insumos {
  codigo: string;
  objeto: string;
  entidad: string;
  montoAnalisis: number | null;
  monedaAnalisis: string | null;
  montoAlerta: number | null;
  montoMP: number | null;       // MontoEstimado de la API de Mercado Público
  fechaCierre: string | Date | null;
  modalidad: string | null;
  plazoEjecucionDias: number | null;
  lugarEntrega: string | null;
  region: string | null;
  criterios: CriterioEval[];
  especificaciones: EspecTecnica[];
  itemsMP: ItemMP[];            // líneas reales desde la API de MP (fuente preferida)
  garantias: Garantia[];
  requisitosTexto: string;
  requisitosObj: Record<string, string[]>;  // requisitos por categoría (admin/tecnicos/...) para el análisis comercial
  resumenAdminTexto: string;
  resumenTecnicasTexto: string;
  hayBasesAdmin: boolean;
  hayBasesTecnicas: boolean;
  estadoFase1: 'completo' | 'incompleto' | 'desconocido';
}

async function cargarInsumos(codigo: string): Promise<Insumos | null> {
  const [aRows] = await pool.query(
    `SELECT * FROM analisis_ia_licitacion WHERE licitacion_codigo = ? LIMIT 1`,
    [codigo],
  );
  const a = (aRows as any[])[0];
  if (!a) return null; // sin análisis exhaustivo no se puede puntuar de forma robusta

  // Metadata de la alerta (monto / nombre / organismo / cierre)
  let objeto = '', entidad = '', montoAlerta: number | null = null, fechaCierre: string | Date | null = null, region: string | null = null;
  try {
    const [lRows] = await pool.query(
      `SELECT licitacion_nombre, licitacion_organismo, licitacion_monto, licitacion_cierre, licitacion_region
       FROM alertas_licitaciones WHERE licitacion_codigo = ? ORDER BY created_at DESC LIMIT 1`,
      [codigo],
    );
    const l = (lRows as any[])[0];
    if (l) {
      objeto = l.licitacion_nombre || '';
      entidad = l.licitacion_organismo || '';
      montoAlerta = l.licitacion_monto ?? null;
      fechaCierre = l.licitacion_cierre ?? null;
      region = l.licitacion_region ?? null;
    }
  } catch { /* tabla puede no existir en pruebas */ }

  // Estado de completitud de Fase 1 (clasificación de documentos)
  let estadoFase1: Insumos['estadoFase1'] = 'desconocido';
  let hayBasesAdminF1 = false, hayBasesTecnicasF1 = false;
  try {
    const [cRows] = await pool.query(
      `SELECT categoria FROM documentos_cache WHERE licitacion_codigo = ?`,
      [codigo],
    );
    const cats = (cRows as any[]).map(r => (r.categoria || '').toUpperCase());
    const clasificados = cats.filter(Boolean);
    if (clasificados.length > 0) {
      hayBasesAdminF1 = cats.includes('BASES_ADMINISTRATIVAS');
      hayBasesTecnicasF1 = cats.includes('BASES_TECNICAS');
      // Las bases técnicas suelen venir INTEGRADAS en las administrativas (ver doc de visión).
      // Por eso: con bases administrativas presentes la info crítica está disponible → 'completo'.
      // Solo es 'incompleto' si faltan las administrativas (ahí no hay presupuesto/criterios).
      estadoFase1 = hayBasesAdminF1 ? 'completo' : 'incompleto';
    }
  } catch { /* columna categoria puede no existir aún */ }

  const requisitos = parseMaybeJSON<Record<string, string[]>>(a.requisitos) || {};
  const requisitosTexto = sinTildes(Object.values(requisitos).flat().filter(Boolean).join(' | '));
  const resumenAdmin = parseMaybeJSON<any>(a.resumen_bases_admin);
  const resumenTecnicas = parseMaybeJSON<any>(a.resumen_bases_tecnicas);
  const resumenAdminTexto = sinTildes(JSON.stringify(resumenAdmin || {}));
  const resumenTecnicasTexto = sinTildes(JSON.stringify(resumenTecnicas || {}));

  const especificaciones = parseMaybeJSON<EspecTecnica[]>(a.especificaciones_tecnicas) || [];

  // Datos estructurados de la API de Mercado Público: líneas reales (con categoría UNSPSC)
  // y monto estimado. Es la fuente MÁS fiable de líneas/área; el PDF la complementa.
  let itemsMP: ItemMP[] = [];
  let montoMP: number | null = null;
  try {
    const lic = await getMercadoPublicoClient().obtenerPorCodigoRapido(codigo, 12_000);
    if (lic) {
      montoMP = (lic.MontoEstimado as number) || null;
      itemsMP = (lic.Items || []).map((it: any) => ({
        nombre: it.NombreProducto || '',
        descripcion: it.Descripcion || '',
        categoria: it.Categoria || '',
        cantidad: it.Cantidad ?? null,
        unidad: it.Unidad || it.UnidadMedida || null,
      })).filter((it: ItemMP) => it.nombre || it.descripcion);
    }
  } catch (e) {
    console.warn('[viabilidad] No se pudieron obtener ítems de la API MP:', String(e).slice(0, 120));
  }

  return {
    codigo,
    objeto,
    entidad,
    montoAnalisis: a.presupuesto_monto ?? null,
    monedaAnalisis: a.presupuesto_moneda ?? null,
    montoAlerta,
    montoMP,
    fechaCierre,
    modalidad: a.modalidad_adjudicacion ?? null,
    plazoEjecucionDias: a.plazo_ejecucion_dias ?? null,
    lugarEntrega: a.lugar_entrega ?? null,
    region,
    criterios: parseMaybeJSON<CriterioEval[]>(a.criterios_evaluacion) || [],
    especificaciones,
    itemsMP,
    garantias: parseMaybeJSON<Garantia[]>(a.garantias) || [],
    requisitosTexto,
    requisitosObj: requisitos,
    resumenAdminTexto,
    resumenTecnicasTexto,
    hayBasesAdmin: hayBasesAdminF1 || !!resumenAdmin,
    hayBasesTecnicas: hayBasesTecnicasF1 || !!resumenTecnicas || especificaciones.length > 0,
    estadoFase1,
  };
}

// ─── IA ligera: área / tipo de producto / informe ───────────────────────────────
type TipoProductoCategoria =
  | 'generico_importable' | 'generico_local' | 'marca_homologable'
  | 'marca_propietaria' | 'dirigida' | 'no_identificable';

interface JuicioIA {
  area_negocio: AreaNegocio;
  tipo_producto: { categoria: TipoProductoCategoria; descripcion: string; es_importable: boolean; especificacion_dirigida: boolean };
  descripcion_producto_para_busqueda: string;
  informe: { resumen: string; ventaja_competitiva: string; riesgos: string[]; alertas: string[]; recomendacion: string };
}

function juicioFallback(ins: Insumos): JuicioIA {
  const desc = ins.especificaciones.slice(0, 8).map(e => e.descripcion || e.item).filter(Boolean).join('; ') || ins.objeto;
  return {
    area_negocio: 'MIXTO',
    tipo_producto: { categoria: 'no_identificable', descripcion: desc, es_importable: true, especificacion_dirigida: false },
    descripcion_producto_para_busqueda: desc,
    informe: {
      resumen: ins.objeto || 'Licitación sin descripción disponible.',
      ventaja_competitiva: 'Por determinar — no se pudo generar el análisis cualitativo automático.',
      riesgos: [],
      alertas: ['El análisis cualitativo (IA) no estuvo disponible; el score se basa solo en los datos extraídos.'],
      recomendacion: 'Revisar manualmente las bases antes de decidir.',
    },
  };
}

async function obtenerJuicioIA(ins: Insumos): Promise<{ juicio: JuicioIA; iaOk: boolean }> {
  if (!iaTextoConfigurada()) return { juicio: juicioFallback(ins), iaOk: false };

  // Preferimos los ítems de la API de MP (traen categoría UNSPSC oficial, señal fuerte de área).
  const itemsParaIA = ins.itemsMP.length > 0
    ? ins.itemsMP.slice(0, 30).map((e, i) =>
        `${i + 1}. ${e.nombre || e.descripcion || ''}${e.categoria ? ` [categoría: ${e.categoria}]` : ''}${e.cantidad ? ` (cant: ${e.cantidad}${e.unidad ? ' ' + e.unidad : ''})` : ''}`)
    : ins.especificaciones.slice(0, 30).map((e, i) =>
        `${i + 1}. ${e.descripcion || e.item || ''}${e.cantidad ? ` (cant: ${e.cantidad}${e.unidad ? ' ' + e.unidad : ''})` : ''}`);
  const itemsTexto = itemsParaIA.join('\n') || '(no se detectaron líneas/ítems)';
  const criteriosTexto = ins.criterios.map(c => `${c.nombre}: ${c.ponderacion}%`).join(', ') || '(no detectados)';

  const system = `Eres analista experto en licitaciones públicas de Chile (Mercado Público) para una empresa que opera en dos áreas: FERRETERÍA (materiales de construcción, ferretería general, productos estándar con oferta local amplia) y EQUIPAMIENTO (instrumentación, laboratorio, electrónica, maquinaria, equipos industriales/médicos).
Tu tarea es SOLO clasificar cualitativamente. NO calcules puntajes. Responde ÚNICAMENTE un objeto JSON válido, sin markdown ni texto adicional.

Categorías de tipo_producto:
- "generico_importable": producto genérico importable o con homólogo directo.
- "generico_local": producto genérico con oferta local amplia (típico ferretería).
- "marca_homologable": marca de referencia pero homologable ("o similar").
- "marca_propietaria": marca propietaria sin homólogo.
- "dirigida": especificación dirigida a un solo proveedor ("sin equivalencia", "único proveedor", "exclusivo", o specs que calzan exactamente con un fabricante).
- "no_identificable": bases técnicas ausentes o producto no determinable.

especificacion_dirigida = true solo si la categoría es "dirigida".`;

  const user = `OBJETO: ${ins.objeto || '(sin nombre)'}
ENTIDAD: ${ins.entidad || '(sin organismo)'}
MODALIDAD: ${ins.modalidad || '(no especificada)'}
CRITERIOS DE EVALUACIÓN: ${criteriosTexto}

LÍNEAS / ESPECIFICACIONES TÉCNICAS:
${itemsTexto}

RESUMEN BASES TÉCNICAS (si hay): ${ins.resumenTecnicasTexto.slice(0, 1500) || '(no disponible)'}

Devuelve EXACTAMENTE este JSON:
{
  "area_negocio": "FERRETERIA | EQUIPAMIENTO | MIXTO",
  "tipo_producto": {
    "categoria": "generico_importable | generico_local | marca_homologable | marca_propietaria | dirigida | no_identificable",
    "descripcion": "qué se licita, en 1 frase",
    "es_importable": true,
    "especificacion_dirigida": false
  },
  "descripcion_producto_para_busqueda": "texto del producto extraído de las bases, sin resumir",
  "informe": {
    "resumen": "qué pide, cuánto vale aprox y para quién, en 1-2 oraciones",
    "ventaja_competitiva": "qué ventaja real tiene la empresa en este proyecto",
    "riesgos": ["..."],
    "alertas": ["..."],
    "recomendacion": "veredicto claro en 2-3 oraciones"
  }
}`;

  try {
    const completion = await crearChatIA({
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.2,
      max_tokens: 1500,
      response_format: { type: 'json_object' },
    });
    const raw = completion.choices[0]?.message?.content || '';
    const parsed = parseJsonIA<any>(raw);
    if (!parsed) throw new Error('JSON de viabilidad IA ilegible');
    const fb = juicioFallback(ins);
    const tp = parsed.tipo_producto || {};
    const juicio: JuicioIA = {
      area_negocio: ['FERRETERIA', 'EQUIPAMIENTO', 'MIXTO'].includes(parsed.area_negocio) ? parsed.area_negocio : 'MIXTO',
      tipo_producto: {
        categoria: tp.categoria || 'no_identificable',
        descripcion: tp.descripcion || fb.tipo_producto.descripcion,
        es_importable: tp.es_importable ?? true,
        especificacion_dirigida: tp.especificacion_dirigida ?? (tp.categoria === 'dirigida'),
      },
      descripcion_producto_para_busqueda: parsed.descripcion_producto_para_busqueda || fb.descripcion_producto_para_busqueda,
      informe: {
        resumen: parsed.informe?.resumen || fb.informe.resumen,
        ventaja_competitiva: parsed.informe?.ventaja_competitiva || fb.informe.ventaja_competitiva,
        riesgos: Array.isArray(parsed.informe?.riesgos) ? parsed.informe.riesgos : [],
        alertas: Array.isArray(parsed.informe?.alertas) ? parsed.informe.alertas : [],
        recomendacion: parsed.informe?.recomendacion || fb.informe.recomendacion,
      },
    };
    return { juicio, iaOk: true };
  } catch (e) {
    console.warn('[viabilidad] IA ligera falló, usando fallback:', String(e).slice(0, 150));
    return { juicio: juicioFallback(ins), iaOk: false };
  }
}

// ─── Scoring determinista de los 5 criterios ─────────────────────────────────────
const PISO_NETO = 10_000_000;

function puntosPresupuesto(neto: number | null, reservado: boolean) {
  if (reservado || neto == null) return { puntos: 15, descalifica: false };
  if (neto < PISO_NETO) return { puntos: 0, descalifica: true };
  if (neto < 20_000_000) return { puntos: 8, descalifica: false };
  if (neto < 50_000_000) return { puntos: 14, descalifica: false };
  if (neto < 150_000_000) return { puntos: 20, descalifica: false };
  if (neto < 500_000_000) return { puntos: 23, descalifica: false };
  return { puntos: 25, descalifica: false };
}

function puntosLineasBase(n: number | null): number {
  if (n == null || n === 0) return 10; // no especificado → neutro
  if (n <= 5) return 20;
  if (n <= 15) return 16;
  if (n <= 30) return 11;
  if (n <= 60) return 6;
  if (n <= 100) return 3;
  return 0;
}

function ajusteLineasArea(n: number, area: AreaNegocio): number {
  if (area === 'FERRETERIA' && n >= 31 && n <= 100) return 3;
  if (area === 'EQUIPAMIENTO' && n > 30) return -3;
  return 0;
}

function puntosModalidad(modalidad: string | null): { modalidad: string; puntos: number; notas: string } {
  const m = sinTildes(modalidad || '');
  if (!m) return { modalidad: 'no_especificada', puntos: 8, notas: 'No especificada — se asume suma alzada.' };
  if (m.includes('linea') || m.includes('unitar') || m.includes('menor monto') || m.includes('menor precio')) return { modalidad: 'por_linea', puntos: 15, notas: 'Adjudicación por línea / menor precio.' };
  if (m.includes('alzada') && (m.includes('obligator') || m.includes('100'))) return { modalidad: 'suma_alzada_items_obligatorios', puntos: 5, notas: 'Suma alzada con ítems obligatorios.' };
  if (m.includes('alzada')) return { modalidad: 'suma_alzada', puntos: 8, notas: 'Suma alzada.' };
  return { modalidad: 'no_especificada', puntos: 8, notas: `Modalidad ambigua ("${modalidad}") — se asume suma alzada.` };
}

function esEconomico(c: CriterioEval): boolean {
  const t = sinTildes(c.tipo || ''); const n = sinTildes(c.nombre || '');
  return t === 'economico' || n.includes('precio') || n.includes('oferta econ') || n.includes('economic');
}
function esAcreditable(c: CriterioEval): boolean {
  const n = sinTildes(c.nombre || ''); const d = sinTildes(c.descripcion || '');
  return ['experiencia', 'certific', 'iso', 'plazo', 'garantia', 'entrega', 'soporte'].some(k => n.includes(k) || d.includes(k));
}

function puntosCriterios(criterios: CriterioEval[]) {
  const detalle = criterios.map(c => ({ nombre: c.nombre, ponderacion_pct: Number(c.ponderacion) || 0, acreditable: esAcreditable(c) }));
  if (criterios.length === 0) {
    return { peso_precio_pct: 0, criterios_acreditables: false, criterios_subjetivos_pct: 0, puntos: 5, detalle, notas: 'No se encontraron criterios — neutro, requiere revisión.' };
  }
  const pesoPrecio = criterios.filter(esEconomico).reduce((s, c) => s + (Number(c.ponderacion) || 0), 0);
  let pts = pesoPrecio >= 40 ? 8 : pesoPrecio >= 20 ? 5 : 2;
  const hayAcreditables = criterios.some(esAcreditable);
  if (hayAcreditables) pts += 6;
  pts += 4; // se asume criterios subjetivos ≤ 30% del total (estimación conservadora)
  pts = Math.min(20, pts);
  return {
    peso_precio_pct: pesoPrecio,
    criterios_acreditables: hayAcreditables,
    criterios_subjetivos_pct: 0,
    puntos: pts,
    detalle,
    notas: `Peso del precio: ${pesoPrecio}%. ${hayAcreditables ? 'Hay criterios técnicos acreditables.' : 'Sin criterios acreditables claros.'}`,
  };
}

const PUNTOS_TIPO: Record<TipoProductoCategoria, number> = {
  generico_importable: 20, generico_local: 17, marca_homologable: 13,
  marca_propietaria: 5, dirigida: 2, no_identificable: 8,
};

// ─── Análisis de Riesgo Comercial (PROMPT 3) ──────────────────────────────────────
// Combina extracción determinista (garantías, plazo, modalidad, monto) con una llamada
// IA para los juicios cualitativos (experiencia bloqueante, seguros, impacto logístico,
// decisión). Devuelve TODO lo rescatado de los documentos sobre viabilidad comercial.

function garantiaTexto(gs: Garantia[], clave: string): string {
  const g = gs.find(x => sinTildes(x.tipo || '').includes(clave));
  if (!g) return 'No exige';
  const partes: string[] = [];
  if (g.porcentaje != null) partes.push(`${g.porcentaje}%`);
  if (g.montoFijo != null) partes.push(fmtCLP(g.montoFijo));
  if ((g as any).plazo) partes.push(`vigencia ${(g as any).plazo}`);
  if ((g as any).devolucion) partes.push(String((g as any).devolucion));
  return partes.length ? partes.join(' · ') : (g.tipo || 'Exige (sin detalle)');
}

function modalidadComercial(modalidadTipo: string): { tipo: 'Suma Alzada' | 'Por Línea' | 'Desconocido'; nivel_riesgo: NivelRiesgo } {
  if (modalidadTipo === 'por_linea') return { tipo: 'Por Línea', nivel_riesgo: 'Bajo' };
  if (modalidadTipo === 'suma_alzada' || modalidadTipo === 'suma_alzada_items_obligatorios') return { tipo: 'Suma Alzada', nivel_riesgo: 'Alto' };
  return { tipo: 'Desconocido', nivel_riesgo: 'Medio' };
}

function riesgoFallback(ins: Insumos, montoNeto: number | null, reservado: boolean, modalidadTipo: string): RiesgoComercial {
  const m = modalidadComercial(modalidadTipo);
  const descartaGate = montoNeto != null && montoNeto < PISO_NETO;
  return {
    monto_neto_calculado_clp: montoNeto,
    score_viabilidad: descartaGate ? 0 : reservado ? 0.5 : 0.5,
    decision_sugerida: descartaGate ? 'DESCARTAR' : 'EVALUAR_CON_PROVEEDOR',
    motivo_principal_decision: descartaGate
      ? 'Presupuesto neto bajo el piso de $10.000.000.'
      : 'Análisis cualitativo no disponible; revisar manualmente las barreras de entrada.',
    analisis_criterios: {
      modalidad_adjudicacion: { tipo: m.tipo, nivel_riesgo: m.nivel_riesgo, justificacion_texto: ins.modalidad || 'Modalidad no especificada en las bases.' },
      experiencia_requerida: { exige_experiencia_publica: false, monto_minimo_exigido: null, alerta_bloqueo: null },
      garantias_y_seguros: {
        seriedad_oferta: garantiaTexto(ins.garantias, 'seriedad'),
        fiel_cumplimiento: garantiaTexto(ins.garantias, 'cumplimiento'),
        seguro_daños_terceros: 'Revisar manualmente',
      },
      logistica_y_plazos: {
        plazo_ejecucion_dias: ins.plazoEjecucionDias,
        zona_geografica: [ins.region, ins.lugarEntrega].filter(Boolean).join(' · ') || 'No especificada',
        impacto_flete_y_operaciones: 'Moderado',
        justificacion_logistica: 'No se pudo evaluar automáticamente el impacto logístico.',
      },
    },
  };
}

async function analizarRiesgoComercial(
  ins: Insumos, montoNeto: number | null, reservado: boolean, modalidadTipo: string,
): Promise<RiesgoComercial> {
  if (!iaTextoConfigurada()) return riesgoFallback(ins, montoNeto, reservado, modalidadTipo);

  const m = modalidadComercial(modalidadTipo);
  const reqTec = (ins.requisitosObj?.tecnicos || []).join(' | ');
  const reqAdm = (ins.requisitosObj?.administrativos || []).join(' | ');
  const reqHab = (ins.requisitosObj?.habilitantes || []).join(' | ');
  const garantiasTxt = ins.garantias.map(g => `${g.tipo}: ${[g.porcentaje != null ? g.porcentaje + '%' : null, g.montoFijo != null ? '$' + g.montoFijo : null, (g as any).plazo].filter(Boolean).join(' ')}`).join(' || ') || '(no detectadas)';

  const system = `ROL Y MISIÓN
Eres un Analista de Licitaciones Senior y Gerente de Riesgo Comercial, experto en compras públicas chilenas (MercadoPúblico). Tu misión es ejecutar un riguroso Filtro de Viabilidad Comercial sobre la metadata y el texto de las BASES ADMINISTRATIVAS, y decidir de forma fría, matemática y estratégica si la licitación es viable o debe descartarse.

PRINCIPIOS:
1. Lógica cascada: presupuesto (Gate 0) → barreras técnicas/legales → riesgo logístico/financiero/operativo.
2. Mentalidad de negocio: busca activamente cláusulas ocultas, multas leoninas, experiencia desmedida y trampas en la modalidad que pongan en peligro la rentabilidad.
3. Certeza documental: no asumas capacidades que la empresa no tiene; si exigen una certificación/garantía/experiencia que no se acredita, la licitación es de alto riesgo o inviable.

GATE 0 — PRESUPUESTO: trabaja con el monto NETO ya calculado. Si es < $10.000.000 CLP → DESCARTAR. Si es reservado/null → no descartar por monto, marca revisión manual.

LOS 4 FILTROS CRÍTICOS:
1. MODALIDAD: Suma Alzada = riesgo ALTO (omitir un solo insumo causa inadmisibilidad/multas). Por Línea/Convenio Marco = riesgo BAJO/MEDIO (se elige a qué partidas postular).
2. EXPERIENCIA: busca "experiencia del oferente/administrador", facturación mínima anual, montos en UTM/UF de obras ejecutadas, actas de recepción de contratos con el Estado. Si exige respaldo público alto (ej. ≥1.000 UTM) marca alerta_bloqueo.
3. GARANTÍAS Y SEGUROS: seriedad de oferta (monto/plazo), fiel cumplimiento (% e instrumento: boleta/vale vista/póliza), seguros obligatorios (responsabilidad civil daños a terceros en UF). Si no exige seriedad, baja la barrera.
4. LOGÍSTICA Y PLAZOS: cruza comuna/zona con plazo de ejecución. Zona rural/alejada/extrema → impacto de flete CRÍTICO o MODERADO para materiales pesados, áridos, hormigón y movilización de cuadrillas.

Responde ÚNICAMENTE un objeto JSON válido, sin markdown ni texto extra.`;

  const user = `METADATA Y DATOS EXTRAÍDOS:
licitacion_id: ${ins.codigo}
objeto: ${ins.objeto || '(sin nombre)'}
monto_neto_calculado_clp: ${montoNeto ?? 'null'}${reservado ? ' (RESERVADO/null)' : ''}
modalidad_detectada: ${ins.modalidad || '(no especificada)'} → tipo=${m.tipo}, riesgo_base=${m.nivel_riesgo}
plazo_ejecucion_dias: ${ins.plazoEjecucionDias ?? 'null'}
zona/comuna: ${[ins.region, ins.lugarEntrega].filter(Boolean).join(' · ') || '(no especificada)'}
garantias_detectadas: ${garantiasTxt}
requisitos_administrativos: ${reqAdm.slice(0, 800) || '(none)'}
requisitos_tecnicos: ${reqTec.slice(0, 800) || '(none)'}
requisitos_habilitantes: ${reqHab.slice(0, 600) || '(none)'}
resumen_bases_admin: ${ins.resumenAdminTexto.slice(0, 1800)}

Devuelve EXACTAMENTE este JSON:
{
  "score_viabilidad": 0.0,
  "decision_sugerida": "POSTULAR | EVALUAR_CON_PROVEEDOR | DESCARTAR",
  "motivo_principal_decision": "1 oración",
  "analisis_criterios": {
    "modalidad_adjudicacion": { "tipo": "${m.tipo}", "nivel_riesgo": "Alto | Medio | Bajo", "justificacion_texto": "cláusula encontrada" },
    "experiencia_requerida": { "exige_experiencia_publica": false, "monto_minimo_exigido": "detalle o null", "alerta_bloqueo": "muro de entrada o null" },
    "garantias_y_seguros": { "seriedad_oferta": "monto o 'No exige'", "fiel_cumplimiento": "% e instrumento", "seguro_daños_terceros": "UF/CLP o 'No exige'" },
    "logistica_y_plazos": { "plazo_ejecucion_dias": ${ins.plazoEjecucionDias ?? 'null'}, "zona_geografica": "zona", "impacto_flete_y_operaciones": "Crítico | Moderado | Despreciable", "justificacion_logistica": "análisis de distancia y materiales" }
  }
}`;

  try {
    const completion = await crearChatIA({
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.2, max_tokens: 1800, response_format: { type: 'json_object' },
    });
    const raw = completion.choices[0]?.message?.content || '';
    const p = parseJsonIA<any>(raw);
    if (!p) throw new Error('JSON de riesgo comercial ilegible');
    const fb = riesgoFallback(ins, montoNeto, reservado, modalidadTipo);
    const ac = p.analisis_criterios || {};
    const result: RiesgoComercial = {
      monto_neto_calculado_clp: montoNeto,
      score_viabilidad: typeof p.score_viabilidad === 'number' ? Math.max(0, Math.min(1, p.score_viabilidad)) : fb.score_viabilidad,
      decision_sugerida: ['POSTULAR', 'EVALUAR_CON_PROVEEDOR', 'DESCARTAR'].includes(p.decision_sugerida) ? p.decision_sugerida : fb.decision_sugerida,
      motivo_principal_decision: p.motivo_principal_decision || fb.motivo_principal_decision,
      analisis_criterios: {
        modalidad_adjudicacion: {
          tipo: m.tipo,
          nivel_riesgo: ['Alto', 'Medio', 'Bajo'].includes(ac.modalidad_adjudicacion?.nivel_riesgo) ? ac.modalidad_adjudicacion.nivel_riesgo : m.nivel_riesgo,
          justificacion_texto: ac.modalidad_adjudicacion?.justificacion_texto || fb.analisis_criterios.modalidad_adjudicacion.justificacion_texto,
        },
        experiencia_requerida: {
          exige_experiencia_publica: !!ac.experiencia_requerida?.exige_experiencia_publica,
          monto_minimo_exigido: ac.experiencia_requerida?.monto_minimo_exigido || null,
          alerta_bloqueo: ac.experiencia_requerida?.alerta_bloqueo || null,
        },
        garantias_y_seguros: {
          // Garantías: la fuente determinista (extraída) manda sobre la IA si la IA dijo "No exige" por error.
          seriedad_oferta: ins.garantias.some(g => sinTildes(g.tipo || '').includes('seriedad')) ? garantiaTexto(ins.garantias, 'seriedad') : (ac.garantias_y_seguros?.seriedad_oferta || 'No exige'),
          fiel_cumplimiento: ins.garantias.some(g => sinTildes(g.tipo || '').includes('cumplimiento')) ? garantiaTexto(ins.garantias, 'cumplimiento') : (ac.garantias_y_seguros?.fiel_cumplimiento || 'No exige'),
          seguro_daños_terceros: ac.garantias_y_seguros?.seguro_daños_terceros || ac.garantias_y_seguros?.['seguro_daños_terceros'] || 'No exige',
        },
        logistica_y_plazos: {
          plazo_ejecucion_dias: ins.plazoEjecucionDias ?? (typeof ac.logistica_y_plazos?.plazo_ejecucion_dias === 'number' ? ac.logistica_y_plazos.plazo_ejecucion_dias : null),
          zona_geografica: ac.logistica_y_plazos?.zona_geografica || fb.analisis_criterios.logistica_y_plazos.zona_geografica,
          impacto_flete_y_operaciones: ['Crítico', 'Moderado', 'Despreciable'].includes(ac.logistica_y_plazos?.impacto_flete_y_operaciones) ? ac.logistica_y_plazos.impacto_flete_y_operaciones : 'Moderado',
          justificacion_logistica: ac.logistica_y_plazos?.justificacion_logistica || fb.analisis_criterios.logistica_y_plazos.justificacion_logistica,
        },
      },
    };
    // Gate 0 determinista: bajo el piso confirmado → DESCARTAR, score 0.
    if (montoNeto != null && montoNeto < PISO_NETO) {
      result.decision_sugerida = 'DESCARTAR';
      result.score_viabilidad = 0;
      result.motivo_principal_decision = `Presupuesto neto ($${montoNeto.toLocaleString('es-CL')}) bajo el piso de $10.000.000.`;
    }
    return result;
  } catch (e) {
    console.warn('[viabilidad] Análisis comercial IA falló, usando fallback:', String(e).slice(0, 150));
    return riesgoFallback(ins, montoNeto, reservado, modalidadTipo);
  }
}

// ─── Función principal ────────────────────────────────────────────────────────────
export async function calcularViabilidad(
  codigo: string,
  opts: { juicioPrecomputado?: ViabilidadJuicioIA | null } = {},
): Promise<ViabilidadResult | null> {
  const ins = await cargarInsumos(codigo);
  if (!ins) return null;

  // Pipeline FUSIONADO: si el juicio ya vino en la llamada de análisis, lo reusamos y NO
  // llamamos al LLM otra vez. Si no, se calcula como siempre (obtenerJuicioIA con su fallback).
  const pre = opts.juicioPrecomputado;
  const { juicio, iaOk } = pre
    ? {
        juicio: {
          area_negocio: pre.area_negocio,
          tipo_producto: { ...pre.tipo_producto, categoria: pre.tipo_producto.categoria as TipoProductoCategoria },
          descripcion_producto_para_busqueda: pre.descripcion_producto_para_busqueda,
          informe: pre.informe,
        } as JuicioIA,
        iaOk: true,
      }
    : await obtenerJuicioIA(ins);
  const area = juicio.area_negocio;

  // C1 — Presupuesto (neto). Asumimos el monto extraído como neto salvo señal de IVA.
  const conIva = sinTildes(`${ins.resumenAdminTexto} ${ins.requisitosTexto}`).includes('iva incluido');
  const montoBruto = ins.montoAnalisis ?? ins.montoMP ?? ins.montoAlerta ?? null;
  const reservado = montoBruto == null || montoBruto === 0;
  const valorNeto = reservado ? null : (conIva ? Math.round(montoBruto / 1.19) : montoBruto);
  const c1 = puntosPresupuesto(valorNeto, reservado);
  const presupuesto = {
    valor_extraido: reservado ? 'Reservado / no disponible' : fmtCLP(montoBruto),
    valor_neto: valorNeto,
    con_iva: conIva,
    puntos: c1.puntos,
    notas: reservado ? 'Presupuesto reservado — puntaje neutro.' : conIva ? 'Monto normalizado a neto (÷1,19).' : 'Monto tratado como neto.',
  };

  // C2 — Líneas y DETALLE DE PRODUCTOS.
  // La API MP da una lista fiable pero a veces AGRUPADA (p.ej. 2 ítems); el detalle real
  // y completo de cada producto (composición, tallas, requisitos) está en las bases/PDF.
  // Regla: usamos como lista principal la fuente MÁS COMPLETA. Si el PDF trae igual o más
  // ítems que la API, mostramos el PDF (con requisitos); si no, usamos la API. La API se
  // complementa con la categoría UNSPSC cuando aplica.
  const itemsPDF = ins.especificaciones.map(e => ({
    nombre: (e.descripcion || e.item || '').toString(),
    descripcion: e.descripcion,
    categoria: undefined as string | undefined,
    cantidad: e.cantidad ?? null,
    unidad: e.unidad ?? null,
    requisitos: e.requisitosMinimos ?? null,
  }));
  const itemsApi = ins.itemsMP.map(it => ({
    nombre: it.nombre,
    descripcion: it.descripcion,
    categoria: it.categoria,
    cantidad: it.cantidad ?? null,
    unidad: it.unidad ?? null,
    requisitos: null as string | null,
  }));
  const pdfTieneDetalle = ins.especificaciones.some(e => e.requisitosMinimos || (e.descripcion && e.descripcion.length > 5));
  const usarPDF = itemsPDF.length > 0 && (itemsPDF.length >= itemsApi.length || pdfTieneDetalle);

  const itemsDetalle = usarPDF ? itemsPDF : itemsApi;
  const fuenteLineas: 'mp' | 'pdf' | null = itemsDetalle.length === 0 ? null : (usarPDF ? 'pdf' : 'mp');

  const nLineas = itemsDetalle.length || null;
  const lineasBase = puntosLineasBase(nLineas);
  const ajusteArea = nLineas ? ajusteLineasArea(nLineas, area) : 0;
  const lineasFinal = Math.max(0, lineasBase + ajusteArea);

  const lineas = {
    cantidad: nLineas,
    puntos_base: lineasBase,
    ajuste_area: ajusteArea,
    puntos_final: lineasFinal,
    fuente: fuenteLineas,
    items: itemsDetalle,
    notas: nLineas
      ? `${nLineas} líneas detectadas${fuenteLineas === 'pdf' ? ' (detalle desde las bases/PDF)' : fuenteLineas === 'mp' ? ' (Mercado Público)' : ''}${itemsApi.length && usarPDF && itemsApi.length !== nLineas ? ` · API MP agrupa en ${itemsApi.length}` : ''}${ajusteArea ? ` · ajuste área ${area}: ${ajusteArea > 0 ? '+' : ''}${ajusteArea}` : ''}.`
      : 'Número de líneas no especificado — neutro.',
  };

  // C3 — Modalidad
  const modalidadBase = puntosModalidad(ins.modalidad);
  const modalidad = {
    ...modalidadBase,
    modalidad_texto: ins.modalidad || null,             // texto crudo tal como viene de MP/bases
    es_por_linea: modalidadBase.modalidad === 'por_linea',
  };

  // C4 — Criterios de evaluación
  const criterios = puntosCriterios(ins.criterios);

  // Capa de Análisis de Riesgo Comercial (PROMPT 3) — en paralelo conceptual al score 0-100.
  const riesgoComercial = await analizarRiesgoComercial(ins, valorNeto, reservado, modalidad.modalidad);

  // C5 — Tipo de producto (de la IA ligera)
  const cat = juicio.tipo_producto.categoria;
  const tipoProducto = {
    descripcion: juicio.tipo_producto.descripcion,
    importable: juicio.tipo_producto.es_importable,
    especificacion_dirigida: juicio.tipo_producto.especificacion_dirigida,
    puntos: PUNTOS_TIPO[cat] ?? 8,
    notas: cat === 'dirigida' ? '⚠ Especificación dirigida a proveedor único.' : `Categoría: ${cat}.`,
  };

  const scoreBase =
    c1.puntos + lineas.puntos_final + modalidad.puntos + criterios.puntos + tipoProducto.puntos;

  // ── Penalizaciones ──
  const penalizaciones: Array<{ motivo: string; puntos_restados: number }> = [];
  if (ins.estadoFase1 === 'incompleto') penalizaciones.push({ motivo: 'Bases incompletas (Fase 1)', puntos_restados: 10 });
  const dh = diasHabilesRestantes(ins.fechaCierre);
  if (dh != null) {
    if (dh <= 3) penalizaciones.push({ motivo: `Plazo de presentación muy corto (${dh} días hábiles)`, puntos_restados: 15 });
    else if (dh <= 7) penalizaciones.push({ motivo: `Plazo de presentación ajustado (${dh} días hábiles)`, puntos_restados: 5 });
  }
  // Garantía de seriedad > 5% del presupuesto
  const seriedad = ins.garantias.find(g => sinTildes(g.tipo || '').includes('seriedad'));
  if (seriedad?.porcentaje != null && seriedad.porcentaje > 5) {
    penalizaciones.push({ motivo: `Garantía de seriedad > 5% (${seriedad.porcentaje}%)`, puntos_restados: 5 });
  }
  const textoReq = `${ins.requisitosTexto} ${ins.resumenAdminTexto}`;
  if (textoReq.includes('registro especial')) penalizaciones.push({ motivo: 'Requisito de registro especial no estándar', puntos_restados: 8 });
  if (textoReq.includes('visita a terreno') && textoReq.includes('obligator')) penalizaciones.push({ motivo: 'Visita a terreno obligatoria', puntos_restados: 5 });

  const totalPenalizaciones = penalizaciones.reduce((s, p) => s + p.puntos_restados, 0);
  let total = Math.max(0, Math.min(100, scoreBase - totalPenalizaciones));

  // ── Descalificación automática + semáforo ──
  let descalifica = false; let motivoDesc: string | null = null;
  if (c1.descalifica) { descalifica = true; motivoDesc = 'Presupuesto neto confirmado bajo el piso de $10.000.000.'; }
  else if (tipoProducto.especificacion_dirigida && !tipoProducto.importable) { descalifica = true; motivoDesc = 'Especificación dirigida a proveedor único sin posibilidad de homólogo.'; }
  else if (
    ins.estadoFase1 === 'incompleto'
    && ins.criterios.length === 0
    && ins.especificaciones.length === 0
    && ins.itemsMP.length === 0      // no hay líneas recuperables desde la API MP
    && montoBruto == null            // ni siquiera hay presupuesto
  ) { descalifica = true; motivoDesc = 'Bases incompletas sin información crítica recuperable.'; }

  let semaforo: Semaforo;
  if (descalifica) { semaforo = 'ROJO_DURO'; total = c1.descalifica ? 0 : total; }
  else if (total >= 80) semaforo = 'VERDE';
  else if (total >= 60) semaforo = 'AMARILLO';
  else if (total >= 40) semaforo = 'NARANJA';
  else if (total >= 20) semaforo = 'ROJO';
  else semaforo = 'ROJO_DURO';

  // ── Confianza del análisis ──
  let confianza = 0.60;
  if (ins.hayBasesAdmin) confianza += 0.15;
  if (ins.hayBasesTecnicas) confianza += 0.15;
  if (ins.criterios.length > 0 && ins.criterios.some(c => (Number(c.ponderacion) || 0) > 0)) confianza += 0.10;
  if (ins.estadoFase1 === 'incompleto') confianza -= 0.20;
  if (!iaOk) confianza -= 0.15;
  confianza = Math.max(0, Math.min(1, Math.round(confianza * 100) / 100));

  // ── trigger_busqueda (se guarda, NO ejecuta búsqueda) ──
  const activar = !descalifica && (semaforo === 'VERDE' || semaforo === 'AMARILLO');
  const trigger = {
    activar,
    requiere_aprobacion_humana: semaforo === 'AMARILLO',
    area_negocio: area,
    descripcion_producto_para_busqueda: juicio.descripcion_producto_para_busqueda,
    es_importable: tipoProducto.importable,
    motivo_no_activar: activar ? null : (motivoDesc || `Semáforo ${semaforo}: no se activa el buscador automáticamente.`),
  };

  // ── Plazo display ──
  const plazoDisplay = ins.fechaCierre
    ? `${new Date(ins.fechaCierre).toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' })}${dh != null ? ` · ${dh} días hábiles restantes` : ''}`
    : null;

  // ── Campos faltantes ──
  const camposFaltantes: string[] = [];
  if (reservado) camposFaltantes.push('Presupuesto');
  if (!nLineas) camposFaltantes.push('Líneas / ítems');
  if (ins.criterios.length === 0) camposFaltantes.push('Criterios de evaluación');
  if (!ins.hayBasesTecnicas) camposFaltantes.push('Bases técnicas');

  return {
    licitacion_id: codigo,
    objeto: ins.objeto,
    entidad_licitante: ins.entidad,
    area_negocio: area,
    score_viabilidad: {
      total,
      semaforo,
      descalificacion_automatica: descalifica,
      motivo_descalificacion: motivoDesc,
      desglose: { presupuesto, lineas, modalidad_adjudicacion: modalidad, criterios_evaluacion: criterios, tipo_producto: tipoProducto },
      penalizaciones,
      score_base: scoreBase,
      total_penalizaciones: totalPenalizaciones,
    },
    informe_ejecutivo: {
      resumen: juicio.informe.resumen,
      presupuesto_display: presupuesto.valor_extraido + (valorNeto ? ' neto' : ''),
      plazo_presentacion: plazoDisplay,
      ventaja_competitiva: juicio.informe.ventaja_competitiva,
      riesgos: juicio.informe.riesgos,
      alertas: juicio.informe.alertas,
      campos_faltantes: camposFaltantes,
      recomendacion: juicio.informe.recomendacion,
    },
    trigger_busqueda: trigger,
    confianza_analisis: confianza,
    notas_analista: `Score híbrido (determinista + IA ${iaOk ? 'OK' : 'fallback'}). Fase 1: ${ins.estadoFase1}.`,
    riesgo_comercial: riesgoComercial,
  };
}

// ─── Persistencia ──────────────────────────────────────────────────────────────────
export async function guardarViabilidad(codigo: string, v: ViabilidadResult): Promise<void> {
  const sv = v.score_viabilidad;
  const informeHibrido = { ...v.informe_ejecutivo, _riesgo_comercial: v.riesgo_comercial ?? null };

  // LA IA MANDA (fuente única del veredicto). Este score híbrido es solo CONTROL. Si ya
  // existe un análisis IA (PROMPT 2) para este código, NO debemos pisar su informe ni degradar
  // las columnas del radar (score/semáforo/área/modelo=ia+…). Antes, el ON DUPLICATE KEY UPDATE
  // con informe_ejecutivo=VALUES() y modelo='hibrido+…' borraba el análisis IA cuando el pipeline
  // de triaje re-tocaba una licitación ya analizada → la licitación desaparecía de "Analizadas".
  // OJO: hay DOS blobs de IA — el v2 (`_informe_ia`) y el v3 (`_informe_ia_v3`, el ACTIVO que lee
  // el panel). El guardia original solo miraba el v2, así que al re-tocar una licitación analizada
  // con v3 SÍ le borraba el `_informe_ia_v3` (el panel quedaba en blanco). Preservamos AMBOS.
  let iaBlob: any = null;      // v2 (_informe_ia)
  let iaBlobV3: any = null;    // v3 (_informe_ia_v3) — el que muestra ViabilidadIAPanel
  let iaModelo: string | null = null;
  try {
    const [rows] = await pool.query(
      `SELECT informe_ejecutivo FROM viabilidad_licitacion WHERE licitacion_codigo = ? LIMIT 1`, [codigo]);
    const row = (rows as any[])[0];
    if (row) {
      const ie = typeof row.informe_ejecutivo === 'string' ? JSON.parse(row.informe_ejecutivo) : (row.informe_ejecutivo || {});
      if (ie && ie._informe_ia)    { iaBlob = ie._informe_ia; iaModelo = ie._modelo_ia ?? null; }
      if (ie && ie._informe_ia_v3) { iaBlobV3 = ie._informe_ia_v3; }
    }
  } catch { /* si falla la lectura, seguimos con el guardado híbrido normal */ }

  if (iaBlob || iaBlobV3) {
    // IA presente (v2 y/o v3) → conservar su(s) blob(s); solo refrescar las columnas propias
    // del análisis híbrido (desglose/penalizaciones/trigger/notas). NO tocar
    // score_total/semaforo/area_negocio/confianza_analisis/modelo (los posee la IA).
    const informeMerge: any = { ...informeHibrido };
    if (iaBlob)   informeMerge._informe_ia = iaBlob;
    if (iaBlobV3) informeMerge._informe_ia_v3 = iaBlobV3;
    if (iaModelo) informeMerge._modelo_ia = iaModelo;
    await pool.query(
      `UPDATE viabilidad_licitacion
          SET descalificacion_automatica = ?, desglose = ?, penalizaciones = ?,
              trigger_busqueda = ?, notas_analista = ?, informe_ejecutivo = ?
        WHERE licitacion_codigo = ?`,
      [
        sv.descalificacion_automatica ? 1 : 0,
        JSON.stringify(sv.desglose),
        JSON.stringify(sv.penalizaciones),
        JSON.stringify(v.trigger_busqueda),
        v.notas_analista,
        JSON.stringify(informeMerge),
        codigo,
      ],
    );
    return;
  }

  // Sin IA previa → guardado híbrido normal (upsert).
  await pool.query(
    `INSERT INTO viabilidad_licitacion
      (licitacion_codigo, score_total, semaforo, descalificacion_automatica, area_negocio,
       desglose, penalizaciones, informe_ejecutivo, trigger_busqueda,
       confianza_analisis, notas_analista, modelo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       score_total                = VALUES(score_total),
       semaforo                   = VALUES(semaforo),
       descalificacion_automatica = VALUES(descalificacion_automatica),
       area_negocio               = VALUES(area_negocio),
       desglose                   = VALUES(desglose),
       penalizaciones             = VALUES(penalizaciones),
       informe_ejecutivo          = VALUES(informe_ejecutivo),
       trigger_busqueda           = VALUES(trigger_busqueda),
       confianza_analisis         = VALUES(confianza_analisis),
       notas_analista             = VALUES(notas_analista),
       modelo                     = VALUES(modelo)`,
    [
      codigo,
      sv.total,
      sv.semaforo,
      sv.descalificacion_automatica ? 1 : 0,
      v.area_negocio,
      JSON.stringify(sv.desglose),
      JSON.stringify(sv.penalizaciones),
      // Guardamos el análisis comercial anidado en el JSON del informe (sin cambiar el esquema).
      JSON.stringify(informeHibrido),
      JSON.stringify(v.trigger_busqueda),
      v.confianza_analisis,
      v.notas_analista,
      'hibrido+deepseek-chat',
    ],
  );
}

// Calcula y guarda en un solo paso. Devuelve null si no hay análisis exhaustivo previo.
// opts.juicioPrecomputado: juicio ya obtenido por el pipeline fusionado (evita otra llamada IA).
export async function calcularYGuardarViabilidad(
  codigo: string,
  opts: { juicioPrecomputado?: ViabilidadJuicioIA | null } = {},
): Promise<ViabilidadResult | null> {
  const v = await calcularViabilidad(codigo, opts);
  if (!v) return null;
  try { await guardarViabilidad(codigo, v); }
  catch (e) { console.error('[viabilidad] Error guardando:', String(e).slice(0, 200)); }
  return v;
}

// Reconstruye un ViabilidadResult parcial desde la fila guardada (para el GET del endpoint).
export function rowToViabilidad(row: any): Partial<ViabilidadResult> & { actualizado?: string } {
  return {
    licitacion_id: row.licitacion_codigo,
    area_negocio: row.area_negocio,
    score_viabilidad: {
      total: row.score_total,
      semaforo: row.semaforo,
      descalificacion_automatica: !!row.descalificacion_automatica,
      motivo_descalificacion: null,
      desglose: parseMaybeJSON<any>(row.desglose),
      penalizaciones: parseMaybeJSON<any>(row.penalizaciones) || [],
      score_base: 0,
      total_penalizaciones: 0,
    } as any,
    informe_ejecutivo: (() => { const ie = parseMaybeJSON<any>(row.informe_ejecutivo) || {}; const { _riesgo_comercial, ...rest } = ie; return rest; })(),
    trigger_busqueda: parseMaybeJSON<any>(row.trigger_busqueda),
    confianza_analisis: row.confianza_analisis != null ? Number(row.confianza_analisis) : undefined as any,
    notas_analista: row.notas_analista,
    riesgo_comercial: (parseMaybeJSON<any>(row.informe_ejecutivo) || {})._riesgo_comercial || undefined,
    actualizado: row.updated_at,
  };
}
