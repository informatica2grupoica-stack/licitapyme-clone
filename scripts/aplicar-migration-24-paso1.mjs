// Aplica SOLO el Paso 1 de migration-24: alinea prefiltro_licitacion.licitacion_codigo
// a VARCHAR(100) utf8mb4_general_ci (arregla el JOIN lento del radar).
// Uso: node scripts/aplicar-migration-24-paso1.mjs
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
  console.log('\n  Antes:');
  const [[a]] = await pool.query(
    `SELECT COLUMN_TYPE, COLLATION_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='prefiltro_licitacion' AND COLUMN_NAME='licitacion_codigo'`, [env.DB_NAME]);
  console.log(`    prefiltro_licitacion.licitacion_codigo = ${a.COLUMN_TYPE} ${a.COLLATION_NAME}`);

  console.log('\n  Ejecutando ALTER...');
  const t = performance.now();
  await pool.query(
    `ALTER TABLE prefiltro_licitacion
       MODIFY COLUMN licitacion_codigo VARCHAR(100)
       CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL`);
  console.log(`    OK en ${Math.round(performance.now() - t)} ms`);

  console.log('\n  Después:');
  const [[b]] = await pool.query(
    `SELECT COLUMN_TYPE, COLLATION_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='prefiltro_licitacion' AND COLUMN_NAME='licitacion_codigo'`, [env.DB_NAME]);
  console.log(`    prefiltro_licitacion.licitacion_codigo = ${b.COLUMN_TYPE} ${b.COLLATION_NAME}`);
  console.log('');
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
