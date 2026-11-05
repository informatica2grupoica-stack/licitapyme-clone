// migration-179: cantidad a comprar distinta de la del costeo, con observación (compras_producto.cantidad_costeo / cantidad_motivo / …).
// Uso:  node scripts/aplicar-migration-179.mjs              → ESPEJO local (127.0.0.1:3308, licitank_dev)
//       node scripts/aplicar-migration-179.mjs --produccion → la base de .env.local (DB_*) — solo con OK explícito del dueño
// Idempotente: si las columnas ya existen no hace nada.
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
  const [col] = await pool.query(`SHOW COLUMNS FROM compras_producto LIKE 'cantidad_motivo'`);
  if (col.length) console.log('  Ya estaba aplicada.\n');
  else {
    await pool.query(`ALTER TABLE compras_producto
      ADD COLUMN cantidad_costeo              DECIMAL(14,3) NULL AFTER cantidad,
      ADD COLUMN cantidad_motivo              VARCHAR(500)  NULL AFTER cantidad_costeo,
      ADD COLUMN cantidad_cambiada_por        INT           NULL AFTER cantidad_motivo,
      ADD COLUMN cantidad_cambiada_por_nombre VARCHAR(150)  NULL AFTER cantidad_cambiada_por,
      ADD COLUMN cantidad_cambiada_at         DATETIME      NULL AFTER cantidad_cambiada_por_nombre`);
    console.log('  Listo: columnas de cantidad a comprar creadas.\n');
  }
} finally {
  await pool.end();
}
