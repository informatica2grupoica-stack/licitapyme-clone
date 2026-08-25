// Aplica migration-76: columna negocios.postulada_en (fecha en que se postuló) +
// backfill desde los dos rastros reales de cambio de etapa (actividad_usuario e
// historial_eventos). Idempotente: si la columna/índice ya existen, los omite.
// Uso: node scripts/aplicar-migration-76.mjs
import mysql from 'mysql2/promise';
import { readFileSync, existsSync } from 'node:fs';

// Credenciales: en el PC de desarrollo vienen de .env.local; dentro del contenedor del
// VPS ya están inyectadas como variables de entorno (env_file: .env del docker-compose)
// y ahí no existe ninguno de los dos archivos. Se prueban las tres fuentes, en ese orden.
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
  console.error('  o dentro del contenedor:  docker compose exec app node scripts/aplicar-migration-76.mjs\n');
  process.exit(1);
}

const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000,
});

const existe = async (col) => {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='negocios' AND COLUMN_NAME=?`, [env.DB_NAME, col]);
  return r.n > 0;
};

try {
  // El driver no acepta multi-statement: se ejecuta sentencia por sentencia.
  const sentencias = readFileSync('docs/migration-76-postulada-en.sql', 'utf8')
    .replace(/--.*$/gm, '')
    .split(';').map(s => s.trim()).filter(Boolean);

  for (const sql of sentencias) {
    const etiqueta = sql.slice(0, 60).replace(/\s+/g, ' ');
    if (/ADD COLUMN postulada_en/i.test(sql) && await existe('postulada_en')) {
      console.log('  · columna postulada_en ya existe, se omite');
      continue;
    }
    try {
      const [r] = await pool.query(sql);
      console.log(`  · OK ${etiqueta}…  ${r.affectedRows != null ? `(${r.affectedRows} filas)` : ''}`);
    } catch (e) {
      // Índice duplicado al re-ejecutar: no es un error real.
      if (/Duplicate key name|already exists/i.test(e.message)) console.log(`  · ya aplicado: ${etiqueta}…`);
      else throw e;
    }
  }

  const [[chk]] = await pool.query(
    `SELECT SUM(postulada_en IS NOT NULL) con, COUNT(*) total
     FROM negocios
     WHERE activo = TRUE AND estado_pipeline IN ('POSTULADA','POSIBLE_ADJ','ADJUDICADA','PERDIDA')`);
  const [[viv]] = await pool.query(
    `SELECT SUM(postulada_en IS NOT NULL) con, COUNT(*) total
     FROM negocios WHERE activo = TRUE AND estado_pipeline = 'POSTULADA'`);
  console.log(`\n  Con fecha de postulación: ${chk.con}/${chk.total} del histórico`);
  console.log(`  En el tablero Postuladas: ${viv.con}/${viv.total}\n`);
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
