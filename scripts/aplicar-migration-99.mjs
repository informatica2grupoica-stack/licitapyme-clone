// Aplica migration-99: tabla compras_proveedor (catálogo de proveedores) + columna proveedor_id
// en compras_cotizacion.
// Uso: node scripts/aplicar-migration-99.mjs
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
const columnaExiste = async (tabla, columna) => {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?`,
    [env.DB_NAME, tabla, columna]);
  return r.n > 0;
};

try {
  console.log('\n  Aplicando migration-99 (catálogo de proveedores)...');

  await pool.query(`CREATE TABLE IF NOT EXISTS compras_proveedor (
    id INT AUTO_INCREMENT PRIMARY KEY, rut VARCHAR(20) NULL, nombre_empresa VARCHAR(300) NOT NULL, nombre_fantasia VARCHAR(300) NULL,
    categoria VARCHAR(150) NULL, giro VARCHAR(300) NULL, contacto_nombre VARCHAR(200) NULL, correo VARCHAR(200) NULL, telefono VARCHAR(60) NULL,
    direccion VARCHAR(400) NULL, comuna VARCHAR(150) NULL, region VARCHAR(150) NULL, banco VARCHAR(150) NULL, tipo_cuenta VARCHAR(60) NULL,
    numero_cuenta VARCHAR(60) NULL, titular_cuenta VARCHAR(200) NULL, rut_titular VARCHAR(20) NULL, correo_pagos VARCHAR(200) NULL,
    obuma_proveedor_id VARCHAR(60) NULL, notas TEXT NULL, activo TINYINT(1) NOT NULL DEFAULT 1,
    creado_por INT NULL, creado_por_nombre VARCHAR(160) NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
    INDEX idx_compras_proveedor_rut (rut), INDEX idx_compras_proveedor_categoria (categoria)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  console.log('    CREATE TABLE compras_proveedor OK');

  if (await columnaExiste('compras_cotizacion', 'proveedor_id')) {
    console.log('    compras_cotizacion.proveedor_id ya existe — se salta el ALTER.');
  } else {
    await pool.query(`ALTER TABLE compras_cotizacion ADD COLUMN proveedor_id INT NULL`);
    console.log('    ALTER compras_cotizacion OK');
  }

  const tablaOk = await tablaExiste('compras_proveedor');
  const colOk = await columnaExiste('compras_cotizacion', 'proveedor_id');
  console.log(`  Verificación: compras_proveedor = ${tablaOk ? 'SÍ' : 'NO'}`);
  console.log(`  Verificación: compras_cotizacion.proveedor_id = ${colOk ? 'SÍ' : 'NO'}\n`);
  if (!tablaOk || !colOk) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
