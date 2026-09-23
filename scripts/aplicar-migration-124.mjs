// Aplica migration-124: columna reportes_error.solucion_visible (solución visible para el perfil o solo admin).
// Ver docs/migration-124-reportes-error-solucion-visible.sql. Idempotente. Uso: node scripts/aplicar-migration-124.mjs
import mysql from 'mysql2/promise';
import { readFileSync, existsSync } from 'node:fs';

const env = { ...process.env };
for (const archivo of ['.env.local', '.env']) {
  if (!existsSync(archivo)) continue;
  for (const line of readFileSync(archivo, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  break;
}
if (!env.DB_HOST) { console.error('\n  Falta DB_HOST.\n'); process.exit(1); }

const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000,
});

const existe = async (sql, params) => { const [[r]] = await pool.query(sql, params); return r.n > 0; };

try {
  console.log('\n  Aplicando migration-124 (reportes_error.solucion_visible)...');
  const col = `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='reportes_error' AND COLUMN_NAME='solucion_visible'`;
  if (await existe(col, [env.DB_NAME])) {
    console.log('    solucion_visible ya existía');
  } else {
    await pool.query(`ALTER TABLE reportes_error ADD COLUMN solucion_visible TINYINT(1) NOT NULL DEFAULT 1 AFTER solucion`);
    console.log('    ADD COLUMN solucion_visible OK');
  }
  const ok = await existe(col, [env.DB_NAME]);
  console.log(`  Verificación: columna = ${ok ? 'SÍ' : 'NO'}\n`);
  if (!ok) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
