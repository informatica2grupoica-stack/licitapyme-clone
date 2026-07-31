// Aplica migration-60: memoria histórica OC↔factura (Frente F.3), multi-cliente desde el origen.
// Uso: node scripts/aplicar-migration-60.mjs
//
// Idempotente. Los ALTER sobre `empresas` se comprueban contra INFORMATION_SCHEMA porque esta
// versión de MySQL (Bluehost) NO soporta "ADD COLUMN IF NOT EXISTS" (verificado con migration-51).
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000,
});

const TABLAS = ['clientes', 'experiencia_caso', 'experiencia_item', 'experiencia_documento'];

try {
  const sql = readFileSync('docs/migration-60-memoria-historica.sql', 'utf8').replace(/--.*$/gm, '');
  const sentencias = sql.split(';').map(s => s.trim()).filter(Boolean);

  console.log('\n  Creando tablas y sembrando el cliente 1...');
  for (const s of sentencias) {
    if (/^ALTER TABLE empresas/i.test(s)) continue;   // se maneja aparte, más abajo
    await pool.query(s);
  }
  console.log('    OK');

  // Columna puente empresas.cliente_id (+ índice), solo si falta.
  const [[colYa]] = await pool.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA=? AND TABLE_NAME='empresas' AND COLUMN_NAME='cliente_id'`, [env.DB_NAME]);
  if (colYa.n > 0) {
    console.log('    empresas.cliente_id: ya existía');
  } else {
    await pool.query(`ALTER TABLE empresas ADD COLUMN cliente_id INT NOT NULL DEFAULT 1`);
    console.log('    empresas.cliente_id: agregada (todas las empresas actuales → cliente 1)');
  }
  const [[idxYa]] = await pool.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA=? AND TABLE_NAME='empresas' AND INDEX_NAME='idx_empresas_cliente'`, [env.DB_NAME]);
  if (idxYa.n === 0) {
    await pool.query(`ALTER TABLE empresas ADD INDEX idx_empresas_cliente (cliente_id)`);
    console.log('    idx_empresas_cliente: creado');
  }

  const [[chk]] = await pool.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA=? AND TABLE_NAME IN (?, ?, ?, ?)`, [env.DB_NAME, ...TABLAS]);
  console.log(`\n  Verificación: ${chk.n}/${TABLAS.length} tablas (${TABLAS.join(', ')})\n`);
  if (chk.n < TABLAS.length) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally {
  await pool.end();
}
