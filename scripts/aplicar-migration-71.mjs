// Aplica migration-71: columnas de costo de IA en auditor_tecnico_jobs.
//
// POR QUÉ (19-ago-2026): la comparación masiva del Auditor Técnico son 88 llamadas a glm-5.2 —
// la operación más cara del sistema. El gasto real quedaba solo en el log del contenedor.
// Ver docs/migration-71-auditor-tecnico-costo.sql.
//
// Idempotente: comprueba columna por columna, así que se puede correr sobre una tabla a medio migrar.
// Uso: node scripts/aplicar-migration-71.mjs
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

const COLUMNAS = {
  llamadas_ia: 'INT           NOT NULL DEFAULT 0',
  tokens_in:   'BIGINT        NOT NULL DEFAULT 0',
  tokens_out:  'BIGINT        NOT NULL DEFAULT 0',
  costo_usd:   'DECIMAL(10,5) NOT NULL DEFAULT 0',
};

try {
  const [[tabla]] = await pool.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA=? AND TABLE_NAME='auditor_tecnico_jobs'`, [env.DB_NAME]);
  if (tabla.n === 0) {
    console.error('\n  Falta auditor_tecnico_jobs. Corre antes: node scripts/aplicar-migration-70.mjs\n');
    process.exitCode = 1;
  } else {
    const [existentes] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA=? AND TABLE_NAME='auditor_tecnico_jobs'`, [env.DB_NAME]);
    const ya = new Set(existentes.map(r => r.COLUMN_NAME));
    const faltan = Object.entries(COLUMNAS).filter(([c]) => !ya.has(c));

    if (!faltan.length) {
      console.log('\n  Ya aplicada (las 4 columnas de costo existen). Nada que hacer.\n');
    } else {
      console.log(`\n  Aplicando migration-71 (${faltan.length} columna(s))...`);
      const t = performance.now();
      await pool.query(`ALTER TABLE auditor_tecnico_jobs ${faltan.map(([c, d]) => `ADD COLUMN ${c} ${d}`).join(', ')}`);
      console.log(`    OK en ${Math.round(performance.now() - t)} ms`);
    }

    const [chk] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA=? AND TABLE_NAME='auditor_tecnico_jobs'
          AND COLUMN_NAME IN ('llamadas_ia','tokens_in','tokens_out','costo_usd')`, [env.DB_NAME]);
    console.log(`  Verificación: ${chk.length}/4 columnas de costo presentes\n`);
    if (chk.length !== 4) process.exitCode = 1;
  }
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
