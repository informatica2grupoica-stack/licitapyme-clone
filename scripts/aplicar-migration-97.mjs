// Aplica migration-97: columna origen_compra en compras_asignacion + tabla compras_embarque
// (Módulo de Compras — Ruta de importación y costeo aterrizado, §12).
// Uso: node scripts/aplicar-migration-97.mjs
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
  console.log('\n  Aplicando migration-97 (ruta de importación)...');

  if (await columnaExiste('compras_asignacion', 'origen_compra')) {
    console.log('    compras_asignacion.origen_compra ya existe — se salta el ALTER.');
  } else {
    await pool.query(
      `ALTER TABLE compras_asignacion
         ADD COLUMN origen_compra VARCHAR(16) NULL,
         ADD COLUMN origen_compra_por INT NULL,
         ADD COLUMN origen_compra_por_nombre VARCHAR(160) NULL,
         ADD COLUMN origen_compra_at DATETIME NULL`,
    );
    console.log('    ALTER compras_asignacion OK');
  }

  await pool.query(`CREATE TABLE IF NOT EXISTS compras_embarque (
    negocio_id INT NOT NULL PRIMARY KEY, flete_internacional DECIMAL(18,2) NULL, costos_aduana DECIMAL(18,2) NULL,
    costo_logistico_local DECIMAL(18,2) NULL, moneda VARCHAR(6) NOT NULL DEFAULT 'CLP', notas TEXT NULL,
    registrado_por INT NULL, registrado_por_nombre VARCHAR(160) NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  console.log('    CREATE TABLE compras_embarque OK');

  const colOk = await columnaExiste('compras_asignacion', 'origen_compra');
  const tablaOk = await tablaExiste('compras_embarque');
  console.log(`  Verificación: compras_asignacion.origen_compra = ${colOk ? 'SÍ' : 'NO'}`);
  console.log(`  Verificación: compras_embarque = ${tablaOk ? 'SÍ' : 'NO'}\n`);
  if (!colOk || !tablaOk) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
