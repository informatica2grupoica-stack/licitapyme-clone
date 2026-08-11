// Aplica migration-66: compras de Obuma cruzadas con licitaciones.
// Uso: node scripts/aplicar-migration-66.mjs
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000,
});

try {
  const sql = readFileSync('docs/migration-66-obuma-compras.sql', 'utf8').replace(/--.*$/gm, '');
  const sentencias = sql.split(';').map(s => s.trim()).filter(Boolean);
  for (const s of sentencias) await pool.query(s);
  console.log('  tabla obuma_compras ......... OK');
  const [t] = await pool.query(`SELECT COUNT(*) AS n FROM obuma_compras`);
  console.log(`\n  Listo. Compras Obuma guardadas: ${t[0].n}`);
} catch (e) {
  console.error('\n  ERROR:', e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
