// Aplica migration-152: columna ya_comprada en compras_compra_rapida. Idempotente.
// Uso: node scripts/aplicar-migration-152.mjs
import mysql from 'mysql2/promise';
import { readFileSync, existsSync } from 'node:fs';
const env = { ...process.env };
for (const a of ['.env.local', '.env']) { if (!existsSync(a)) continue;
  for (const l of readFileSync(a, 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim(); } break; }
if (!env.DB_HOST) { console.error('\n  Falta DB_HOST.\n'); process.exit(1); }
const pool = mysql.createPool({ host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000 });
const [cols] = await pool.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'compras_compra_rapida'`);
if (cols.length === 0) { console.error('\n  Falta aplicar antes la migración 151 (node scripts/aplicar-migration-151.mjs).\n'); process.exit(1); }
if (cols.some(c => c.COLUMN_NAME === 'ya_comprada')) console.log('La columna ya_comprada ya existe.');
else {
  const sql = readFileSync('docs/migration-152-compras-compra-rapida-ya-comprada.sql', 'utf8').split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  await pool.query(sql);
  console.log('Columna ya_comprada agregada.');
}
await pool.end();
