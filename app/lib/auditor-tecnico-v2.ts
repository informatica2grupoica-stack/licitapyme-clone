// app/lib/auditor-tecnico-v2.ts
// AUDITOR · VERIFICADOR TÉCNICO (PROMPT 4 v2.0) — llamadas de IA y datos. Server-only.
// Corre POR OPCIÓN (línea + producto + proveedor), sobre lo que leyó el Lector de los documentos y links de la opción, contra los
// requisitos que hereda de la fase de análisis (informe de viabilidad). Lo que devuelve el modelo NO se usa directo: pasa por
// evaluarTecnico() (auditor-tecnico-v2-core.ts), que calcula veredictos, bloqueos, habilitaciones y eventos por código.
//
// Llamadas: L1 (comparación por lotes de requisitos + correspondencia + compromisos con costo) y L2 (segunda pasada de rojos sobre los
// documentos ORIGINALES, en la pasada final). La búsqueda dirigida del Lector (L0-D) no hace falta: L1 lee el TEXTO COMPLETO de cada
// documento, así que un dato que no aparece ya está buscado en todo el documento (ver `no_encontrado_en_extraccion`).
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { crearChatIA as crearChatIABase } from '@/app/lib/gemini';
import { conModuloIA } from '@/app/lib/ia-uso';
const crearChatIA = conModuloIA('auditor', crearChatIABase);
import { parseJsonIA } from '@/app/lib/json-ia';
import { MOTOR_KIMI_ESTRICTO, type MotorComparacion } from '@/app/lib/auditor-tecnico';
import { productosCrudosDeLinea } from '@/app/lib/auditor-tecnico-core';
import { extraccionPorId } from '@/app/lib/auditor-lector';
import { agregarCostoAsociado } from '@/app/lib/auditor-lineas';
import {
  evaluarTecnico, type RequisitoHeredado, type ResultadoTecnico, type SalidaTecnicaCruda, type ItemCrudo, type Criticidad,
} from '@/app/lib/auditor-tecnico-v2-core';
import * as P from '@/app/lib/auditor-tecnico-v2-prompts';

const sec = (t: string, c: string) => `\n\n══════ ${t} ══════\n${c}`;

const CONTRATO_L1 = `

══════ CONTRATO DE ESTA LLAMADA (L1 — verificación técnica de UNA opción) ══════
- Recibes los REQUISITOS heredados de la línea, cada uno con su identificador "n". Devuelve UN ítem de "matriz_tecnica" por cada n recibido, con ese mismo n. No agregues, omitas ni agrupes requisitos.
- Los DOCUMENTOS de la opción vienen con su texto COMPLETO ya transcrito, etiquetados [DOC k] con su tipo y formalidad. Cita siempre el documento por su etiqueta y el pasaje literal entre comillas dentro de "cita_original".
- ORIGEN DEL DATO: documento de tipo link_web → FICHA_WEB; ficha_tecnica, catalogo_familia, certificado, manual o cotización formal → FICHA; respaldo_informal (foto, captura, WhatsApp) → CONFIRMACION_INFORMAL.
- NO calcules el veredicto de la línea, los bloqueos ni las habilitaciones (lo hace el sistema) y NO redactes el mensaje final al proveedor: solo la pregunta por ítem abierto.
- Para acortar la salida: OMITE los campos vacíos y, en los ítems que CUMPLEN, no incluyas "ayuda" ni "motivo_pendiente".
- Devuelve SOLO JSON (sin markdown) con la forma de la PARTE X. Las secciones "alertas_generales", "correspondencia_documentos", "compromisos_con_costo" y "eventos" solo en la llamada que te lo pida.`;

const CONTRATO_L2 = `

══════ CONTRATO DE ESTA LLAMADA (L2 — segunda pasada de rojos) ══════
Recibes ítems de criticidad INADMISIBLE que la primera pasada declaró CUMPLE, con la UBICACIÓN que se citó (no el valor que se leyó: tu pasada es independiente), y los DOCUMENTOS ORIGINALES. Para cada uno relee esa ubicación y di qué valor o norma está escrito ahí.
Devuelve SOLO JSON: {"reverificacion":[{"n":0,"confirmado":true,"valor_releido":"","cita":"","rectificacion":""}]}
- "confirmado": false si el dato no aparece donde se citó, no dice lo que se afirmaba o la deducción no se sostiene. "rectificacion": si confirmado=false, explica la diferencia en una línea clara para el asistente.`;

export const SYS_L1_TEC = P.PARTE_I + sec('PARTE II — ENTRADAS', P.PARTE_II) + sec('PARTE III — ETAPA 1 · CORRESPONDENCIA', P.PARTE_III)
  + sec('PARTE IV — ETAPA 2 · VARIAS FUENTES', P.PARTE_IV) + sec('PARTE V — ETAPA 3 · PREPARACIÓN DEL REQUISITO', P.PARTE_V)
  + sec('PARTE VI — ETAPA 4 · COMPARACIÓN Y VEREDICTO', P.PARTE_VI) + sec('PARTE VII — ETAPA 5 · SALIDA DE AYUDA', P.PARTE_VII)
  + sec('PARTE VIII — ETAPA 6 · COMPROMISOS CON COSTO', P.PARTE_VIII) + sec('PARTE X — FORMATO DE SALIDA', P.PARTE_X)
  + sec('PARTE XII — AUTOCHEQUEO', P.PARTE_XII) + CONTRATO_L1;
export const SYS_L2_TEC = P.PARTE_I + sec('PARTE IX — ETAPA 7 · SEGUNDA PASADA DE ROJOS', P.PARTE_IX) + CONTRATO_L2;

const LOTE = 8;
const TOPE_TEXTO = 60_000;
const s = (v: unknown, max = 300) => (v == null ? '' : String(v)).trim().slice(0, max);

async function llamarJSON(system: string, user: string, motor: MotorComparacion): Promise<any> {
  const completion: any = await crearChatIA({
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0.1, stream: false, max_tokens: motor.maxTokens, response_format: { type: 'json_object' },
  }, { timeoutMs: motor.timeoutMs, modeloPreferido: motor.modeloPreferido, proveedorPreferido: motor.proveedorPreferido, sinRespaldo: motor.sinRespaldo });
  return parseJsonIA(String(completion.choices?.[0]?.message?.content ?? '')) || {};
}

// ── Requisitos heredados de la línea (informe de viabilidad) ─────────────────────────────────────
async function leerInforme(codigo: string): Promise<any | null> {
  try {
    const [rows] = await pool.query(`SELECT informe_ejecutivo FROM viabilidad_licitacion WHERE licitacion_codigo = ? LIMIT 1`, [codigo]) as any;
    const row = (rows as any[])[0];
    if (!row) return null;
    const ie = typeof row.informe_ejecutivo === 'string' ? JSON.parse(row.informe_ejecutivo) : row.informe_ejecutivo;
    return ie?._informe_ia_v3 ?? ie?._informe_ia ?? null;
  } catch { return null; }
}

// Viabilidad v4.0 (P8/P10): el bloque técnico-administrativo recibe los REQUISITOS GENERALES de los
// productos (garantía, capacitación, manuales…), los DOCUMENTOS A CREAR (compromisos nuestros, con el
// contenido que exigen las bases) y las causales de admisibilidad, sin el resto del bloque. Los
// informes v3 siguen mandando su requisitos_admisibilidad completo.
function requisitosGeneralesDelInforme(informe: any): string | null {
  if (informe?._schema === 'v4') {
    const adm = informe?.requisitos_admisibilidad || {};
    const compacto = {
      requisitos_generales: (informe?.productos?.requisitos_generales || []).map((r: any) => r?.producto ? `${r.producto}: ${r.texto}` : r?.texto).filter(Boolean),
      documentos_a_crear: (adm.documentos_a_crear || []).map((d: any) => ({ que_crear: d?.que_crear, contenido_exigido: d?.contenido_exigido })),
      requisitos_admisibilidad: (adm.requisitos || []).map((r: any) => ({ que: r?.que, cuanto: r?.cuanto, cuando: r?.cuando, consecuencia: r?.consecuencia })),
      garantias: adm.garantias || null,
    };
    return JSON.stringify(compacto).slice(0, 5000);
  }
  return informe?.requisitos_admisibilidad ? JSON.stringify(informe.requisitos_admisibilidad).slice(0, 5000) : null;
}

export interface ContextoRequisitos {
  requisitos: RequisitoHeredado[]; nombreLinea: string; criticidadLinea: Criticidad;
  criterios: string | null; requisitosGenerales: string | null; foro: string | null; presupuestoNeto: number | null;
}

/** Los requisitos que la línea hereda de la fase de análisis. La criticidad de la línea del checklist se traduce al vocabulario del
 *  prompt; PUNTAJE_CONDICIONANTE llega como INADMISIBLE (decisión CA 28-09-2026: "lo CONDICIONANTE debe llegar como INADMISIBLE"). */
export async function requisitosDeLinea(negocioId: number, licitacionCodigo: string, lineaReal: number | null): Promise<ContextoRequisitos | null> {
  if (lineaReal == null) return null;
  const informe = await leerInforme(licitacionCodigo);
  if (!informe) return null;
  const [it] = await pool.query(
    `SELECT criticidad FROM checklist_comercial WHERE negocio_id = ? AND tipo = 'linea_tecnica' AND linea_numero = ? LIMIT 1`, [negocioId, lineaReal]) as any;
  const crit = String((it as any[])[0]?.criticidad || '').toUpperCase();
  const criticidadLinea: Criticidad = crit === 'ADMISIBILIDAD_DURA' || crit === 'INADMISIBLE' || crit === 'PUNTAJE_CONDICIONANTE' ? 'INADMISIBLE'
    : crit === 'PUNTAJE' ? 'PUNTAJE' : crit === 'INFORMATIVO' || crit === 'COMPROMISO' ? 'COMPROMISO' : 'SIN_CLASIFICAR';
  const productos = productosCrudosDeLinea(informe, lineaReal);
  const requisitos: RequisitoHeredado[] = [];
  for (const p of productos) for (const c of p.caracteristicas) {
    const texto = String(c || '').trim();
    if (texto) requisitos.push({ n: requisitos.length + 1, texto, fuente: 'Bases técnicas (informe de viabilidad)', criticidad: criticidadLinea, producto: productos.length > 1 ? p.nombre : undefined });
  }
  const foro = informe?.foro ?? informe?.foro_qa ?? informe?.aclaraciones ?? null;
  const cri = informe?.criterios_evaluacion ?? null;
  return {
    requisitos, nombreLinea: productos.map(p => p.nombre).join(' + ') || `Línea ${lineaReal}`, criticidadLinea,
    criterios: cri ? JSON.stringify(cri).slice(0, 6000) : null,
    requisitosGenerales: requisitosGeneralesDelInforme(informe),
    foro: foro ? (typeof foro === 'string' ? foro : JSON.stringify(foro)).slice(0, 6000) : null,
    presupuestoNeto: Number(informe?.presupuesto?.neto) || null,
  };
}

/** Cuántos requisitos técnicos hereda cada línea (una sola lectura del informe por panel). */
export async function contarRequisitosPorLinea(negocioId: number, licitacionCodigo: string): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const informe = await leerInforme(licitacionCodigo);
  if (!informe) return out;
  const [rows] = await pool.query(`SELECT linea_numero FROM checklist_comercial WHERE negocio_id = ? AND tipo = 'linea_tecnica' AND linea_numero IS NOT NULL`, [negocioId]) as any;
  for (const r of rows as any[]) {
    const n = Number(r.linea_numero);
    out.set(n, productosCrudosDeLinea(informe, n).reduce((a, p) => a + p.caracteristicas.filter(c => String(c || '').trim()).length, 0));
  }
  return out;
}

// ── Documentos de la opción (lo que leyó el Lector) ──────────────────────────────────────────────
export interface DocumentoOpcion { etiqueta: string; texto: string; tipo: string; formalidad: string; nombre: string; resumen: string }

export async function documentosDeOpcion(opcionId: number): Promise<DocumentoOpcion[]> {
  const [rs] = await pool.query(`SELECT extraccion_id, tipo, producto_idx FROM auditor_respaldo WHERE opcion_id = ? AND vigente = 1 AND extraccion_id IS NOT NULL ORDER BY id`, [opcionId]) as any;
  const vistos = new Set<number>(), out: DocumentoOpcion[] = [];
  for (const r of rs as any[]) {
    if (vistos.has(r.extraccion_id)) continue;
    vistos.add(r.extraccion_id);
    const ex = await extraccionPorId(r.extraccion_id);
    if (!ex?.data) continue;
    const doc = ex.data.salida.documento || {};
    const tipo = r.tipo === 'link_web' ? 'link_web' : s(doc.tipo, 40) || 'otro';
    // Documento con varios productos (catálogo de familia, cotización de varios ítems): solo se le muestra al verificador el de ESTA opción.
    const todos = ex.data.salida.productos || [];
    const prods = todos.length > 1 && r.producto_idx != null && todos[r.producto_idx] ? [todos[r.producto_idx]] : todos;
    const carac = prods.flatMap(p => (p.caracteristicas || []).slice(0, 80).map(c => `${s(c.nombre, 80)}: ${s(c.valor, 60)} ${s(c.unidad, 20)}${c.cita ? ` [${s(c.cita, 60)}]` : ''}`));
    const accs = prods.flatMap(p => [...(p.producto?.accesorios_estandar || []).map(a => `estándar: ${s(a.item, 80)}`), ...(p.producto?.accesorios_opcionales || []).map(a => `opcional: ${s(a.item, 80)}`)]);
    out.push({
      etiqueta: `DOC ${out.length + 1}`, texto: ex.data.texto, tipo, formalidad: doc.formalidad === 'informal' ? 'informal' : 'formal', nombre: ex.documentoNombre || 'documento',
      resumen: [carac.length ? `CARACTERÍSTICAS EXTRAÍDAS POR EL LECTOR:\n${carac.join('\n')}` : '', accs.length ? `ACCESORIOS: ${accs.join(' · ')}` : ''].filter(Boolean).join('\n'),
    });
  }
  return out;
}

export function bloqueDocumentos(docs: DocumentoOpcion[]): { texto: string; enviado: string } {
  const porDoc = Math.floor(TOPE_TEXTO / Math.max(1, docs.length));
  const partes = docs.map(d => `[${d.etiqueta}] archivo: "${d.nombre}" · tipo: ${d.tipo} · ${d.formalidad}\n${d.resumen ? d.resumen + '\n' : ''}TEXTO COMPLETO:\n${d.texto.slice(0, porDoc)}`);
  return { texto: partes.join('\n\n'), enviado: docs.map(d => d.texto.slice(0, porDoc)).join('\n') };
}

// ── Verificación técnica de UNA opción (L1) ──────────────────────────────────────────────────────
export interface OpcionParaTecnico { id: number; filaId: string; marca: string | null; modelo: string | null; version_producto: string | null; via: string; proveedor_razon_social: string | null; estado: string }

const textoRequisito = (r: RequisitoHeredado) => `n=${r.n} · ${r.criticidad} · ${r.producto ? `[${r.producto}] ` : ''}${r.texto} · fuente en bases: ${r.fuente}`;

export interface CorridaTecnica { salida: SalidaTecnicaCruda; requisitos: RequisitoHeredado[]; textoEnviado: string; motor: string }

export async function correrL1(o: OpcionParaTecnico, ctx: ContextoRequisitos, docs: DocumentoOpcion[], nombreLinea: string, cantidad: number | null, unidad: string): Promise<CorridaTecnica> {
  const { texto: bloque, enviado } = bloqueDocumentos(docs);
  const cabecera = `LÍNEA: ${nombreLinea} · cantidad ${cantidad ?? '?'} ${unidad}
OPCIÓN #${o.id} · estado ${o.estado} · marca: ${o.marca || '(sin identificar)'} · modelo: ${o.modelo || '(sin identificar)'} · versión: ${o.version_producto || '-'} · proveedor: ${o.proveedor_razon_social || '-'}
COSTEO DE LA OPCIÓN (accesorios o documentos de terceros ya costeados): (ninguno registrado)
VERIFICACIÓN ANTERIOR: (primera verificación)`;
  const extra = [
    ctx.foro ? `FORO (parte integrante de las bases):\n${ctx.foro}` : 'FORO: (no disponible)',
    ctx.criterios ? `CRITERIOS DE EVALUACIÓN (con su forma de aplicación):\n${ctx.criterios}` : 'CRITERIOS DE EVALUACIÓN: (no llegaron — emite una sola alerta general "criterios_evaluacion_no_disponibles")',
    'CRONOGRAMA: (sin fecha de cierre de preguntas del foro: avisa que hay que verificar el plazo)',
  ].join('\n\n');

  const lotes: RequisitoHeredado[][] = [];
  for (let i = 0; i < ctx.requisitos.length; i += LOTE) lotes.push(ctx.requisitos.slice(i, i + LOTE));
  const matriz: ItemCrudo[] = [];
  const merged: SalidaTecnicaCruda = { alertas_generales: undefined, correspondencia_documentos: [], compromisos_con_costo: [], eventos: [], no_pude_leer: [] };

  // Lotes en serie corto (2 a la vez): Kimi razona y cada lote pesa; la primera llamada además trae las secciones generales.
  const correr = async (lote: RequisitoHeredado[], primera: boolean) => {
    const user = `${cabecera}

REQUISITOS HEREDADOS DE ESTA LÍNEA (el n es su identificador):
${lote.map(textoRequisito).join('\n')}

${primera
      ? `ESTA ES LA LLAMADA GENERAL: además de la matriz, entrega "alertas_generales", "correspondencia_documentos", "compromisos_con_costo" y "eventos".${ctx.requisitosGenerales ? `\nREQUISITOS GENERALES DE ADMISIBILIDAD DE LA LICITACIÓN (para detectar compromisos con costo, Parte VIII):\n${ctx.requisitosGenerales}` : ''}`
      : 'Solo la matriz_tecnica de estos requisitos (las secciones generales ya se entregaron en otra llamada).'}

${extra}

DOCUMENTOS DE LA OPCIÓN:
${bloque}`;
    const parsed = await llamarJSON(SYS_L1_TEC, user, { ...MOTOR_KIMI_ESTRICTO, timeoutMs: 240_000 });
    const arr: any[] = Array.isArray(parsed?.matriz_tecnica) ? parsed.matriz_tecnica : [];
    if (!arr.length) throw new Error('El modelo no devolvió la matriz técnica (respuesta vacía o ilegible).');
    for (const it of arr) if (Number.isFinite(Number(it?.n)) && lote.some(r => r.n === Number(it.n))) matriz.push(it);
    if (primera) {
      merged.alertas_generales = parsed.alertas_generales;
      merged.correspondencia_documentos = parsed.correspondencia_documentos || [];
      merged.compromisos_con_costo = parsed.compromisos_con_costo || [];
      merged.alerta_sobredimensionamiento = parsed.alerta_sobredimensionamiento;
    }
    for (const x of parsed.no_pude_leer || []) if (x?.que) merged.no_pude_leer!.push(x);
  };
  if (lotes.length) {
    await correr(lotes[0], true);
    for (let i = 1; i < lotes.length; i += 2) await Promise.all(lotes.slice(i, i + 2).map(l => correr(l, false)));
  }
  merged.matriz_tecnica = matriz;
  return { salida: merged, requisitos: ctx.requisitos, textoEnviado: enviado, motor: 'kimi-k3' };
}

// ── Persistencia y lectura del estado (se recalcula al leer: habilitaciones y declaraciones cambian sin volver a llamar a la IA) ─────────
export interface VerificacionGuardada { id: number; pasada: 'L1' | 'L2'; corrida: CorridaTecnica; creadoAt: string; error: string | null }

async function guardar(negocioId: number, opcionId: number, pasada: 'L1' | 'L2', datos: unknown, estado: string | null, motor: string, userId: number | null, error: string | null = null) {
  await pool.query(
    `INSERT INTO auditor_verificacion_tecnica (negocio_id, opcion_id, pasada, resultado_json, estado_tecnico, motor, version_prompt, error, creado_por, creado_at)
     VALUES (?, ?, ?, ?, ?, ?, 'v2.0', ?, ?, ?)`, [negocioId, opcionId, pasada, JSON.stringify(datos), estado, motor, error, userId, ahoraChileSQL()]);
}

/** @param soloV2 true = solo las corridas hechas con el prompt v2.0 (historial: las del comparador v3.0 se guardan en otra forma). */
export async function ultimasVerificaciones(negocioId: number, soloV2 = false): Promise<Map<number, { l1: VerificacionGuardada | null; l2: { rectificados: Map<number, string>; confirmados: Set<number>; at: string } | null }>> {
  // Solo la última L1 de cada opción y lo posterior (una L1 nueva descarta todo lo anterior): el historial completo eran cientos de KB.
  const filtro = soloV2 ? " AND version_prompt = 'v2.0'" : '';
  const [rows] = await pool.query(
    `SELECT t.id, t.opcion_id, t.pasada, t.resultado_json, t.error, t.creado_at FROM auditor_verificacion_tecnica t
      WHERE t.negocio_id = ?${filtro.replace('version_prompt', 't.version_prompt')}
        AND t.id >= COALESCE((SELECT MAX(l.id) FROM auditor_verificacion_tecnica l WHERE l.negocio_id = t.negocio_id AND l.opcion_id = t.opcion_id AND l.pasada = 'L1'${filtro.replace('version_prompt', 'l.version_prompt')}), 0)
      ORDER BY t.id`, [negocioId]) as any;
  const out = new Map<number, { l1: VerificacionGuardada | null; l2: { rectificados: Map<number, string>; confirmados: Set<number>; at: string } | null }>();
  for (const r of rows as any[]) {
    const cur = out.get(r.opcion_id) || { l1: null, l2: null };
    let j: any = null;
    try { j = JSON.parse(r.resultado_json); } catch { /* fila con error */ }
    const at = r.creado_at instanceof Date ? r.creado_at.toISOString() : String(r.creado_at);
    if (r.pasada === 'L1') { cur.l1 = j?.salida ? { id: r.id, pasada: 'L1', corrida: j, creadoAt: at, error: r.error } : { id: r.id, pasada: 'L1', corrida: { salida: {}, requisitos: [], textoEnviado: '', motor: '' }, creadoAt: at, error: r.error || 'sin resultado' }; cur.l2 = null; }
    else if (j) cur.l2 = { rectificados: new Map<number, string>((j.rectificados || []).map((x: any) => [Number(x.n), String(x.texto)])), confirmados: new Set<number>((j.confirmados || []).map(Number)), at };
    out.set(r.opcion_id, cur);
  }
  return out;
}

export async function habilitacionesYDeclaraciones(negocioId: number): Promise<Map<number, { habilitados: Set<number>; declarados: Map<number, { texto: string; respaldo: string }> }>> {
  const [rows] = await pool.query(`SELECT opcion_id, tipo, detalle FROM auditor_evento WHERE negocio_id = ? AND tipo IN ('habilitacion_tecnica','declaracion_tecnica') ORDER BY id`, [negocioId]) as any;
  const out = new Map<number, { habilitados: Set<number>; declarados: Map<number, { texto: string; respaldo: string }> }>();
  for (const r of rows as any[]) {
    const cur = out.get(r.opcion_id) || { habilitados: new Set<number>(), declarados: new Map() };
    try {
      const d = JSON.parse(r.detalle || '{}');
      if (r.tipo === 'habilitacion_tecnica') { if (d.habilitado === false) cur.habilitados.delete(Number(d.n)); else cur.habilitados.add(Number(d.n)); }
      else if (d.respaldo) cur.declarados.set(Number(d.n), { texto: String(d.texto || ''), respaldo: String(d.respaldo) });
    } catch { /* evento mal formado: se ignora */ }
    out.set(r.opcion_id, cur);
  }
  return out;
}

/** Recalcula el estado técnico de una opción a partir de su última corrida (más habilitaciones, declaraciones y segunda pasada). */
export function estadoTecnicoDe(
  v: { l1: VerificacionGuardada | null; l2: { rectificados: Map<number, string>; confirmados: Set<number>; at: string } | null } | undefined,
  hd: { habilitados: Set<number>; declarados: Map<number, { texto: string; respaldo: string }> } | undefined,
): { resultado: ResultadoTecnico | null; corridoAt: string | null; error: string | null; segundaPasadaAt: string | null } {
  if (!v?.l1) return { resultado: null, corridoAt: null, error: null, segundaPasadaAt: null };
  if (v.l1.error) return { resultado: null, corridoAt: v.l1.creadoAt, error: v.l1.error, segundaPasadaAt: null };
  const c = v.l1.corrida;
  const salida: SalidaTecnicaCruda = JSON.parse(JSON.stringify(c.salida));
  // Segunda pasada: un 🔴 que no se confirmó se rectifica a SIN VEREDICTO con el motivo de la rectificación.
  const l2 = v.l2;
  for (const it of salida.matriz_tecnica || []) {
    const n = Number(it.n);
    if (l2?.rectificados.has(n)) {
      it.rectificacion = l2.rectificados.get(n);
      for (const p of it.partes || []) if (p.veredicto === 'CUMPLE') { p.veredicto = 'SIN_VEREDICTO'; p.motivo_sin_veredicto = 'rectificado_segunda_pasada'; }
    }
    if (l2?.confirmados.has(n)) it.reverificado = true;
  }
  const resultado = evaluarTecnico({ requisitos: c.requisitos, salida, textoDocumentos: c.textoEnviado, habilitados: hd?.habilitados, declarados: new Set([...(hd?.declarados.keys() ?? [])]) });
  for (const f of resultado.filas) if (l2?.rectificados.has(f.n)) resultado.alertas.unshift({ nivel: 'rojo', texto: `HALLAZGO GRAVE de la segunda pasada — ítem ${f.n}: ${l2.rectificados.get(f.n)}` });
  return { resultado, corridoAt: v.l1.creadoAt, error: null, segundaPasadaAt: l2?.at ?? null };
}

// ── Orquestación: correr L1 y ejecutar los eventos ───────────────────────────────────────────────
export interface ResumenCorridaTecnica { estado: ResultadoTecnico['estado']; resumen: ResultadoTecnico['resumen']; eventos: string[]; costosCreados: number; descartada: boolean }

export async function verificarTecnicoOpcion(params: {
  negocioId: number; licitacionCodigo: string; opcionId: number; actor: { id: number; nombre: string };
  lineaReal: number | null; nombreLinea: string; cantidad: number | null; unidad: string;
}): Promise<ResumenCorridaTecnica> {
  const { negocioId, licitacionCodigo, opcionId, actor, lineaReal, nombreLinea, cantidad, unidad } = params;
  const [ors] = await pool.query(`SELECT * FROM auditor_opcion WHERE id = ? AND negocio_id = ?`, [opcionId, negocioId]) as any;
  const o = (ors as any[])[0] as OpcionParaTecnico | undefined;
  if (!o) throw new Error('La opción no existe en este negocio.');
  if (o.via === 'liviana') throw new Error('La opción está en vía liviana: el verificador técnico no corre (cambia a vía completa para verificarla).');
  const ctx = await requisitosDeLinea(negocioId, licitacionCodigo, lineaReal);
  if (!ctx || ctx.requisitos.length === 0) throw new Error('Esta línea no tiene requisitos técnicos heredados del análisis: no hay contra qué comparar.');
  const docs = await documentosDeOpcion(opcionId);
  if (docs.length === 0) throw new Error('La opción no tiene documentos leídos: carga una cotización, ficha o link primero.');

  let corrida: CorridaTecnica;
  try { corrida = await correrL1(o, ctx, docs, nombreLinea || ctx.nombreLinea, cantidad, unidad); }
  catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 480);
    await guardar(negocioId, opcionId, 'L1', {}, null, 'kimi-k3', actor.id, msg);
    throw new Error(`No se pudo completar la verificación técnica: ${msg}`);
  }
  const hd = (await habilitacionesYDeclaraciones(negocioId)).get(opcionId);
  const resultado = evaluarTecnico({ requisitos: corrida.requisitos, salida: corrida.salida, textoDocumentos: corrida.textoEnviado, habilitados: hd?.habilitados, declarados: new Set([...(hd?.declarados.keys() ?? [])]) });
  await guardar(negocioId, opcionId, 'L1', corrida, resultado.estado, corrida.motor, actor.id);

  // Eventos hacia el resto del sistema (los enruta el código).
  const ahora = ahoraChileSQL();
  const evt = async (tipo: string, detalle: string) => pool.query(
    `INSERT INTO auditor_evento (negocio_id, opcion_id, tipo, emisor, detalle, creado_at) VALUES (?, ?, ?, 'tecnico', ?, ?)`, [negocioId, opcionId, tipo, detalle.slice(0, 1000), ahora]).catch(() => { /* la bitácora no tumba la corrida */ });
  let costosCreados = 0, descartada = false;
  for (const c of resultado.compromisos) {
    const antes = await pool.query(`SELECT COUNT(*) n FROM auditor_costo_asociado WHERE negocio_id = ?`, [negocioId]) as any;
    await agregarCostoAsociado(negocioId, { filaId: o.filaId, opcionId, materia: c.materia, exigeBaseLiteral: c.exigeBaseLiteral, fuenteBases: c.fuenteBases, cuantificacion: c.cuantificacion, criticidad: c.criticidad, origen: 'tecnico' }, actor);
    const despues = await pool.query(`SELECT COUNT(*) n FROM auditor_costo_asociado WHERE negocio_id = ?`, [negocioId]) as any;
    if (Number(despues[0][0].n) > Number(antes[0][0].n)) costosCreados++;
  }
  for (const e of resultado.eventos) await evt(e.tipo, `${e.itemRef ? `ítem ${e.itemRef}: ` : ''}${e.detalle}`);
  // ruta_insalvable → la opción queda DESCARTADA (el asistente puede reabrirla con comentario).
  const insalvable = resultado.eventos.find(e => e.tipo === 'ruta_insalvable');
  if (insalvable && !['aprobada', 'en_aprobacion', 'definitiva', 'descartada'].includes(o.estado)) {
    await pool.query(`UPDATE auditor_opcion SET estado = 'descartada', motivo_descarte = ?, actualizado_at = ? WHERE id = ?`, [`Ruta insalvable (verificador técnico): ${insalvable.detalle}`.slice(0, 480), ahora, opcionId]);
    descartada = true;
  }
  return { estado: resultado.estado, resumen: resultado.resumen, eventos: resultado.eventos.map(e => e.tipo), costosCreados, descartada };
}

// ── Segunda pasada de rojos (L2) — en la pasada final ────────────────────────────────────────────
export async function segundaPasadaTecnica(params: { negocioId: number; opcionId: number; actor: { id: number } }): Promise<{ revisados: number; rectificados: number }> {
  const { negocioId, opcionId, actor } = params;
  const v = (await ultimasVerificaciones(negocioId)).get(opcionId);
  const hd = (await habilitacionesYDeclaraciones(negocioId)).get(opcionId);
  const est = estadoTecnicoDe(v, hd);
  if (!est.resultado) return { revisados: 0, rectificados: 0 };
  const rojos = est.resultado.filas.filter(f => f.rojo && (f.veredicto === 'CUMPLE' || f.veredicto === 'CUMPLE_CON_COMPLEMENTO') && f.criticidad !== 'SIN_CLASIFICAR');
  if (rojos.length === 0) return { revisados: 0, rectificados: 0 };
  const docs = await documentosDeOpcion(opcionId);
  const { texto } = bloqueDocumentos(docs);
  const user = `ÍTEMS A REVERIFICAR (INADMISIBLE, declarados CUMPLE en la primera pasada):
${rojos.map(f => `n=${f.n} · ${f.requeridoTexto} · valor ofertado declarado: (no lo tomes de aquí) · ubicación citada: ${f.partes.map(p => p.fuenteFicha || p.citaOriginal).filter(Boolean).join(' | ') || '(no citada)'}`).join('\n')}

DOCUMENTOS ORIGINALES:
${texto}`;
  const parsed = await llamarJSON(SYS_L2_TEC, user, { ...MOTOR_KIMI_ESTRICTO, timeoutMs: 240_000 });
  const arr: any[] = Array.isArray(parsed?.reverificacion) ? parsed.reverificacion : [];
  if (!arr.length) throw new Error('La segunda pasada no devolvió resultados legibles.');
  const rectificados: Array<{ n: number; texto: string }> = [], confirmados: number[] = [];
  for (const r of arr) {
    const n = Number(r?.n);
    if (!rojos.some(f => f.n === n)) continue;
    if (r.confirmado === false) rectificados.push({ n, texto: s(r.rectificacion, 400) || 'El dato no aparece donde se citó.' }); else confirmados.push(n);
  }
  await guardar(negocioId, opcionId, 'L2', { rectificados, confirmados }, null, 'kimi-k3', actor.id);
  return { revisados: rojos.length, rectificados: rectificados.length };
}
