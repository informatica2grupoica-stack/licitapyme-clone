// Aplica migration-93: tablas compras_fletero / compras_fletero_zona (Módulo de Compras —
// Logística y fleteros, §13) + columnas de modalidad de retiro en compras_asignacion (§13.2).
// Uso: node scripts/aplicar-migration-93.mjs
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
  console.log('\n  Aplicando migration-93 (logística y fleteros)...');

  if (await columnaExiste('compras_asignacion', 'modalidad_retiro')) {
    console.log('    compras_asignacion.modalidad_retiro ya existe — se salta el ALTER.');
  } else {
    await pool.query(
      `ALTER TABLE compras_asignacion
         ADD COLUMN modalidad_retiro VARCHAR(16) NULL,
         ADD COLUMN modalidad_retiro_por INT NULL,
         ADD COLUMN modalidad_retiro_por_nombre VARCHAR(160) NULL,
         ADD COLUMN modalidad_retiro_at DATETIME NULL`,
    );
    console.log('    ALTER compras_asignacion OK');
  }

  for (const [tabla, sql] of [
    ['compras_fletero', `CREATE TABLE IF NOT EXISTS compras_fletero (
      id INT AUTO_INCREMENT PRIMARY KEY, rut VARCHAR(20) NULL, nombre VARCHAR(300) NOT NULL,
      categoria VARCHAR(16) NOT NULL, capacidad_camion VARCHAR(120) NULL, tipo_camion VARCHAR(120) NULL,
      precio DECIMAL(18,2) NULL, costo_km DECIMAL(12,2) NULL, incluye_descarga TINYINT(1) NOT NULL DEFAULT 0,
      tiene_pionetas TINYINT(1) NOT NULL DEFAULT 0, plazo_despacho_dias INT NULL,
      quedo_en_pana TINYINT(1) NOT NULL DEFAULT 0, nota DECIMAL(3,1) NULL, activo TINYINT(1) NOT NULL DEFAULT 1,
      creado_por INT NULL, creado_por_nombre VARCHAR(160) NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
      INDEX idx_compras_fletero_categoria (categoria, activo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`],
    ['compras_fletero_zona', `CREATE TABLE IF NOT EXISTS compras_fletero_zona (
      fletero_id INT NOT NULL, zona VARCHAR(120) NOT NULL, PRIMARY KEY (fletero_id, zona)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`],
  ]) {
    await pool.query(sql);
    console.log(`    CREATE TABLE ${tabla} OK`);
  }

  const tablas = ['compras_fletero', 'compras_fletero_zona'];
  const estado = await Promise.all(tablas.map(tablaExiste));
  for (let i = 0; i < tablas.length; i++) console.log(`  Verificación: ${tablas[i]} = ${estado[i] ? 'SÍ' : 'NO'}`);
  const colOk = await columnaExiste('compras_asignacion', 'modalidad_retiro');
  console.log(`  Verificación: compras_asignacion.modalidad_retiro = ${colOk ? 'SÍ' : 'NO'}\n`);
  if (estado.some(x => !x) || !colOk) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
