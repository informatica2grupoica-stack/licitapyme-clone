// Aplica migration-159: seguimiento de la importación en compras_embarque (estado del embarque con
// la fecha de cada etapa + datos del envío: origen, medio, incoterm, N° de seguimiento, naviera,
// agente de aduana, puerto, ETD/ETA y N° de DIN). Solo agrega columnas.
// Uso: node scripts/aplicar-migration-159.mjs
import mysql from 'mysql2/promise';
import { readFileSync, existsSync } from 'node:fs';

const env = { ...process.env };
for (const archivo of ['.env.local', '.env']) {
  if (!existsSync(archivo)) continue;
  for (const line of readFileSync(archivo, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  break;
}
if (!env.DB_HOST) { console.error('\n  Falta DB_HOST.\n'); process.exit(1); }

const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000,
});

const COLUMNAS = [
  ['estado', 'VARCHAR(20) DEFAULT NULL'],
  ['estado_fechas', 'TEXT DEFAULT NULL'],
  ['proveedor_extranjero', 'VARCHAR(300) DEFAULT NULL'],
  ['pais_origen', 'VARCHAR(80) DEFAULT NULL'],
  ['medio', 'VARCHAR(20) DEFAULT NULL'],
  ['incoterm', 'VARCHAR(10) DEFAULT NULL'],
  ['numero_seguimiento', 'VARCHAR(120) DEFAULT NULL'],
  ['transportista', 'VARCHAR(200) DEFAULT NULL'],
  ['agente_aduana', 'VARCHAR(200) DEFAULT NULL'],
  ['puerto_llegada', 'VARCHAR(120) DEFAULT NULL'],
  ['fecha_salida', 'DATE DEFAULT NULL'],
  ['fecha_llegada_estimada', 'DATE DEFAULT NULL'],
  ['numero_din', 'VARCHAR(60) DEFAULT NULL'],
];

try {
  console.log('\n  Aplicando migration-159 (seguimiento en compras_embarque)...');
  for (const [col, def] of COLUMNAS) {
    const [[r]] = await pool.query(
      `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='compras_embarque' AND COLUMN_NAME=?`,
      [env.DB_NAME, col]);
    if (r.n > 0) { console.log(`  = ${col} ya estaba`); continue; }
    await pool.query(`ALTER TABLE compras_embarque ADD COLUMN ${col} ${def}`);
    console.log(`  + ${col}`);
  }
  console.log('  Listo.\n');
} catch (e) {
  console.error('\n  Error:', e.message, '\n');
  process.exit(1);
} finally {
  await pool.end();
}
