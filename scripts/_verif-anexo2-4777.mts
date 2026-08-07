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

const codigo = '4777-24-LE26';
// TODAS las filas de documentos_cache para esta licitación que mencionen ANEXO, con su URL exacta y timestamps
const [rows]: any = await pool.query(
  `SELECT id, documento_nombre, documento_url_local, size_bytes, categoria, created_at, updated_at
     FROM documentos_cache WHERE licitacion_codigo=? AND documento_nombre LIKE '%ANEXO%' ORDER BY documento_nombre`,
  [codigo],
);
console.log('Filas en documentos_cache para', codigo, ':');
for (const r of rows) {
  console.log(`  id=${r.id} nombre="${r.documento_nombre}" size=${r.size_bytes} categoria=${r.categoria} url=${r.documento_url_local} created=${r.created_at} updated=${r.updated_at}`);
}

await pool.end();
