// Aplica migration-139: tabla ia_uso (gasto de IA por perfil/módulo).
// Ver docs/migration-139-ia-uso.sql (única fuente del SQL). Idempotente.
// Uso: node scripts/aplicar-migration-139.mjs
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

const sql = readFileSync('docs/migration-139-ia-uso.sql', 'utf8')
  .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

try {
  console.log('\n  Aplicando migration-139 (ia_uso)...');
  for (const s of sql.split(';').map(x => x.trim()).filter(Boolean)) await pool.query(s);
  const [[r]] = await pool.query('SELECT COUNT(*) n FROM ia_uso');
  console.log(`    OK  ia_uso lista (${r.n} filas)\n`);
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally {
  await pool.end();
}
