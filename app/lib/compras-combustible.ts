// app/lib/compras-combustible.ts
// Capa de base de datos del gasto extra «Combustible» (reglas puras en compras-combustible-core.ts; tabla en migration-202).
// Sin la migración todo lo demás de Compras sigue funcionando: las funciones devuelven vacío o avisan qué falta aplicar.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { normalizarPatente, validarCarga, type CargaCombustible, type TipoCombustible } from '@/app/lib/compras-combustible-core';

let tablaLista: Promise<boolean> | null = null;
export function hayTablaCombustible(): Promise<boolean> {
  tablaLista ??= pool.query(`SHOW TABLES LIKE 'compras_combustible_carga'`)
    .then(([r]) => (r as any[]).length > 0).catch(() => { tablaLista = null; return false; });
  return tablaLista;
}

export interface CargaGuardada extends CargaCombustible { productoId: number; negocioId: number; createdAt: string }

function filaACarga(r: any): CargaGuardada {
  return {
    productoId: Number(r.producto_id), negocioId: Number(r.negocio_id), tipo: r.tipo_combustible as TipoCombustible,
    litros: Number(r.litros), netoAfecto: Number(r.neto_afecto), impuestoEspecifico: Number(r.impuesto_especifico),
    patente: r.patente ?? null, createdAt: String(r.created_at),
  };
}

export async function guardarCarga(negocioId: number, productoId: number, c: CargaCombustible): Promise<void> {
  const error = validarCarga(c);
  if (error) throw new Error(error);
  if (!(await hayTablaCombustible())) throw new Error('Falta aplicar la migración 202 (node scripts/aplicar-migration-202.mjs) para el combustible.');
  await pool.query(
    `INSERT INTO compras_combustible_carga (producto_id, negocio_id, tipo_combustible, litros, neto_afecto, impuesto_especifico, patente, created_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE tipo_combustible = VALUES(tipo_combustible), litros = VALUES(litros), neto_afecto = VALUES(neto_afecto),
       impuesto_especifico = VALUES(impuesto_especifico), patente = VALUES(patente)`,
    [productoId, negocioId, c.tipo, c.litros, c.netoAfecto, c.impuestoEspecifico, normalizarPatente(c.patente), ahoraChileSQL()],
  );
}

/** Cargas por producto (servicio) de Compras; vacío si la migración no está aplicada. */
export async function cargasDeProductos(productoIds: number[]): Promise<Map<number, CargaGuardada>> {
  const out = new Map<number, CargaGuardada>();
  if (productoIds.length === 0 || !(await hayTablaCombustible())) return out;
  const [rows] = await pool.query(`SELECT * FROM compras_combustible_carga WHERE producto_id IN (?)`, [productoIds]) as any;
  for (const r of rows as any[]) out.set(Number(r.producto_id), filaACarga(r));
  return out;
}

export async function cargasDeNegocio(negocioId: number): Promise<CargaGuardada[]> {
  if (!(await hayTablaCombustible())) return [];
  const [rows] = await pool.query(`SELECT * FROM compras_combustible_carga WHERE negocio_id = ? ORDER BY created_at`, [negocioId]) as any;
  return (rows as any[]).map(filaACarga);
}

/** Cargas anteriores de TODA la empresa-cliente de este negocio (para avisar un precio por litro raro). */
export async function cargasPreviasParaAvisos(negocioId: number): Promise<Array<{ tipo: string; litros: number; netoAfecto: number; impuestoEspecifico: number }>> {
  if (!(await hayTablaCombustible())) return [];
  const [rows] = await pool.query(
    `SELECT c.tipo_combustible, c.litros, c.neto_afecto, c.impuesto_especifico
       FROM compras_combustible_carga c
       JOIN negocios n ON n.id = c.negocio_id
      WHERE n.cliente_id = (SELECT cliente_id FROM negocios WHERE id = ? LIMIT 1)
      ORDER BY c.created_at DESC LIMIT 60`, [negocioId]) as any;
  return (rows as any[]).map(r => ({ tipo: r.tipo_combustible, litros: Number(r.litros), netoAfecto: Number(r.neto_afecto), impuestoEspecifico: Number(r.impuesto_especifico) }));
}

export async function borrarCarga(productoId: number): Promise<void> {
  if (!(await hayTablaCombustible())) return;
  await pool.query(`DELETE FROM compras_combustible_carga WHERE producto_id = ?`, [productoId]);
}
