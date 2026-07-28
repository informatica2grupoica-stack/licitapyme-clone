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
const [rows] = await pool.query(`SELECT informe_ejecutivo FROM viabilidad_licitacion WHERE licitacion_codigo=?`, [codigo]);
const ie = typeof rows[0].informe_ejecutivo === 'string' ? JSON.parse(rows[0].informe_ejecutivo) : rows[0].informe_ejecutivo;
console.log('top-level keys de informe_ejecutivo:', Object.keys(ie));
const v3 = ie._informe_ia_v3;
if (!v3) { console.log('NO HAY _informe_ia_v3'); process.exit(0); }
console.log('\nv3 keys:', Object.keys(v3));
console.log('\nmanifiesto_productos:', JSON.stringify(v3.manifiesto_productos, null, 2));
console.log('\nestructura_costeo:', v3.estructura_costeo);
console.log('\nmodalidad:', JSON.stringify(v3.modalidad, null, 2));
console.log('\nmeta:', JSON.stringify(v3.meta, null, 2));

await pool.end();
