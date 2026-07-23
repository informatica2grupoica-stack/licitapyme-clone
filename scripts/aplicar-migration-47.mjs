// Aplica migration-47: columna categoria_manual en documentos_cache (protege los documentos
// de la licitación que el usuario reclasificó a mano contra ser pisados por la IA).
// Uso: node scripts/aplicar-migration-47.mjs
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
  const [[yaExiste]] = await pool.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='documentos_cache' AND COLUMN_NAME='categoria_manual'`, [env.DB_NAME]);
  if (yaExiste.n > 0) {
    console.log('\n  La columna categoria_manual ya existe. Nada que hacer.\n');
  } else {
    console.log('\n  Agregando columna categoria_manual a documentos_cache...');
    const sql = readFileSync('docs/migration-47-categoria-manual-documentos.sql', 'utf8')
      .replace(/--.*$/gm, '');
    const t = performance.now();
    await pool.query(sql);
    console.log(`    OK en ${Math.round(performance.now() - t)} ms`);
  }

  const [[chk]] = await pool.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='documentos_cache' AND COLUMN_NAME='categoria_manual'`, [env.DB_NAME]);
  console.log(`  Verificación: columna existe = ${chk.n === 1 ? 'SÍ' : 'NO'}\n`);
  if (chk.n !== 1) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
