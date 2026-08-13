import { readFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim(); }
const mysql = (await import('mysql2/promise')).default;
const COD = '1063534-4-LE26';
const pool = mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 20000 });
const [rows] = await pool.query(
  `SELECT texto_extraido AS texto FROM documentos_cache WHERE licitacion_codigo = ? AND documento_nombre = 'Formularios_word.docx'`,
  [COD],
) as any[];
const texto = (rows as any[])[0]?.texto || '';
console.log(texto.slice(3000));
await pool.end();
