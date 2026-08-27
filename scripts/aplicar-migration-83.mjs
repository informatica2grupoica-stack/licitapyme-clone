// Aplica migration-83: columna producto_index + clave única compuesta en
// checklist_comercial_caracteristicas (características por producto — ver
// docs/migration-83-caracteristicas-por-producto.sql).
//
// Idempotente: comprueba la columna Y que la clave única ya la incluya (ADD COLUMN IF NOT EXISTS
// no funciona en esta versión de MySQL, ver migration-80; y un ALTER de índice a medio aplicar
// dejaría la tabla en un estado raro si se reintenta a ciegas).
// Uso: node scripts/aplicar-migration-83.mjs
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
  console.error('  o dentro del contenedor:  docker compose exec app node scripts/aplicar-migration-83.mjs\n');
  process.exit(1);
}

const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000,
  multipleStatements: true,
});

const TABLA = 'checklist_comercial_caracteristicas';

const columnaExiste = async () => {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME='producto_index'`,
    [env.DB_NAME, TABLA]);
  return r.n > 0;
};
const claveIncluyeIndice = async () => {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND INDEX_NAME='uq_caracteristica' AND COLUMN_NAME='producto_index'`,
    [env.DB_NAME, TABLA]);
  return r.n > 0;
};

try {
  const yaColumna = await columnaExiste();
  const yaClave = yaColumna && await claveIncluyeIndice();

  if (yaColumna && yaClave) {
    console.log(`\n  Ya aplicada (${TABLA}.producto_index existe y la clave única lo incluye). Nada que hacer.`);
  } else if (!yaColumna) {
    console.log(`\n  Aplicando migration-83 (columna + clave única compuesta en ${TABLA})...`);
    const t = performance.now();
    await pool.query(readFileSync('docs/migration-83-caracteristicas-por-producto.sql', 'utf8'));
    console.log(`    OK en ${Math.round(performance.now() - t)} ms`);
  } else {
    // La columna quedó de una corrida anterior interrumpida pero la clave no se cambió: solo
    // falta el segundo ALTER (correr el primero de nuevo fallaría porque la columna ya existe).
    console.log(`\n  La columna ya existía pero la clave única no la incluía — aplicando solo ese cambio...`);
    await pool.query(
      `ALTER TABLE ${TABLA} DROP INDEX uq_caracteristica, ADD UNIQUE KEY uq_caracteristica (item_id, producto_index, clave_caracteristica)`,
    );
  }

  const ok = (await columnaExiste()) && (await claveIncluyeIndice());
  console.log(`  ${ok ? 'OK   ' : 'FALTA'} ${TABLA}.producto_index (columna + clave única)\n`);
  if (!ok) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
