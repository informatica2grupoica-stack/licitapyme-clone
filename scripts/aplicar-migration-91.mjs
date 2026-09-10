// Aplica migration-91: tablas del Auditor de Compras (compras_cotizacion, compras_cotizacion_item,
// compras_veredicto, compras_escenario) — Módulo de Compras §8.
// Uso: node scripts/aplicar-migration-91.mjs
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

const tablaExiste = async (tabla) => {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`,
    [env.DB_NAME, tabla]);
  return r.n > 0;
};

try {
  console.log('\n  Aplicando migration-91 (Auditor de Compras)...');
  const sql = readFileSync('docs/migration-91-auditor-compras.sql', 'utf8');
  const sentencias = sql
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    .split(';').map(s => s.trim()).filter(Boolean);
  for (const s of sentencias) await pool.query(s);
  console.log(`    OK (${sentencias.length} sentencia(s))`);

  const tablas = ['compras_cotizacion', 'compras_cotizacion_item', 'compras_veredicto', 'compras_escenario'];
  const estado = await Promise.all(tablas.map(tablaExiste));
  for (let i = 0; i < tablas.length; i++) console.log(`  Verificación: ${tablas[i]} = ${estado[i] ? 'SÍ' : 'NO'}`);
  console.log('');
  if (estado.some(x => !x)) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
