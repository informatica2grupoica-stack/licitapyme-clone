// migration-184: tabla compras_oc_linea_negocio («unidades para este negocio» de una OC de Obuma).
// Uso:  node scripts/aplicar-migration-184.mjs              → ESPEJO local (127.0.0.1:3308, licitank_dev)
//       node scripts/aplicar-migration-184.mjs --produccion → la base de .env.local (DB_*) — solo con OK explícito del dueño
// Idempotente (CREATE TABLE IF NOT EXISTS).
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';

const produccion = process.argv.includes('--produccion');
const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*([^#\r\n]*)/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const conf = produccion
  ? { host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306') }
  : { host: '127.0.0.1', user: 'licitank', password: 'licitank_local', database: 'licitank_dev', port: 3308 };
const pool = mysql.createPool({ ...conf, connectTimeout: 20000 });
try {
  console.log(`\n  Base: ${conf.database} (${conf.host}:${conf.port})${produccion ? '  ← PRODUCCIÓN' : '  (espejo local)'}`);
  const sql = readFileSync(new URL('../docs/migration-184-oc-linea-negocio.sql', import.meta.url), 'utf8').replace(/^--.*$/gm, '');
  await pool.query(sql);
  const [t] = await pool.query(`SHOW TABLES LIKE 'compras_oc_linea_negocio'`);
  console.log(t.length ? '  Listo: la tabla compras_oc_linea_negocio existe.\n' : '  ERROR: la tabla no quedó creada.\n');
} finally {
  await pool.end();
}
