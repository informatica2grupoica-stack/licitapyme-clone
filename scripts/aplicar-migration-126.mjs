// Aplica migration-126: tabla compras_cierre_resultado (cierre con resultado final de Compras).
// Ver docs/migration-126-compras-cierre-resultado.sql. Idempotente. Uso: node scripts/aplicar-migration-126.mjs
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
  console.log('\n  Aplicando migration-126 (compras_cierre_resultado)...');
  const sql = readFileSync('docs/migration-126-compras-cierre-resultado.sql', 'utf8')
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  await pool.query(sql);
  const [[r]] = await pool.query(`SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'compras_cierre_resultado'`);
  console.log(r.n > 0 ? '  OK: la tabla existe.\n' : '  ERROR: la tabla no quedó creada.\n');
} catch (e) {
  console.error('  Falló:', e.message); process.exitCode = 1;
} finally {
  await pool.end();
}
