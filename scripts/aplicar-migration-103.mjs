// Aplica migration-103: columnas de contacto de la licitación en adjudicacion_cache.
// Uso: node scripts/aplicar-migration-103.mjs
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

const COLUMNAS = [
  ['contacto_nombre',   "VARCHAR(200) DEFAULT NULL"],
  ['contacto_cargo',    "VARCHAR(200) DEFAULT NULL"],
  ['contacto_telefono', "VARCHAR(60)  DEFAULT NULL"],
  ['contacto_email',    "VARCHAR(200) DEFAULT NULL"],
];

try {
  console.log('\n  Aplicando migration-103 (contacto de la licitación en adjudicacion_cache)...');
  let aplicadas = 0, yaExistian = 0;
  for (const [col, def] of COLUMNAS) {
    if (await columnaExiste('adjudicacion_cache', col)) { yaExistian++; continue; }
    await pool.query(`ALTER TABLE adjudicacion_cache ADD COLUMN ${col} ${def}`);
    aplicadas++;
    console.log(`  + columna ${col} agregada`);
  }
  console.log(`\n  Listo: ${aplicadas} columna(s) nueva(s), ${yaExistian} que ya estaban.\n`);
} catch (e) {
  console.error('\n  Error:', e.message, '\n');
  process.exit(1);
} finally {
  await pool.end();
}
