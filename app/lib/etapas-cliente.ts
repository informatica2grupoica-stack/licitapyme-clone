// app/lib/etapas-cliente.ts — etapas de avance propias de cada empresa (migration-199). Servidor.
import pool from '@/app/lib/db';
import { type EtapaPropia, MAX_ETAPAS_POR_EMPRESA, esClaveEtapa, idDeClave, validarEtapa } from '@/app/lib/etapas-core';

export async function listarEtapas(clienteId: number): Promise<EtapaPropia[]> {
  try {
    const [rows] = await pool.query('SELECT id, nombre, color, base, orden FROM etapas_cliente WHERE cliente_id = ? AND activo = 1 ORDER BY orden, id', [clienteId]);
    return (rows as Array<Record<string, unknown>>).map(r => ({ id: Number(r.id), nombre: String(r.nombre), color: String(r.color), base: String(r.base), orden: Number(r.orden) }));
  } catch { return []; } // sin migration-199 todo sigue con las etapas del sistema
}

type Datos = { nombre: string; color: string; base: string };

export async function crearEtapa(clienteId: number, d: Datos): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const err = validarEtapa(d);
  if (err) return { ok: false, error: err };
  const actuales = await listarEtapas(clienteId);
  if (actuales.length >= MAX_ETAPAS_POR_EMPRESA) return { ok: false, error: `Máximo ${MAX_ETAPAS_POR_EMPRESA} etapas propias.` };
  const nombre = d.nombre.trim();
  if (actuales.some(a => a.nombre.toLowerCase() === nombre.toLowerCase())) return { ok: false, error: 'Ya tienes una etapa con ese nombre.' };
  const [r] = await pool.query('INSERT INTO etapas_cliente (cliente_id, nombre, color, base, orden) VALUES (?, ?, ?, ?, ?)',
    [clienteId, nombre, d.color, d.base, actuales.reduce((m, a) => Math.max(m, a.orden), 0) + 1]);
  return { ok: true, id: Number((r as { insertId: number }).insertId) };
}

export async function actualizarEtapa(clienteId: number, id: number, d: Datos): Promise<{ ok: true } | { ok: false; error: string }> {
  const err = validarEtapa(d);
  if (err) return { ok: false, error: err };
  const nombre = d.nombre.trim();
  const actuales = await listarEtapas(clienteId);
  const prev = actuales.find(a => a.id === id);
  if (!prev) return { ok: false, error: 'Esa etapa no existe.' };
  if (actuales.some(a => a.id !== id && a.nombre.toLowerCase() === nombre.toLowerCase())) return { ok: false, error: 'Ya tienes una etapa con ese nombre.' };
  await pool.query('UPDATE etapas_cliente SET nombre = ?, color = ?, base = ? WHERE id = ? AND cliente_id = ?', [nombre, d.color, d.base, id, clienteId]);
  // Si cambió la etapa del sistema a la que equivale, los negocios que estaban en ella pasan a esa base (estado_pipeline y etapa siguen de acuerdo).
  if (prev.base !== d.base) await pool.query('UPDATE negocios SET estado_pipeline = ? WHERE etapa_id = ? AND cliente_id = ?', [d.base, id, clienteId]);
  return { ok: true };
}

/** Mueve una etapa una posición arriba (-1) o abajo (+1). */
export async function moverEtapa(clienteId: number, id: number, delta: -1 | 1): Promise<void> {
  const l = await listarEtapas(clienteId);
  const i = l.findIndex(e => e.id === id), j = i + delta;
  if (i < 0 || j < 0 || j >= l.length) return;
  [l[i], l[j]] = [l[j], l[i]];
  for (let k = 0; k < l.length; k++) await pool.query('UPDATE etapas_cliente SET orden = ? WHERE id = ? AND cliente_id = ?', [k + 1, l[k].id, clienteId]);
}

/** Borra la etapa: los negocios que estaban en ella siguen en su etapa base del sistema. */
export async function borrarEtapa(clienteId: number, id: number): Promise<void> {
  await pool.query('UPDATE negocios SET etapa_id = NULL WHERE etapa_id = ? AND cliente_id = ?', [id, clienteId]);
  await pool.query('UPDATE etapas_cliente SET activo = 0 WHERE id = ? AND cliente_id = ?', [id, clienteId]);
}

/**
 * Traduce lo que manda la pantalla (id de etapa del sistema, o `E<n>`) a { base, etapaId }.
 * Una clave `E<n>` de OTRA empresa o inexistente es inválida: nunca se acepta por id suelto.
 */
export async function resolverClaveEtapa(clienteId: number, clave: string | null | undefined): Promise<{ base: string | null; etapaId: number | null } | { error: string }> {
  if (!clave) return { base: null, etapaId: null };
  if (!esClaveEtapa(clave)) return { base: clave, etapaId: null };
  const e = (await listarEtapas(clienteId)).find(x => x.id === idDeClave(clave));
  if (!e) return { error: 'Esa etapa ya no existe.' };
  return { base: e.base, etapaId: e.id };
}
