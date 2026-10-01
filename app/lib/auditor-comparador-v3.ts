// app/lib/auditor-comparador-v3.ts
// AUDITOR · COMPARADOR TÉCNICO v3.0 — datos y llamada a la IA. Server-only. Spec: docs/PROMPT_4_Comparador_Tecnico_v3_0.md.
// UNA llamada por LÍNEA (no por opción): recibe los requisitos de la línea ya separados y los documentos de todas sus opciones, y devuelve el cuadro
// completo (un estado por producto y requisito, más los mensajes al proveedor). Lo que devuelve el modelo pasa por parsearSalidaV3() (el código manda).
// Cada opción guarda su propia corrida en auditor_verificacion_tecnica con version_prompt = 'v3.0' (las filas v2.0 anteriores ya no se usan).
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { crearChatIA } from '@/app/lib/gemini';
import { parseJsonIA } from '@/app/lib/json-ia';
import { MOTOR_KIMI_ESTRICTO } from '@/app/lib/auditor-tecnico';
import { requisitosDeLinea, documentosDeOpcion, type DocumentoOpcion } from '@/app/lib/auditor-tecnico-v2';
import { PROMPT_V3, ESQUEMA_V3 } from '@/app/lib/auditor-comparador-v3-prompts';
import {
  parsearSalidaV3, construirResultadoTecnico, estadoDeProducto,
  type SalidaV3, type GuardadaV3, type Confirmacion, type OpcionParaV3, type RequisitoV3,
} from '@/app/lib/auditor-comparador-v3-core';
import type { ResultadoTecnico } from '@/app/lib/auditor-tecnico-v2-core';

const TEXTO_CON_RESUMEN = 9_000;
const TOPE_TEXTO_TOTAL = 40_000;
const ESTADOS_QUE_SE_COMPARAN = ['tanteo', 'formalizada', 'verificada', 'definitiva'];

/** Notas de implementación que se agregan al prompt v3.0 SIN tocarlo (el .md manda): esta llamada es de UNA línea y las opciones ya vienen asignadas. */
const ADENDA = `

=== ADENDA DE IMPLEMENTACIÓN (del sistema; complementa el prompt, no lo reemplaza) ===
- La entrada es FORMATO: JSON y trae UNA sola línea. Responde con el ESQUEMA JSON de abajo; en "lineas" va solo esa línea. "documentos" y "resumen" pueden ir vacíos: los calcula el sistema.
- Los REQUISITOS ya vienen separados y numerados: usa exactamente esos "n" en las celdas (una celda por requisito y por producto, en el mismo orden) y no los separes de nuevo.
- Los documentos ya vienen asignados por el sistema a cada OPCIÓN. El "producto_id" de cada producto es el identificador de su opción (ej. "P12"): úsalo tal cual y no reasignes documentos entre opciones ni a otras líneas. Si un documento de una opción es de OTRO producto que el de la opción, no lo uses para comparar y dilo en "notas" ("documento de otro producto").
- "cita": frase LITERAL copiada del documento (mínimo 2 palabras). Si no la puedes copiar textual, déjala vacía.
- "dato_ofertado": el dato tal como lo dice el documento (con su unidad). En ❌ y 🟩 es obligatorio.
- "mensajes_proveedor": uno por proveedor, máximo 3 preguntas, solo sobre ❓ en características principales.

ESQUEMA JSON DE SALIDA:
${ESQUEMA_V3}`;

export function sistemaComparadorV3(): string { return PROMPT_V3 + ADENDA; }

async function llamarJSON(system: string, user: string): Promise<any> {
  const m = MOTOR_KIMI_ESTRICTO;
  const completion: any = await crearChatIA({
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0.1, stream: false, max_tokens: m.maxTokens, response_format: { type: 'json_object' },
  }, { timeoutMs: 240_000, modeloPreferido: m.modeloPreferido, proveedorPreferido: m.proveedorPreferido, sinRespaldo: m.sinRespaldo });
  return parseJsonIA(String(completion.choices?.[0]?.message?.content ?? '')) || {};
}

const docOrigen = (d: DocumentoOpcion): string => d.tipo;

export interface ResumenCorridaV3 { opciones: Array<{ opcionId: number; estado: 'CUMPLE' | 'NO_CUMPLE' | 'FALTA_DATO'; sinFicha: boolean }>; preguntas: number }

/** Compara TODAS las opciones vivas de una línea contra sus requisitos, con una sola llamada. */
export async function verificarLineaV3(params: {
  negocioId: number; licitacionCodigo: string; filaId: string; lineaReal: number | null; nombreLinea: string; cantidad: number | null; unidad: string; actor: { id: number };
  /** Solo estas opciones (p. ej. la que recién recibió una ficha): las demás conservan su última comparación. Sin esto se compara la línea completa. */
  soloOpcionIds?: number[];
}): Promise<ResumenCorridaV3> {
  const { negocioId, licitacionCodigo, filaId, lineaReal, nombreLinea, cantidad, unidad, actor, soloOpcionIds } = params;
  const [ors] = await pool.query(
    `SELECT * FROM auditor_opcion WHERE negocio_id = ? AND fila_id = ? AND via = 'completa' AND estado IN (?) ORDER BY id`, [negocioId, filaId, ESTADOS_QUE_SE_COMPARAN]) as any;
  const opciones = (ors as any[]).filter(o => !soloOpcionIds?.length || soloOpcionIds.includes(o.id));
  if (opciones.length === 0) throw new Error('La línea no tiene opciones en vía completa para comparar (las de vía liviana no pasan por el comparador técnico).');
  const ctx = await requisitosDeLinea(negocioId, licitacionCodigo, lineaReal);
  if (!ctx || ctx.requisitos.length === 0) throw new Error('Esta línea no tiene requisitos técnicos heredados del análisis: no hay contra qué comparar.');

  const conDocs: Array<{ o: any; docs: DocumentoOpcion[] }> = [];
  for (const o of opciones) { const docs = await documentosDeOpcion(o.id); if (docs.length) conDocs.push({ o, docs }); }
  if (conDocs.length === 0) throw new Error('Ninguna opción de la línea tiene documentos leídos: carga una cotización, una ficha o un link primero.');

  const requisitos: RequisitoV3[] = ctx.requisitos.map(r => ({ n: r.n, texto: r.texto, fuente: r.fuente, criticidad: r.criticidad }));
  const porDoc = Math.floor(TOPE_TEXTO_TOTAL / Math.max(1, conDocs.reduce((n, x) => n + x.docs.length, 0)));
  // Si el Lector ya extrajo las características del producto (con su texto original), no hace falta mandar el documento entero: va el resumen y un tramo del texto.
  const largoTexto = (d: DocumentoOpcion) => Math.min(porDoc, d.resumen.length >= 400 ? TEXTO_CON_RESUMEN : porDoc);
  const bloqueOpciones = conDocs.map(({ o, docs }) => {
    const cab = `=== OPCIÓN P${o.id} · ${[o.marca, o.modelo].filter(Boolean).join(' ') || '(marca y modelo sin identificar)'} · proveedor: ${o.proveedor_razon_social || '-'} ===`;
    const cuerpo = docs.map(d => `[${d.etiqueta}] archivo: "${d.nombre}" · tipo: ${docOrigen(d)}\n${d.resumen ? d.resumen + '\n' : ''}${d.resumen.length >= 400 && d.texto.length > TEXTO_CON_RESUMEN ? 'TEXTO (primeras páginas; las características completas están arriba)' : 'TEXTO COMPLETO'}:\n${d.texto.slice(0, largoTexto(d))}`).join('\n\n');
    return `${cab}\n${cuerpo}`;
  }).join('\n\n');
  const user = `FORMATO: JSON
LÍNEA ${filaId}: ${nombreLinea || ctx.nombreLinea} · ${cantidad ?? '?'} ${unidad}

REQUISITOS (texto literal de las bases, YA separados; usa estos n):
${requisitos.map(r => `${r.n}. ${ctx.requisitos.find(x => x.n === r.n)?.producto ? `[${ctx.requisitos.find(x => x.n === r.n)!.producto}] ` : ''}${r.texto}`).join('\n')}

OPCIONES Y SUS DOCUMENTOS:
${bloqueOpciones}`;

  const guardar = (opcionId: number, datos: unknown, estado: string | null, error: string | null) => pool.query(
    `INSERT INTO auditor_verificacion_tecnica (negocio_id, opcion_id, pasada, resultado_json, estado_tecnico, motor, version_prompt, error, creado_por, creado_at)
     VALUES (?, ?, 'L1', ?, ?, ?, 'v3.0', ?, ?, ?)`, [negocioId, opcionId, JSON.stringify(datos), estado, 'kimi-k3', error, actor.id, ahoraChileSQL()]);

  let salida: SalidaV3;
  try {
    const t0 = Date.now();
    salida = await llamarJSON(sistemaComparadorV3(), user);
    console.log(`[comparador-v3] línea ${filaId}: ${conDocs.length} opción(es), ${user.length} car. enviados, ${Math.round((Date.now() - t0) / 1000)} s`);
    if (!Array.isArray(salida?.lineas) || !salida.lineas[0]?.productos?.length) throw new Error('El modelo no devolvió el cuadro de la línea (respuesta vacía o ilegible).');
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 480);
    for (const { o } of conDocs) await guardar(o.id, {}, null, msg);
    throw new Error(`No se pudo completar la comparación técnica: ${msg}`);
  }

  const paraCodigo: OpcionParaV3[] = conDocs.map(({ o, docs }) => ({
    opcionId: o.id, marca: o.marca, modelo: o.modelo, proveedor: o.proveedor_razon_social, proveedorRut: o.proveedor_rut, docs: docs.map(d => ({ texto: d.texto, tipo: docOrigen(d) })),
  }));
  const corridas = parsearSalidaV3(salida, requisitos, paraCodigo);
  const resumen: ResumenCorridaV3 = { opciones: [], preguntas: 0 };
  for (const { o } of conDocs) {
    const c = corridas.get(o.id)!;
    const guardada: GuardadaV3 = { version: 'v3.0', requisitos, opcion: c, motor: 'kimi-k3' };
    const estado = estadoDeProducto(c.celdas, new Map());
    await guardar(o.id, guardada, estado, null);
    resumen.opciones.push({ opcionId: o.id, estado, sinFicha: c.sinFicha });
    resumen.preguntas += c.preguntas.length;
  }
  return resumen;
}

// ── Lectura: última corrida v3 por opción + confirmaciones del asistente ─────────────────────────
export interface CorridaGuardadaV3 { guardada: GuardadaV3 | null; corridoAt: string; error: string | null }

export async function ultimasCorridasV3(negocioId: number): Promise<Map<number, CorridaGuardadaV3>> {
  const [rows] = await pool.query(
    `SELECT opcion_id, resultado_json, error, creado_at FROM auditor_verificacion_tecnica WHERE negocio_id = ? AND pasada = 'L1' AND version_prompt = 'v3.0' ORDER BY id`, [negocioId]) as any;
  const out = new Map<number, CorridaGuardadaV3>();
  for (const r of rows as any[]) {
    let g: GuardadaV3 | null = null;
    try { const j = JSON.parse(r.resultado_json); g = j?.version === 'v3.0' ? j : null; } catch { /* fila con error */ }
    out.set(r.opcion_id, { guardada: g, corridoAt: r.creado_at instanceof Date ? r.creado_at.toISOString() : String(r.creado_at), error: r.error || (g ? null : 'sin resultado') });
  }
  return out;
}

/** ❓ que el asistente cerró con un clic («lo confirmo»): sin respaldo, y queda quién y cuándo (el EM ve la lista). */
export async function confirmacionesTecnicas(negocioId: number): Promise<Map<number, Map<number, Confirmacion>>> {
  const [rows] = await pool.query(`SELECT opcion_id, detalle, creado_at FROM auditor_evento WHERE negocio_id = ? AND tipo = 'confirmacion_tecnica' ORDER BY id`, [negocioId]) as any;
  const out = new Map<number, Map<number, Confirmacion>>();
  for (const r of rows as any[]) {
    try {
      const d = JSON.parse(r.detalle || '{}');
      const m = out.get(r.opcion_id) || new Map<number, Confirmacion>();
      if (d.confirmada === false) m.delete(Number(d.n));
      else m.set(Number(d.n), { por: String(d.por || ''), motivo: d.motivo ? String(d.motivo) : undefined, at: r.creado_at instanceof Date ? r.creado_at.toISOString() : String(r.creado_at) });
      out.set(r.opcion_id, m);
    } catch { /* evento mal formado: se ignora */ }
  }
  return out;
}

export async function confirmarCelda(negocioId: number, opcionId: number, n: number, confirmada: boolean, actor: { id: number; nombre: string }, motivo = ''): Promise<void> {
  const [ors] = await pool.query(`SELECT estado FROM auditor_opcion WHERE id = ? AND negocio_id = ?`, [opcionId, negocioId]) as any;
  if (!(ors as any[]).length) throw new Error('La opción no existe en este negocio.');
  if (['en_aprobacion', 'aprobada'].includes((ors as any[])[0].estado)) throw new Error('La opción ya está en aprobación: pide rechazarla antes de cambiarle datos.');
  const corrida = (await ultimasCorridasV3(negocioId)).get(opcionId);
  const celda = corrida?.guardada?.opcion.celdas.find(c => c.n === n);
  if (!celda) throw new Error('Ese requisito no está en la última comparación de la opción.');
  const razon = motivo.trim().slice(0, 500);
  if (confirmada && celda.estado === 'NO_CUMPLE' && razon.length < 8) throw new Error('Para dar por cumplido un ❌ escribe el motivo (por ejemplo: «el proveedor confirmó por teléfono que trae AM» o «la ficha oficial lo dice en la pág. 2»).');
  await pool.query(`INSERT INTO auditor_evento (negocio_id, opcion_id, tipo, emisor, detalle, creado_at) VALUES (?, ?, 'confirmacion_tecnica', 'asistente', ?, ?)`,
    [negocioId, opcionId, JSON.stringify({ n, confirmada, por: actor.nombre, motivo: razon || undefined, antes: celda.estado }), ahoraChileSQL()]);
}

/** Recalcula el estado técnico de una opción a partir de su última corrida v3 y sus confirmaciones. */
export function estadoTecnicoV3(v: CorridaGuardadaV3 | undefined, conf: Map<number, Confirmacion> | undefined): { resultado: ResultadoTecnico | null; corridoAt: string | null; error: string | null } {
  if (!v) return { resultado: null, corridoAt: null, error: null };
  if (v.error || !v.guardada) return { resultado: null, corridoAt: v.corridoAt, error: v.error || 'sin resultado' };
  return { resultado: construirResultadoTecnico(v.guardada, conf ?? new Map()), corridoAt: v.corridoAt, error: null };
}
