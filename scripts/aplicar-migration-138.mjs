// Aplica migration-138: hilos en los comentarios. Ver docs/migration-138-comentarios-hilos.sql
// (única fuente del SQL; este script lo lee y lo ejecuta).
// Idempotente: salta las columnas y los índices que ya existen.
// Uso: node scripts/aplicar-migration-138.mjs
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

const sql = readFileSync('docs/migration-138-comentarios-hilos.sql', 'utf8')
  .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
const sentencias = sql.split(';').map(s => s.trim()).filter(Boolean);

async function columnaExiste(tabla, columna) {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?`,
    [env.DB_NAME, tabla, columna]);
  return r.n > 0;
}

try {
  console.log('\n  Aplicando migration-138 (hilos en los comentarios)...');
  for (const s of sentencias) {
    const col = s.match(/^ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(\w+)/i);
    if (col && await columnaExiste(col[1], col[2])) {
      console.log(`    --  ${col[1]}.${col[2]} ya existe`);
      continue;
    }
    try {
      await pool.query(s);
      console.log(`    OK  ${s.replace(/\s+/g, ' ').slice(0, 70)}...`);
    } catch (e) {
      if (e.code === 'ER_DUP_KEYNAME') { console.log(`    --  índice ya existe: ${s.replace(/\s+/g, ' ').slice(0, 60)}`); continue; }
      throw e;
    }
  }
  const ok = await columnaExiste('comentarios_licitacion', 'padre_id') && await columnaExiste('comentarios_negocio', 'padre_id');
  console.log(`  Verificación: padre_id en ambas tablas = ${ok ? 'SÍ' : 'NO'}`);
  if (!ok) process.exitCode = 1;
} catch (e) {
  console.error('  Falló:', e.message); process.exitCode = 1;
} finally {
  await pool.end();
}
