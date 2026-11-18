// app/lib/cv/v4/cargar-config.ts
// Configuración de la viabilidad de las EMPRESAS-CLIENTE (copia propia: Grupo ICA usa app/lib/viabilidad-v4/cargar-config.ts y su fila 'v4').
// Para un cliente: valores por defecto ← lo que esa empresa cambió (tabla cliente_viabilidad_config, migration-201). NO se usa la fila 'v4' de
// ICA: esa es la calibración de Grupo ICA. Si la tabla no existe o la fila está mal, se usa el default y el análisis nunca se cae.
import pool from '@/app/lib/db';
import { CONFIG_V4_DEFAULT, type ConfigViabilidadV4 } from '@/app/lib/cv/v4/config';
import { normalizarConfigEmpresa } from '@/app/lib/cv/viabilidad-empresa-core';

const cache = new Map<number, { cfg: ConfigViabilidadV4; t: number }>();
const TTL_MS = 30_000;

export function olvidarConfigViabilidad(clienteId: number) { cache.delete(clienteId); }

export async function cargarConfigViabilidad(clienteId = 0): Promise<ConfigViabilidadV4> {
  const c = cache.get(clienteId);
  if (c && Date.now() - c.t < TTL_MS) return c.cfg;
  let cfg = CONFIG_V4_DEFAULT;
  if (clienteId) {
    try {
      const [rows] = await pool.query('SELECT config FROM cliente_viabilidad_config WHERE cliente_id = ? LIMIT 1', [clienteId]);
      const raw = (rows as Array<{ config: unknown }>)[0]?.config;
      const propia = normalizarConfigEmpresa(raw);
      if (propia.minimo_neto != null) cfg = { ...cfg, minimo_neto: propia.minimo_neto };
    } catch (e) {
      console.warn('[viabilidad-cliente] configuración de la empresa no disponible, se usan los valores por defecto:', String(e).slice(0, 120));
    }
  }
  cache.set(clienteId, { cfg, t: Date.now() });
  return cfg;
}
