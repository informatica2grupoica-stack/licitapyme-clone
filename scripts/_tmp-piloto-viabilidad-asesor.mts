// Piloto viabilidad automática (2026-08): activa el permiso en el usuario "Asesor" (id=7) y
// corre el backfill de las licitaciones asignadas/activas que aún no tienen viabilidad.
// Uso: npx tsx scripts/_tmp-piloto-viabilidad-asesor.mts
import { readFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}

const pool = (await import('@/app/lib/db')).default;
const { procesarLicitacionCompleta } = await import('@/app/lib/pipeline-licitacion');
const { ahoraChileSQL } = await import('@/app/lib/tz');

const USER_ID = 7;

console.log('1) Activando permiso viabilidad_automatica en usuario', USER_ID, '...');
await pool.query(
  `UPDATE usuarios SET permisos = JSON_SET(COALESCE(permisos, '{}'), '$.viabilidad_automatica', true) WHERE id = ?`,
  [USER_ID],
);
const [chk]: any = await pool.query(`SELECT id, nombre, permisos FROM usuarios WHERE id = ?`, [USER_ID]);
console.log('   confirmado:', JSON.stringify(chk[0]));

console.log('\n2) Buscando pendientes de viabilidad (asignadas/activas de este perfil)...');
const ahora = ahoraChileSQL();
const [rows]: any = await pool.query(
  `SELECT n.licitacion_codigo, n.estado_pipeline, n.licitacion_cierre
     FROM negocios n
     WHERE n.asignado_a = ?
       AND n.activo = TRUE
       AND n.estado_pipeline <> 'DESCARTADA'
       AND EXISTS (
             SELECT 1 FROM documentos_cache dc
              WHERE dc.licitacion_codigo = CONVERT(n.licitacion_codigo USING utf8) COLLATE utf8_unicode_ci)
       AND NOT EXISTS (
             SELECT 1 FROM viabilidad_licitacion v
              WHERE v.licitacion_codigo = n.licitacion_codigo)
     ORDER BY n.licitacion_cierre ASC`,
  [USER_ID],
);
console.log(`   ${rows.length} pendientes:`, rows.map((r: any) => `${r.licitacion_codigo} (${r.estado_pipeline})`).join(', ') || '(ninguna)');

const resultados: any[] = [];
for (const row of rows) {
  const codigo = row.licitacion_codigo;
  console.log(`\n-> Procesando ${codigo}...`);
  try {
    const r = await procesarLicitacionCompleta(codigo);
    if (!r.ok || !r.viabilidad) {
      console.log(`   FALLÓ: ${r.error}`);
      resultados.push({ codigo, exito: false, error: r.error });
    } else {
      console.log(`   OK — semáforo=${r.viabilidad.score_viabilidad.semaforo} score=${r.viabilidad.score_viabilidad.total}`);
      resultados.push({ codigo, exito: true, semaforo: r.viabilidad.score_viabilidad.semaforo, score: r.viabilidad.score_viabilidad.total });
    }
  } catch (e: any) {
    console.log(`   ERROR: ${e?.message ?? e}`);
    resultados.push({ codigo, exito: false, error: String(e?.message ?? e) });
  }
}

console.log('\n=== RESUMEN ===');
console.table(resultados);
await pool.end();
