// Aplica migration-130: tabla negocio_auditor_compra_cotizacion + columnas cotizacion_id /
// precio_cotizado en negocio_auditor_compra_linea. Ver
// docs/migration-130-auditor-compra-cotizaciones.sql.
// Uso: node scripts/aplicar-migration-130.mjs
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

const columnaExiste = async (tabla, columna) => {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?`,
    [env.DB_NAME, tabla, columna]);
  return r.n > 0;
};

try {
  console.log('\n  Aplicando migration-130 (auditor de compra · cotizaciones)...');

  await pool.query(`CREATE TABLE IF NOT EXISTS negocio_auditor_compra_cotizacion (
    id INT AUTO_INCREMENT PRIMARY KEY, negocio_id INT NOT NULL, documento_url VARCHAR(1000) NOT NULL,
    documento_nombre VARCHAR(300) NULL, creado_por INT NULL, creado_por_nombre VARCHAR(160) NULL,
    creado_at DATETIME NOT NULL, INDEX idx_auditor_compra_cotizacion_negocio (negocio_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  console.log('    CREATE TABLE negocio_auditor_compra_cotizacion OK');

  if (await columnaExiste('negocio_auditor_compra_linea', 'cotizacion_id')) {
    console.log('    negocio_auditor_compra_linea.cotizacion_id ya existe — se salta el ALTER.');
  } else {
    await pool.query(`ALTER TABLE negocio_auditor_compra_linea ADD COLUMN cotizacion_id INT NULL`);
    console.log('    ALTER negocio_auditor_compra_linea.cotizacion_id OK');
  }

  if (await columnaExiste('negocio_auditor_compra_linea', 'precio_cotizado')) {
    console.log('    negocio_auditor_compra_linea.precio_cotizado ya existe — se salta el ALTER.');
  } else {
    await pool.query(`ALTER TABLE negocio_auditor_compra_linea ADD COLUMN precio_cotizado DECIMAL(14,2) NULL`);
    console.log('    ALTER negocio_auditor_compra_linea.precio_cotizado OK');
  }

  const [[t]] = await pool.query(
    `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME='negocio_auditor_compra_cotizacion'`,
    [env.DB_NAME]);
  const colCotizacion = await columnaExiste('negocio_auditor_compra_linea', 'cotizacion_id');
  const colPrecio = await columnaExiste('negocio_auditor_compra_linea', 'precio_cotizado');
  console.log(`  Verificación: negocio_auditor_compra_cotizacion = ${t.n > 0 ? 'SÍ' : 'NO'}`);
  console.log(`  Verificación: negocio_auditor_compra_linea.cotizacion_id = ${colCotizacion ? 'SÍ' : 'NO'}`);
  console.log(`  Verificación: negocio_auditor_compra_linea.precio_cotizado = ${colPrecio ? 'SÍ' : 'NO'}\n`);
  if (t.n < 1 || !colCotizacion || !colPrecio) process.exitCode = 1;
} catch (e) {
  console.error('  Falló:', e.message); process.exitCode = 1;
} finally {
  await pool.end();
}
