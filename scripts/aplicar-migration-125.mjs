// Aplica migration-125: usuarios.telefono/rut/cargo/area/foto. Ver docs/migration-125-perfil-usuario.sql.
// Idempotente. Uso: node scripts/aplicar-migration-125.mjs
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

const COLUMNAS = [
  ['telefono', 'VARCHAR(20) NULL AFTER empresa'],
  ['rut', 'VARCHAR(12) NULL AFTER telefono'],
  ['cargo', 'VARCHAR(100) NULL AFTER rut'],
  ['area', 'VARCHAR(100) NULL AFTER cargo'],
  ['foto', 'MEDIUMTEXT NULL AFTER area'],
];

try {
  console.log('\n  Aplicando migration-125 (perfil de usuario)...');
  for (const [nombre, def] of COLUMNAS) {
    const [[r]] = await pool.query(
      `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='usuarios' AND COLUMN_NAME=?`,
      [env.DB_NAME, nombre]);
    if (r.n > 0) { console.log(`    ${nombre} ya existía`); continue; }
    await pool.query(`ALTER TABLE usuarios ADD COLUMN ${nombre} ${def}`);
    console.log(`    ${nombre} agregada`);
  }
  console.log('  Listo.\n');
} catch (e) {
  console.error('  Error:', e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
