// app/lib/opciones-empresa.ts — opciones de funcionamiento de cada empresa (migration-200). Servidor.
import pool from '@/app/lib/db';
import { type ModoAprobacion, type OpcionesEmpresa, aprobacionRequerida, normalizarOpciones, esModoAprobacion, esRecargoValido } from '@/app/lib/opciones-empresa-core';

export async function leerOpciones(clienteId: number): Promise<OpcionesEmpresa> {
  try {
    const [rows] = await pool.query('SELECT config_json FROM clientes WHERE id = ? LIMIT 1', [clienteId]);
    return normalizarOpciones((rows as Array<{ config_json: unknown }>)[0]?.config_json);
  } catch { return normalizarOpciones(null); } // sin migration-200: valores por defecto
}

/** Guarda solo lo que viene (y es válido), conservando el resto. */
export async function guardarOpciones(clienteId: number, cambio: { aprobaciones_auditor?: unknown; recargo_costeo?: unknown }): Promise<{ ok: true; opciones: OpcionesEmpresa } | { ok: false; error: string }> {
  if (cambio.aprobaciones_auditor !== undefined && !esModoAprobacion(cambio.aprobaciones_auditor)) return { ok: false, error: 'Opción no válida.' };
  // null = volver al recargo del sistema; undefined = no se está cambiando.
  if (cambio.recargo_costeo !== undefined && cambio.recargo_costeo !== null && !esRecargoValido(cambio.recargo_costeo)) return { ok: false, error: 'El recargo debe ser un número entre 0 y 300.' };
  const actual = await leerOpciones(clienteId);
  const nuevas: OpcionesEmpresa = {
    ...actual,
    ...(esModoAprobacion(cambio.aprobaciones_auditor) ? { aprobaciones_auditor: cambio.aprobaciones_auditor as ModoAprobacion } : {}),
    ...(cambio.recargo_costeo !== undefined ? { recargo_costeo: cambio.recargo_costeo as number | null } : {}),
  };
  await pool.query('UPDATE clientes SET config_json = ? WHERE id = ?', [JSON.stringify(nuevas), clienteId]);
  return { ok: true, opciones: nuevas };
}

/** ¿El Auditor de esta empresa pide aprobación ahora mismo? (según su opción y cuántos usuarios activos tiene). */
export async function aprobacionesAuditorActivas(clienteId: number): Promise<boolean> {
  if (clienteId === 1) return true;
  const o = await leerOpciones(clienteId);
  if (o.aprobaciones_auditor !== 'auto') return aprobacionRequerida(o.aprobaciones_auditor, 0, clienteId);
  const [rows] = await pool.query('SELECT COUNT(*) AS n FROM usuarios WHERE cliente_id = ? AND activo = TRUE', [clienteId]);
  return aprobacionRequerida('auto', Number((rows as Array<{ n: number }>)[0]?.n ?? 0), clienteId);
}
