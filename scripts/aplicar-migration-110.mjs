// Aplica migration-110: compras_historial_oc + compras_historial_oc_item (historial de compras REAL
// de Obuma, guardado localmente — pedido explícito del usuario, 14-sep-2026, para que las consultas
// y los avisos sean rápidos, sin depender de llamadas en vivo a Obuma).
// Uso: node scripts/aplicar-migration-110.mjs
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
  console.log('\n  Aplicando migration-110 (historial de compras local)...');

  await pool.query(`CREATE TABLE IF NOT EXISTS compras_historial_oc (
    id INT AUTO_INCREMENT PRIMARY KEY,
    obuma_compra_oc_id VARCHAR(60) NOT NULL,
    obuma_proveedor_id VARCHAR(60) NOT NULL,
    folio VARCHAR(60) NULL, fecha DATETIME NULL, total BIGINT NULL, estado VARCHAR(60) NULL,
    items_sincronizados_at DATETIME NULL,
    created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
    UNIQUE KEY uk_compras_historial_oc_obuma_id (obuma_compra_oc_id),
    INDEX idx_compras_historial_oc_proveedor (obuma_proveedor_id),
    INDEX idx_compras_historial_oc_pendientes (items_sincronizados_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  console.log('    CREATE TABLE compras_historial_oc OK');

  await pool.query(`CREATE TABLE IF NOT EXISTS compras_historial_oc_item (
    id INT AUTO_INCREMENT PRIMARY KEY,
    historial_oc_id INT NOT NULL,
    producto_nombre VARCHAR(300) NOT NULL,
    cantidad DECIMAL(12,2) NULL, precio_unitario BIGINT NULL, subtotal BIGINT NULL,
    created_at DATETIME NOT NULL,
    INDEX idx_compras_historial_oc_item_oc (historial_oc_id),
    INDEX idx_compras_historial_oc_item_nombre (producto_nombre)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  console.log('    CREATE TABLE compras_historial_oc_item OK');

  const okOc = await tablaExiste('compras_historial_oc');
  const okItem = await tablaExiste('compras_historial_oc_item');
  console.log(`  Verificación: compras_historial_oc = ${okOc ? 'SÍ' : 'NO'}`);
  console.log(`  Verificación: compras_historial_oc_item = ${okItem ? 'SÍ' : 'NO'}\n`);
  if (!okOc || !okItem) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
