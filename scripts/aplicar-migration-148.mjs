// Aplica migration-148: columnas de corrección en compras_aprobacion_linea. Idempotente.
// Uso: node scripts/aplicar-migration-148.mjs
import mysql from 'mysql2/promise';
import { readFileSync, existsSync } from 'node:fs';
const env = { ...process.env };
for (const a of ['.env.local', '.env']) { if (!existsSync(a)) continue;
  for (const l of readFileSync(a, 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim(); } break; }
if (!env.DB_HOST) { console.error('\n  Falta DB_HOST.\n'); process.exit(1); }
const pool = mysql.createPool({ host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000 });
const [cols] = await pool.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'compras_aprobacion_linea'`);
if (cols.length === 0) { console.error('Falta la tabla: aplica antes scripts/aplicar-migration-147.mjs'); process.exit(1); }
if (cols.some(c => c.COLUMN_NAME === 'nota_correccion')) console.log('Ya estaba aplicada.');
else {
  const sql = readFileSync('docs/migration-148-compras-aprobacion-linea-correccion.sql', 'utf8').split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  await pool.query(sql);
  console.log('Columnas de corrección agregadas.');
}
await pool.end();
