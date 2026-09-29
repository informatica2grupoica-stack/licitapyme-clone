// Aplica migration-132: extracción por documento en el AUDITOR. Ver
// docs/migration-132-auditor-extraccion-documento.sql. Idempotente: comprueba cada columna/índice.
// Uso: node scripts/aplicar-migration-132.mjs
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

const columnaExiste = async (tabla, columna) => {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?`,
    [env.DB_NAME, tabla, columna]);
  return r.n > 0;
};
const indiceExiste = async (tabla, indice) => {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND INDEX_NAME=?`,
    [env.DB_NAME, tabla, indice]);
  return r.n > 0;
};

try {
  console.log('\n  Aplicando migration-132 (AUDITOR · extracción por documento)...');

  // MODIFY ... NULL es idempotente por sí mismo.
  await pool.query(`ALTER TABLE auditor_extraccion MODIFY respaldo_id INT NULL, MODIFY opcion_id INT NULL`);
  console.log('    auditor_extraccion.respaldo_id / opcion_id → NULL OK');

  const columnas = [
    ['auditor_extraccion', 'negocio_id', 'INT NULL'],
    ['auditor_extraccion', 'documento_url', 'VARCHAR(1000) NULL'],
    ['auditor_extraccion', 'documento_nombre', 'VARCHAR(300) NULL'],
    ['auditor_extraccion', 'error', 'VARCHAR(500) NULL'],
    ['auditor_respaldo', 'extraccion_id', 'INT NULL'],
    ['auditor_respaldo', 'producto_idx', 'INT NULL'],
  ];
  for (const [tabla, col, def] of columnas) {
    if (await columnaExiste(tabla, col)) { console.log(`    ${tabla}.${col} ya existe — se salta.`); continue; }
    await pool.query(`ALTER TABLE ${tabla} ADD COLUMN ${col} ${def}`);
    console.log(`    ALTER ${tabla}.${col} OK`);
  }
  if (await indiceExiste('auditor_extraccion', 'idx_auditor_extraccion_negocio')) {
    console.log('    índice idx_auditor_extraccion_negocio ya existe — se salta.');
  } else {
    await pool.query(`ALTER TABLE auditor_extraccion ADD INDEX idx_auditor_extraccion_negocio (negocio_id)`);
    console.log('    ADD INDEX idx_auditor_extraccion_negocio OK');
  }

  let ok = true;
  for (const [tabla, col] of columnas) {
    const e = await columnaExiste(tabla, col);
    if (!e) ok = false;
    console.log(`  Verificación: ${tabla}.${col} = ${e ? 'SÍ' : 'NO'}`);
  }
  if (!ok) process.exitCode = 1;
} catch (e) {
  console.error('  Falló:', e.message); process.exitCode = 1;
} finally {
  await pool.end();
}
