// Aplica migration-122: tabla obuma_proyectos_reales (snapshot leído a mano de la web de Obuma).
// Ver docs/migration-122-obuma-proyectos-reales.sql. Idempotente. Uso: node scripts/aplicar-migration-122.mjs
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

const existe = async (sql, params) => { const [[r]] = await pool.query(sql, params); return r.n > 0; };

try {
  console.log('\n  Aplicando migration-122 (obuma_proyectos_reales)...');
  await pool.query(`CREATE TABLE IF NOT EXISTS obuma_proyectos_reales (
    folio            INT           NOT NULL PRIMARY KEY,
    fecha_ingreso    DATE              NULL,
    fecha_inicio     DATE              NULL,
    nombre           VARCHAR(300)      NULL,
    referencia       VARCHAR(200)      NULL,
    cliente          VARCHAR(300)      NULL,
    presupuesto      DECIMAL(14,2)     NULL,
    costo            DECIMAL(14,2)     NULL,
    precio_neto      DECIMAL(14,2)     NULL,
    facturado_neto   DECIMAL(14,2)     NULL,
    estado           VARCHAR(40)       NULL,
    capturado_at     DATETIME      NOT NULL,
    INDEX idx_obuma_proy_reales_referencia (referencia)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  console.log('    CREATE TABLE obuma_proyectos_reales OK');

  const t = await existe(`SELECT COUNT(*) n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME='obuma_proyectos_reales'`, [env.DB_NAME]);
  console.log(`  Verificación: tabla = ${t ? 'SÍ' : 'NO'}\n`);
  if (!t) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
