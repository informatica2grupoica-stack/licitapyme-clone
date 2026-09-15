// Aplica migration-113: compras_reparto_respaldo (archivo + nota obligatoria por hito del Proceso
// Administrativo §11). Pedido explícito del usuario, 14-sep-2026.
// Uso: node scripts/aplicar-migration-113.mjs
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
  console.log('\n  Aplicando migration-113 (respaldo de hitos del Proceso Administrativo)...');
  await pool.query(`CREATE TABLE IF NOT EXISTS compras_reparto_respaldo (
    id INT AUTO_INCREMENT PRIMARY KEY,
    negocio_id INT NOT NULL,
    hito VARCHAR(40) NOT NULL,
    nota TEXT NOT NULL,
    archivo_url VARCHAR(600) NULL,
    archivo_nombre VARCHAR(300) NULL,
    actualizado_por INT NULL,
    actualizado_por_nombre VARCHAR(160) NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY uk_compras_reparto_respaldo (negocio_id, hito)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  console.log('    CREATE TABLE compras_reparto_respaldo OK');
  const ok = await tablaExiste('compras_reparto_respaldo');
  console.log(`  Verificación: compras_reparto_respaldo = ${ok ? 'SÍ' : 'NO'}\n`);
  if (!ok) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
