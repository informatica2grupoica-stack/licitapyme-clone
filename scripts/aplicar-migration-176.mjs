// migration-176: compras_gasto.oc_obuma_folio (gasto extra enlazado a la OC de Obuma que ya lo respalda).
// Uso:  node scripts/aplicar-migration-176.mjs              → ESPEJO local (127.0.0.1:3308, licitank_dev)
//       node scripts/aplicar-migration-176.mjs --produccion → la base de .env.local (DB_*) — solo con OK explícito del dueño
// Idempotente: si la columna ya existe no hace nada.
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
  const [col] = await pool.query(`SHOW COLUMNS FROM compras_gasto LIKE 'oc_obuma_folio'`);
  if (col.length) console.log('  Ya estaba aplicada.\n');
  else {
    await pool.query(`ALTER TABLE compras_gasto ADD COLUMN oc_obuma_folio VARCHAR(30) NULL AFTER comprobante_url, ADD KEY idx_cg_oc (negocio_id, oc_obuma_folio)`);
    console.log('  Listo: columna oc_obuma_folio creada.\n');
  }
} finally {
  await pool.end();
}
