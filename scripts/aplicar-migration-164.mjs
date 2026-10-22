// Aplica migration-164: multi-cliente, paso A (clientes ampliada + usuarios.cliente_id/es_superadmin).
// Uso: node scripts/aplicar-migration-164.mjs
//
// Idempotente: cada ALTER se comprueba contra INFORMATION_SCHEMA (MySQL no tiene ADD COLUMN IF NOT EXISTS).
//
// PROTECCIÓN: se niega a correr contra algo que no sea la BD local de desarrollo (127.0.0.1:3308,
// licitank_dev). El desarrollo multi-cliente se hace SOLO en local; para llevarlo a producción hay que
// pasar --produccion a propósito.
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*([^#\r\n]*)/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}

// Base de PRUEBAS = la que se llama `licitank_dev` (en Docker local, puerto 3308, o la copia en el servidor por el túnel).
const esPruebas = env.DB_NAME === 'licitank_dev';
if (!esPruebas && !process.argv.includes('--produccion')) {
  console.error(`\n  ✗ .env.local no apunta a la base de pruebas licitank_dev (host=${env.DB_HOST} puerto=${env.DB_PORT} base=${env.DB_NAME}).`);
  console.error('    Esta migración es solo para la base de pruebas. Para aplicarla en producción: --produccion\n');
  process.exit(1);
}

const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000,
});

try {
  const sql = readFileSync('docs/migration-164-multicliente-base.sql', 'utf8').replace(/--.*$/gm, '');
  const sentencias = sql.split(';').map(s => s.trim()).filter(Boolean);

  const existeColumna = async (tabla, col) => {
    const [r] = await pool.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [tabla, col]);
    return r.length > 0;
  };
  const existeIndice = async (tabla, idx) => {
    const [r] = await pool.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`, [tabla, idx]);
    return r.length > 0;
  };

  console.log(`\n  Base: ${env.DB_NAME} (${env.DB_HOST}:${env.DB_PORT})`);
  for (const s of sentencias) {
    const col = s.match(/^ALTER TABLE (\w+) ADD COLUMN (\w+)/i);
    const idx = s.match(/^ALTER TABLE (\w+) ADD INDEX (\w+)/i);
    if (col) {
      if (await existeColumna(col[1], col[2])) { console.log(`    = ${col[1]}.${col[2]} ya existe`); continue; }
      await pool.query(s); console.log(`    + ${col[1]}.${col[2]}`);
    } else if (idx) {
      if (await existeIndice(idx[1], idx[2])) { console.log(`    = índice ${idx[2]} ya existe`); continue; }
      await pool.query(s); console.log(`    + índice ${idx[2]}`);
    } else {
      await pool.query(s); console.log('    · UPDATE cliente 1');
    }
  }

  const [[c1]] = await pool.query('SELECT id, nombre, plan, max_usuarios, estado, modulos FROM clientes WHERE id = 1');
  const [[u]] = await pool.query('SELECT COUNT(*) AS n, SUM(cliente_id = 1) AS en_cliente_1 FROM usuarios');
  console.log('\n  Cliente 1:', JSON.stringify(c1));
  console.log(`  Usuarios: ${u.n} (${u.en_cliente_1 ?? 0} en el cliente 1)\n`);
} finally {
  await pool.end();
}
