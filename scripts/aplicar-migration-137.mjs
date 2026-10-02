// Aplica migration-137: viabilidad v4.0 + nivel de atractivo v4.1. Ver
// docs/migration-137-viabilidad-v4-nivel.sql (única fuente del SQL; este script lo lee y lo ejecuta).
// Idempotente: los ALTER ... ADD COLUMN se saltan si la columna ya existe.
// Uso: node scripts/aplicar-migration-137.mjs
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

const sql = readFileSync('docs/migration-137-viabilidad-v4-nivel.sql', 'utf8')
  .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
const sentencias = sql.split(';').map(s => s.trim()).filter(Boolean);

async function columnaExiste(tabla, columna) {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?`,
    [env.DB_NAME, tabla, columna]);
  return r.n > 0;
}

try {
  console.log('\n  Aplicando migration-137 (viabilidad v4 + nivel de atractivo)...');
  for (const s of sentencias) {
    const m = s.match(/^ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(\w+)/i);
    if (m && await columnaExiste(m[1], m[2])) {
      console.log(`    --  ${m[1]}.${m[2]} ya existe`);
      continue;
    }
    await pool.query(s);
    console.log(`    OK  ${s.replace(/\s+/g, ' ').slice(0, 70)}...`);
  }
  const ok = await columnaExiste('viabilidad_licitacion', 'nivel_atractivo')
    && await columnaExiste('viabilidad_feedback', 'sin_destilar');
  const [[t]] = await pool.query(
    `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME='viabilidad_config'`, [env.DB_NAME]);
  console.log(`  Verificación: columnas nivel = ${ok ? 'SÍ' : 'NO'} · viabilidad_config = ${t.n > 0 ? 'SÍ' : 'NO'}`);
  if (!ok || t.n < 1) process.exitCode = 1;
} catch (e) {
  console.error('  Falló:', e.message); process.exitCode = 1;
} finally {
  await pool.end();
}
