// Aplica migration-144: «Aceptación de la OC» con ancla LIMITE_OC.
// Ver docs/migration-144-compras-aceptar-oc-limite.sql (única fuente del SQL). Idempotente.
// Uso: node scripts/aplicar-migration-144.mjs
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

const sql = readFileSync('docs/migration-144-compras-aceptar-oc-limite.sql', 'utf8')
  .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

try {
  console.log('\n  Aplicando migration-144 (aceptar_oc → LIMITE_OC)...');
  for (const s of sql.split(';').map(x => x.trim()).filter(Boolean)) {
    const [r] = await pool.query(s);
    console.log(`    ${r.affectedRows} fila(s)`);
  }
  const [[v]] = await pool.query("SELECT ancla, plazo_dias FROM compras_tarea_catalogo WHERE clave = 'aceptar_oc'");
  console.log(`    OK  aceptar_oc → ${v.ancla}, plazo_dias=${v.plazo_dias}\n`);
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally {
  await pool.end();
}
