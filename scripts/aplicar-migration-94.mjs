// Aplica migration-94: compras_incidencia_tipo (catálogo enunciativo) y compras_incidencia
// (Módulo de Compras — Zona de incidencias, §9).
// Uso: node scripts/aplicar-migration-94.mjs
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
  console.log('\n  Aplicando migration-94 (zona de incidencias)...');
  const sql = readFileSync('docs/migration-94-compras-incidencias.sql', 'utf8');
  const sentencias = sql
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    .split(';').map(s => s.trim()).filter(Boolean);
  for (const s of sentencias) await pool.query(s);
  console.log(`    OK (${sentencias.length} sentencia(s))`);

  const tablas = ['compras_incidencia_tipo', 'compras_incidencia'];
  const estado = await Promise.all(tablas.map(tablaExiste));
  for (let i = 0; i < tablas.length; i++) console.log(`  Verificación: ${tablas[i]} = ${estado[i] ? 'SÍ' : 'NO'}`);
  const [[{ n: catalogoN }]] = await pool.query(`SELECT COUNT(*) n FROM compras_incidencia_tipo`);
  console.log(`  Catálogo inicial: ${catalogoN} tipo(s) sembrado(s).\n`);
  if (estado.some(x => !x)) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
