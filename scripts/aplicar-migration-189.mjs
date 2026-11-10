// migration-189: RUT de empresa único por cliente (ver docs/migration-189-rut-empresa-por-cliente.sql). Idempotente.
// Uso:  node scripts/aplicar-migration-189.mjs              → ESPEJO local (127.0.0.1:3308, licitank_dev)
//       node scripts/aplicar-migration-189.mjs --produccion → la base de .env.local (DB_*) — solo con OK explícito del dueño
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

const indices = async () => {
  const [r] = await pool.query(
    `SELECT INDEX_NAME n, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) c FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'empresas' AND NON_UNIQUE = 0 GROUP BY INDEX_NAME`);
  return Object.fromEntries(r.map(x => [x.n, x.c]));
};

try {
  console.log(`\n  Base: ${conf.database} (${conf.host}:${conf.port})${produccion ? '  ← PRODUCCIÓN' : '  (espejo local)'}`);
  let ix = await indices();
  if (!ix.uq_empresa_cliente_rut) {
    // Si ya hay dos filas con el mismo (cliente, rut) el índice nuevo falla: se avisa y no se toca nada.
    const [dup] = await pool.query('SELECT cliente_id, rut, COUNT(*) n FROM empresas GROUP BY cliente_id, rut HAVING n > 1');
    if (dup.length) throw new Error('Hay RUT repetidos dentro de un mismo cliente: ' + JSON.stringify(dup));
    await pool.query('ALTER TABLE empresas ADD UNIQUE KEY uq_empresa_cliente_rut (cliente_id, rut)');
    console.log('  + índice uq_empresa_cliente_rut (cliente_id, rut)');
  } else console.log('  = uq_empresa_cliente_rut ya existe');
  ix = await indices();
  if (ix.uq_empresa_rut) {
    await pool.query('ALTER TABLE empresas DROP INDEX uq_empresa_rut');
    console.log('  - índice viejo uq_empresa_rut (rut) quitado');
  } else console.log('  = uq_empresa_rut ya no existe');
  console.log('  Únicos hoy:', JSON.stringify(await indices()), '\n');
} finally {
  await pool.end();
}
