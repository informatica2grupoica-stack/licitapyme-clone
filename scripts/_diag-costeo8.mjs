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
const v3 = ie._informe_ia_v3;
console.log('adjudicacion:', JSON.stringify(v3.adjudicacion, null, 2));
console.log('\nrequisitos_admisibilidad (solo claves):', Object.keys(v3.requisitos_admisibilidad || {}));
console.log('\nrequisitos_admisibilidad completo:', JSON.stringify(v3.requisitos_admisibilidad, null, 2).slice(0, 3000));

await pool.end();
