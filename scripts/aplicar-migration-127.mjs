// Aplica migration-127: analisis_json en las características + tabla auditor_comparador_linea.
// Ver docs/migration-127-comparador-fichas.sql. Idempotente. Uso: node scripts/aplicar-migration-127.mjs
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

try {
  console.log('\n  Aplicando migration-127 (comparador de fichas)...');
  const [[col]] = await pool.query(
    `SELECT COUNT(*) n FROM information_schema.columns WHERE table_schema = DATABASE()
      AND table_name = 'checklist_comercial_caracteristicas' AND column_name = 'analisis_json'`);
  if (col.n === 0) {
    await pool.query(`ALTER TABLE checklist_comercial_caracteristicas ADD COLUMN analisis_json MEDIUMTEXT NULL DEFAULT NULL`);
    console.log('    analisis_json agregada');
  } else console.log('    analisis_json ........ ya existía');
  await pool.query(`CREATE TABLE IF NOT EXISTS auditor_comparador_linea (
    item_id INT NOT NULL PRIMARY KEY, negocio_id INT NOT NULL, resultado_json MEDIUMTEXT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`);
  const [[t]] = await pool.query(
    `SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'auditor_comparador_linea'`);
  console.log(t.n > 0 ? '  OK: columna y tabla presentes.\n' : '  ERROR: la tabla no quedó creada.\n');
  if (!t.n) process.exitCode = 1;
} catch (e) {
  console.error('  Falló:', e.message); process.exitCode = 1;
} finally {
  await pool.end();
}
