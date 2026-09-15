// Aplica migration-107: columnas cierre_legado* en compras_asignacion (Módulo de Compras — marca
// rápida de "entregada"/"no realizada" para el backlog histórico, sin pasar por el flujo completo
// de Entrega o Fracaso).
// Uso: node scripts/aplicar-migration-107.mjs
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
  console.log('\n  Aplicando migration-107 (cierre legado de Compras)...');

  if (await columnaExiste('compras_asignacion', 'cierre_legado')) {
    console.log('    compras_asignacion.cierre_legado ya existe — se salta el ALTER.');
  } else {
    await pool.query(
      `ALTER TABLE compras_asignacion
         ADD COLUMN cierre_legado VARCHAR(16) NULL,
         ADD COLUMN cierre_legado_nota VARCHAR(300) NULL,
         ADD COLUMN cierre_legado_por INT NULL,
         ADD COLUMN cierre_legado_por_nombre VARCHAR(160) NULL,
         ADD COLUMN cierre_legado_at DATETIME NULL`,
    );
    console.log('    ALTER compras_asignacion OK');
  }

  const colOk = await columnaExiste('compras_asignacion', 'cierre_legado');
  console.log(`  Verificación: compras_asignacion.cierre_legado = ${colOk ? 'SÍ' : 'NO'}\n`);
  if (!colOk) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
