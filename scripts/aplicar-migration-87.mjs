// Aplica migration-87: orden de compra del cliente (§3.6) + registro de ejecución de las tareas
// (§5.3/§5.4) del Módulo de Compras — ver docs/migration-87-compras-oc-y-registro-tareas.sql.
//
// Idempotente: los ALTER TABLE ... ADD COLUMN que fallan por "columna ya existe" (1060) o "clave
// ya existe" (1061) se cuentan como ya-aplicados y no detienen la corrida. MySQL no soporta
// ADD COLUMN IF NOT EXISTS, así que esta es la forma de que correrla dos veces sea seguro.
//
// Uso: node scripts/aplicar-migration-87.mjs
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
  console.error('  o dentro del contenedor:  docker compose exec app node scripts/aplicar-migration-87.mjs\n');
  process.exit(1);
}

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
  console.log('\n  Aplicando migration-87 (compras: OC del cliente + registro de tareas)...');
  const sql = readFileSync('docs/migration-87-compras-oc-y-registro-tareas.sql', 'utf8');
  const sentencias = sql
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    .split(';').map(s => s.trim()).filter(Boolean);

  let aplicadas = 0, yaEstaban = 0;
  for (const s of sentencias) {
    try {
      await pool.query(s);
      aplicadas++;
    } catch (e) {
      // 1060 = Duplicate column name · 1061 = Duplicate key name. Ya estaba aplicada.
      if (e.errno === 1060 || e.errno === 1061) { yaEstaban++; continue; }
      throw e;
    }
  }
  console.log(`    OK — ${aplicadas} sentencia(s) aplicadas, ${yaEstaban} que ya estaban.`);

  const chequeos = [
    ['compras_asignacion', 'oc_numero'],
    ['compras_asignacion', 'oc_aceptada_at'],
    ['compras_tarea', 'registro_json'],
    ['compras_tarea', 'hallazgo'],
    ['compras_tarea_catalogo', 'campos_json'],
  ];
  let faltante = false;
  for (const [tabla, col] of chequeos) {
    const ok = await columnaExiste(tabla, col);
    if (!ok) faltante = true;
    console.log(`  Verificación: ${tabla}.${col} = ${ok ? 'SÍ' : 'NO'}`);
  }
  const [[{ n: conFormulario }]] = await pool.query(
    `SELECT COUNT(*) n FROM compras_tarea_catalogo WHERE campos_json IS NOT NULL`);
  console.log(`  Tareas del catálogo con formulario de registro: ${conFormulario}\n`);
  if (faltante) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
