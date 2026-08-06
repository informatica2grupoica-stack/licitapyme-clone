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

const { extraerSeccionesLineaProducto } = await import('../app/lib/planilla-costeo-parser.ts');

const codigo = '707423-56-LE26';
const [docs] = await pool.query(
  `SELECT documento_nombre AS nombre, texto_extraido AS texto, categoria
   FROM documentos_cache WHERE licitacion_codigo=? AND texto_extraido IS NOT NULL`,
  [codigo]
);
const fuentes = docs.filter(d => (d.categoria || '').toUpperCase() !== 'DOCUMENTOS_PROPIOS' && !/^COSTEO_/i.test(d.nombre));

const secciones = extraerSeccionesLineaProducto(fuentes.map(d => ({ nombre: d.nombre, texto: d.texto })));
console.log(`Secciones encontradas: ${secciones.length}`);
for (const s of secciones) {
  console.log(` - línea ${s.linea} "${s.nombre}" (${s.texto.length} chars)`);
}

await pool.end();
