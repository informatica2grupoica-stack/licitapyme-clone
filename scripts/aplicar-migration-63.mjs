// Aplica migration-63: titular de la cuenta bancaria (banco_titular_nombre, banco_titular_rut)
// en `empresas`.
// Uso: node scripts/aplicar-migration-63.mjs
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
  const [[colYaExiste]] = await pool.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='empresas' AND COLUMN_NAME='banco_titular_nombre'`, [env.DB_NAME]);

  if (colYaExiste.n > 0) {
    console.log('\n  Ya aplicada (columnas de titular de cuenta existen en empresas). Nada que hacer.\n');
  } else {
    console.log('\n  Aplicando migration-63 (titular de la cuenta bancaria)...');
    const sql = readFileSync('docs/migration-63-empresas-titular-cuenta.sql', 'utf8').replace(/--.*$/gm, '');
    const sentencias = sql.split(';').map(s => s.trim()).filter(Boolean);
    const t = performance.now();
    for (const s of sentencias) await pool.query(s);
    console.log(`    OK (${sentencias.length} sentencia(s)) en ${Math.round(performance.now() - t)} ms`);
  }

  const [[chkCol]] = await pool.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='empresas' AND COLUMN_NAME='banco_titular_nombre'`, [env.DB_NAME]);
  console.log(`  Verificación: columna banco_titular_nombre = ${chkCol.n === 1 ? 'SÍ' : 'NO'}\n`);
  if (chkCol.n !== 1) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
