// migration-210: solicitudes de alta de empresas (tabla cliente_solicitud). Idempotente. Solo AGREGA una tabla.
// Uso:  node scripts/aplicar-migration-210.mjs              → ESPEJO local (127.0.0.1:3308, licitank_dev)
//       node scripts/aplicar-migration-210.mjs --produccion → la base de .env.local (DB_*) — solo con OK explícito del dueño
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
try {
  console.log(`\n  Base: ${conf.database} (${conf.host}:${conf.port})${produccion ? '  ← PRODUCCIÓN' : '  (espejo local)'}`);
  await pool.query(`CREATE TABLE IF NOT EXISTS cliente_solicitud (
      id                INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
      razon_social      VARCHAR(200) NOT NULL,
      rut               VARCHAR(20)  NOT NULL,
      contacto_nombre   VARCHAR(150) NOT NULL,
      contacto_email    VARCHAR(190) NOT NULL,
      contacto_telefono VARCHAR(40)  NULL,
      mensaje           VARCHAR(500) NULL,
      estado            VARCHAR(12)  NOT NULL DEFAULT 'PENDIENTE',
      ip                VARCHAR(64)  NULL,
      cliente_id        INT          NULL,
      resuelta_por      INT          NULL,
      resuelta_at       DATETIME     NULL,
      motivo            VARCHAR(300) NULL,
      created_at        DATETIME     NOT NULL,
      KEY idx_estado (estado, created_at),
      KEY idx_email (contacto_email),
      KEY idx_ip (ip, created_at)
    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  console.log('  ✓ tabla cliente_solicitud\n');
} finally {
  await pool.end();
}
