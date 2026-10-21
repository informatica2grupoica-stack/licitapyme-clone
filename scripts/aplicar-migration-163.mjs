// Aplica migration-163: PARTES QUE SE COMPRAN APARTE (pedido del dueño, 21-oct-2026, compra 1090). La butaca «incluye pernos de
// fijación» es UNA fila del costeo, pero la butaca se le compra a un proveedor y los pernos a otro. La parte es un producto más de
// Compras (cotización, compra directa/rápida, aprobación, SKU, OC, entrega) colgado de su producto: no se vende sola y no viene del
// costeo. Solo agrega una columna NULL a compras_producto.
// Uso: node scripts/aplicar-migration-163.mjs
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
  console.log('\n  Aplicando migration-163 (compras_producto.producto_padre_id)...');
  const [col] = await pool.query(`SHOW COLUMNS FROM compras_producto LIKE 'producto_padre_id'`);
  if (col.length) console.log('  Ya estaba aplicada.');
  else {
    await pool.query(`ALTER TABLE compras_producto ADD COLUMN producto_padre_id INT NULL AFTER correlativo, ADD KEY idx_cp_padre (producto_padre_id)`);
    console.log('  Listo.');
  }
  console.log('');
} catch (e) {
  console.error('\n  Error:', e.message, '\n');
  process.exit(1);
} finally {
  await pool.end();
}
