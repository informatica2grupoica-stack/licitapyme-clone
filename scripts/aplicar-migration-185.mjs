// migration-185: medidor por cliente (ia_uso.cliente_id, mp_api_uso_cliente, topes en clientes).
// Uso:  node scripts/aplicar-migration-185.mjs              → ESPEJO local (127.0.0.1:3308, licitank_dev)
//       node scripts/aplicar-migration-185.mjs --produccion → la base de .env.local (DB_*) — solo con OK explícito del dueño
// Idempotente: revisa cada cambio antes de hacerlo.
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

const columna = async (t, c) => (await pool.query('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [t, c]))[0].length > 0;
const indice = async (t, i) => (await pool.query('SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?', [t, i]))[0].length > 0;

try {
  console.log(`\n  Base: ${conf.database} (${conf.host}:${conf.port})${produccion ? '  ← PRODUCCIÓN' : '  (espejo local)'}`);
  if (!(await columna('ia_uso', 'cliente_id'))) { await pool.query('ALTER TABLE ia_uso ADD COLUMN cliente_id INT NOT NULL DEFAULT 1, ALGORITHM=INSTANT'); console.log('  + ia_uso.cliente_id'); }
  if (!(await indice('ia_uso', 'idx_ia_uso_cliente'))) { await pool.query('ALTER TABLE ia_uso ADD INDEX idx_ia_uso_cliente (cliente_id, created_at)'); console.log('  + índice idx_ia_uso_cliente'); }
  await pool.query(`CREATE TABLE IF NOT EXISTS mp_api_uso_cliente (
      fecha DATE NOT NULL, cliente_id INT NOT NULL, consultas INT NOT NULL DEFAULT 0, actualizado_at DATETIME NOT NULL,
      PRIMARY KEY (cliente_id, fecha)) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  console.log('  = tabla mp_api_uso_cliente');
  let topesNuevos = false;
  if (!(await columna('clientes', 'tope_ia_usd_mes'))) { await pool.query('ALTER TABLE clientes ADD COLUMN tope_ia_usd_mes DECIMAL(10,2) NULL DEFAULT 10.00'); topesNuevos = true; console.log('  + clientes.tope_ia_usd_mes'); }
  if (!(await columna('clientes', 'tope_mp_diario'))) { await pool.query('ALTER TABLE clientes ADD COLUMN tope_mp_diario INT NULL DEFAULT 500'); topesNuevos = true; console.log('  + clientes.tope_mp_diario'); }
  if (topesNuevos) { await pool.query('UPDATE clientes SET tope_ia_usd_mes = NULL, tope_mp_diario = NULL WHERE id = 1'); console.log('  = Grupo ICA (1) sin topes'); }
  console.log('  Listo.\n');
} finally {
  await pool.end();
}
