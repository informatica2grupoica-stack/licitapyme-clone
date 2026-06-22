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

import pool from '@/app/lib/db';
import { descargarYExtraerTexto } from '@/app/lib/document-extraction';
import { getMercadoPublicoClient } from '@/app/lib/mercado-publico';

const GEMINI_MODEL = 'gemini-2.5-flash';
const MAX_CHARS_DOCS = 400_000;   // ~100k tokens de documentos (Flash aguanta de sobra)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── Tipos del veredicto IA (subset operativo del PROMPT 2) ──────────────────────
export interface ViabilidadIAResult {
  meta: { id: string; nombre: string; organismo: string; region: string; linea_negocio: string };
  exclusion: { excluido: boolean; categoria: string | null; motivo: string; fuente: string; confianza: number };
  presupuesto: { bruto: number | null; neto: number | null; con_iva: boolean; fuente: string };
  modalidad: { tipo: string; fuente: string; evidencia: string; confianza: number };
  criterios_evaluacion: Array<{ nombre: string; ponderacion_pct: number; tipo: string; fuente: string }>;
  plazo_entrega: { detalle: string; fuente: string };
  garantias: Array<{ tipo: string; detalle: string; fuente: string }>;
  capa_a: {
    presupuesto: { pts: number; fuente: string };
    cantidad_items: { pts: number; n_items: number; fuente: string };
    complejidad: { pts: number; fuente: string };
    ejecucion: { pts: number; fuente: string };
    nivel: string;
  };
  palancas: Array<{ palanca: string; estado: string; condicion: string; fuente: string }>;
  admisibilidad: {
    bloqueantes: Array<{ item: string; efecto: string; fuente: string }>;
    barreras_a_favor: Array<{ item: string; fuente: string }>;
    boleta_aplica: boolean;
    firma_puno_y_letra: boolean;
    alertas: string[];
  };
  multas: { estructura: string; costo_por_dia: string; costo_maximo: string; umbral_termino: string; fuente: string };
  manifiesto_productos: Array<{ linea: number; descripcion: string; modelo: string; cantidad: number | null; tipo: string }>;
  veredicto: { nivel: string; gana: 'GANA' | 'NO_GANA' | 'CONDICIONAL'; por_que: string; acciones_AC: string[]; advertencias: string[] };
  pendientes_fase3: string[];
  confianza_global: number;
  documentos_leidos: string[];
  documentos_no_leidos: string[];
}

// ─── Carga de documentos COMPLETOS (texto + visión para escaneados) ──────────────
function noRequiereOCR(nombre: string): boolean {
  const n = nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return /plano|croquis|lamina|elevacion|planta|isometric|render|imagen|fotograf/.test(n)
    || /\.(jpg|jpeg|png|gif|bmp|tiff|webp|dwg)$/.test(n);
}

interface DocLeido { nombre: string; categoria: string | null; texto: string; metodo: string; ok: boolean }

async function cargarDocumentos(codigo: string): Promise<DocLeido[]> {
  const [rows] = await pool.query(
    `SELECT documento_nombre, documento_url_local, categoria
     FROM documentos_cache WHERE licitacion_codigo = ? ORDER BY created_at ASC`,
    [codigo],
  );
  const docs = rows as Array<{ documento_nombre: string; documento_url_local: string; categoria: string | null }>;

  const out: DocLeido[] = [];
  // Concurrencia 2 para no disparar 429 de Gemini visión.
  for (let i = 0; i < docs.length; i += 2) {
    const batch = docs.slice(i, i + 2);
    const res = await Promise.all(batch.map(async (d) => {
      const r = await descargarYExtraerTexto(d.documento_url_local, d.documento_nombre, { omitirOCR: noRequiereOCR(d.documento_nombre) }).catch(() => null);
      const texto = (r?.texto || '').replace(/\s+\n/g, '\n').trim();
      return {
        nombre: d.documento_nombre,
        categoria: d.categoria,
        texto,
        metodo: r?.metodo || 'error',
        ok: texto.length >= 50,
      } as DocLeido;
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
    generationConfig: { temperature: 0.15, responseMimeType: 'application/json', maxOutputTokens: 32_000 },
  });

  const ESPERAS = [0, 5_000, 15_000];
  let ultimoErr = '';
  for (let intento = 0; intento < ESPERAS.length; intento++) {
    if (intento > 0) await sleep(ESPERAS[intento]);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(180_000) },
    );
    if (res.ok) {
      const data = await res.json();
      const txt = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      const ini = txt.indexOf('{'); const fin = txt.lastIndexOf('}');
      return JSON.parse(ini !== -1 ? txt.slice(ini, fin + 1) : txt);
    }
    ultimoErr = `${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`;
    if (res.status !== 429 && res.status !== 503) break; // permanente → no reintentar
  }
  throw new Error(`Gemini falló: ${ultimoErr}`);
}

// ─── Prompt PROMPT 2 ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Eres un ANALISTA EXPERTO en licitaciones públicas chilenas (Ley 19.886, Mercado Público) con 8 años adjudicando, trabajando para una empresa que VENDE bienes/equipamiento (ferretería, materiales, equipamiento, mobiliario urbano), con bodega y cotizaciones SIEMPRE desde Santiago.

Tu tarea: leer las BASES (administrativas y técnicas, criterios, anexos) de UNA licitación y emitir un INFORME DE VIABILIDAD que permita decidir SIN DUDAS si conviene postular y por qué.

REGLAS INNEGOCIABLES:
1. VERACIDAD: nunca inventes datos, montos, artículos ni cifras. Si un dato no está en las bases, decláralo ausente (null / "no informado").
2. FUENTE OBLIGATORIA: cada puntaje, bandera y afirmación debe citar el artículo/punto/sección exacto de las bases que lo respalda (ej. "Art. 12", "punto 8.2", "Bases Técnicas, Garantías"). Sin fuente, el dato no vale.
3. Logística SIEMPRE desde Santiago: no asumas ventaja por cercanía geográfica.
4. Exclusión por NATURALEZA del objeto, no por palabra clave. Si el núcleo es venta de bienes/equipamiento (aunque incluya instalación/capacitación accesorias) → NO excluir. Servicio puro / obra civil / consultoría / convenio de largo horizonte → excluir.
5. Presupuesto: si viene con IVA, normaliza a neto (÷1,19). Piso de descalificación: neto < $10.000.000.
6. Modalidad de ADJUDICACIÓN (DATO CRÍTICO): determina si la adjudicación es POR LÍNEA/ÍTEM (se puede ganar líneas sueltas) o SUMA ALZADA (oferta por el total). NO confundas con el TIPO de licitación (LP/LE/LR). Pista: si hay tabla de ítems con precio unitario por línea → por_linea. Cita la frase de las bases.
7. CRITERIOS DE EVALUACIÓN: extrae CADA criterio con su PORCENTAJE exacto tal como aparece en las bases (la suma debe dar 100). Es obligatorio: estos % siempre están en las bases (sección "criterios de evaluación").
7. Lo que dependa de buscar productos/precios en internet → déjalo en "pendientes_fase3", NO lo inventes.
8. El veredicto debe ser claro: GANA / NO_GANA / CONDICIONAL, con el porqué fundamentado en las bases.

Responde ÚNICAMENTE un objeto JSON válido con el esquema indicado, sin markdown.`;

function construirUserPrompt(codigo: string, ctx: any, docs: DocLeido[]): string {
  const leidos = docs.filter(d => d.ok);
  const itemsMPTxt = (ctx.itemsMP || []).slice(0, 40).map((it: any, i: number) =>
    `${i + 1}. ${it.nombre || it.descripcion}${it.categoria ? ` [${it.categoria}]` : ''}${it.cantidad ? ` (cant ${it.cantidad}${it.unidad ? ' ' + it.unidad : ''})` : ''}`).join('\n') || '(la API MP no entregó ítems)';

  let docsTexto = leidos.map(d => `\n\n===== DOCUMENTO: ${d.nombre} ${d.categoria ? `[${d.categoria}]` : ''} =====\n${d.texto}`).join('');
  if (docsTexto.length > MAX_CHARS_DOCS) docsTexto = docsTexto.slice(0, MAX_CHARS_DOCS) + '\n[...truncado...]';

  return `LICITACIÓN: ${codigo}
NOMBRE: ${ctx.meta.nombre || '(sin nombre)'}
ORGANISMO: ${ctx.meta.organismo || '(sin organismo)'}
REGIÓN: ${ctx.meta.region || '(sin región)'}
PRESUPUESTO PORTADA (API MP): ${ctx.meta.monto ? '$' + Number(ctx.meta.monto).toLocaleString('es-CL') : 'reservado / no informado'}

ÍTEMS SEGÚN API MERCADO PÚBLICO (referencia de líneas):
${itemsMPTxt}

DOCUMENTOS DE LA LICITACIÓN (texto completo; los escaneados ya fueron leídos por visión):
${docsTexto || '(no se pudo extraer texto de los documentos)'}

Analiza TODO lo anterior y devuelve EXACTAMENTE este JSON (cita FUENTE en cada punto):
{
  "meta": { "id": "${codigo}", "nombre": "", "organismo": "", "region": "", "linea_negocio": "ferreteria|equipamiento|mixto" },
  "exclusion": { "excluido": false, "categoria": "servicio|obra_civil|capacitacion_pura|consultoria|convenio_suministro|null", "motivo": "", "fuente": "", "confianza": 0.0 },
  "presupuesto": { "bruto": null, "neto": null, "con_iva": false, "fuente": "" },
  "modalidad": { "tipo": "suma_alzada|por_linea|desconocida", "fuente": "", "evidencia": "frase exacta de las bases", "confianza": 0.0 },
  "criterios_evaluacion": [ { "nombre": "Precio", "ponderacion_pct": 0, "tipo": "economico|tecnico|experiencia|otros", "fuente": "sección/artículo de las bases" } ],
  "plazo_entrega": { "detalle": "", "fuente": "" },
  "garantias": [ { "tipo": "seriedad|fiel_cumplimiento|otra", "detalle": "monto/% y plazo, o 'No exige'", "fuente": "" } ],
  "capa_a": {
    "presupuesto": { "pts": 0, "fuente": "" },
    "cantidad_items": { "pts": 0, "n_items": 0, "fuente": "" },
    "complejidad": { "pts": 0, "fuente": "" },
    "ejecucion": { "pts": 0, "fuente": "" },
    "nivel": "MUY_VIABLE|VIABLE|POCO_VIABLE|DESCARTE"
  },
  "palancas": [ { "palanca": "plazo|garantia|precio|geografia|completitud|densidad", "estado": "VENTAJA|NEUTRO|DESVENTAJA", "condicion": "", "fuente": "" } ],
  "admisibilidad": {
    "bloqueantes": [ { "item": "", "efecto": "EN_CONTRA", "fuente": "" } ],
    "barreras_a_favor": [ { "item": "", "fuente": "" } ],
    "boleta_aplica": false,
    "firma_puno_y_letra": false,
    "alertas": []
  },
  "multas": { "estructura": "", "costo_por_dia": "", "costo_maximo": "", "umbral_termino": "", "fuente": "" },
  "manifiesto_productos": [ { "linea": 1, "descripcion": "descripción técnica EXACTA de las bases", "modelo": "", "cantidad": null, "tipo": "generico|especifico" } ],
  "veredicto": { "nivel": "MUY_VIABLE|VIABLE|POCO_VIABLE|DESCARTE", "gana": "GANA|NO_GANA|CONDICIONAL", "por_que": "2-3 oraciones fundamentadas", "acciones_AC": [], "advertencias": [] },
  "pendientes_fase3": ["importabilidad_real","densidad_de_oferta","margen"],
  "confianza_global": 0.0
}`;
}

// ─── Función principal ───────────────────────────────────────────────────────────
export async function analizarViabilidadIA(codigo: string): Promise<ViabilidadIAResult | null> {
  const docs = await cargarDocumentos(codigo);
  if (docs.length === 0) return null;
  const leidos = docs.filter(d => d.ok);
  if (leidos.length === 0) return null;

  const ctx = await cargarContexto(codigo);
  const parsed = await llamarGeminiJSON(SYSTEM_PROMPT, construirUserPrompt(codigo, ctx, docs));

  const result: ViabilidadIAResult = {
    ...parsed,
    documentos_leidos: leidos.map(d => d.nombre),
    documentos_no_leidos: docs.filter(d => !d.ok).map(d => `${d.nombre} (${d.metodo})`),
    confianza_global: typeof parsed.confianza_global === 'number' ? parsed.confianza_global : 0.7,
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

  if (fila) {
    let ie: any = {};
    try { ie = typeof fila.informe_ejecutivo === 'string' ? JSON.parse(fila.informe_ejecutivo) : (fila.informe_ejecutivo || {}); } catch { ie = {}; }
    ie._informe_ia = r;
    ie._modelo_ia = GEMINI_MODEL;
    await pool.query(
      `UPDATE viabilidad_licitacion SET informe_ejecutivo = ? WHERE licitacion_codigo = ?`,
      [JSON.stringify(ie), codigo]);
  } else {
    await pool.query(
      `INSERT INTO viabilidad_licitacion (licitacion_codigo, informe_ejecutivo) VALUES (?, ?)`,
      [codigo, JSON.stringify({ _informe_ia: r, _modelo_ia: GEMINI_MODEL })]);
  }
}

export async function analizarYGuardarViabilidadIA(codigo: string): Promise<ViabilidadIAResult | null> {
  const r = await analizarViabilidadIA(codigo);
  if (!r) return null;
  try { await guardarViabilidadIA(codigo, r); }
  catch (e) { console.error('[viabilidad-ia] guardar falló:', String(e).slice(0, 200)); }
  return r;
}
