// Aplica migration-156: datos para facturar leídos del acta de adjudicación (adjudicacion_cache).
// NULL = el acta nunca se leyó con este campo; el cron de Compras la vuelve a leer sola.
// Uso: node scripts/aplicar-migration-156.mjs
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
  console.log('\n  Aplicando migration-156 (facturacion_json en adjudicacion_cache)...');
  const [[r]] = await pool.query(
    `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='adjudicacion_cache' AND COLUMN_NAME='facturacion_json'`,
    [env.DB_NAME]);
  if (r.n > 0) console.log('  La columna ya estaba.\n');
  else {
    await pool.query(`ALTER TABLE adjudicacion_cache ADD COLUMN facturacion_json TEXT DEFAULT NULL`);
    console.log('  + columna facturacion_json agregada\n');
  }
} catch (e) {
  console.error('\n  Error:', e.message, '\n');
  process.exit(1);
} finally {
  await pool.end();
}
