import { readFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim(); }
const mysql = (await import('mysql2/promise')).default;
const pool = mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 20000 });
const [r] = await pool.query(`SELECT n.licitacion_codigo, n.empresa_id, e.razon_social FROM negocios n LEFT JOIN empresas e ON e.id = n.empresa_id WHERE n.licitacion_codigo = ? AND n.activo = TRUE`, ['2296-48-LE26']) as any[];
console.log(r);
await pool.end();
