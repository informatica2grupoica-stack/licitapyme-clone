// Aplica migration-146: ensancha compras_aprobacion.estado y repara los 'APROBADA_CON_MODIFICACIO' cortados.
// Uso: node scripts/aplicar-migration-146.mjs
import mysql from 'mysql2/promise';
import { readFileSync, existsSync } from 'node:fs';
const env = { ...process.env };
for (const a of ['.env.local', '.env']) { if (!existsSync(a)) continue;
  for (const l of readFileSync(a, 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim(); } break; }
if (!env.DB_HOST) { console.error('\n  Falta DB_HOST.\n'); process.exit(1); }
const pool = mysql.createPool({ host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000 });
await pool.query(`ALTER TABLE compras_aprobacion MODIFY estado VARCHAR(40) NOT NULL DEFAULT 'PENDIENTE'`);
const [r] = await pool.query(`UPDATE compras_aprobacion SET estado = 'APROBADA_CON_MODIFICACION' WHERE estado = 'APROBADA_CON_MODIFICACIO'`);
console.log(`Columna ensanchada. Filas reparadas: ${r.affectedRows}`);
await pool.end();
