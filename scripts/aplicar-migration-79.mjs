// Aplica migration-79: tabla linea_producto_ofertado (datos del producto que ofertamos (marca, modelo, fabricante)).
//
// POR QUÉ (26-ago-2026): los formularios técnicos de los organismos abren con una tabla
// "INFORMACIÓN DE LA OFERTA" que pide Marca / Modelo / Fabricante / País-Año del producto que
// ofertamos, y ese dato no existía en NINGUNA parte del sistema (la empresa no lo tiene porque es
// del producto; el costeo tampoco). Ver docs/migration-79-datos-producto-ofertado.sql.
//
// Idempotente: CREATE TABLE IF NOT EXISTS + verificación final. Sin backfill: el dato no está en
// ningún lado y no se inventa.
// Uso: node scripts/aplicar-migration-79.mjs
import mysql from 'mysql2/promise';
import { readFileSync, existsSync } from 'node:fs';

// Credenciales: .env.local en desarrollo, .env o el entorno inyectado dentro del contenedor.
const env = { ...process.env };
for (const archivo of ['.env.local', '.env']) {
  if (!existsSync(archivo)) continue;
  for (const line of readFileSync(archivo, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  break;
}
if (!env.DB_HOST) {
  console.error('\n  Falta DB_HOST. Corre el script desde la carpeta del proyecto (con .env/.env.local),');
  console.error('  o dentro del contenedor:  docker compose exec app node scripts/aplicar-migration-79.mjs\n');
  process.exit(1);
}

const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000,
  multipleStatements: true,
});

const TABLA = 'linea_producto_ofertado';
const existe = async () => {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`,
    [env.DB_NAME, TABLA]);
  return r.n > 0;
};

try {
  if (await existe()) {
    console.log(`\n  Ya aplicada (${TABLA} existe). Nada que hacer.`);
  } else {
    console.log(`\n  Aplicando migration-79 (creando ${TABLA})...`);
    const t = performance.now();
    await pool.query(readFileSync('docs/migration-79-datos-producto-ofertado.sql', 'utf8'));
    console.log(`    OK en ${Math.round(performance.now() - t)} ms`);
  }
  const ok = await existe();
  console.log(`  ${ok ? 'OK   ' : 'FALTA'} ${TABLA}\n`);
  if (!ok) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
