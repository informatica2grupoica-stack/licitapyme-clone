// Aplica migration-161: varios comprobantes por pago de OC (pedido del dueño, 21-oct-2026). El primero
// sigue en archivo_url/archivo_nombre; los demás van en adjuntos_json como [{url, nombre}]. Solo agrega una columna.
// Uso: node scripts/aplicar-migration-161.mjs
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
  console.log('\n  Aplicando migration-161 (compras_oc_pago.adjuntos_json)...');
  const [[r]] = await pool.query(
    `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='compras_oc_pago' AND COLUMN_NAME='adjuntos_json'`,
    [env.DB_NAME]);
  if (r.n > 0) console.log('  = compras_oc_pago.adjuntos_json ya estaba');
  else { await pool.query(`ALTER TABLE compras_oc_pago ADD COLUMN adjuntos_json TEXT DEFAULT NULL AFTER archivo_nombre`); console.log('  + compras_oc_pago.adjuntos_json'); }
  console.log('  Listo.\n');
} catch (e) {
  console.error('\n  Error:', e.message, '\n');
  process.exit(1);
} finally {
  await pool.end();
}
