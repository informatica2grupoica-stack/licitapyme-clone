// Aplica migration-111: precio_unitario_bruto + descuento_pct en compras_cotizacion (desglose de
// descuento sobre cotizaciones — pedido explícito del usuario, 14-sep-2026).
// Uso: node scripts/aplicar-migration-111.mjs
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

const columnaExiste = async (tabla, columna) => {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?`,
    [env.DB_NAME, tabla, columna]);
  return r.n > 0;
};

const COLUMNAS = [
  ['precio_unitario_bruto', 'DECIMAL(14,2) NULL'],
  ['descuento_pct', 'DECIMAL(5,2) NULL'],
];

try {
  console.log('\n  Aplicando migration-111 (descuento en compras_cotizacion)...');
  for (const [nombre, tipo] of COLUMNAS) {
    if (await columnaExiste('compras_cotizacion', nombre)) {
      console.log(`    ${nombre} ya existe — se salta.`);
      continue;
    }
    await pool.query(`ALTER TABLE compras_cotizacion ADD COLUMN ${nombre} ${tipo}`);
    console.log(`    ALTER compras_cotizacion ADD COLUMN ${nombre} OK`);
  }
  let todasOk = true;
  for (const [nombre] of COLUMNAS) {
    const ok = await columnaExiste('compras_cotizacion', nombre);
    console.log(`  Verificación: compras_cotizacion.${nombre} = ${ok ? 'SÍ' : 'NO'}`);
    if (!ok) todasOk = false;
  }
  console.log();
  if (!todasOk) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
