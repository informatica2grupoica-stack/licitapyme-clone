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

const [docs] = await pool.query(
  `SELECT id, documento_nombre, categoria, subcategoria, size_bytes
   FROM documentos_cache WHERE licitacion_codigo = ? ORDER BY id DESC`,
  [codigo]
);
console.log('Todos los documentos:', docs.length);
for (const d of docs) console.log(d.id, '|', d.categoria, '|', d.subcategoria, '|', d.documento_nombre);

const [informe] = await pool.query(
  `SELECT id, informe_json FROM informes_viabilidad WHERE licitacion_codigo = ? ORDER BY id DESC LIMIT 1`,
  [codigo]
);
if (informe.length) {
  const inf = JSON.parse(informe[0].informe_json);
  console.log('\n--- modalidad ---');
  console.log(JSON.stringify(inf.modalidad || inf.requisitos_admisibilidad?.modalidad, null, 2));
  console.log('\n--- productos ---');
  console.log(JSON.stringify(inf.productos, null, 2));
} else {
  console.log('No hay informe de viabilidad para este código');
}

await pool.end();
