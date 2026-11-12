// Aplica migration-192: compras_postventa_correccion. Uso: node scripts/aplicar-migration-192.mjs
import mysql from 'mysql2/promise';
import { readFileSync, existsSync } from 'node:fs';

const env = { ...process.env };
for (const archivo of ['.env.local', '.env']) {
  if (!existsSync(archivo)) continue;
  for (const line of readFileSync(archivo, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim();
  }
  break;
}
if (!env.DB_HOST) { console.error('\n  Falta DB_HOST.\n'); process.exit(1); }
const pool = mysql.createPool({ host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000 });
try {
  const sql = readFileSync('docs/migration-192-compras-postventa-correccion.sql', 'utf8')
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n').split(';').map(s => s.trim()).filter(Boolean);
  for (const s of sql) await pool.query(s);
  const [[r]] = await pool.query(`SELECT COUNT(*) n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME='compras_postventa_correccion'`, [env.DB_NAME]);
  console.log(`\n  migration-192: compras_postventa_correccion = ${r.n > 0 ? 'SÍ' : 'NO'}\n`);
  if (r.n === 0) process.exitCode = 1;
} catch (e) { console.error('  Error:', e.message); process.exitCode = 1; } finally { await pool.end(); }
