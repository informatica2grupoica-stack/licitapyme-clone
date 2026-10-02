// app/lib/auditor-prepostulacion.ts
// PRE-POSTULACIÓN — datos e IA. Server-only. La lógica que decide (certificado, candado) vive en auditor-prepostulacion-core.ts.
// Spec: docs/ESPECIFICACION_AUDITOR_v1.md §2 y §11.4 · docs/RESERVA_PREPOSTULACION_Bloque_TecAdm_y_Certificado.md.
// Tablas: migration-135 (auditor_prepost_item, auditor_prepost_linea). Si todavía no se aplicó, todo responde `migracionPendiente`.
import { createHash } from 'node:crypto';
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { crearChatIA } from '@/app/lib/gemini';
import { parseJsonIA } from '@/app/lib/json-ia';
import { MOTOR_KIMI_ESTRICTO } from '@/app/lib/auditor-tecnico';
import { citaExiste } from '@/app/lib/auditor-compras-core';
import { criticidadDe } from '@/app/lib/auditor-tecnico-v2-core';
import { requisitosDeLinea } from '@/app/lib/auditor-tecnico-v2';
import { armarPanelAuditor, correrSegundaPasadaDeOpcion, type PanelAuditorDTO } from '@/app/lib/auditor-opciones';
import { agregarCostoAsociado, anularCostoAsociado, type CostoAsociadoDTO } from '@/app/lib/auditor-lineas';
import { SYS_TECADM, MATERIAS_TECADM } from '@/app/lib/auditor-prepostulacion-prompts';
import {
  armarCertificado, evaluarCandado, claveDeCompromiso, itemVigente, repetidosDeCompromisos,
  type Certificado, type ItemPrePost, type ResultadoCandado, type LineaParaCertificado, type OrigenItem,
} from '@/app/lib/auditor-prepostulacion-core';

export interface ActorPP { id: number; nombre: string }

const s = (v: unknown, max = 600) => (v == null ? '' : String(v)).trim().slice(0, max);
const fechaS = (v: unknown) => (v ? (v instanceof Date ? v.toISOString() : String(v)) : null);
const sha = (t: string) => createHash('sha1').update(t).digest('hex');

// ── ¿Está aplicada la migración? ────────────────────────────────────────────────────────────────
let migracionOk: boolean | null = null;
export async function migracionAplicada(): Promise<boolean> {
  if (migracionOk === true) return true;                      // una vez aplicada no se vuelve a preguntar; si falta, se reintenta en la próxima carga
  try {
    const [rows] = await pool.query(`SELECT COUNT(*) n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('auditor_prepost_item','auditor_prepost_linea')`) as any;
    migracionOk = Number((rows as any[])[0]?.n) === 2;
  } catch { migracionOk = false; }
  return migracionOk;
}

// ── DTO ─────────────────────────────────────────────────────────────────────────────────────────
export interface LineaPrePostDTO {
  filaId: string; item: number; detalle: string; noOfertada: boolean; motivoNoOfertada: string | null;
  opcionAprobadaId: number | null; producto: string | null; proveedor: string | null;
  revisada: boolean; revisadaAt: string | null; revisadaPorNombre: string | null; errorRevision: string | null;
}
/** Un documento de la oferta (anexo, formulario, garantía…) tal como está en el checklist de Anexos, con los archivos ya cargados. */
export interface DocumentoOfertaDTO { itemId: number; bloque: string; titulo: string; criticidad: string; estado: string; documentos: Array<{ id: number; nombre: string; url: string }> }
export interface PrePostulacionDTO {
  migracionPendiente: false;
  /** TODO lo que se sube a Mercado Público, con su estado (cargado / aprobado / falta). */
  documentosOferta: DocumentoOfertaDTO[];
  /** El negocio ya trabaja con el AUDITOR unificado (tiene al menos una opción viva): solo entonces el candado aplica. */
  activo: boolean;
  lineas: LineaPrePostDTO[];
  items: ItemPrePost[];
  certificado: Certificado;
  candado: ResultadoCandado;
  avance: PanelAuditorDTO['avance'];
  costosAsociados: { total: number; sinEstimar: number };
}

interface FilaItemDB {
  id: number; fila_id: string | null; origen: OrigenItem; materia: string; exige_base_literal: string | null; fuente_bases: string | null; se_compromete: string | null;
  cuantificacion: string | null; criticidad: string | null; costo_asociado_id: number | null; confirmado: number; confirmado_por_nombre: string | null;
  confirmado_at: Date | string | null; no_aplica: number; nota: string | null;
}

const itemDeFila = (r: FilaItemDB, costos: Map<number, CostoAsociadoDTO>): ItemPrePost => {
  const c = r.costo_asociado_id != null ? costos.get(r.costo_asociado_id) : null;
  return {
    id: r.id, filaId: r.fila_id, origen: r.origen, materia: r.materia, exigeBaseLiteral: r.exige_base_literal || '', fuenteBases: r.fuente_bases || '',
    seCompromete: r.se_compromete || '', cuantificacion: r.cuantificacion || '', criticidad: r.criticidad || 'SIN_CLASIFICAR', costoAsociadoId: r.costo_asociado_id,
    confirmado: !!r.confirmado, confirmadoPorNombre: r.confirmado_por_nombre, confirmadoAt: fechaS(r.confirmado_at), noAplica: !!r.no_aplica, nota: r.nota,
    costo: r.origen === 'costo_asociado' ? { anulado: c ? c.anulado : false, montoEstimado: c ? c.montoEstimado : null } : null,
  };
};

/** Los compromisos con costo que el verificador técnico ya detectó en EN PROCESO llegan precargados: uno por costo asociado (idempotente). */
async function sincronizarCostosAsociados(negocioId: number, costos: CostoAsociadoDTO[], yaTienen: Set<number>): Promise<boolean> {
  const faltan = costos.filter(c => !yaTienen.has(c.id));
  if (!faltan.length) return false;
  const ahora = ahoraChileSQL();
  for (const c of faltan) {
    await pool.query(
      `INSERT IGNORE INTO auditor_prepost_item (negocio_id, fila_id, clave, origen, materia, exige_base_literal, fuente_bases, se_compromete, cuantificacion, criticidad,
         costo_asociado_id, creado_at, actualizado_at) VALUES (?, ?, ?, 'costo_asociado', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [negocioId, c.filaId, sha(`costo:${c.id}`), c.materia, c.exigeBaseLiteral, c.fuenteBases, c.cuantificacion || 'no cuantificado', c.cuantificacion, c.criticidad, c.id, ahora, ahora]);
  }
  return true;
}

/** Anula (con motivo, reversible) los costos asociados que son el MISMO compromiso repetido: el comparador anterior los creaba de nuevo en cada corrida. Se queda uno por grupo. */
export async function anularCompromisosRepetidos(negocioId: number): Promise<number> {
  const [rows] = await pool.query(
    `SELECT c.id, c.fila_id, c.materia, c.exige_base_literal, COALESCE(MAX(i.confirmado), 0) AS conf
     FROM auditor_costo_asociado c LEFT JOIN auditor_prepost_item i ON i.costo_asociado_id = c.id AND i.negocio_id = c.negocio_id
     WHERE c.negocio_id = ? AND c.anulado = 0 GROUP BY c.id`, [negocioId]) as any;
  const grupos = repetidosDeCompromisos((rows as any[]).map(r => ({ id: r.id, filaId: r.fila_id, materia: r.materia, texto: r.exige_base_literal || '', prioridad: r.conf ? 0 : 1 })));
  let n = 0;
  for (const g of grupos) for (const id of g.sobran) { await anularCostoAsociado(negocioId, id, `Repetido: es el mismo compromiso que el #${g.queda} (se conserva uno solo).`, { id: 0, nombre: 'Sistema' }); n++; }
  return n;
}

/** Documentos de la oferta: los puntos de tipo «documento» del checklist (Anexos) con sus archivos. Si el checklist aún no existe, lista vacía. */
async function documentosDeLaOferta(negocioId: number): Promise<DocumentoOfertaDTO[]> {
  try {
    const [items] = await pool.query(
      `SELECT id, bloque, titulo, criticidad, estado, ofertamos FROM checklist_comercial WHERE negocio_id = ? AND tipo = 'documento' ORDER BY FIELD(bloque,'ADMINISTRATIVO','TECNICO','COMERCIAL'), orden, id`, [negocioId]) as any;
    const [docs] = await pool.query(`SELECT id, item_id, nombre, url FROM checklist_comercial_documentos WHERE negocio_id = ? ORDER BY subido_at, id`, [negocioId]) as any;
    const porItem = new Map<number, Array<{ id: number; nombre: string; url: string }>>();
    for (const d of docs as any[]) (porItem.get(d.item_id) || porItem.set(d.item_id, []).get(d.item_id)!).push({ id: d.id, nombre: d.nombre, url: d.url });
    return (items as any[]).filter(i => i.ofertamos !== 0).map(i => ({ itemId: i.id, bloque: i.bloque, titulo: i.titulo, criticidad: i.criticidad || '', estado: i.estado, documentos: porItem.get(i.id) || [] }));
  } catch { return []; }
}

export async function armarPrePostulacion(negocioId: number, licitacionCodigo: string, panelPrevio?: PanelAuditorDTO): Promise<PrePostulacionDTO> {
  const repetidos = await anularCompromisosRepetidos(negocioId).catch(() => 0);
  const panel = panelPrevio && !repetidos ? panelPrevio : await armarPanelAuditor(negocioId, licitacionCodigo);
  const costos = new Map(panel.costosAsociados.map(c => [c.id, c]));

  let [rows] = await pool.query(`SELECT * FROM auditor_prepost_item WHERE negocio_id = ? ORDER BY id`, [negocioId]) as any;
  const yaTienen = new Set<number>((rows as FilaItemDB[]).map(r => r.costo_asociado_id).filter((x): x is number => x != null));
  if (await sincronizarCostosAsociados(negocioId, panel.costosAsociados, yaTienen)) [rows] = await pool.query(`SELECT * FROM auditor_prepost_item WHERE negocio_id = ? ORDER BY id`, [negocioId]) as any;
  const items = (rows as FilaItemDB[]).map(r => itemDeFila(r, costos));

  const [lrows] = await pool.query(`SELECT fila_id, revisado_at, revisado_por_nombre, error FROM auditor_prepost_linea WHERE negocio_id = ?`, [negocioId]) as any;
  const revisadas = new Map<string, any>((lrows as any[]).map(r => [r.fila_id, r]));

  const lineas: LineaPrePostDTO[] = panel.lineas.map(l => {
    const ap = l.opciones.find(o => o.estado === 'aprobada') ?? null;
    const rv = revisadas.get(l.filaId);
    return {
      filaId: l.filaId, item: l.item, detalle: l.detalle, noOfertada: l.noOfertada, motivoNoOfertada: l.motivoNoOfertada,
      opcionAprobadaId: ap?.id ?? null, producto: ap ? [ap.marca, ap.modelo].filter(Boolean).join(' ') || null : null, proveedor: ap?.proveedorRazonSocial ?? null,
      // Una revisión que terminó con error NO cuenta como revisada: hay que volver a intentarla.
      revisada: !!rv && !rv.error, revisadaAt: rv ? fechaS(rv.revisado_at) : null, revisadaPorNombre: rv?.revisado_por_nombre ?? null, errorRevision: rv?.error ?? null,
    };
  });

  const paraCert: LineaParaCertificado[] = panel.lineas.map(l => {
    const ap = l.opciones.find(o => o.estado === 'aprobada') ?? null;
    return {
      filaId: l.filaId, item: l.item, detalle: l.detalle, noOfertada: l.noOfertada,
      aprobada: ap ? { id: ap.id, marca: ap.marca, modelo: ap.modelo, via: ap.via, tecnicoEstado: ap.tecnico.estado, resultado: ap.tecnico.resultado, segundaPasadaAt: ap.tecnico.segundaPasadaAt } : null,
    };
  });
  const certificado = armarCertificado(paraCert);
  const lineasSinRevisar = lineas.filter(l => !l.noOfertada && l.opcionAprobadaId != null && !l.revisada).map(l => l.item);
  const candado = evaluarCandado({ avance: panel.avance, certificado, items, lineasSinRevisar });
  const vigentesCosto = items.filter(i => i.origen === 'costo_asociado' && itemVigente(i));

  return {
    migracionPendiente: false,
    documentosOferta: await documentosDeLaOferta(negocioId),
    activo: panel.lineas.some(l => l.opciones.some(o => o.estado !== 'descartada')),
    lineas, items, certificado, candado, avance: panel.avance,
    costosAsociados: { total: vigentesCosto.length, sinEstimar: vigentesCosto.filter(i => i.costo && i.costo.montoEstimado == null).length },
  };
}

// ── Revisión de compromisos (IA) ────────────────────────────────────────────────────────────────
export interface ResultadoRevision { filaId: string; creados: number; descartados: number; error: string | null }

function cuerpoUsuario(p: { nombreLinea: string; producto: string; cantidad: number | null; unidad: string; requisitos: string[]; generales: string | null; criterios: string | null; foro: string | null; costosYa: string[] }): string {
  return `LÍNEA: ${p.nombreLinea} · cantidad ${p.cantidad ?? '?'} ${p.unidad}
PRODUCTO APROBADO PARA ESTA LÍNEA: ${p.producto || '(sin identificar)'}

REQUISITOS HEREDADOS DE ESTA LÍNEA (bases técnicas):
${p.requisitos.length ? p.requisitos.join('\n') : '(ninguno)'}

REQUISITOS GENERALES DE ADMISIBILIDAD DE LA LICITACIÓN:
${p.generales ?? '(no disponibles)'}

CRITERIOS DE EVALUACIÓN:
${p.criterios ?? '(no disponibles)'}

FORO (parte integrante de las bases):
${p.foro ?? '(no disponible)'}

COMPROMISOS CON COSTO YA DETECTADOS (no los repitas):
${p.costosYa.length ? p.costosYa.join('\n') : '(ninguno)'}`;
}

/** Revisa el bloque técnico-administrativo de UNA línea: pide al modelo los compromisos, descarta los que no citan texto que figure en lo enviado
 *  (PROHIBIDO inventar un requisito) y guarda el resto sin pisar confirmaciones anteriores. Marca la línea como revisada aunque no salga ningún ítem. */
export async function revisarCompromisosDeLinea(params: { negocioId: number; licitacionCodigo: string; filaId: string; actor: ActorPP; panel?: PanelAuditorDTO }): Promise<ResultadoRevision> {
  const { negocioId, licitacionCodigo, filaId, actor } = params;
  const panel = params.panel ?? await armarPanelAuditor(negocioId, licitacionCodigo);
  const l = panel.lineas.find(x => x.filaId === filaId);
  if (!l) throw new Error('La línea no existe en el costeo de este negocio.');
  if (l.noOfertada) throw new Error('La línea está marcada como NO OFERTADA: no tiene compromisos que confirmar.');
  const ap = l.opciones.find(o => o.estado === 'aprobada');
  if (!ap) throw new Error('La línea no tiene una opción aprobada: apruébala en el Auditor antes de revisar sus compromisos.');

  const ctx = await requisitosDeLinea(negocioId, licitacionCodigo, l.lineaReal);
  const requisitos = (ctx?.requisitos ?? []).map(r => `n=${r.n} · ${r.criticidad} · ${r.producto ? `[${r.producto}] ` : ''}${r.texto} · fuente en bases: ${r.fuente}`);
  const costosYa = panel.costosAsociados.filter(c => !c.anulado && (c.filaId === filaId || c.filaId == null)).map(c => `${c.materia}: ${c.cuantificacion || 'no cuantificado'}`);
  const ahora = ahoraChileSQL();
  const marcar = (motor: string | null, n: number, error: string | null) => pool.query(
    `INSERT INTO auditor_prepost_linea (negocio_id, fila_id, revisado_at, revisado_por, revisado_por_nombre, motor, items_detectados, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE revisado_at = VALUES(revisado_at), revisado_por = VALUES(revisado_por), revisado_por_nombre = VALUES(revisado_por_nombre), motor = VALUES(motor), items_detectados = VALUES(items_detectados), error = VALUES(error)`,
    [negocioId, filaId, ahora, actor.id, actor.nombre, motor, n, error]);

  // Sin ningún requisito de donde sacar compromisos no hay nada que preguntarle al modelo: la línea queda revisada sin ítems.
  if (!ctx || (!requisitos.length && !ctx.requisitosGenerales)) { await marcar(null, 0, null); return { filaId, creados: 0, descartados: 0, error: null }; }

  const usuario = cuerpoUsuario({
    nombreLinea: l.detalle, producto: [ap.marca, ap.modelo].filter(Boolean).join(' '), cantidad: l.cantidad, unidad: l.unidad,
    requisitos, generales: ctx.requisitosGenerales, criterios: ctx.criterios, foro: ctx.foro, costosYa,
  });
  let parsed: any;
  try {
    const completion: any = await crearChatIA({
      messages: [{ role: 'system', content: SYS_TECADM }, { role: 'user', content: usuario }],
      temperature: 0.1, stream: false, max_tokens: MOTOR_KIMI_ESTRICTO.maxTokens, response_format: { type: 'json_object' },
    }, { timeoutMs: 240_000, modeloPreferido: MOTOR_KIMI_ESTRICTO.modeloPreferido, proveedorPreferido: MOTOR_KIMI_ESTRICTO.proveedorPreferido, sinRespaldo: MOTOR_KIMI_ESTRICTO.sinRespaldo });
    parsed = parseJsonIA(String(completion.choices?.[0]?.message?.content ?? '')) || {};
    if (!Array.isArray(parsed.tecnico_administrativo)) throw new Error('El modelo no devolvió la lista de compromisos (respuesta vacía o ilegible).');
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 480);
    await marcar('kimi-k3', 0, msg);
    return { filaId, creados: 0, descartados: 0, error: msg };
  }

  let creados = 0, descartados = 0;
  const vistos = new Set<string>();
  for (const x of parsed.tecnico_administrativo as any[]) {
    const literal = s(x?.exige_base_literal, 1500);
    // Guardarraíl: el compromiso tiene que citar un texto que figure en lo que se le mandó al modelo.
    if (!literal || !citaExiste(usuario, literal)) { descartados++; continue; }
    const materiaRaw = s(x?.materia, 40).toLowerCase();
    const materia = (MATERIAS_TECADM as readonly string[]).includes(materiaRaw) ? materiaRaw : 'otro';
    const clave = sha(claveDeCompromiso(filaId, materia, literal));
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    const [r] = await pool.query(
      `INSERT IGNORE INTO auditor_prepost_item (negocio_id, fila_id, clave, origen, materia, exige_base_literal, fuente_bases, se_compromete, cuantificacion, criticidad, creado_at, actualizado_at)
       VALUES (?, ?, ?, 'ia', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [negocioId, filaId, clave, materia, literal, s(x?.fuente_bases, 300) || null, s(x?.se_compromete, 600) || 'no cuantificado', s(x?.se_compromete, 300) || 'no cuantificado', criticidadDe(x?.criticidad), ahora, ahora]) as any;
    if (r.affectedRows > 0) creados++;
  }
  await marcar('kimi-k3', creados, null);
  return { filaId, creados, descartados, error: null };
}

/** Revisa todas las líneas ofertadas con opción aprobada que todavía no se revisaron (o cuya revisión falló). De a dos para no saturar al modelo. */
export async function revisarTodasLasLineas(params: { negocioId: number; licitacionCodigo: string; actor: ActorPP; forzar?: boolean }): Promise<ResultadoRevision[]> {
  const panel = await armarPanelAuditor(params.negocioId, params.licitacionCodigo);
  const dto = await armarPrePostulacion(params.negocioId, params.licitacionCodigo, panel);
  const pendientes = dto.lineas.filter(l => !l.noOfertada && l.opcionAprobadaId != null && (params.forzar || !l.revisada));
  const out: ResultadoRevision[] = [];
  for (let i = 0; i < pendientes.length; i += 2) {
    out.push(...await Promise.all(pendientes.slice(i, i + 2).map(l =>
      revisarCompromisosDeLinea({ negocioId: params.negocioId, licitacionCodigo: params.licitacionCodigo, filaId: l.filaId, actor: params.actor, panel })
        .catch(e => ({ filaId: l.filaId, creados: 0, descartados: 0, error: e instanceof Error ? e.message : String(e) })))));
  }
  return out;
}

// ── Acciones del asistente sobre un ítem ────────────────────────────────────────────────────────
async function itemDe(negocioId: number, id: number): Promise<FilaItemDB> {
  const [rows] = await pool.query(`SELECT * FROM auditor_prepost_item WHERE id = ? AND negocio_id = ?`, [id, negocioId]) as any;
  if (!(rows as any[]).length) throw new Error('El compromiso no existe en este negocio.');
  return (rows as any[])[0];
}

export async function confirmarItem(negocioId: number, id: number, confirmado: boolean, actor: ActorPP): Promise<void> {
  const it = await itemDe(negocioId, id);
  if (it.no_aplica) throw new Error('El compromiso está marcado «No aplica»: restáuralo primero.');
  await pool.query(
    `UPDATE auditor_prepost_item SET confirmado = ?, confirmado_por = ?, confirmado_por_nombre = ?, confirmado_at = ?, actualizado_at = ? WHERE id = ?`,
    confirmado ? [1, actor.id, actor.nombre, ahoraChileSQL(), ahoraChileSQL(), id] : [0, null, null, null, ahoraChileSQL(), id]);
}

/** Confirma varios de una vez (los que el asistente ya revisó uno a uno en pantalla). Cada uno queda con su nombre y hora. */
export async function confirmarItems(negocioId: number, ids: number[], actor: ActorPP): Promise<number> {
  let n = 0;
  for (const id of ids) { const it = await itemDe(negocioId, id); if (!it.no_aplica && !it.confirmado) { await confirmarItem(negocioId, id, true, actor); n++; } }
  return n;
}

export async function marcarItemNoAplica(negocioId: number, id: number, noAplica: boolean, comentario: string, actor: ActorPP): Promise<void> {
  await itemDe(negocioId, id);
  if (noAplica && !comentario.trim()) throw new Error('«No aplica» exige un comentario (por qué este compromiso no corresponde).');
  await pool.query(
    `UPDATE auditor_prepost_item SET no_aplica = ?, nota = ?, confirmado = 0, confirmado_por = NULL, confirmado_por_nombre = ?, confirmado_at = NULL, actualizado_at = ? WHERE id = ?`,
    [noAplica ? 1 : 0, noAplica ? comentario.trim().slice(0, 480) : null, noAplica ? actor.nombre : null, ahoraChileSQL(), id]);
}

export async function agregarItemManual(negocioId: number, d: { filaId: string | null; materia: string; exigeBaseLiteral: string; fuenteBases?: string; seCompromete?: string; conCosto?: boolean }, actor: ActorPP): Promise<number> {
  const literal = d.exigeBaseLiteral.trim();
  if (!literal) throw new Error('Copia la exigencia tal como la dicen las bases.');
  const materia = (MATERIAS_TECADM as readonly string[]).includes(d.materia) ? d.materia : 'otro';
  const ahora = ahoraChileSQL();
  const clave = sha(claveDeCompromiso(d.filaId, materia, literal));
  const [r] = await pool.query(
    `INSERT INTO auditor_prepost_item (negocio_id, fila_id, clave, origen, materia, exige_base_literal, fuente_bases, se_compromete, cuantificacion, criticidad, creado_at, actualizado_at)
     VALUES (?, ?, ?, 'manual', ?, ?, ?, ?, ?, 'COMPROMISO', ?, ?) ON DUPLICATE KEY UPDATE actualizado_at = VALUES(actualizado_at)`,
    [negocioId, d.filaId, clave, materia, literal.slice(0, 1500), (d.fuenteBases || '').slice(0, 300) || null, (d.seCompromete || '').slice(0, 600) || 'no cuantificado', (d.seCompromete || '').slice(0, 300) || 'no cuantificado', ahora, ahora]) as any;
  // Un compromiso que cuesta plata tiene que estar en el costeo antes de fijar el precio (Prompt 4 v2.0, Parte VIII): se crea el costo asociado.
  if (d.conCosto) await agregarCostoAsociado(negocioId, { filaId: d.filaId, materia, exigeBaseLiteral: literal, fuenteBases: d.fuenteBases || null, cuantificacion: d.seCompromete || null, criticidad: 'COMPROMISO', origen: 'manual' }, actor);
  return r.insertId as number;
}

// ── Segunda pasada (la consume el certificado) ──────────────────────────────────────────────────
/** El comparador técnico v3.0 no tiene segunda pasada (decisión CA 30-09-2026): el certificado usa el cuadro tal cual, con lo que el asistente confirmó. */
export async function correrSegundaPasada(negocioId: number, opcionId: number, actor: ActorPP): Promise<{ revisados: number; rectificados: number }> {
  return correrSegundaPasadaDeOpcion(negocioId, opcionId, actor);
}

// ── Candado hacia el resto de la app ────────────────────────────────────────────────────────────
/** Candado de PRE-POSTULACIÓN para quien lo consulta desde otro módulo (checklist/anexos). null = no aplica todavía: migración sin aplicar o
 *  el negocio no usa el AUDITOR unificado (no se bloquea a quien sigue con el flujo anterior). Nunca lanza. */
export async function candadoDelNegocio(negocioId: number, licitacionCodigo: string): Promise<ResultadoCandado | null> {
  try {
    if (!(await migracionAplicada())) return null;
    const dto = await armarPrePostulacion(negocioId, licitacionCodigo);
    return dto.activo ? dto.candado : null;
  } catch (e) {
    console.warn('[prepostulacion] candado no disponible:', String(e).slice(0, 160));
    return null;
  }
}
