// Aplica migration-155: columna adjudicacion_cache.readjudicada_en.
// Uso: node scripts/aplicar-migration-155.mjs
import mysql from 'mysql2/promise';
import { readFileSync, existsSync } from 'node:fs';

const env = { ...process.env };
for (const archivo of ['.env.local', '.env']) {
  if (!existsSync(archivo)) continue;
  for (const line of readFileSync(archivo, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  break;
}
if (!env.DB_HOST) { console.error('\n  Falta DB_HOST.\n'); process.exit(1); }

const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000,
});

const existe = async () => (await pool.query(
  `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='adjudicacion_cache' AND COLUMN_NAME='readjudicada_en'`, [env.DB_NAME]))[0][0].n > 0;

try {
  console.log('\n  Aplicando migration-155 (readjudicada_en)...');
  if (await existe()) console.log('    ya existe — se salta el ALTER.');
  else await pool.query('ALTER TABLE adjudicacion_cache ADD COLUMN readjudicada_en VARCHAR(64) NULL');
  const ok = await existe();
  console.log(`  Verificación: adjudicacion_cache.readjudicada_en = ${ok ? 'SÍ' : 'NO'}\n`);
  if (!ok) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
