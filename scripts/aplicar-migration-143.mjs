// Aplica migration-143: Gantt de Compras por fases (columnas fase/ancla/desfase_horas/duracion_horas
// en compras_tarea_catalogo + 7 tareas nuevas). Ver docs/migration-143-compras-gantt-fases.sql
// (única fuente del SQL). Idempotente: salta las columnas que ya existen.
// Uso: node scripts/aplicar-migration-143.mjs
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

const sql = readFileSync('docs/migration-143-compras-gantt-fases.sql', 'utf8')
  .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
const sentencias = sql.split(';').map(x => x.trim()).filter(Boolean);

try {
  console.log('\n  Aplicando migration-143 (Gantt de Compras por fases)...');
  const [cols] = await pool.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'compras_tarea_catalogo'`);
  const existentes = new Set(cols.map(c => c.COLUMN_NAME));
  for (const s of sentencias) {
    if (/^ALTER TABLE/i.test(s)) {
      const nuevas = ['fase', 'ancla', 'desfase_horas', 'duracion_horas'].filter(c => !existentes.has(c));
      if (nuevas.length === 0) { console.log('    columnas ya existen'); continue; }
      const defs = { fase: 'VARCHAR(12) NULL', ancla: 'VARCHAR(16) NULL', desfase_horas: 'INT NULL', duracion_horas: 'INT NULL' };
      await pool.query(`ALTER TABLE compras_tarea_catalogo ${nuevas.map(c => `ADD COLUMN ${c} ${defs[c]}`).join(', ')}`);
      console.log(`    columnas agregadas: ${nuevas.join(', ')}`);
      continue;
    }
    const [r] = await pool.query(s);
    console.log(`    ${s.split('\n')[0].slice(0, 60)}… → ${r.affectedRows} fila(s)`);
  }
  const [ver] = await pool.query(
    `SELECT clave, fase, ancla, desfase_horas, duracion_horas, plazo_dias FROM compras_tarea_catalogo WHERE activo = 1 ORDER BY orden`);
  console.table(ver);
  console.log();
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally {
  await pool.end();
}
