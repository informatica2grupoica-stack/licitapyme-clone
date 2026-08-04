// Aplica migration-64: órdenes de compra de Mercado Público.
// Uso: node scripts/aplicar-migration-64.mjs
//
// Idempotente. El ALTER sobre `empresas` se comprueba contra INFORMATION_SCHEMA porque esta
// versión de MySQL (Bluehost) NO soporta "ADD COLUMN IF NOT EXISTS" (verificado con migration-51).
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
  const sql = readFileSync('docs/migration-64-ordenes-compra.sql', 'utf8').replace(/--.*$/gm, '');
  const sentencias = sql.split(';').map(s => s.trim()).filter(Boolean);

  for (const s of sentencias) {
    if (/^ALTER TABLE (empresas|ordenes_compra)/i.test(s)) continue;   // se manejan aparte, más abajo
    await pool.query(s);
  }
  console.log('  tabla ordenes_compra ......... OK');

  const [cols] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'empresas' AND COLUMN_NAME = 'mp_codigo_proveedor'`,
  );
  if (cols.length) {
    console.log('  empresas.mp_codigo_proveedor .. ya existía');
  } else {
    await pool.query(`ALTER TABLE empresas ADD COLUMN mp_codigo_proveedor VARCHAR(30) DEFAULT NULL`);
    console.log('  empresas.mp_codigo_proveedor .. OK');
  }

  const [c2] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ordenes_compra' AND COLUMN_NAME = 'es_nuestra'`,
  );
  if (c2.length) {
    console.log('  ordenes_compra.es_nuestra ..... ya existía');
  } else {
    await pool.query(`ALTER TABLE ordenes_compra ADD COLUMN es_nuestra TINYINT(1) NOT NULL DEFAULT 0`);
    console.log('  ordenes_compra.es_nuestra ..... OK');
  }

  const [t] = await pool.query(`SELECT COUNT(*) AS n FROM ordenes_compra`);
  console.log(`\n  Listo. Órdenes de compra guardadas: ${t[0].n}`);
} catch (e) {
  console.error('\n  ERROR:', e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
