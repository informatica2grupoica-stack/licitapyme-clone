// Aplica migration-73: Puente del Radar (bandeja de reparto).
//
// POR QUÉ (20-ago-2026): el asesor empuja licitaciones del radar a una bandeja intermedia y
// después las reparte entre varios perfiles con una regla (equitativa, por carga, por categoría,
// por monto, por región). Ver docs/migration-73-puente-radar.sql.
//
// Idempotente: CREATE TABLE IF NOT EXISTS + verificación final.
// Uso: node scripts/aplicar-migration-73.mjs
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
  multipleStatements: true,
});

const TABLAS = ['puente_radar', 'puente_repartos'];

try {
  const [previas] = await pool.query(
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)`, [env.DB_NAME, TABLAS]);
  const ya = new Set(previas.map(r => r.TABLE_NAME));
  if (ya.size === TABLAS.length) {
    console.log('\n  Ya aplicada (las 2 tablas existen). Nada que hacer.');
  } else {
    console.log(`\n  Aplicando migration-73 (faltan ${TABLAS.length - ya.size} tabla(s))...`);
    const sql = readFileSync('docs/migration-73-puente-radar.sql', 'utf8');
    const t = performance.now();
    await pool.query(sql);
    console.log(`    OK en ${Math.round(performance.now() - t)} ms`);
  }

  const [chk] = await pool.query(
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)`, [env.DB_NAME, TABLAS]);
  for (const t of TABLAS) {
    console.log(`  ${chk.some(r => r.TABLE_NAME === t) ? 'OK  ' : 'FALTA'} ${t}`);
  }
  console.log('');
  if (chk.length !== TABLAS.length) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
