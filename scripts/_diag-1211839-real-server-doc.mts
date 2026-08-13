import { readFileSync, writeFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim(); }
const mysql = (await import('mysql2/promise')).default;
const pool = mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 20000 });
const [rows] = await pool.query(
  `SELECT id, documento_nombre, documento_url_local, categoria, created_at, updated_at
     FROM documentos_cache WHERE licitacion_codigo = ? AND documento_nombre LIKE '%FORMULARIO%' ORDER BY id DESC`,
  ['1211839-58-LE26'],
) as any[];
console.log(JSON.stringify(rows, null, 2));
await pool.end();
