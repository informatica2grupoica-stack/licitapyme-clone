// migration-183: índices de alertas_licitaciones (cierre y creación por cliente) para el dashboard y el radar.
// Uso:  node scripts/aplicar-migration-183.mjs              → ESPEJO local (127.0.0.1:3308, licitank_dev)
//       node scripts/aplicar-migration-183.mjs --produccion → la base de .env.local (DB_*) — solo con OK explícito del dueño
// Idempotente: si los índices ya existen no hace nada.
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
  const [ix] = await pool.query(
    `SHOW INDEX FROM alertas_licitaciones WHERE Key_name IN ('idx_alertas_cliente_cierre','idx_alertas_cliente_creada')`);
  if (ix.length) console.log('  Ya estaba aplicada.\n');
  else {
    await pool.query(`ALTER TABLE alertas_licitaciones
      ADD INDEX idx_alertas_cliente_cierre (cliente_id, licitacion_cierre, licitacion_codigo),
      ADD INDEX idx_alertas_cliente_creada (cliente_id, created_at, licitacion_codigo)`);
    console.log('  Listo: índices creados.\n');
  }
} finally {
  await pool.end();
}
