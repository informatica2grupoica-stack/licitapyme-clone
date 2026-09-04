// Aplica migration-86: tablas compras_asignacion, compras_tarea_catalogo, compras_tarea (Módulo de
// Compras, Fase 1) — ver docs/migration-86-modulo-compras.sql.
//
// Idempotente: CREATE TABLE IF NOT EXISTS + INSERT IGNORE son repetibles sin efecto secundario.
// Uso: node scripts/aplicar-migration-86.mjs
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
if (!env.DB_HOST) {
  console.error('\n  Falta DB_HOST. Corre el script desde la carpeta del proyecto (con .env/.env.local),');
  console.error('  o dentro del contenedor:  docker compose exec app node scripts/aplicar-migration-86.mjs\n');
  process.exit(1);
}

const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000,
});

const tablaExiste = async (tabla) => {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`,
    [env.DB_NAME, tabla]);
  return r.n > 0;
};

try {
  console.log('\n  Aplicando migration-86 (módulo de compras — Fase 1)...');
  const sql = readFileSync('docs/migration-86-modulo-compras.sql', 'utf8');
  const sentencias = sql
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    .split(';').map(s => s.trim()).filter(Boolean);

  for (const s of sentencias) {
    await pool.query(s);
  }
  console.log(`    OK (${sentencias.length} sentencia(s) evaluadas)`);

  const tablas = ['compras_asignacion', 'compras_tarea_catalogo', 'compras_tarea'];
  const estado = await Promise.all(tablas.map(tablaExiste));
  for (let i = 0; i < tablas.length; i++) {
    console.log(`  Verificación: ${tablas[i]} = ${estado[i] ? 'SÍ' : 'NO'}`);
  }
  const [[{ n: catalogoN }]] = await pool.query(`SELECT COUNT(*) n FROM compras_tarea_catalogo`);
  console.log(`  Catálogo inicial: ${catalogoN} tarea(s) sembradas.\n`);
  if (estado.some(x => !x)) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
