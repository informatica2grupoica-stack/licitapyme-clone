// Diagnóstico de rendimiento de /api/alertas y /api/negocios contra la BD real.
// Mide las queries EXACTAS de los endpoints + revisa collations/índices/tamaños.
// Uso: node scripts/_diag-perf.mjs   (temporal, se borra después)
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

const t = async (nombre, sql, params = []) => {
  const t0 = performance.now();
  try {
    const [rows] = await pool.query(sql, params);
    const ms = Math.round(performance.now() - t0);
    const n = Array.isArray(rows) ? rows.length : 0;
    let bytes = 0;
    try { bytes = JSON.stringify(rows).length; } catch {}
    console.log(`  ${nombre}: ${ms} ms · ${n} filas · ~${(bytes/1024).toFixed(0)} KB`);
    return rows;
  } catch (e) {
    console.log(`  ${nombre}: ERROR ${e.message}`);
    return null;
  }
};

try {
  // Ping para separar latencia base de red
  const t0 = performance.now();
  await pool.query('SELECT 1');
  console.log(`\nLatencia base (SELECT 1): ${Math.round(performance.now() - t0)} ms`);

  console.log('\n== Collations de columnas licitacion_codigo ==');
  const [cols] = await pool.query(
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, COLLATION_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND COLUMN_NAME = 'licitacion_codigo'
     ORDER BY TABLE_NAME`, [env.DB_NAME]);
  for (const c of cols) console.log(`  ${c.TABLE_NAME}.${c.COLUMN_NAME} = ${c.COLUMN_TYPE} ${c.COLLATION_NAME}`);

  console.log('\n== Tamaños de tablas involucradas ==');
  const [sizes] = await pool.query(
    `SELECT TABLE_NAME, TABLE_ROWS, ROUND(DATA_LENGTH/1024/1024,1) AS data_mb, ROUND(INDEX_LENGTH/1024/1024,1) AS idx_mb
     FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME IN ('alertas_licitaciones','viabilidad_licitacion','prefiltro_licitacion','documentos_cache','negocios','negocios_etiquetas','comentarios_negocio','licitaciones_descartadas','palabras_clave','etiquetas','usuarios')
     ORDER BY DATA_LENGTH DESC`, [env.DB_NAME]);
  for (const s of sizes) console.log(`  ${s.TABLE_NAME}: ~${s.TABLE_ROWS} filas · datos ${s.data_mb} MB · índices ${s.idx_mb} MB`);

  console.log('\n== Índices clave ==');
  const [idx] = await pool.query(
    `SELECT TABLE_NAME, INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
     FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME IN ('alertas_licitaciones','viabilidad_licitacion','prefiltro_licitacion','documentos_cache','negocios')
     GROUP BY TABLE_NAME, INDEX_NAME ORDER BY TABLE_NAME, INDEX_NAME`, [env.DB_NAME]);
  for (const i of idx) console.log(`  ${i.TABLE_NAME} · ${i.INDEX_NAME} (${i.cols})`);

  console.log('\n== /api/alertas (camino admin) — queries exactas ==');
  await t('principal (con informe_ejecutivo)',
    `SELECT a.id, a.keyword_texto, a.licitacion_codigo, a.licitacion_nombre,
            a.licitacion_organismo, a.licitacion_monto, a.licitacion_cierre,
            a.licitacion_fecha_publicacion, a.licitacion_estado, a.licitacion_region, a.licitacion_tipo,
            a.match_fuente, a.match_score, a.leida, a.created_at,
            v.score_total AS viabilidad_score, v.semaforo AS viabilidad_semaforo,
            v.area_negocio AS viabilidad_area, v.informe_ejecutivo AS viabilidad_informe,
            pf.decision AS prefiltro_decision, pf.categoria AS prefiltro_categoria,
            pf.motivo AS prefiltro_motivo, pf.confianza AS prefiltro_confianza,
            cat.nombre AS categoria_nombre, cat.color AS categoria_color
     FROM alertas_licitaciones a
     JOIN (SELECT MAX(id) AS mid FROM alertas_licitaciones GROUP BY licitacion_codigo) latest ON latest.mid = a.id
     LEFT JOIN viabilidad_licitacion v ON v.licitacion_codigo = a.licitacion_codigo
     LEFT JOIN prefiltro_licitacion pf ON pf.licitacion_codigo = a.licitacion_codigo
     LEFT JOIN palabras_clave pc ON pc.id = a.palabra_clave_id
     LEFT JOIN etiquetas cat ON cat.id = pc.categoria_id
     WHERE 1 = 1
     ORDER BY COALESCE(a.licitacion_fecha_publicacion, a.licitacion_cierre, a.created_at) DESC`);
  await t('principal SIN informe_ejecutivo (comparación)',
    `SELECT a.id, a.licitacion_codigo, v.score_total, v.semaforo
     FROM alertas_licitaciones a
     JOIN (SELECT MAX(id) AS mid FROM alertas_licitaciones GROUP BY licitacion_codigo) latest ON latest.mid = a.id
     LEFT JOIN viabilidad_licitacion v ON v.licitacion_codigo = a.licitacion_codigo
     ORDER BY COALESCE(a.licitacion_fecha_publicacion, a.licitacion_cierre, a.created_at) DESC`);
  await t('asignaciones', `SELECT n.licitacion_codigo, n.asignado_a, u.nombre, u.email FROM negocios n JOIN usuarios u ON u.id = n.asignado_a WHERE n.activo = TRUE`);
  await t('descartadas', `SELECT licitacion_codigo FROM licitaciones_descartadas`);
  await t('docs DISTINCT', `SELECT DISTINCT licitacion_codigo FROM documentos_cache`);
  await t('count noLeidas', `SELECT COUNT(*) AS total FROM alertas_licitaciones a JOIN (SELECT MAX(id) AS mid FROM alertas_licitaciones GROUP BY licitacion_codigo) latest ON latest.mid = a.id WHERE a.leida = FALSE`);

  console.log('\n== /api/negocios (admin, todos) — queries exactas ==');
  await t('principal (GROUP_CONCAT + subquery comentarios)',
    `SELECT n.id, n.licitacion_codigo, n.licitacion_nombre, n.licitacion_organismo,
            n.licitacion_monto, n.licitacion_cierre, n.licitacion_estado,
            n.licitacion_tipo, n.licitacion_region, n.monto_ofertado,
            COALESCE(n.estado_pipeline, '1ASIGNADO') AS estado_pipeline,
            n.created_at, n.updated_at, u.nombre AS usuario_nombre, u.email AS usuario_email,
            GROUP_CONCAT(DISTINCT e.nombre ORDER BY e.nombre SEPARATOR ',') AS etiquetas_nombres,
            GROUP_CONCAT(DISTINCT CONCAT(e.id,':',e.nombre,':',e.color) ORDER BY e.nombre SEPARATOR '|') AS etiquetas_raw,
            (SELECT COUNT(*) FROM comentarios_negocio cn WHERE cn.negocio_id = n.id) AS comentarios_count
     FROM negocios n
     JOIN usuarios u ON u.id = n.asignado_a
     LEFT JOIN negocios_etiquetas ne ON ne.negocio_id = n.id
     LEFT JOIN etiquetas e ON e.id = ne.etiqueta_id
     WHERE n.activo = TRUE
     GROUP BY n.id ORDER BY n.updated_at DESC`);
  await t('carga', `SELECT n.asignado_a, u.nombre, u.email, n.licitacion_codigo FROM negocios n JOIN usuarios u ON u.id = n.asignado_a WHERE n.activo = TRUE`);

  // Para docs/viab IN(...) necesito los códigos reales
  const [codRows] = await pool.query(`SELECT licitacion_codigo FROM negocios WHERE activo = TRUE`);
  const codigos = codRows.map(r => r.licitacion_codigo).filter(Boolean);
  if (codigos.length) {
    const ph = codigos.map(() => '?').join(',');
    await t(`docs IN(${codigos.length} códigos)`, `SELECT DISTINCT licitacion_codigo FROM documentos_cache WHERE licitacion_codigo IN (${ph})`, codigos);
    await t(`viab IN(${codigos.length} códigos)`, `SELECT licitacion_codigo, semaforo, score_total FROM viabilidad_licitacion WHERE licitacion_codigo IN (${ph})`, codigos);
  }
} catch (e) {
  console.error('ERROR GENERAL:', e.message);
} finally { await pool.end(); }
