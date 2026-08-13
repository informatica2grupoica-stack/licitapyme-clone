// Aplica migration-68: tabla viabilidad_jobs (estado del análisis IA persistido en BD, sobrevive reinicios).
// Uso: node scripts/aplicar-migration-68.mjs
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
  const [[tablaYaExiste]] = await pool.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='viabilidad_jobs'`, [env.DB_NAME]);

  if (tablaYaExiste.n > 0) {
    console.log('\n  Ya aplicada (viabilidad_jobs existe). Nada que hacer.\n');
  } else {
    console.log('\n  Aplicando migration-68 (viabilidad_jobs)...');
    const sql = readFileSync('docs/migration-68-viabilidad-jobs.sql', 'utf8').replace(/--.*$/gm, '');
    const sentencias = sql.split(';').map(s => s.trim()).filter(Boolean);
    const t = performance.now();
    for (const s of sentencias) await pool.query(s);
    console.log(`    OK (${sentencias.length} sentencia(s)) en ${Math.round(performance.now() - t)} ms`);
  }

  const [[chk]] = await pool.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='viabilidad_jobs'`, [env.DB_NAME]);
  console.log(`  Verificación: viabilidad_jobs = ${chk.n > 0 ? 'SÍ' : 'NO'}\n`);
  if (chk.n === 0) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
