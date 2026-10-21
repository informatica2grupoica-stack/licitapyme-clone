// Aplica migration-160: VARIOS embarques de importación por negocio (pedido del dueño, 21-oct-2026).
// Cada embarque tiene sus productos, su seguimiento (etapa con fecha por etapa + datos del envío) y
// sus propios costos (flete, aduana, traslado), que se reparten solo entre SUS productos. Reemplaza a
// compras_embarque (una sola fila por negocio), que estaba vacía y deja de usarse.
// Uso: node scripts/aplicar-migration-160.mjs
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
  console.log('\n  Aplicando migration-160 (compras_importacion_embarque + compras_producto.embarque_id)...');
  await pool.query(`CREATE TABLE IF NOT EXISTS compras_importacion_embarque (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    negocio_id INT NOT NULL,
    nombre VARCHAR(120) NOT NULL,
    estado VARCHAR(20) DEFAULT NULL,
    estado_fechas TEXT DEFAULT NULL,
    proveedor_extranjero VARCHAR(300) DEFAULT NULL,
    pais_origen VARCHAR(80) DEFAULT NULL,
    medio VARCHAR(20) DEFAULT NULL,
    incoterm VARCHAR(10) DEFAULT NULL,
    numero_seguimiento VARCHAR(120) DEFAULT NULL,
    transportista VARCHAR(200) DEFAULT NULL,
    agente_aduana VARCHAR(200) DEFAULT NULL,
    puerto_llegada VARCHAR(120) DEFAULT NULL,
    fecha_salida DATE DEFAULT NULL,
    fecha_llegada_estimada DATE DEFAULT NULL,
    numero_din VARCHAR(60) DEFAULT NULL,
    flete_internacional DECIMAL(18,2) DEFAULT NULL,
    costos_aduana DECIMAL(18,2) DEFAULT NULL,
    costo_logistico_local DECIMAL(18,2) DEFAULT NULL,
    moneda VARCHAR(6) NOT NULL DEFAULT 'CLP',
    actualizado_por INT DEFAULT NULL,
    actualizado_por_nombre VARCHAR(160) DEFAULT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    KEY idx_negocio (negocio_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  console.log('  + tabla compras_importacion_embarque lista');
  const [[r]] = await pool.query(
    `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='compras_producto' AND COLUMN_NAME='embarque_id'`,
    [env.DB_NAME]);
  if (r.n > 0) console.log('  = compras_producto.embarque_id ya estaba');
  else { await pool.query(`ALTER TABLE compras_producto ADD COLUMN embarque_id INT DEFAULT NULL`); console.log('  + compras_producto.embarque_id'); }
  console.log('  Listo.\n');
} catch (e) {
  console.error('\n  Error:', e.message, '\n');
  process.exit(1);
} finally {
  await pool.end();
}
