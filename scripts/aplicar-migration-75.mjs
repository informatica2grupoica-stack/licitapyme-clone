// Aplica migration-75: tabla documentos_origen_manual (marca los documentos que el usuario
// subió a mano directo en una caja de la licitación, para que queden borrables/renombrables
// aunque la caja sea "oficial"). Es una tabla NUEVA, no una columna en documentos_cache — ver el
// porqué en el .sql: un ALTER TABLE sobre esa tabla grande (MySQL 5.7, ~24k filas) supera el
// límite de ~150s que Bluehost impone a conexiones/queries en este plan compartido.
// Uso: node scripts/aplicar-migration-75.mjs
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
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='documentos_origen_manual'`, [env.DB_NAME]);
  if (yaExiste.n > 0) {
    console.log('\n  La tabla documentos_origen_manual ya existe. Nada que hacer.\n');
  } else {
    console.log('\n  Creando tabla documentos_origen_manual...');
    const sql = readFileSync('docs/migration-75-origen-manual-documentos.sql', 'utf8')
      .replace(/--.*$/gm, '');
    const t = performance.now();
    await pool.query(sql);
    console.log(`    OK en ${Math.round(performance.now() - t)} ms`);
  }

  const [[chk]] = await pool.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='documentos_origen_manual'`, [env.DB_NAME]);
  console.log(`  Verificación: tabla existe = ${chk.n === 1 ? 'SÍ' : 'NO'}\n`);
  if (chk.n !== 1) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
