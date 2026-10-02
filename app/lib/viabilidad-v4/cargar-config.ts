// app/lib/viabilidad-v4/cargar-config.ts
// Lee la configuración editable de la v4 (fila 'v4' de `viabilidad_config`, migration-137) y la
// mezcla sobre los valores por defecto. Si la tabla no existe o la fila está mal formada, se usa
// el default y se avisa en el log: el análisis nunca se cae por la configuración.
import pool from '@/app/lib/db';
import { CONFIG_V4_DEFAULT, mezclarConfig, type ConfigViabilidadV4 } from '@/app/lib/viabilidad-v4/config';

let cache: { cfg: ConfigViabilidadV4; t: number } | null = null;
const TTL_MS = 60_000;

export async function cargarConfigViabilidad(): Promise<ConfigViabilidadV4> {
  if (cache && Date.now() - cache.t < TTL_MS) return cache.cfg;
  let cfg = CONFIG_V4_DEFAULT;
  try {
    const [rows] = await pool.query(`SELECT valor FROM viabilidad_config WHERE clave = 'v4' LIMIT 1`) as any;
    const raw = (rows as any[])[0]?.valor;
    if (raw) cfg = mezclarConfig(CONFIG_V4_DEFAULT, typeof raw === 'string' ? JSON.parse(raw) : raw);
  } catch (e) {
    console.warn('[viabilidad-v4] configuración editable no disponible, se usan los valores por defecto:', String(e).slice(0, 120));
  }
  cache = { cfg, t: Date.now() };
  return cfg;
}
