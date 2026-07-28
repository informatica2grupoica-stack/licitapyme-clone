// Aplica migration-51: identidad de empresas (logo/firma/timbre) + tabla empresa_documentos
// (certificados/experiencia). Uso: node scripts/aplicar-migration-51.mjs
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
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='empresas' AND COLUMN_NAME='logo_url'`, [env.DB_NAME]);
  const [[tablaYaExiste]] = await pool.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='empresa_documentos'`, [env.DB_NAME]);

  if (colYaExiste.n > 0 && tablaYaExiste.n > 0) {
    console.log('\n  Ya aplicada (columnas de identidad + tabla empresa_documentos existen). Nada que hacer.\n');
  } else {
    console.log('\n  Aplicando migration-51 (identidad de empresas + empresa_documentos)...');
    const sql = readFileSync('docs/migration-51-empresas-identidad.sql', 'utf8').replace(/--.*$/gm, '');
    // Varias sentencias separadas por ';' — se ejecutan una a una (sin depender de
    // multipleStatements, que no está habilitado en el pool del proyecto).
    const sentencias = sql.split(';').map(s => s.trim()).filter(Boolean);
    const t = performance.now();
    for (const s of sentencias) await pool.query(s);
    console.log(`    OK (${sentencias.length} sentencia(s)) en ${Math.round(performance.now() - t)} ms`);
  }

  const [[chkCol]] = await pool.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='empresas' AND COLUMN_NAME='logo_url'`, [env.DB_NAME]);
  const [[chkTabla]] = await pool.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='empresa_documentos'`, [env.DB_NAME]);
  console.log(`  Verificación: columnas de identidad = ${chkCol.n === 1 ? 'SÍ' : 'NO'} · tabla empresa_documentos = ${chkTabla.n === 1 ? 'SÍ' : 'NO'}\n`);
  if (chkCol.n !== 1 || chkTabla.n !== 1) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
