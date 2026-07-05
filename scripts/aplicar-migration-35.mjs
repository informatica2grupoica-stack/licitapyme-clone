// Aplica migration-35: crea la tabla adjudicacion_cache (cache del resultado de
// adjudicación de Mercado Público, usada por /api/licitacion-adjudicacion).
// Uso: node scripts/aplicar-migration-35.mjs
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000,
});

try {
  console.log('\n  Creando tabla adjudicacion_cache...');
  const sql = readFileSync('docs/migration-35-adjudicacion-cache.sql', 'utf8')
    .replace(/--.*$/gm, ''); // quitar comentarios (el driver no acepta multi-statement)
  const t = performance.now();
  await pool.query(sql);
  console.log(`    OK en ${Math.round(performance.now() - t)} ms`);

  const [[chk]] = await pool.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='adjudicacion_cache'`, [env.DB_NAME]);
  console.log(`  Verificación: tabla existe = ${chk.n === 1 ? 'SÍ' : 'NO'}\n`);
  if (chk.n !== 1) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
