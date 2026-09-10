// Aplica migration-100: tabla compras_tipo_cambio + columnas de conversión en compras_cotizacion.
// Uso: node scripts/aplicar-migration-100.mjs
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
  console.log('\n  Aplicando migration-100 (tipo de cambio)...');

  await pool.query(`CREATE TABLE IF NOT EXISTS compras_tipo_cambio (
    fecha DATE NOT NULL, moneda VARCHAR(6) NOT NULL DEFAULT 'USD', valor DECIMAL(10,2) NOT NULL,
    fuente VARCHAR(100) NOT NULL, consultado_at DATETIME NOT NULL, PRIMARY KEY (fecha, moneda)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  console.log('    CREATE TABLE compras_tipo_cambio OK');

  if (await columnaExiste('compras_cotizacion', 'tipo_cambio_usado')) {
    console.log('    compras_cotizacion.tipo_cambio_usado ya existe — se salta el ALTER.');
  } else {
    await pool.query(`ALTER TABLE compras_cotizacion
      ADD COLUMN tipo_cambio_usado DECIMAL(10,2) NULL,
      ADD COLUMN precio_unitario_clp DECIMAL(18,2) NULL,
      ADD COLUMN precio_total_clp DECIMAL(18,2) NULL`);
    console.log('    ALTER compras_cotizacion OK');
  }

  const tablaOk = await tablaExiste('compras_tipo_cambio');
  const colOk = await columnaExiste('compras_cotizacion', 'tipo_cambio_usado');
  console.log(`  Verificación: compras_tipo_cambio = ${tablaOk ? 'SÍ' : 'NO'}`);
  console.log(`  Verificación: compras_cotizacion.tipo_cambio_usado = ${colOk ? 'SÍ' : 'NO'}\n`);
  if (!tablaOk || !colOk) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
