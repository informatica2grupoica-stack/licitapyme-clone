// Aplica migration-74: ocultar un negocio de la bandeja de Aprobaciones sin tocar nada más.
//
// POR QUÉ (21-ago-2026): el botón "Eliminar" de /aprobaciones usaba el DELETE de
// /api/negocios/[id] (activo = FALSE), que saca el negocio de TODA la app, no solo de
// Aprobaciones. Esta columna reemplaza eso: solo la lee construirBandeja(). Ver
// docs/migration-74-aprobaciones-ocultar.sql.
//
// Idempotente: comprueba columna por columna.
// Uso: node scripts/aplicar-migration-74.mjs
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

const TABLA = 'negocios';
const COLUMNAS = {
  oculto_aprobaciones:     'TINYINT(1) NOT NULL DEFAULT 0',
  oculto_aprobaciones_por: 'INT            NULL DEFAULT NULL',
  oculto_aprobaciones_at:  'DATETIME       NULL DEFAULT NULL',
};

try {
  const [existentes] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`, [env.DB_NAME, TABLA]);
  const ya = new Set(existentes.map(r => r.COLUMN_NAME));
  const faltan = Object.entries(COLUMNAS).filter(([c]) => !ya.has(c));

  if (!faltan.length) {
    console.log('\n  Ya aplicada (las 3 columnas existen). Nada que hacer.');
  } else {
    console.log(`\n  Aplicando migration-74 (${faltan.length} columna(s))...`);
    const t = performance.now();
    await pool.query(`ALTER TABLE ${TABLA} ${faltan.map(([c, d]) => `ADD COLUMN ${c} ${d}`).join(', ')}`);
    console.log(`    OK en ${Math.round(performance.now() - t)} ms`);
  }

  const [chk] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA=? AND TABLE_NAME=?
        AND COLUMN_NAME IN ('oculto_aprobaciones','oculto_aprobaciones_por','oculto_aprobaciones_at')`,
    [env.DB_NAME, TABLA]);
  console.log(`  Verificación: ${chk.length}/3 columnas presentes\n`);
  if (chk.length !== 3) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
