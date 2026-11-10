// Informe de viabilidad de una licitación PARA UNA EMPRESA (cliente). Lo lee Costeo (y lo que cuelga de él) sin saber de qué motor viene.
//  · Grupo ICA (cliente 1): `viabilidad_licitacion.informe_ejecutivo` → `_informe_ia_v3` (activo) o `_informe_ia` (v2, respaldo).
//  · Cualquier otra empresa: `cliente_viabilidad_v4.informe` (copia del motor v4 de ICA; mismo esquema, sin el envoltorio `_informe_ia_v3`).
// Nunca mezcla: una empresa-cliente jamás lee la fila de ICA aunque la licitación tenga el mismo código.
import pool from '@/app/lib/db';
import { CLIENTE_ICA } from '@/app/lib/tenant';

function aObjeto(v: unknown): any | null {
  if (v == null) return null;
  try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; }
}

export async function leerInformeViabilidad(codigo: string, clienteId: number): Promise<any | null> {
  if (clienteId === CLIENTE_ICA) {
    const [rows] = await pool.query(`SELECT informe_ejecutivo FROM viabilidad_licitacion WHERE licitacion_codigo = ? LIMIT 1`, [codigo]);
    const ie = aObjeto((rows as any[])[0]?.informe_ejecutivo);
    return ie?._informe_ia_v3 ?? ie?._informe_ia ?? null;
  }
  const [rows] = await pool.query(`SELECT informe FROM cliente_viabilidad_v4 WHERE cliente_id = ? AND licitacion_codigo = ? LIMIT 1`, [clienteId, codigo]);
  return aObjeto((rows as any[])[0]?.informe);
}

/** Cuándo se guardó el informe de esa empresa (para saber si el checklist quedó viejo). */
export async function fechaInformeViabilidad(codigo: string, clienteId: number): Promise<Date | null> {
  const [rows] = clienteId === CLIENTE_ICA
    ? await pool.query(`SELECT updated_at AS f FROM viabilidad_licitacion WHERE licitacion_codigo = ? LIMIT 1`, [codigo])
    : await pool.query(`SELECT created_at AS f FROM cliente_viabilidad_v4 WHERE cliente_id = ? AND licitacion_codigo = ? LIMIT 1`, [clienteId, codigo]);
  const f = (rows as any[])[0]?.f;
  return f ? new Date(f) : null;
}
