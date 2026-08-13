// Muestra el estado ACTUAL de los análisis de viabilidad en curso (tabla viabilidad_jobs).
// Si la tabla está vacía, no hay ningún análisis corriendo ni fallado pendiente de revisar.
// Uso:
//   node scripts/ver-viabilidad-jobs.mjs                  → todos los jobs
//   node scripts/ver-viabilidad-jobs.mjs 1171142-100-LE26  → solo ese código
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000,
});

const codigo = process.argv[2];

try {
  const [rows] = codigo
    ? await pool.query(`SELECT * FROM viabilidad_jobs WHERE licitacion_codigo = ?`, [codigo])
    : await pool.query(`SELECT * FROM viabilidad_jobs ORDER BY actualizado_at DESC`);

  if (rows.length === 0) {
    console.log(codigo ? `\n  Sin job registrado para ${codigo} (no está corriendo ni falló).\n` : '\n  No hay ningún análisis de viabilidad corriendo ni fallado en este momento.\n');
  } else {
    for (const r of rows) {
      const segs = Math.round((Date.now() - new Date(r.iniciado_at).getTime()) / 1000);
      const sinActualizar = Math.round((Date.now() - new Date(r.actualizado_at).getTime()) / 1000);
      console.log(`\n  ${r.licitacion_codigo}`);
      console.log(`    estado:          ${r.estado}`);
      console.log(`    fase:            ${r.fase ?? '—'}`);
      console.log(`    iniciado hace:   ${segs}s`);
      console.log(`    sin actualizar:  ${sinActualizar}s${sinActualizar > 660 ? '  ⚠ probablemente huérfano (se marcará error en el próximo GET)' : ''}`);
      if (r.error) console.log(`    error:           ${r.error}`);
    }
    console.log();
  }
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
