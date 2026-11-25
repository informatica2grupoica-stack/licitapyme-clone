// migration-208: banco del proveedor leído de Obuma (obuma_banco_id, obuma_banco en compras_proveedor).
// Uso:  node scripts/aplicar-migration-208.mjs              → ESPEJO local (127.0.0.1:3308, licitank_dev)
//       node scripts/aplicar-migration-208.mjs --produccion → la base de .env.local (DB_*)
// Idempotente: si la columna ya existe no hace nada. (En producción ya se aplicó el 25-nov-2026.)
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
  const [c] = await pool.query("SHOW COLUMNS FROM compras_proveedor LIKE 'obuma_banco_id'");
  if (c.length) {
    console.log('  Ya estaba aplicada.\n');
  } else {
    const sql = readFileSync('docs/migration-208-proveedor-obuma-banco.sql', 'utf8').replace(/^--.*$/gm, '');
    for (const st of sql.split(';').map(x => x.trim()).filter(Boolean)) await pool.query(st);
    const [r] = await pool.query('SELECT COUNT(*) n FROM compras_proveedor');
    console.log('  Listo. Proveedores en la tabla:', r[0].n, '\n');
  }
} finally {
  await pool.end();
}
