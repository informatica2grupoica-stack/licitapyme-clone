// Aplica migration-29: crea la tabla historial_eventos (historial + campana de
// notificaciones por perfil, con leído/no leído y push en tiempo real).
// Uso: node scripts/aplicar-migration-29.mjs
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
  console.log('\n  Creando tabla historial_eventos...');
  const sql = readFileSync('docs/migration-29-historial.sql', 'utf8')
    .replace(/--.*$/gm, ''); // quitar comentarios (incluye la ALTER de FKs, opcional)
  const t = performance.now();
  await pool.query(sql);
  console.log(`    OK en ${Math.round(performance.now() - t)} ms`);

  const [[chk]] = await pool.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='historial_eventos'`, [env.DB_NAME]);
  console.log(`  Verificación: tabla existe = ${chk.n === 1 ? 'SÍ' : 'NO'}\n`);
  if (chk.n !== 1) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
