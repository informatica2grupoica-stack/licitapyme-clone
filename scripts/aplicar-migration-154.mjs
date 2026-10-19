// Aplica migration-154: columna compras_producto.importado.
// Uso: node scripts/aplicar-migration-154.mjs
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

const existe = async () => (await pool.query(
  `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='compras_producto' AND COLUMN_NAME='importado'`, [env.DB_NAME]))[0][0].n > 0;

try {
  console.log('\n  Aplicando migration-154 (productos importados)...');
  if (await existe()) console.log('    ya existe — se salta el ALTER.');
  else await pool.query('ALTER TABLE compras_producto ADD COLUMN importado TINYINT(1) NOT NULL DEFAULT 0');
  const ok = await existe();
  console.log(`  Verificación: compras_producto.importado = ${ok ? 'SÍ' : 'NO'}\n`);
  if (!ok) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
