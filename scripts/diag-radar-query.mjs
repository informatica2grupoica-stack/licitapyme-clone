// Diagnóstico SOLO LECTURA: aísla qué JOIN del query de /api/alertas es lento.
// Uso: node scripts/diag-radar-query.mjs
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

const time = async (label, sql) => {
  const t = performance.now();
  const [rows] = await pool.query(sql);
  const ms = Math.round(performance.now() - t);
  console.log(`  ${ms.toString().padStart(6)} ms  ${label}  (${rows.length} filas)`);
  return ms;
};

const BASE_FROM = `
  FROM alertas_licitaciones a
  JOIN (SELECT MAX(id) AS mid FROM alertas_licitaciones GROUP BY licitacion_codigo) latest ON latest.mid = a.id`;
const ORDER = ` ORDER BY COALESCE(a.licitacion_fecha_publicacion, a.licitacion_cierre, a.created_at) DESC`;

try {
  console.log('\n── Aislando cada JOIN (admin, 3346 filas) ──');

  await time('solo dedup + orden (sin LEFT JOINs)',
    `SELECT a.id, a.licitacion_codigo, a.licitacion_nombre ${BASE_FROM}${ORDER}`);

  await time('+ viabilidad (con informe_ejecutivo)',
    `SELECT a.id, v.informe_ejecutivo ${BASE_FROM}
     LEFT JOIN viabilidad_licitacion v ON v.licitacion_codigo = a.licitacion_codigo ${ORDER}`);

  await time('+ viabilidad (SIN informe_ejecutivo)',
    `SELECT a.id, v.semaforo, v.score_total ${BASE_FROM}
     LEFT JOIN viabilidad_licitacion v ON v.licitacion_codigo = a.licitacion_codigo ${ORDER}`);

  await time('+ prefiltro',
    `SELECT a.id, pf.decision ${BASE_FROM}
     LEFT JOIN prefiltro_licitacion pf ON pf.licitacion_codigo = a.licitacion_codigo ${ORDER}`);

  await time('+ documentos_cache (derivada agrupada)',
    `SELECT a.id, (dc.licitacion_codigo IS NOT NULL) td ${BASE_FROM}
     LEFT JOIN (SELECT licitacion_codigo FROM documentos_cache GROUP BY licitacion_codigo) dc ON dc.licitacion_codigo = a.licitacion_codigo ${ORDER}`);

  await time('+ documentos_cache (EXISTS correlacionado)',
    `SELECT a.id, EXISTS(SELECT 1 FROM documentos_cache d WHERE d.licitacion_codigo = a.licitacion_codigo) td ${BASE_FROM}${ORDER}`);

  await time('+ palabras_clave + etiquetas',
    `SELECT a.id, cat.nombre ${BASE_FROM}
     LEFT JOIN palabras_clave pc ON pc.id = a.palabra_clave_id
     LEFT JOIN etiquetas cat ON cat.id = pc.categoria_id ${ORDER}`);

  console.log('');
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
