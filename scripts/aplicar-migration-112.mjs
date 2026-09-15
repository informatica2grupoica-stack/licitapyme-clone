// Aplica migration-112: flete_monto en compras_cotizacion — el cargo REAL de flete que cobra el
// proveedor (leído del documento o tipeado a mano), para usar en vez del flete interno fijo cuando
// existe. Pedido explícito del usuario, 14-sep-2026.
// Uso: node scripts/aplicar-migration-112.mjs
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

try {
  console.log('\n  Aplicando migration-112 (flete_monto en compras_cotizacion)...');
  if (await columnaExiste('compras_cotizacion', 'flete_monto')) {
    console.log('    flete_monto ya existe — se salta.');
  } else {
    await pool.query(`ALTER TABLE compras_cotizacion ADD COLUMN flete_monto DECIMAL(14,2) NULL`);
    console.log('    ALTER compras_cotizacion ADD COLUMN flete_monto OK');
  }
  const ok = await columnaExiste('compras_cotizacion', 'flete_monto');
  console.log(`  Verificación: compras_cotizacion.flete_monto = ${ok ? 'SÍ' : 'NO'}\n`);
  if (!ok) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
