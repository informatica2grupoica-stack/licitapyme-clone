// Aplica migration-123: tabla reportes_error (botón flotante "Reportar error" → /admin/errores).
// Ver docs/migration-123-reportes-error.sql. Idempotente. Uso: node scripts/aplicar-migration-123.mjs
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
  console.log('\n  Aplicando migration-123 (reportes_error)...');
  await pool.query(`CREATE TABLE IF NOT EXISTS reportes_error (
    id                  INT            NOT NULL AUTO_INCREMENT PRIMARY KEY,
    usuario_id          INT            NOT NULL,
    usuario_nombre      VARCHAR(200)       NULL,
    usuario_email       VARCHAR(200)       NULL,
    url                 VARCHAR(1000)  NOT NULL,
    titulo              VARCHAR(200)   NOT NULL,
    que_paso            TEXT           NOT NULL,
    que_esperaba        TEXT           NOT NULL,
    pasos               TEXT               NULL,
    gravedad            VARCHAR(20)    NOT NULL DEFAULT 'media',
    imagen_url          VARCHAR(1000)      NULL,
    contexto            JSON               NULL,
    estado              VARCHAR(20)    NOT NULL DEFAULT 'abierto',
    solucion            TEXT               NULL,
    resuelto_por        INT                NULL,
    resuelto_por_nombre VARCHAR(200)       NULL,
    resuelto_at         DATETIME           NULL,
    created_at          DATETIME       NOT NULL,
    updated_at          DATETIME       NOT NULL,
    INDEX idx_reportes_error_estado (estado, created_at),
    INDEX idx_reportes_error_usuario (usuario_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  console.log('    CREATE TABLE reportes_error OK');

  const t = await existe(`SELECT COUNT(*) n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME='reportes_error'`, [env.DB_NAME]);
  console.log(`  Verificación: tabla = ${t ? 'SÍ' : 'NO'}\n`);
  if (!t) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
