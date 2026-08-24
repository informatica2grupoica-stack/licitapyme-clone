// Aplica migration-75: columna origen_manual en documentos_cache (marca los documentos que el
// usuario subió a mano directo en una caja de la licitación, para que queden borrables/
// renombrables aunque la caja sea "oficial").
// Uso: node scripts/aplicar-migration-75.mjs
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
// enableKeepAlive: la tabla ya tiene ~24k filas / ~300MB — el ALTER (MySQL 5.7, sin soporte de
// INSTANT ADD COLUMN) tarda más que cuando se aplicaron las migraciones 45/47, y dos intentos
// previos de esta migración perdieron la conexión a mitad de camino ("Connection lost: The
// server closed the connection") — probablemente un firewall/NAT intermedio de Bluehost cortando
// la conexión larga. TCP keepalive evita que la vean "inactiva" y la corten.
const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000,
  enableKeepAlive: true, keepAliveInitialDelay: 5000,
});

try {
  const [[yaExiste]] = await pool.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='documentos_cache' AND COLUMN_NAME='origen_manual'`, [env.DB_NAME]);
  if (yaExiste.n > 0) {
    console.log('\n  La columna origen_manual ya existe. Nada que hacer.\n');
  } else {
    console.log('\n  Agregando columna origen_manual a documentos_cache...');
    const sql = readFileSync('docs/migration-75-origen-manual-documentos.sql', 'utf8')
      .replace(/--.*$/gm, '');
    const t = performance.now();
    await pool.query(sql);
    console.log(`    OK en ${Math.round(performance.now() - t)} ms`);
  }

  const [[chk]] = await pool.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='documentos_cache' AND COLUMN_NAME='origen_manual'`, [env.DB_NAME]);
  console.log(`  Verificación: columna existe = ${chk.n === 1 ? 'SÍ' : 'NO'}\n`);
  if (chk.n !== 1) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
