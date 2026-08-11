// Aplica migration-67: facturas de Obuma sobre las compras ya cruzadas.
// Uso: node scripts/aplicar-migration-67.mjs
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
  const [cols] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'obuma_compras' AND COLUMN_NAME = 'facturas_json'`,
  );
  if (cols.length) {
    console.log('  obuma_compras.facturas_json .. ya existía');
  } else {
    await pool.query(`ALTER TABLE obuma_compras ADD COLUMN facturas_json LONGTEXT DEFAULT NULL`);
    console.log('  obuma_compras.facturas_json .. OK');
  }
} catch (e) {
  console.error('\n  ERROR:', e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
