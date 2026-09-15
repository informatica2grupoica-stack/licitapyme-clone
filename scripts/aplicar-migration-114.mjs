// Aplica migration-114: columna `estado` (HECHO/NO_APLICA) en compras_reparto_respaldo — pedido
// explícito del usuario, 14-sep-2026: hitos que a veces no corresponden (ej. anticipo cuando se
// paga de contado) necesitan poder marcarse "no aplica" en vez de quedar pendientes para siempre.
// Uso: node scripts/aplicar-migration-114.mjs
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

const columnaExiste = async (tabla, columna) => {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?`,
    [env.DB_NAME, tabla, columna]);
  return r.n > 0;
};

try {
  console.log('\n  Aplicando migration-114 (estado HECHO/NO_APLICA en compras_reparto_respaldo)...');
  if (await columnaExiste('compras_reparto_respaldo', 'estado')) {
    console.log('    estado ya existe — se salta.');
  } else {
    await pool.query(`ALTER TABLE compras_reparto_respaldo ADD COLUMN estado ENUM('HECHO','NO_APLICA') NOT NULL DEFAULT 'HECHO'`);
    console.log('    ALTER compras_reparto_respaldo ADD COLUMN estado OK');
  }
  const ok = await columnaExiste('compras_reparto_respaldo', 'estado');
  console.log(`  Verificación: compras_reparto_respaldo.estado = ${ok ? 'SÍ' : 'NO'}\n`);
  if (!ok) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
