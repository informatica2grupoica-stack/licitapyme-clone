// Aplica migration-167: `cliente_id` en las tablas privadas de Radar y Negocios (multi-cliente, paso B).
// Uso:  node scripts/aplicar-migration-167.mjs              → ESPEJO local (127.0.0.1:3308, licitank_dev)
//       node scripts/aplicar-migration-167.mjs --produccion → la base de .env.local (DB_*) — solo con OK explícito del dueño
//
// Idempotente: cada sentencia se comprueba contra INFORMATION_SCHEMA (MySQL no tiene ADD COLUMN IF NOT EXISTS).
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';

const produccion = process.argv.includes('--produccion');
const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*([^#\r\n]*)/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const conf = produccion
  ? { host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306') }
  : { host: '127.0.0.1', user: 'licitank', password: 'licitank_local', database: 'licitank_dev', port: 3308 };
const pool = mysql.createPool({ ...conf, connectTimeout: 20000 });

const existeTabla = async (t) => (await pool.query(`SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`, [t]))[0].length > 0;
const existeColumna = async (t, c) => (await pool.query(`SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?`, [t, c]))[0].length > 0;
const existeIndice = async (t, i) => (await pool.query(`SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?`, [t, i]))[0].length > 0;
const pkIncluye = async (t, c) => (await pool.query(`SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME='PRIMARY' AND COLUMN_NAME=?`, [t, c]))[0].length > 0;

try {
  const sql = readFileSync('docs/migration-167-multicliente-tablas-privadas.sql', 'utf8').replace(/--.*$/gm, '');
  const sentencias = sql.split(';').map(s => s.trim()).filter(Boolean);
  console.log(`\n  Base: ${conf.database} (${conf.host}:${conf.port})${produccion ? '  ← PRODUCCIÓN' : '  (espejo local)'}`);
  for (const s of sentencias) {
    const tabla = s.match(/^ALTER TABLE (\w+)/i)[1];
    if (!(await existeTabla(tabla))) { console.log(`    ! ${tabla} no existe, se omite`); continue; }
    let hecho = false, etiqueta = '';
    const col = s.match(/ADD COLUMN (\w+)/i), idx = s.match(/ADD (?:UNIQUE )?INDEX (\w+)/i), pk = /ADD PRIMARY KEY/i.test(s);
    if (col)      { etiqueta = `${tabla}.${col[1]}`;     hecho = await existeColumna(tabla, col[1]); }
    else if (pk)  { etiqueta = `${tabla} PK con cliente_id`; hecho = await pkIncluye(tabla, 'cliente_id'); }
    else if (idx) { etiqueta = `${tabla} índice ${idx[1]}`;  hecho = await existeIndice(tabla, idx[1]); }
    if (hecho) { console.log(`    = ${etiqueta} ya está`); continue; }
    await pool.query(s); console.log(`    + ${etiqueta}`);
  }
  const [[r]] = await pool.query(`SELECT COUNT(*) n FROM usuarios WHERE cliente_id = 1`);
  console.log(`\n  Usuarios en cliente 1: ${r.n}\n`);
} finally { await pool.end(); }
