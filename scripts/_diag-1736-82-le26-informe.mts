import mysql from 'mysql2/promise';
import { readFileSync, writeFileSync } from 'node:fs';

const env: Record<string, string> = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000,
});

const codigo = '1736-82-LE26';

const [rows]: any = await pool.query(
  `SELECT informe_ejecutivo FROM viabilidad_licitacion WHERE licitacion_codigo = ?`,
  [codigo]
);
const inf = rows[0].informe_ejecutivo;
const obj = typeof inf === 'string' ? JSON.parse(inf) : inf;

console.log('=== manifiesto_productos (length) ===', Array.isArray(obj.manifiesto_productos) ? obj.manifiesto_productos.length : 'N/A');
console.log(JSON.stringify(obj.manifiesto_productos, null, 2));

console.log('=== productos?.items (length) ===', Array.isArray(obj.productos?.items) ? obj.productos.items.length : 'N/A');
console.log(JSON.stringify(obj.productos?.items, null, 2));

console.log('=== modalidad / estructura_costeo ===');
console.log(obj.modalidad, obj.estructura_costeo);

console.log('=== documentos_leidos ===');
console.log(obj.documentos_leidos);
console.log('=== documentos_no_leidos ===');
console.log(obj.documentos_no_leidos);

const outFile = 'C:/Users/droku/AppData/Local/Temp/claude/D--licitapyme-clone/c0a29e2d-c4a3-400e-88ba-b824862a8dc2/scratchpad/informe_1736-82-LE26.json';
writeFileSync(outFile, JSON.stringify(obj, null, 2), 'utf8');
console.log('Guardado en', outFile);

await pool.end();
