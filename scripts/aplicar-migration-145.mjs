// Aplica migration-145: columnas precompra / precompra_at en compras_asignacion.
// Ver docs/migration-145-compras-precompra.sql. Idempotente (revisa si la columna ya existe).
// Uso: node scripts/aplicar-migration-145.mjs
import mysql from 'mysql2/promise';
import { readFileSync, existsSync } from 'node:fs';

const env = { ...process.env };
for (const archivo of ['.env.local', '.env']) {
  if (!existsSync(archivo)) continue;
  for (const line of readFileSync(archivo, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  break;
}
if (!env.DB_HOST) { console.error('\n  Falta DB_HOST.\n'); process.exit(1); }

const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000,
});

try {
  console.log('\n  Aplicando migration-145 (pre-compra)...');
  const [cols] = await pool.query("SHOW COLUMNS FROM compras_asignacion LIKE 'precompra'");
  if (cols.length) {
    console.log('    Ya estaba aplicada.\n');
  } else {
    await pool.query('ALTER TABLE compras_asignacion ADD COLUMN precompra TINYINT(1) NOT NULL DEFAULT 0, ADD COLUMN precompra_at DATETIME NULL');
    console.log('    OK  columnas precompra / precompra_at creadas\n');
  }
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally {
  await pool.end();
}
