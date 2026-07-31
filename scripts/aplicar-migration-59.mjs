// Aplica migration-59: ofertas de la competencia (Frente F.2 — Evaluación en línea).
// Uso: node scripts/aplicar-migration-59.mjs
//
// Idempotente y granular: las tablas van con CREATE TABLE IF NOT EXISTS, y cada ALTER sobre
// licitacion_apertura se comprueba antes contra INFORMATION_SCHEMA — esta versión de MySQL
// (Bluehost) NO soporta "ADD COLUMN IF NOT EXISTS" (verificado con la migración 51).
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

const COLUMNAS = [
  ['ofertas_leidas_en',   'DATETIME DEFAULT NULL'],
  ['ofertas_encontradas', 'INT NOT NULL DEFAULT 0'],
  ['ofertas_intentos',    'INT NOT NULL DEFAULT 0'],
  ['ofertas_diagnostico', 'VARCHAR(400) DEFAULT NULL'],
];

try {
  // 1) Las dos tablas nuevas (el SQL del archivo, sin los ALTER).
  const sql = readFileSync('docs/migration-59-ofertas-competencia.sql', 'utf8').replace(/--.*$/gm, '');
  const creates = sql.split(';').map(s => s.trim()).filter(s => /^CREATE TABLE/i.test(s));
  console.log('\n  Creando tablas de ofertas...');
  for (const s of creates) await pool.query(s);
  console.log(`    OK (${creates.length} tabla(s))`);

  // 2) Columnas de estado en licitacion_apertura (una por una, solo las que falten).
  const [[apExiste]] = await pool.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA=? AND TABLE_NAME='licitacion_apertura'`, [env.DB_NAME]);
  if (apExiste.n === 0) {
    console.log('\n  AVISO: licitacion_apertura no existe — aplica antes migration-41.\n');
    process.exitCode = 1;
  } else {
    for (const [col, def] of COLUMNAS) {
      const [[ya]] = await pool.query(
        `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA=? AND TABLE_NAME='licitacion_apertura' AND COLUMN_NAME=?`,
        [env.DB_NAME, col]);
      if (ya.n > 0) { console.log(`    ${col}: ya existía`); continue; }
      await pool.query(`ALTER TABLE licitacion_apertura ADD COLUMN ${col} ${def}`);
      console.log(`    ${col}: agregada`);
    }
  }

  const [[chk]] = await pool.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA=? AND TABLE_NAME IN ('oferta_competencia','oferta_competencia_documento')`,
    [env.DB_NAME]);
  console.log(`\n  Verificación: ${chk.n}/2 tablas (oferta_competencia, oferta_competencia_documento)\n`);
  if (chk.n < 2) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally {
  await pool.end();
}
