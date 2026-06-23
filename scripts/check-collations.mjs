// Muestra tipo y collation de licitacion_codigo en las tablas del JOIN del radar.
// Liviano: solo lee INFORMATION_SCHEMA. Uso: node scripts/check-collations.mjs
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 15000,
});

try {
  const [rows] = await pool.query(
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, CHARACTER_SET_NAME, COLLATION_NAME, COLUMN_KEY
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ?
       AND COLUMN_NAME = 'licitacion_codigo'
       AND TABLE_NAME IN ('alertas_licitaciones','viabilidad_licitacion','prefiltro_licitacion','documentos_cache')
     ORDER BY TABLE_NAME`, [env.DB_NAME]);
  console.log('\n  tabla                    columna            tipo         charset   collation                  key');
  for (const r of rows) {
    console.log(`  ${r.TABLE_NAME.padEnd(24)} ${r.COLUMN_NAME.padEnd(18)} ${(r.COLUMN_TYPE||'').padEnd(12)} ${(r.CHARACTER_SET_NAME||'-').padEnd(9)} ${(r.COLLATION_NAME||'-').padEnd(26)} ${r.COLUMN_KEY||''}`);
  }
  console.log('');
} finally { await pool.end(); }
