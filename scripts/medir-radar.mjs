// Mide el costo real de la query del radar (/api/alertas, scope admin) contra Bluehost.
// Uso: node scripts/medir-radar.mjs
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';

// Parse simple de .env.local
const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}

const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'),
  connectTimeout: 15000, connectionLimit: 3,
});

const SELECT = `
  SELECT a.id, a.keyword_texto, a.licitacion_codigo, a.licitacion_nombre,
         a.licitacion_organismo, a.licitacion_monto, a.licitacion_cierre,
         a.licitacion_fecha_publicacion, a.licitacion_estado, a.licitacion_region, a.licitacion_tipo,
         a.match_fuente, a.match_contexto, a.match_score, a.leida, a.created_at,
         (dc.licitacion_codigo IS NOT NULL) AS tiene_documentos,
         v.score_total, v.semaforo, v.area_negocio, v.informe_ejecutivo,
         pf.decision, pf.categoria, pf.motivo, pf.confianza,
         cat.nombre, cat.color
  FROM alertas_licitaciones a
  LEFT JOIN viabilidad_licitacion v ON v.licitacion_codigo = a.licitacion_codigo
  LEFT JOIN prefiltro_licitacion pf ON pf.licitacion_codigo = a.licitacion_codigo
  LEFT JOIN (SELECT licitacion_codigo FROM documentos_cache GROUP BY licitacion_codigo) dc ON dc.licitacion_codigo = a.licitacion_codigo
  LEFT JOIN palabras_clave pc ON pc.id = a.palabra_clave_id
  LEFT JOIN etiquetas cat ON cat.id = pc.categoria_id
  WHERE a.id IN (SELECT MAX(a3.id) FROM alertas_licitaciones a3 GROUP BY a3.licitacion_codigo)
  ORDER BY COALESCE(a.licitacion_fecha_publicacion, a.licitacion_cierre, a.created_at) DESC`;

async function cron(label, sql, params = []) {
  process.stdout.write(`  ${label.padEnd(34)} midiendo...`);
  const reps = [];
  let rowsN = 0;
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    const [rows] = await pool.query(sql, params);
    reps.push(performance.now() - t);
    if (i === 0) rowsN = rows.length;
  }
  const ms = reps.map(r => Math.round(r));
  console.log(`\r  ${label.padEnd(34)} filas=${String(rowsN).padStart(5)}  →  ${ms.join(' / ')} ms`);
}

try {
  console.log('\n── Tamaño de la tabla ──');
  const [[{ total }]] = await pool.query('SELECT COUNT(*) total FROM alertas_licitaciones');
  const [[{ codigos }]] = await pool.query('SELECT COUNT(DISTINCT licitacion_codigo) codigos FROM alertas_licitaciones');
  console.log(`  alertas_licitaciones: ${total} filas · ${codigos} códigos únicos`);

  console.log('\n── ¿Existe ya el índice idx_alertas_codigo? ──');
  const [idx] = await pool.query(`SHOW INDEX FROM alertas_licitaciones WHERE Key_name = 'idx_alertas_codigo'`);
  console.log(`  ${idx.length ? 'SÍ existe' : 'NO existe (migration-23 pendiente)'}`);

  const LIM = ' LIMIT 500 OFFSET 0';
  const DEDUP_IN   = `WHERE a.id IN (SELECT MAX(a3.id) FROM alertas_licitaciones a3 GROUP BY a3.licitacion_codigo)`;
  const ORDER      = ` ORDER BY COALESCE(a.licitacion_fecha_publicacion, a.licitacion_cierre, a.created_at) DESC`;

  // Variantes: cada una quita UN sospechoso para aislar el culpable.
  console.log('\n── Aislando al culpable (todas con LIMIT 500, 3 corridas) ──');

  // 0) Base actual (referencia ~18s)
  await cron('0. BASE (igual a producción)', SELECT + LIM);

  // 1) Sin el EXISTS correlacionado de documentos_cache
  await cron('1. sin EXISTS documentos_cache',
    SELECT.replace(/EXISTS \(SELECT 1 FROM documentos_cache[^)]*\) AS tiene_documentos,/, '0 AS tiene_documentos,') + LIM);

  // 2) Sin los LEFT JOIN a viabilidad y prefiltro (y sus columnas)
  await cron('2. sin JOIN viabilidad+prefiltro',
    `SELECT a.id, a.licitacion_codigo, a.licitacion_nombre, a.created_at,
            EXISTS (SELECT 1 FROM documentos_cache dc WHERE dc.licitacion_codigo = a.licitacion_codigo) AS tiene_documentos
     FROM alertas_licitaciones a ${DEDUP_IN}${ORDER}${LIM}`);

  // 3) Dedup por JOIN a derived table en vez de IN (subquery)
  await cron('3. dedup con JOIN (no IN-subquery)',
    `SELECT a.id, a.licitacion_codigo, a.licitacion_nombre, a.created_at
     FROM alertas_licitaciones a
     JOIN (SELECT MAX(id) id FROM alertas_licitaciones GROUP BY licitacion_codigo) d ON d.id = a.id
     ${ORDER}${LIM}`);

  // 4) Solo filas crudas con el IN-subquery, sin JOINs ni EXISTS ni ORDER
  await cron('4. solo dedup IN, sin JOIN/EXISTS/ORDER',
    `SELECT a.id, a.licitacion_codigo FROM alertas_licitaciones a ${DEDUP_IN}${LIM}`);

  // 5) Igual que 4 pero CON ORDER (mide el costo de ordenar)
  await cron('5. dedup IN + ORDER, sin JOIN/EXISTS',
    `SELECT a.id, a.licitacion_codigo FROM alertas_licitaciones a ${DEDUP_IN}${ORDER}${LIM}`);

  console.log('\n── EXPLAIN de la query COMPLETA (con LIMIT) ──');
  const [plan] = await pool.query(`EXPLAIN ${SELECT}${LIM}`);
  for (const p of plan) console.log(`  tabla=${(p.table||'').padEnd(6)} type=${(p.type||'').padEnd(8)} key=${String(p.key||'NULL').padEnd(14)} rows=${String(p.rows).padStart(5)} extra=${p.Extra || ''}`);

  console.log('');
} finally {
  await pool.end();
}
