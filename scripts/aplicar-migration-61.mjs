// Aplica migration-61: acta_documento (anexos de la adjudicación — acta de evaluación, resolución).
// Uso: node scripts/aplicar-migration-61.mjs
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
  const sql = readFileSync('docs/migration-61-acta-documentos.sql', 'utf8').replace(/--.*$/gm, '');
  const sentencias = sql.split(';').map(s => s.trim()).filter(Boolean);
  console.log('\n  Aplicando migration-61 (acta_documento)...');
  for (const s of sentencias) await pool.query(s);

  const [[chk]] = await pool.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA=? AND TABLE_NAME='acta_documento'`, [env.DB_NAME]);
  console.log(`  Verificación: acta_documento ${chk.n ? 'OK' : 'FALTA'}\n`);
  if (!chk.n) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally {
  await pool.end();
}
