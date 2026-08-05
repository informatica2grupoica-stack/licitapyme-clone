import { readFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const mysql = (await import('mysql2/promise')).default;
const pool = mysql.createPool({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 20000,
});
const codigos = ['1057678-2-LE26', '1058086-43-LP26', '539119-76-LP26', '1057480-41-LP26'];
const [rows] = await pool.query(
  `SELECT licitacion_codigo, estado_pipeline, empresa_id, activo FROM negocios WHERE licitacion_codigo IN (?)`,
  [codigos]
);
for (const r of rows) console.log(r);
await pool.end();
