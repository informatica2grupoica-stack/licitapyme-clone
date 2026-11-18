// migration-199: etapas propias por empresa (ver docs/migration-199-etapas-propias.sql). Idempotente.
// Uso:  node scripts/aplicar-migration-199.mjs              → ESPEJO local (127.0.0.1:3308, licitank_dev)
//       node scripts/aplicar-migration-199.mjs --produccion → la base de .env.local (DB_*) — solo con OK explícito del dueño
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
  await pool.query(`CREATE TABLE IF NOT EXISTS etapas_cliente (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, cliente_id INT NOT NULL, nombre VARCHAR(40) NOT NULL, color VARCHAR(7) NOT NULL,
      base VARCHAR(30) NOT NULL, orden INT NOT NULL DEFAULT 0, activo TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX ix_etapas_cliente (cliente_id, activo, orden)
    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  console.log('  ✓ tabla etapas_cliente');
  const [r] = await pool.query("SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'negocios' AND COLUMN_NAME = 'etapa_id'");
  if (!r.length) { await pool.query('ALTER TABLE negocios ADD COLUMN etapa_id INT NULL'); console.log('  + negocios.etapa_id'); }
  else console.log('  = negocios.etapa_id ya existe');
  console.log('');
} finally {
  await pool.end();
}
