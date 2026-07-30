// SIEMBRA TEMPORAL para probar la UI de Entregas. Inserta 1 entrega + 1 acuse SOLO para el
// usuario 1, SIN pasar por registrarEvento (nadie más recibe campana ni correo).
// Se borra con _tmp-limpiar-entrega.mts.
import fs from 'fs';
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) { let v = m[2].trim(); if (!/^["']/.test(v)) v = v.replace(/\s+#.*$/, '').trim(); process.env[m[1]] = v.replace(/^["']|["']$/g, ''); }
}
const pool = (await import('@/app/lib/db')).default;
const { construirResumenEjecutivo } = await import('@/app/lib/entrega-proyecto');
const { ahoraChileSQL } = await import('@/app/lib/tz');

// Elegimos una adjudicada REAL con acta y competencia, para que la pantalla muestre datos de verdad.
const [negs]: any = await pool.query(
  `SELECT n.id, n.licitacion_codigo FROM negocios n
     JOIN adjudicacion_cache c ON c.licitacion_codigo COLLATE utf8mb4_general_ci = n.licitacion_codigo COLLATE utf8mb4_general_ci
    WHERE n.activo=TRUE AND n.estado_pipeline='ADJUDICADA' AND c.es_adjudicada=1 AND c.numero_oferentes > 1
    ORDER BY n.updated_at DESC LIMIT 1`);
const n = negs[0];
const resumen = await construirResumenEjecutivo(n.id, n.licitacion_codigo);
await pool.query(
  `INSERT IGNORE INTO entrega_proyecto (negocio_id, licitacion_codigo, abierta_at, origen, resumen) VALUES (?,?,?,'ACTA_MP',?)`,
  [n.id, n.licitacion_codigo, ahoraChileSQL(), JSON.stringify(resumen)]);
// Dos acuses: el usuario 1 (pendiente, para probar el flujo) y el 7 ya acusado (para ver "1/2").
await pool.query(`INSERT IGNORE INTO entrega_acuse (negocio_id, usuario_id, notificado_at) VALUES (?,1,?)`, [n.id, ahoraChileSQL()]);
await pool.query(`INSERT IGNORE INTO entrega_acuse (negocio_id, usuario_id, notificado_at, acusado_at) VALUES (?,7,?,?)`, [n.id, ahoraChileSQL(), ahoraChileSQL()]);
console.log(`  Sembrado: negocio ${n.id} · ${n.licitacion_codigo} · ${resumen.licitacionNombre}`);
console.log(`  faltantes: ${resumen.faltantes.join(' | ') || '(ninguno)'}`);
await pool.end();
