// Aplica migration-129: tabla del Auditor de Compra (etapa comercial). Ver
// docs/migration-129-auditor-compra-comercial.sql. Idempotente (CREATE TABLE IF NOT EXISTS).
// Uso: node scripts/aplicar-migration-129.mjs
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
  console.log('\n  Aplicando migration-129 (auditor de compra · comercial)...');
  const sql = readFileSync('docs/migration-129-auditor-compra-comercial.sql', 'utf8')
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  for (const stmt of sql.split(';').map(s => s.trim()).filter(Boolean)) await pool.query(stmt);
  const [rows] = await pool.query(
    `SELECT table_name n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'negocio_auditor_compra_linea'`);
  const nombres = rows.map(r => r.n ?? r.N ?? r.TABLE_NAME);
  console.log('  Tablas presentes:', nombres.join(', '));
  if (nombres.length < 1) { console.error('  ERROR: falta la tabla.'); process.exitCode = 1; } else console.log('  OK.\n');
} catch (e) {
  console.error('  Falló:', e.message); process.exitCode = 1;
} finally {
  await pool.end();
}
