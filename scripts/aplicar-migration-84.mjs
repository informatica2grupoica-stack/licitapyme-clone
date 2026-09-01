// Aplica migration-84: tabla empresa_firmas (varias firmas por empresa) + backfill de la firma
// única que ya tenía cada empresa. Uso: node scripts/aplicar-migration-84.mjs
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

const tablaExiste = async () => {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'empresa_firmas'`, [env.DB_NAME]);
  return r.n > 0;
};

try {
  console.log(`\n  Aplicando migration-84 (empresa_firmas)...`);
  // El CREATE TABLE es IF NOT EXISTS y el INSERT del backfill tiene su propio NOT EXISTS, así que
  // correr esto dos veces no duplica nada — igual que el resto de los aplicadores del proyecto.
  const sql = readFileSync('docs/migration-84-empresa-firmas.sql', 'utf8');
  const sentencias = sql
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    .split(';').map(s => s.trim()).filter(Boolean);
  const t = performance.now();
  for (const s of sentencias) await pool.query(s);
  console.log(`    OK (${sentencias.length} sentencia(s)) en ${Math.round(performance.now() - t)} ms`);

  const ok = await tablaExiste();
  const [[cuenta]] = ok
    ? await pool.query(`SELECT COUNT(*) AS n FROM empresa_firmas`)
    : [[{ n: 0 }]];
  console.log(`  Verificación: tabla empresa_firmas = ${ok ? 'SÍ' : 'NO'} · firmas cargadas = ${cuenta.n}\n`);
  if (!ok) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
