// Aplica migration-121: tabla compras_auditoria_cotizacion (dictamen del auditor por cotización ×
// producto) + compras_cotizacion.texto_documento. Ver docs/migration-121-compras-auditoria-cotizacion.sql.
// Idempotente. Uso: node scripts/aplicar-migration-121.mjs
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
  console.log('\n  Aplicando migration-121 (auditoría de cotizaciones)...');
  await pool.query(`CREATE TABLE IF NOT EXISTS compras_auditoria_cotizacion (
    id INT AUTO_INCREMENT PRIMARY KEY,
    negocio_id INT NOT NULL, cotizacion_id INT NOT NULL, producto_id INT NOT NULL,
    dictamen VARCHAR(24) NOT NULL, resumen TEXT NULL, revisiones_json LONGTEXT NULL, modelo VARCHAR(40) NULL,
    generado_at DATETIME NOT NULL, generado_por INT NULL, generado_por_nombre VARCHAR(160) NULL,
    cumple_aplicado VARCHAR(24) NULL,
    override_cumple VARCHAR(24) NULL, override_motivo TEXT NULL, override_por INT NULL,
    override_por_nombre VARCHAR(160) NULL, override_at DATETIME NULL,
    UNIQUE KEY uk_auditoria_cot_prod (cotizacion_id, producto_id),
    INDEX idx_auditoria_cot_negocio (negocio_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  console.log('    CREATE TABLE compras_auditoria_cotizacion OK');

  const tieneCol = await existe(
    `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='compras_cotizacion' AND COLUMN_NAME='texto_documento'`, [env.DB_NAME]);
  if (tieneCol) console.log('    compras_cotizacion.texto_documento ya existe — se salta.');
  else { await pool.query('ALTER TABLE compras_cotizacion ADD COLUMN texto_documento LONGTEXT NULL'); console.log('    ALTER compras_cotizacion ADD texto_documento OK'); }

  const t = await existe(`SELECT COUNT(*) n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME='compras_auditoria_cotizacion'`, [env.DB_NAME]);
  const c = await existe(`SELECT COUNT(*) n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='compras_cotizacion' AND COLUMN_NAME='texto_documento'`, [env.DB_NAME]);
  console.log(`  Verificación: tabla = ${t ? 'SÍ' : 'NO'} · columna texto_documento = ${c ? 'SÍ' : 'NO'}\n`);
  if (!t || !c) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
