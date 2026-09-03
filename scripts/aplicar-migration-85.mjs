// Aplica migration-85: tabla negocio_costeo_editor (estado vivo del costeo editado en el sistema)
// + checklist_comercial_costeo.archivo_url ahora admite NULL + columna origen ('archivo'|'editor')
// — ver docs/migration-85-costeo-editor.sql.
//
// Idempotente: CREATE TABLE IF NOT EXISTS y MODIFY COLUMN son repetibles; la columna `origen` se
// comprueba antes (ADD COLUMN IF NOT EXISTS no funciona en esta versión de MySQL, ver migration-80).
// Uso: node scripts/aplicar-migration-85.mjs
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
  console.error('  o dentro del contenedor:  docker compose exec app node scripts/aplicar-migration-85.mjs\n');
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
const columnaExiste = async (tabla, columna) => {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?`,
    [env.DB_NAME, tabla, columna]);
  return r.n > 0;
};

try {
  console.log('\n  Aplicando migration-85 (costeo-editor)...');
  const sql = readFileSync('docs/migration-85-costeo-editor.sql', 'utf8');
  const sentencias = sql
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    .split(';').map(s => s.trim()).filter(Boolean);

  for (const s of sentencias) {
    if (/ADD COLUMN origen/i.test(s)) {
      if (await columnaExiste('checklist_comercial_costeo', 'origen')) {
        console.log('    checklist_comercial_costeo.origen ya existe — se salta.');
        continue;
      }
    }
    await pool.query(s);
  }
  console.log(`    OK (${sentencias.length} sentencia(s) evaluadas)`);

  const okTabla = await tablaExiste('negocio_costeo_editor');
  const okColumna = await columnaExiste('checklist_comercial_costeo', 'origen');
  console.log(`  Verificación: negocio_costeo_editor = ${okTabla ? 'SÍ' : 'NO'} · checklist_comercial_costeo.origen = ${okColumna ? 'SÍ' : 'NO'}\n`);
  if (!okTabla || !okColumna) process.exitCode = 1;
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
