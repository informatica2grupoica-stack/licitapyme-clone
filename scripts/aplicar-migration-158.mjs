// Aplica migration-158: datos del transporte en el retiro por proveedor (compras_retiro_proveedor).
// Cuando un proveedor se retira con transporte externo se registra quién lo trae (nombre y RUT, para
// su factura o pago), cuánto cobra, desde dónde, hasta dónde y cuándo. Solo agrega columnas.
// Uso: node scripts/aplicar-migration-158.mjs
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

const COLUMNAS = [
  ['transporte_fletero_id', 'INT DEFAULT NULL'],
  ['transporte_nombre', 'VARCHAR(300) DEFAULT NULL'],
  ['transporte_rut', 'VARCHAR(20) DEFAULT NULL'],
  ['transporte_telefono', 'VARCHAR(60) DEFAULT NULL'],
  ['transporte_precio', 'DECIMAL(14,0) DEFAULT NULL'],
  ['transporte_precio_con_iva', 'TINYINT(1) NOT NULL DEFAULT 0'],
  ['transporte_origen', 'VARCHAR(400) DEFAULT NULL'],
  ['transporte_destino', 'VARCHAR(400) DEFAULT NULL'],
  ['transporte_fecha', 'DATE DEFAULT NULL'],
  ['transporte_nota', 'VARCHAR(500) DEFAULT NULL'],
];

try {
  console.log('\n  Aplicando migration-158 (datos del transporte en compras_retiro_proveedor)...');
  for (const [col, def] of COLUMNAS) {
    const [[r]] = await pool.query(
      `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='compras_retiro_proveedor' AND COLUMN_NAME=?`,
      [env.DB_NAME, col]);
    if (r.n > 0) { console.log(`  = ${col} ya estaba`); continue; }
    await pool.query(`ALTER TABLE compras_retiro_proveedor ADD COLUMN ${col} ${def}`);
    console.log(`  + ${col}`);
  }
  console.log('  Listo.\n');
} catch (e) {
  console.error('\n  Error:', e.message, '\n');
  process.exit(1);
} finally {
  await pool.end();
}
