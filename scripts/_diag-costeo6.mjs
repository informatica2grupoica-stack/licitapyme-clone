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
  `SELECT licitacion_codigo, modelo, updated_at, especificaciones_tecnicas FROM analisis_ia_licitacion WHERE licitacion_codigo = ?`,
  [codigo]
);
if (!rows.length) { console.log('sin fila en analisis_ia_licitacion'); process.exit(0); }
const r = rows[0];
console.log('modelo:', r.modelo);
console.log('updated_at:', r.updated_at);
const especs = typeof r.especificaciones_tecnicas === 'string' ? JSON.parse(r.especificaciones_tecnicas) : r.especificaciones_tecnicas;
console.log('cantidad especificaciones:', especs?.length);
console.log(JSON.stringify(especs, null, 2).slice(0, 4000));

const [viab] = await pool.query(`SELECT modelo, updated_at FROM viabilidad_licitacion WHERE licitacion_codigo=?`, [codigo]);
console.log('\nviabilidad_licitacion modelo:', viab[0]?.modelo, 'updated_at:', viab[0]?.updated_at);

await pool.end();
