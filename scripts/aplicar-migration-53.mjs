// Aplica migration-53: tabla checklist_comercial_costeo (Motor Comercial, Fase 4).
// Uso: node scripts/aplicar-migration-53.mjs
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
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='checklist_comercial_costeo'`, [env.DB_NAME]);

  if (tablaYaExiste.n > 0) {
    console.log('\n  Ya aplicada (checklist_comercial_costeo existe). Nada que hacer.\n');
  } else {
    console.log('\n  Aplicando migration-53 (checklist_comercial_costeo)...');
    const sql = readFileSync('docs/migration-53-motor-comercial-costeo.sql', 'utf8').replace(/--.*$/gm, '');
    const sentencias = sql.split(';').map(s => s.trim()).filter(Boolean);
    const t = performance.now();
    for (const s of sentencias) await pool.query(s);
    console.log(`    OK (${sentencias.length} sentencia(s)) en ${Math.round(performance.now() - t)} ms`);
  }

  const [[chk]] = await pool.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='checklist_comercial_costeo'`, [env.DB_NAME]);
  console.log(`  Verificación: checklist_comercial_costeo = ${chk.n > 0 ? 'SÍ' : 'NO'}\n`);
  if (chk.n === 0) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
