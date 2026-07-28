import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000,
});

const codigo = '1271359-92-LE26';
const [rows] = await pool.query(
  `SELECT documento_nombre, texto_extraido FROM documentos_cache WHERE licitacion_codigo=? AND documento_nombre LIKE 'BAE%'`,
  [codigo]
);
const texto = rows[0]?.texto_extraido || '';
// Buscar todas las ocurrencias de CANASTA
let idx = -1;
let count = 0;
while ((idx = texto.indexOf('CANASTA', idx + 1)) !== -1 && count < 10) {
  console.log(`\n=== Ocurrencia @${idx} ===`);
  console.log(texto.slice(idx, idx + 150).replace(/\n/g, ' | '));
  count++;
}
// Buscar palabras clave de productos cerca de "N° ITEM" o similar
const idx2 = texto.indexOf('N° ITEM');
if (idx2 === -1) console.log('\n(no se encontró "N° ITEM" literal)');
else { console.log('\n--- Zona N° ITEM (3000 chars) ---'); console.log(texto.slice(idx2 - 200, idx2 + 3000)); }

await pool.end();
