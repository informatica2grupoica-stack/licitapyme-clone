// Aplica migration-80: columna imagen_url en linea_producto_ofertado (foto del producto que
// ofertamos, sacada de la ficha del proveedor — ver docs/migration-80-imagen-producto-ofertado.sql).
//
// Idempotente: ADD COLUMN IF NOT EXISTS + verificación final.
// Uso: node scripts/aplicar-migration-80.mjs
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
if (!env.DB_HOST) {
  console.error('\n  Falta DB_HOST. Corre el script desde la carpeta del proyecto (con .env/.env.local),');
  console.error('  o dentro del contenedor:  docker compose exec app node scripts/aplicar-migration-80.mjs\n');
  process.exit(1);
}

const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000,
  multipleStatements: true,
});

const TABLA = 'linea_producto_ofertado';
const COLUMNA = 'imagen_url';
const existe = async () => {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?`,
    [env.DB_NAME, TABLA, COLUMNA]);
  return r.n > 0;
};

try {
  if (await existe()) {
    console.log(`\n  Ya aplicada (${TABLA}.${COLUMNA} existe). Nada que hacer.`);
  } else {
    console.log(`\n  Aplicando migration-80 (agregando ${TABLA}.${COLUMNA})...`);
    const t = performance.now();
    await pool.query(readFileSync('docs/migration-80-imagen-producto-ofertado.sql', 'utf8'));
    console.log(`    OK en ${Math.round(performance.now() - t)} ms`);
  }
  const ok = await existe();
  console.log(`  ${ok ? 'OK   ' : 'FALTA'} ${TABLA}.${COLUMNA}\n`);
  if (!ok) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
