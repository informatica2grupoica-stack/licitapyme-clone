// Aplica migration-77: número de página de la grilla de anexos de oferta.
// Uso: node scripts/aplicar-migration-77.mjs
// Idempotente: esta versión de MySQL (Bluehost) no soporta ADD COLUMN IF NOT EXISTS, así que se
// comprueba antes contra INFORMATION_SCHEMA (misma disciplina que las migraciones 51 y 59).
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
  const [[col]] = await pool.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA=? AND TABLE_NAME='oferta_competencia_documento'
        AND COLUMN_NAME='pagina_grilla'`, [env.DB_NAME]);
  if (col.n > 0) {
    console.log('\n  pagina_grilla ya existe — nada que hacer.\n');
  } else {
    await pool.query(`ALTER TABLE oferta_competencia_documento
      ADD COLUMN pagina_grilla INT NOT NULL DEFAULT 1`);
    console.log('\n  OK: columna pagina_grilla agregada.\n');
  }
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally {
  await pool.end();
}
