// migration-195: compras_cotizacion.descuento_sobre_total (descuento global aplicado una vez al total de cada producto).
// Uso:  node scripts/aplicar-migration-195.mjs              → ESPEJO local (127.0.0.1:3308, licitank_dev)
//       node scripts/aplicar-migration-195.mjs --produccion → la base de .env.local (DB_*) — solo con OK explícito del dueño
// Idempotente: si la columna ya existe no hace nada. Las filas existentes quedan en 0 (sin cambio de comportamiento).
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
  const [ya] = await pool.query(`SHOW COLUMNS FROM compras_cotizacion LIKE 'descuento_sobre_total'`);
  if (ya.length) console.log('  La columna ya existe: nada que hacer.');
  else {
    const sql = readFileSync(new URL('../docs/migration-195-cotizacion-descuento-sobre-total.sql', import.meta.url), 'utf8')
      .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    for (const stmt of sql.split(';').map(s => s.trim()).filter(Boolean)) await pool.query(stmt);
    console.log('  Listo: compras_cotizacion.descuento_sobre_total agregada.');
  }
  console.log('');
} finally {
  await pool.end();
}
