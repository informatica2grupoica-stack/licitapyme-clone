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
  `SELECT * FROM viabilidad_licitacion WHERE licitacion_codigo = ? LIMIT 1`, [codigo]
);
if (!rows.length) { console.log('sin fila'); process.exit(0); }
console.log('Columnas:', Object.keys(rows[0]));
const desglose = typeof rows[0].desglose === 'string' ? JSON.parse(rows[0].desglose) : rows[0].desglose;
console.log('\n--- modalidad ---');
console.log(JSON.stringify(desglose?.modalidad, null, 2));
console.log('\n--- requisitos_admisibilidad.modalidad (si existe) ---');
console.log(JSON.stringify(desglose?.requisitos_admisibilidad?.modalidad, null, 2));
console.log('\n--- productos ---');
console.log(JSON.stringify(desglose?.productos, null, 2));

await pool.end();
