// Aplica migration-157: pagos a proveedores por orden de compra (anticipo / pago total / saldo),
// cada uno con su comprobante. Reemplaza los hitos únicos «Pago registrado» y «Anticipo pagado»
// del negocio, que no servían con varias OC (un negocio puede tener 16 proveedores).
// Uso: node scripts/aplicar-migration-157.mjs
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
  console.log('\n  Aplicando migration-157 (compras_oc_pago)...');
  await pool.query(`CREATE TABLE IF NOT EXISTS compras_oc_pago (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    negocio_id INT NOT NULL,
    oc_folio VARCHAR(40) NOT NULL,
    proveedor_nombre VARCHAR(255) DEFAULT NULL,
    tipo ENUM('ANTICIPO','PAGO_TOTAL','SALDO') NOT NULL,
    monto DECIMAL(14,0) NOT NULL,
    fecha DATE NOT NULL,
    archivo_url VARCHAR(1000) NOT NULL,
    archivo_nombre VARCHAR(255) DEFAULT NULL,
    nota VARCHAR(500) DEFAULT NULL,
    creado_por INT DEFAULT NULL,
    creado_por_nombre VARCHAR(120) DEFAULT NULL,
    created_at DATETIME NOT NULL,
    KEY idx_negocio (negocio_id),
    KEY idx_negocio_oc (negocio_id, oc_folio)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  console.log('  + tabla compras_oc_pago lista\n');
} catch (e) {
  console.error('\n  Error:', e.message, '\n');
  process.exit(1);
} finally {
  await pool.end();
}
