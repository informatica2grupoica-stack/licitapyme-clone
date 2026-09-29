// app/lib/auditor-lineas.ts
// AUDITOR unificado — estado por LÍNEA del costeo y COSTOS ASOCIADOS (migration-133).
//   · NO OFERTADA por línea, con motivo obligatorio (spec §11.4). Una línea no ofertada sale del margen y de la
//     verificación; queda en el histórico (nada se borra).
//   · Líneas con exigencias que pueden dejarnos fuera (criticidad de admisibilidad dura o puntaje condicionante,
//     decisión CA 28-09-2026: "lo CONDICIONANTE llega como INADMISIBLE"): la vía COMPLETA es obligatoria (spec §5).
//   · Costos asociados: compromisos de las bases con costo (capacitación, instalación, despacho a región…). Los
//     detecta el verificador técnico o los agrega el asistente; los ESTIMA el asistente sin respaldo; no llevan margen
//     y solo suben el costo (spec §8.3). Anular exige comentario. Nunca se borran.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';

export interface ActorL { id: number; nombre: string }

// ── Estado por línea ─────────────────────────────────────────────────────────────────────────────
export interface EstadoLinea { noOfertada: boolean; motivo: string | null }

export async function estadosDeLineas(negocioId: number): Promise<Map<string, EstadoLinea>> {
  const [rows] = await pool.query(`SELECT fila_id, no_ofertada, motivo FROM auditor_linea_estado WHERE negocio_id = ?`, [negocioId]) as any;
  return new Map((rows as any[]).map(r => [r.fila_id, { noOfertada: !!r.no_ofertada, motivo: r.motivo ?? null }]));
}

export async function marcarNoOfertada(negocioId: number, filaId: string, motivo: string, actor: ActorL): Promise<void> {
  if (!motivo.trim()) throw new Error('Indica el motivo por el que no se oferta esta línea.');
  await pool.query(
    `INSERT INTO auditor_linea_estado (negocio_id, fila_id, no_ofertada, motivo, actualizado_por, actualizado_por_nombre, actualizado_at)
     VALUES (?, ?, 1, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE no_ofertada = 1, motivo = VALUES(motivo), actualizado_por = VALUES(actualizado_por),
       actualizado_por_nombre = VALUES(actualizado_por_nombre), actualizado_at = VALUES(actualizado_at)`,
    [negocioId, filaId, motivo.trim().slice(0, 480), actor.id, actor.nombre, ahoraChileSQL()]);
}

export async function reofertarLinea(negocioId: number, filaId: string, actor: ActorL): Promise<void> {
  await pool.query(
    `UPDATE auditor_linea_estado SET no_ofertada = 0, actualizado_por = ?, actualizado_por_nombre = ?, actualizado_at = ? WHERE negocio_id = ? AND fila_id = ?`,
    [actor.id, actor.nombre, ahoraChileSQL(), negocioId, filaId]);
}

/** Números de línea real (`lineaReal` del costeo) cuya criticidad heredada obliga a la vía completa. */
export async function lineasQueExigenViaCompleta(negocioId: number): Promise<Set<number>> {
  try {
    const [rows] = await pool.query(
      `SELECT linea_numero, criticidad FROM checklist_comercial WHERE negocio_id = ? AND tipo = 'linea_tecnica' AND linea_numero IS NOT NULL`, [negocioId]) as any;
    const s = new Set<number>();
    for (const r of rows as any[]) if (['ADMISIBILIDAD_DURA', 'INADMISIBLE', 'PUNTAJE_CONDICIONANTE'].includes(String(r.criticidad || '').toUpperCase())) s.add(Number(r.linea_numero));
    return s;
  } catch { return new Set(); }
}

// ── Costos asociados ─────────────────────────────────────────────────────────────────────────────
export interface CostoAsociadoDTO {
  id: number; filaId: string | null; opcionId: number | null; materia: string; exigeBaseLiteral: string | null; fuenteBases: string | null;
  cuantificacion: string | null; criticidad: string | null; montoEstimado: number | null; origen: 'tecnico' | 'manual';
  anulado: boolean; comentarioAnulacion: string | null; creadoAt: string; actualizadoPorNombre: string | null;
}

const num = (v: unknown) => (v == null ? null : Number(v));

export async function listarCostosAsociados(negocioId: number): Promise<CostoAsociadoDTO[]> {
  const [rows] = await pool.query(`SELECT * FROM auditor_costo_asociado WHERE negocio_id = ? ORDER BY anulado, id`, [negocioId]) as any;
  return (rows as any[]).map(r => ({
    id: r.id, filaId: r.fila_id ?? null, opcionId: r.opcion_id ?? null, materia: r.materia, exigeBaseLiteral: r.exige_base_literal ?? null,
    fuenteBases: r.fuente_bases ?? null, cuantificacion: r.cuantificacion ?? null, criticidad: r.criticidad ?? null,
    montoEstimado: num(r.monto_estimado), origen: r.origen === 'manual' ? 'manual' : 'tecnico', anulado: !!r.anulado,
    comentarioAnulacion: r.comentario_anulacion ?? null, creadoAt: r.creado_at instanceof Date ? r.creado_at.toISOString() : String(r.creado_at),
    actualizadoPorNombre: r.actualizado_por_nombre ?? null,
  }));
}

/** Suma de los costos asociados ACTIVOS con monto estimado: es lo que entra al margen (R1/R2). */
export function totalCostosAsociados(lista: CostoAsociadoDTO[]): number {
  return lista.filter(c => !c.anulado && c.montoEstimado != null).reduce((a, c) => a + (c.montoEstimado as number), 0);
}

export async function agregarCostoAsociado(negocioId: number, d: {
  filaId?: string | null; opcionId?: number | null; materia: string; exigeBaseLiteral?: string | null; fuenteBases?: string | null;
  cuantificacion?: string | null; criticidad?: string | null; montoEstimado?: number | null; origen: 'tecnico' | 'manual';
}, actor: ActorL | null): Promise<number> {
  const ahora = ahoraChileSQL();
  // Sin duplicar: el mismo compromiso (misma materia y misma cuantificación en la misma línea) se registra una sola vez,
  // aunque lo detecten varias opciones de la misma línea o varias corridas del verificador.
  const [dup] = await pool.query(
    `SELECT id FROM auditor_costo_asociado WHERE negocio_id = ? AND materia = ? AND COALESCE(fila_id,'') = ? AND COALESCE(cuantificacion,'') = ? AND COALESCE(exige_base_literal,'') = ? LIMIT 1`,
    [negocioId, d.materia, d.filaId || '', d.cuantificacion || '', (d.exigeBaseLiteral || '').slice(0, 2000)]) as any;
  if ((dup as any[]).length) return (dup as any[])[0].id;
  const [r] = await pool.query(
    `INSERT INTO auditor_costo_asociado (negocio_id, fila_id, opcion_id, materia, exige_base_literal, fuente_bases, cuantificacion, criticidad, monto_estimado, origen,
       creado_at, actualizado_por, actualizado_por_nombre, actualizado_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [negocioId, d.filaId || null, d.opcionId || null, d.materia.slice(0, 40), (d.exigeBaseLiteral || '').slice(0, 2000) || null, (d.fuenteBases || '').slice(0, 300) || null,
      (d.cuantificacion || '').slice(0, 300) || null, d.criticidad || null, d.montoEstimado ?? null, d.origen, ahora, actor?.id ?? null, actor?.nombre ?? null, ahora]) as any;
  return r.insertId as number;
}

async function costoDe(negocioId: number, id: number): Promise<any> {
  const [rows] = await pool.query(`SELECT * FROM auditor_costo_asociado WHERE id = ? AND negocio_id = ?`, [id, negocioId]) as any;
  if (!(rows as any[]).length) throw new Error('El costo asociado no existe en este negocio.');
  return (rows as any[])[0];
}

export async function estimarCostoAsociado(negocioId: number, id: number, monto: number | null, actor: ActorL): Promise<void> {
  await costoDe(negocioId, id);
  if (monto != null && (!Number.isFinite(monto) || monto < 0)) throw new Error('El monto estimado debe ser un número mayor o igual a cero.');
  await pool.query(`UPDATE auditor_costo_asociado SET monto_estimado = ?, actualizado_por = ?, actualizado_por_nombre = ?, actualizado_at = ? WHERE id = ?`,
    [monto, actor.id, actor.nombre, ahoraChileSQL(), id]);
}

export async function anularCostoAsociado(negocioId: number, id: number, comentario: string, actor: ActorL): Promise<void> {
  await costoDe(negocioId, id);
  if (!comentario.trim()) throw new Error('Anular un costo asociado exige un comentario (por qué no aplica).');
  await pool.query(`UPDATE auditor_costo_asociado SET anulado = 1, comentario_anulacion = ?, actualizado_por = ?, actualizado_por_nombre = ?, actualizado_at = ? WHERE id = ?`,
    [comentario.trim().slice(0, 480), actor.id, actor.nombre, ahoraChileSQL(), id]);
}

export async function restaurarCostoAsociado(negocioId: number, id: number, actor: ActorL): Promise<void> {
  await costoDe(negocioId, id);
  await pool.query(`UPDATE auditor_costo_asociado SET anulado = 0, comentario_anulacion = NULL, actualizado_por = ?, actualizado_por_nombre = ?, actualizado_at = ? WHERE id = ?`,
    [actor.id, actor.nombre, ahoraChileSQL(), id]);
}
