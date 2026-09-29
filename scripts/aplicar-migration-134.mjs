// Aplica migration-134: auditor_verificacion_costo y auditor_posicion_precio. Ver
// docs/migration-134-auditor-costo-extendido.sql (única fuente del SQL; este script lo lee y lo ejecuta). Idempotente.
// Uso: node scripts/aplicar-migration-134.mjs
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

const sql = readFileSync('docs/migration-134-auditor-costo-extendido.sql', 'utf8')
  .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
const sentencias = sql.split(';').map(s => s.trim()).filter(Boolean);

const TABLAS = ['auditor_verificacion_costo', 'auditor_posicion_precio'];

try {
  console.log('\n  Aplicando migration-134 (AUDITOR · costo extendido y posición de precio)...');
  for (const s of sentencias) {
    const [res] = await pool.query(s);
    const etiqueta = s.replace(/\s+/g, ' ').slice(0, 60);
    console.log(`    OK  ${etiqueta}...${res?.affectedRows != null && /^INSERT/i.test(s) ? `  (${res.affectedRows} filas)` : ''}`);
  }

  let ok = true;
  for (const t of TABLAS) {
    const [[r]] = await pool.query(
      `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`, [env.DB_NAME, t]);
    console.log(`  Verificación: ${t} = ${r.n > 0 ? 'SÍ' : 'NO'}`);
    if (r.n < 1) ok = false;
  }
  if (!ok) process.exitCode = 1;
} catch (e) {
  console.error('  Falló:', e.message); process.exitCode = 1;
} finally {
  await pool.end();
}
