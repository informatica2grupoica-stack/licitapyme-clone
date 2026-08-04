// Aplica migration-65: columnas de PDF en ordenes_compra.
// Uso: node scripts/aplicar-migration-65.mjs
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

const COLUMNAS = [
  ['pdf_url', `VARCHAR(500) DEFAULT NULL`],
  ['pdf_descargado_at', `DATETIME DEFAULT NULL`],
  ['pdf_error', `VARCHAR(300) DEFAULT NULL`],
];

try {
  for (const [nombre, def] of COLUMNAS) {
    const [cols] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ordenes_compra' AND COLUMN_NAME = ?`,
      [nombre],
    );
    if (cols.length) {
      console.log(`  ordenes_compra.${nombre} .......... ya existía`);
    } else {
      await pool.query(`ALTER TABLE ordenes_compra ADD COLUMN ${nombre} ${def}`);
      console.log(`  ordenes_compra.${nombre} .......... OK`);
    }
  }
  console.log('\n  Listo.');
} catch (e) {
  console.error('\n  ERROR:', e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
