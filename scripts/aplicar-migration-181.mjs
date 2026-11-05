// migration-181: compras_producto.servicio_tipo (FLETE o ADICIONAL de un servicio).
// Uso:  node scripts/aplicar-migration-181.mjs              → ESPEJO local (127.0.0.1:3308, licitank_dev)
//       node scripts/aplicar-migration-181.mjs --produccion → la base de .env.local (DB_*) — solo con OK explícito del dueño
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
  const [col] = await pool.query(`SHOW COLUMNS FROM compras_producto LIKE 'servicio_tipo'`);
  if (col.length) console.log('  Ya estaba aplicada.\n');
  else {
    await pool.query(`ALTER TABLE compras_producto ADD COLUMN servicio_tipo VARCHAR(20) NULL AFTER es_servicio`);
    console.log('  Listo: columna servicio_tipo creada.\n');
  }
} finally {
  await pool.end();
}
