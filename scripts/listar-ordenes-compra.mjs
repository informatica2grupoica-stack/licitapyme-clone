// Lista las órdenes de compra propias (es_nuestra=1) guardadas en la tabla ordenes_compra.
// Uso: node scripts/listar-ordenes-compra.mjs
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

try {
  const [rows] = await pool.query(`
    SELECT oc.codigo, oc.licitacion_codigo, oc.estado, oc.total, oc.comprador_organismo,
           e.razon_social AS empresa
    FROM ordenes_compra oc
    LEFT JOIN empresas e ON e.id = oc.empresa_id
    WHERE oc.es_nuestra = 1
    ORDER BY e.razon_social, oc.codigo
  `);
  console.log(`Total OC propias: ${rows.length}\n`);
  for (const r of rows) {
    console.log(`${r.codigo}\t${r.empresa || '(sin empresa)'}\t${r.estado}\t$${Number(r.total).toLocaleString('es-CL')}\t${r.comprador_organismo}\t(lic. ${r.licitacion_codigo})`);
  }
} catch (e) {
  console.error('ERROR:', e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
