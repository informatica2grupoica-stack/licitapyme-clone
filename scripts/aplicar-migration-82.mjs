// Aplica migration-82: columna producto_index + PK compuesta en linea_producto_ofertado (varios
// productos por línea — ver docs/migration-82-multi-producto-linea.sql).
//
// Idempotente: comprueba la columna Y que la primary key ya la incluya (ADD COLUMN IF NOT EXISTS
// no funciona en esta versión de MySQL, ver migration-80; y un ALTER de PK a medio aplicar dejaría
// la tabla en un estado raro si se reintenta a ciegas).
// Uso: node scripts/aplicar-migration-82.mjs
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
  console.error('  o dentro del contenedor:  docker compose exec app node scripts/aplicar-migration-82.mjs\n');
  process.exit(1);
}

const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000,
  multipleStatements: true,
});

const TABLA = 'linea_producto_ofertado';

const columnaExiste = async () => {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME='producto_index'`,
    [env.DB_NAME, TABLA]);
  return r.n > 0;
};
const pkIncluyeIndice = async () => {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND INDEX_NAME='PRIMARY' AND COLUMN_NAME='producto_index'`,
    [env.DB_NAME, TABLA]);
  return r.n > 0;
};

try {
  const yaColumna = await columnaExiste();
  const yaPk = yaColumna && await pkIncluyeIndice();

  if (yaColumna && yaPk) {
    console.log(`\n  Ya aplicada (${TABLA}.producto_index existe y es parte de la PK). Nada que hacer.`);
  } else if (!yaColumna) {
    console.log(`\n  Aplicando migration-82 (columna + PK compuesta en ${TABLA})...`);
    const t = performance.now();
    await pool.query(readFileSync('docs/migration-82-multi-producto-linea.sql', 'utf8'));
    console.log(`    OK en ${Math.round(performance.now() - t)} ms`);
  } else {
    // La columna quedó de una corrida anterior interrumpida pero la PK no se cambió: solo falta
    // el segundo ALTER (correr el primero de nuevo fallaría porque la columna ya existe).
    console.log(`\n  La columna ya existía pero la PK no la incluía — aplicando solo el cambio de PK...`);
    await pool.query(`ALTER TABLE ${TABLA} DROP PRIMARY KEY, ADD PRIMARY KEY (item_id, producto_index)`);
  }

  const ok = (await columnaExiste()) && (await pkIncluyeIndice());
  console.log(`  ${ok ? 'OK   ' : 'FALTA'} ${TABLA}.producto_index (columna + PK)\n`);
  if (!ok) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
