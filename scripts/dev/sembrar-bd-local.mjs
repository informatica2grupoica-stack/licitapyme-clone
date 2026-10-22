// Siembra la BD LOCAL de desarrollo (Docker `licitank-dev-db`, ver docker-compose.dev-db.yml).
// Uso: node scripts/dev/sembrar-bd-local.mjs
//
// Crea lo mínimo para poder entrar: el cliente 1 (Grupo ICA) y un usuario administrador de prueba.
// Idempotente. SE NIEGA a correr si .env.local no apunta a la base local: así nunca siembra
// usuarios de prueba en producción por error (el túnel al VPS es el puerto 3307).
//
// Usuario de prueba local:  admin@local.test  /  Local-Licitank-1
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*([^#\r\n]*)/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}

// Solo la base de PRUEBAS (`licitank_dev`: Docker local o la copia en el servidor), nunca la de producción.
if (env.DB_NAME !== 'licitank_dev') {
  console.error(`\n  ✗ .env.local NO apunta a la base de pruebas (host=${env.DB_HOST} puerto=${env.DB_PORT} base=${env.DB_NAME}).`);
  console.error('    No siembro nada. Para trabajar en pruebas: DB_NAME=licitank_dev.\n');
  process.exit(1);
}

const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: Number(env.DB_PORT), connectTimeout: 10000,
});

try {
  await pool.query(
    `INSERT INTO clientes (id, nombre, rut) VALUES (1, 'Grupo ICA', NULL)
     ON DUPLICATE KEY UPDATE nombre = VALUES(nombre)`,
  );
  const hash = await bcrypt.hash('Local-Licitank-1', 10);
  await pool.query(
    `INSERT INTO usuarios (email, password_hash, nombre, empresa, rol, activo)
     VALUES ('admin@local.test', ?, 'Admin Local', 'Grupo ICA', 'admin', 1)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), activo = 1, rol = 'admin'`,
    [hash],
  );
  const [[c]] = await pool.query('SELECT COUNT(*) AS n FROM clientes');
  const [[u]] = await pool.query('SELECT COUNT(*) AS n FROM usuarios');
  console.log(`\n  ✓ BD local sembrada: ${c.n} cliente(s), ${u.n} usuario(s).\n`);
} finally {
  await pool.end();
}
