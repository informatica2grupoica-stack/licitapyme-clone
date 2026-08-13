import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';
import { parsearPlanillaCosteo } from '../app/lib/planilla-costeo-parser';

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
  `SELECT documento_nombre AS nombre, categoria, texto_extraido AS texto, metodo_extraccion AS metodo
   FROM documentos_cache WHERE licitacion_codigo = ? ORDER BY id`,
  [codigo]
);

console.log('Documentos cargados:', rows.map((r: any) => `${r.nombre} (metodo=${r.metodo}, len=${(r.texto||'').length})`));

const resultado = parsearPlanillaCosteo(rows);
console.log('=== RESULTADO parsearPlanillaCosteo ===');
console.log(resultado ? { fuenteDoc: resultado.fuenteDoc, estructura: resultado.estructura, nItems: resultado.items.length, numeracion: resultado.numeracion } : null);

await pool.end();
