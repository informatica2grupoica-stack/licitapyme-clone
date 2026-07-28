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
const [rows] = await pool.query(`SELECT desglose FROM viabilidad_licitacion WHERE licitacion_codigo = ? LIMIT 1`, [codigo]);
const d = typeof rows[0].desglose === 'string' ? JSON.parse(rows[0].desglose) : rows[0].desglose;
console.log('Top-level keys:', Object.keys(d));
await pool.end();
