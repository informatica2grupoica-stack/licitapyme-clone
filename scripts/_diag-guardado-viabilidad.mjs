// Diagnóstico SOLO LECTURA: ¿se guardó la viabilidad IA de un código?
// Uso: node scripts/_diag-guardado-viabilidad.mjs 3890-113-L126
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

const codigo = process.argv[2] || '3890-113-L126';
console.log(`\n=== Diagnóstico viabilidad IA para: "${codigo}" ===\n`);

try {
  // 1) ¿Existe la fila en viabilidad_licitacion?
  const [rows] = await pool.query(
    `SELECT id, licitacion_codigo, score_total, semaforo, area_negocio, modelo,
            confianza_analisis, updated_at,
            (informe_ejecutivo IS NOT NULL) AS tiene_informe,
            JSON_VALID(informe_ejecutivo) AS json_valido,
            JSON_CONTAINS_PATH(informe_ejecutivo, 'one', '$._informe_ia') AS tiene_informe_ia,
            LENGTH(informe_ejecutivo) AS bytes_informe
       FROM viabilidad_licitacion WHERE licitacion_codigo = ?`, [codigo]);
  if (!rows.length) {
    console.log('❌ NO existe fila en viabilidad_licitacion para este código.');
    console.log('   → El análisis NO se guardó (o nunca se corrió / falló al guardar).\n');
  } else {
    for (const r of rows) {
      console.log('✅ Fila encontrada:');
      console.log(`   id=${r.id} · modelo=${r.modelo} · score=${r.score_total} · semaforo=${r.semaforo} · area=${r.area_negocio}`);
      console.log(`   updated_at=${r.updated_at}`);
      console.log(`   informe_ejecutivo: presente=${r.tiene_informe} · JSON_válido=${r.json_valido} · tiene _informe_ia=${r.tiene_informe_ia} · bytes=${r.bytes_informe}`);
      console.log(`   ¿Aparece en "Analizadas"? → ${String(r.modelo || '').startsWith('ia+') ? 'SÍ (modelo empieza con ia+)' : 'NO (modelo NO empieza con ia+)'}`);
    }
  }

  // 2) Variantes del código (por si hay diferencias de mayúsculas/guiones/espacios)
  const [similares] = await pool.query(
    `SELECT licitacion_codigo, modelo, updated_at FROM viabilidad_licitacion
      WHERE licitacion_codigo LIKE ? ORDER BY updated_at DESC LIMIT 10`,
    [`%${codigo.replace(/[^0-9]/g, '%')}%`]);
  console.log(`\n   Códigos parecidos en viabilidad_licitacion (${similares.length}):`);
  for (const s of similares) console.log(`     · "${s.licitacion_codigo}" modelo=${s.modelo} updated=${s.updated_at}`);

  // 3) ¿Hay documentos descargados para ese código? (sin docs no hay análisis)
  const [docs] = await pool.query(
    `SELECT COUNT(*) AS n, SUM(LENGTH(texto_extraido) >= 50) AS legibles
       FROM documentos_cache WHERE licitacion_codigo = ?`, [codigo]);
  console.log(`\n   Documentos en documentos_cache: total=${docs[0].n} · legibles(≥50 chars)=${docs[0].legibles ?? 0}`);

  // 4) Definición de columnas relevantes + max_allowed_packet
  const [cols] = await pool.query(
    `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'viabilidad_licitacion'
        AND COLUMN_NAME IN ('informe_ejecutivo','semaforo','area_negocio','modelo','score_total','confianza_analisis','updated_at')`);
  console.log('\n   Columnas de viabilidad_licitacion:');
  for (const c of cols) console.log(`     · ${c.COLUMN_NAME}: ${c.COLUMN_TYPE} (nullable=${c.IS_NULLABLE})`);

  const [[pkt]] = await pool.query(`SHOW VARIABLES LIKE 'max_allowed_packet'`).then(([r]) => [r]);
  console.log(`\n   max_allowed_packet = ${pkt?.Value ?? '?'} bytes (${pkt ? Math.round(pkt.Value / 1048576) : '?'} MB)`);

  // 5) Últimas 5 analizadas (para comparar timestamps)
  const [ultimas] = await pool.query(
    `SELECT licitacion_codigo, modelo, score_total, updated_at FROM viabilidad_licitacion
      WHERE modelo LIKE 'ia+%' ORDER BY updated_at DESC LIMIT 5`);
  console.log(`\n   Últimas 5 en "Analizadas":`);
  for (const u of ultimas) console.log(`     · ${u.updated_at} · "${u.licitacion_codigo}" · ${u.modelo} · score ${u.score_total}`);

} catch (e) {
  console.error('\n❌ Error de diagnóstico:', e.message);
} finally {
  await pool.end();
  console.log('\n=== fin ===\n');
}
