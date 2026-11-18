// app/lib/cv/viabilidad-empresa.ts — configuración de la Viabilidad IA por empresa-cliente (migration-201). Servidor.
// Solo clientes: Grupo ICA tiene su propia configuración (viabilidad_config) y no pasa por aquí.
import pool from '@/app/lib/db';
import { type ConfigViabilidadEmpresa, CONFIG_EMPRESA_POR_DEFECTO, esModoCalce, normalizarConfigEmpresa } from '@/app/lib/cv/viabilidad-empresa-core';
import { olvidarConfigViabilidad } from '@/app/lib/cv/v4/cargar-config';

export async function leerConfigEmpresa(clienteId: number): Promise<ConfigViabilidadEmpresa> {
  try {
    const [rows] = await pool.query('SELECT config FROM cliente_viabilidad_config WHERE cliente_id = ? LIMIT 1', [clienteId]);
    return normalizarConfigEmpresa((rows as Array<{ config: unknown }>)[0]?.config);
  } catch { return { ...CONFIG_EMPRESA_POR_DEFECTO }; } // sin migration-201: valores por defecto
}

/** Guarda solo lo que viene (y es válido), conservando el resto. `minimo_neto: null` vuelve al valor por defecto del sistema. */
export async function guardarConfigEmpresa(clienteId: number, cambio: { minimo_neto?: unknown; calce?: unknown }): Promise<{ ok: true; config: ConfigViabilidadEmpresa } | { ok: false; error: string }> {
  if (clienteId === 1) return { ok: false, error: 'Grupo ICA usa su propia configuración.' };
  if (cambio.calce !== undefined && !esModoCalce(cambio.calce)) return { ok: false, error: 'Opción de calce no válida.' };
  if (cambio.minimo_neto !== undefined && cambio.minimo_neto !== null && cambio.minimo_neto !== '' && !(Number.isFinite(Number(cambio.minimo_neto)) && Number(cambio.minimo_neto) >= 0))
    return { ok: false, error: 'El presupuesto mínimo tiene que ser un monto en pesos (0 o más).' };
  const actual = await leerConfigEmpresa(clienteId);
  const nueva = normalizarConfigEmpresa({
    minimo_neto: cambio.minimo_neto === undefined ? actual.minimo_neto : (cambio.minimo_neto === '' ? null : cambio.minimo_neto),
    calce: cambio.calce === undefined ? actual.calce : cambio.calce,
  });
  await pool.query(
    'INSERT INTO cliente_viabilidad_config (cliente_id, config) VALUES (?, ?) ON DUPLICATE KEY UPDATE config = VALUES(config)',
    [clienteId, JSON.stringify(nueva)]);
  olvidarConfigViabilidad(clienteId);
  return { ok: true, config: nueva };
}
