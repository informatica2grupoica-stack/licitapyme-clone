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
console.log('Longitud texto BAE:', texto.length);
// Buscar la zona de CANASTA
const idx1 = texto.indexOf('CANASTA');
console.log('\n--- Contexto CANASTA (2000 chars) ---');
console.log(texto.slice(Math.max(0, idx1 - 200), idx1 + 3000));

await pool.end();
