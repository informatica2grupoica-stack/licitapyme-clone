// Aplica migration-153: tabla compras_retiro_proveedor (modalidad de retiro por proveedor).
// Uso: node scripts/aplicar-migration-153.mjs
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
  console.log('\n  Aplicando migration-153 (retiro por proveedor)...');
  await pool.query(`CREATE TABLE IF NOT EXISTS compras_retiro_proveedor (
    negocio_id INT NOT NULL, proveedor_nombre VARCHAR(300) NOT NULL, modalidad VARCHAR(16) NOT NULL,
    por_nombre VARCHAR(160) NULL, updated_at DATETIME NOT NULL,
    PRIMARY KEY (negocio_id, proveedor_nombre(190))
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  const [[r]] = await pool.query(
    `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME='compras_retiro_proveedor'`, [env.DB_NAME]);
  console.log(`  Verificación: compras_retiro_proveedor = ${r.n > 0 ? 'SÍ' : 'NO'}\n`);
  if (!r.n) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
