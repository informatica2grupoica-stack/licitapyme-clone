// Verificación SOLO LECTURA de los fixes (rotación postuladas · contactos · cola viabilidad).
// Descartable: es una comprobación puntual del 2026-07-30.
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';
const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const pool = mysql.createPool({ host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, port: parseInt(env.DB_PORT||'3306'), connectTimeout: 20000 });
const ahora = new Date().toLocaleString('sv-SE', { timeZone: 'America/Santiago' });

const colaSQL = (gatePref, gateFallos, incluirVencidas) =>
  `SELECT al.licitacion_codigo, MIN(al.licitacion_cierre) AS cierre
     FROM alertas_licitaciones al
    WHERE EXISTS (SELECT 1 FROM documentos_cache dc
                   WHERE dc.licitacion_codigo = CONVERT(al.licitacion_codigo USING utf8) COLLATE utf8_unicode_ci)
      AND NOT EXISTS (SELECT 1 FROM viabilidad_licitacion v WHERE v.licitacion_codigo = al.licitacion_codigo)
      ${incluirVencidas ? '' : 'AND (al.licitacion_cierre IS NULL OR al.licitacion_cierre > ?)'}
      ${gatePref} ${gateFallos}
    GROUP BY al.licitacion_codigo
    ORDER BY (MIN(al.licitacion_cierre) < ?), MIN(al.licitacion_cierre) ASC`;
const GP = `AND EXISTS (SELECT 1 FROM prefiltro_licitacion pf WHERE pf.licitacion_codigo = al.licitacion_codigo AND pf.decision IN ('PASA','REVISION_HUMANA'))`;
const GF = `AND NOT EXISTS (SELECT 1 FROM pipeline_fallos pfa WHERE pfa.licitacion_codigo = al.licitacion_codigo AND pfa.intentos >= 3)`;

try {
  console.log(`\nMySQL ${(await pool.query('SELECT VERSION() v'))[0][0].v} · ahora Chile = ${ahora}\n`);

  // Fix 1
  const [rot] = await pool.query(
    `SELECT n.licitacion_codigo, c.consultado_en FROM negocios n
      JOIN usuarios u ON u.id = n.asignado_a AND u.activo = TRUE
      LEFT JOIN adjudicacion_cache c ON c.licitacion_codigo COLLATE utf8mb4_general_ci = n.licitacion_codigo COLLATE utf8mb4_general_ci
     WHERE n.activo = TRUE AND n.estado_pipeline = 'POSTULADA'
     GROUP BY n.licitacion_codigo, c.consultado_en
     ORDER BY (c.consultado_en IS NOT NULL), c.consultado_en ASC, n.licitacion_codigo`);
  const nunca = rot.filter(r => !r.consultado_en).length;
  console.log(`  fix1  rotación OK · ${rot.length} códigos POSTULADA · ${nunca} nunca consultados (van primeros)`);

  // Fix 2
  const [sin] = await pool.query(
    `SELECT n.licitacion_codigo FROM checklist_comercial_congelamiento c JOIN negocios n ON n.id = c.negocio_id
      WHERE JSON_EXTRACT(c.paquete_traspaso,'$.contactosCliente') IS NULL
         OR JSON_TYPE(JSON_EXTRACT(c.paquete_traspaso,'$.contactosCliente')) = 'NULL'`);
  console.log(`  fix2  reparación OK · ${sin.length} paquete(s) a reparar: ${sin.map(x=>x.licitacion_codigo).join(', ') || '(ninguno)'}`);

  // Fix 3
  const [[t]] = await pool.query(`SELECT COUNT(*) n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME='pipeline_fallos'`, [env.DB_NAME]);
  console.log(`  fix3  pipeline_fallos ${t.n ? 'existe' : 'NO existe todavía → falta node scripts/aplicar-migration-57.mjs'}`);

  // Fix 4 — variante completa (debe fallar si falta la tabla) y degradada (debe funcionar)
  try {
    await pool.query(colaSQL(GP, GF, false), [ahora, ahora]);
    console.log('  fix4  variante 1 (prefiltro + fallos) OK');
  } catch (e) {
    console.log(`  fix4  variante 1 falla como se espera → ${String(e.message).slice(0,60)}`);
  }
  const [vig] = await pool.query(colaSQL(GP, '', false), [ahora, ahora]);
  const [tod] = await pool.query(colaSQL(GP, '', true), [ahora]);
  console.log(`  fix4  degradación OK · cola del cron = ${vig.length} vigentes (backlog total ${tod.length})`);
  console.log(`        primeras: ${vig.slice(0,5).map(x=>`${x.licitacion_codigo} (cierra ${String(x.cierre).slice(0,16)})`).join(' · ')}`);
} catch (e) { console.error('\nERROR:', e.message); process.exitCode = 1; }
finally { await pool.end(); console.log(''); }
