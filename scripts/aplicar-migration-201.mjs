// migration-201: configuración de la Viabilidad IA por empresa-cliente (tabla cliente_viabilidad_config). Idempotente.
// Uso:  node scripts/aplicar-migration-201.mjs              → ESPEJO local (127.0.0.1:3308, licitank_dev)
//       node scripts/aplicar-migration-201.mjs --produccion → la base de .env.local (DB_*) — solo con OK explícito del dueño
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
  await pool.query(`CREATE TABLE IF NOT EXISTS cliente_viabilidad_config (
      cliente_id INT NOT NULL PRIMARY KEY, config JSON NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  console.log('  ✓ tabla cliente_viabilidad_config\n');
} finally {
  await pool.end();
}
