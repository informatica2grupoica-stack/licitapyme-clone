// migration-197: cola de la evaluación por RUT + caché pública de OC de MP (ver docs/migration-197-evaluacion-rut-cola.sql). Idempotente.
// Uso:  node scripts/aplicar-migration-197.mjs              → ESPEJO local (127.0.0.1:3308, licitank_dev)
//       node scripts/aplicar-migration-197.mjs --produccion → la base de .env.local (DB_*) — solo con OK explícito del dueño
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

const columnas = async (t) => {
  const [r] = await pool.query('SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [t]);
  return new Set(r.map(x => x.c));
};
const indices = async (t) => {
  const [r] = await pool.query('SELECT DISTINCT INDEX_NAME n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [t]);
  return new Set(r.map(x => x.n));
};

try {
  console.log(`\n  Base: ${conf.database} (${conf.host}:${conf.port})${produccion ? '  ← PRODUCCIÓN' : '  (espejo local)'}`);
  const col = await columnas('cliente_evaluacion');
  if (!col.has('cursor')) { await pool.query('ALTER TABLE cliente_evaluacion ADD COLUMN `cursor` JSON NULL'); console.log('  + cliente_evaluacion.cursor'); }
  else console.log('  = cliente_evaluacion.cursor ya existe');
  if (!col.has('reintentar_at')) { await pool.query('ALTER TABLE cliente_evaluacion ADD COLUMN reintentar_at DATETIME NULL'); console.log('  + cliente_evaluacion.reintentar_at'); }
  else console.log('  = cliente_evaluacion.reintentar_at ya existe');
  if (!(await indices('cliente_evaluacion')).has('ix_cliente_evaluacion_estado')) {
    await pool.query('ALTER TABLE cliente_evaluacion ADD INDEX ix_cliente_evaluacion_estado (estado, reintentar_at)'); console.log('  + índice ix_cliente_evaluacion_estado');
  } else console.log('  = índice ix_cliente_evaluacion_estado ya existe');
  await pool.query(`CREATE TABLE IF NOT EXISTS mp_oc_publica (
      codigo VARCHAR(40) NOT NULL PRIMARY KEY, proveedor_rut VARCHAR(20) NULL, raw_json LONGTEXT NOT NULL,
      fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX ix_mp_oc_publica_rut (proveedor_rut)
    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  console.log('  ✓ tabla mp_oc_publica');
  await pool.query(`CREATE TABLE IF NOT EXISTS mp_oc_proveedor_dia (
      codigo_proveedor VARCHAR(30) NOT NULL, fecha DATE NOT NULL, codigos JSON NOT NULL,
      fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (codigo_proveedor, fecha)
    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  console.log('  ✓ tabla mp_oc_proveedor_dia');
  // 3) dueño de cada OC «nuestra»
  if (!(await columnas('ordenes_compra')).has('cliente_id')) { await pool.query('ALTER TABLE ordenes_compra ADD COLUMN cliente_id INT NULL'); console.log('  + ordenes_compra.cliente_id'); }
  else console.log('  = ordenes_compra.cliente_id ya existe');
  if (!(await indices('ordenes_compra')).has('ix_ordenes_compra_cliente_lic')) {
    await pool.query('ALTER TABLE ordenes_compra ADD INDEX ix_ordenes_compra_cliente_lic (cliente_id, licitacion_codigo)'); console.log('  + índice ix_ordenes_compra_cliente_lic');
  } else console.log('  = índice ix_ordenes_compra_cliente_lic ya existe');
  const [r1] = await pool.query('UPDATE ordenes_compra o JOIN empresas e ON e.id = o.empresa_id SET o.cliente_id = e.cliente_id WHERE o.es_nuestra = 1 AND o.cliente_id IS NULL');
  const [r2] = await pool.query('UPDATE ordenes_compra SET cliente_id = 1 WHERE es_nuestra = 1 AND cliente_id IS NULL');
  console.log(`  ✓ OC nuestras con dueño: ${r1.affectedRows} por su razón social, ${r2.affectedRows} sin razón social → Grupo ICA`);
  const [cnt] = await pool.query('SELECT COALESCE(cliente_id, 0) c, es_nuestra n, COUNT(*) k FROM ordenes_compra GROUP BY 1, 2 ORDER BY 1, 2');
  console.log('  Reparto (cliente 0 = sin dueño/terceros):', JSON.stringify(cnt), '\n');
} finally {
  await pool.end();
}
