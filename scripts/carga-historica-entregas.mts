// Carga histórica SILENCIOSA para las adjudicadas que ganamos ANTES de que existiera F.1
// (Entrega de Proyectos). Sin esto, esos proyectos ya ganados nunca tendrán su resumen
// ejecutivo ni aparecerán en /entregas, porque el disparo real solo vive en el cron que
// promueve POSTULADA→ADJUDICADA (abrirEntregaSiCorresponde en procesar-postuladas.ts), y esas
// promociones ya ocurrieron en el pasado.
//
// SILENCIOSO a propósito: crea la entrega Y la marca como YA reconocida por todos los
// involucrados (acusado_at = ahora), así ningún usuario ve el modal bloqueante ni recibe
// campana/correo por algo que ya pasó hace tiempo. Es una ficha histórica, no un aviso.
//
// Uso:
//   npx tsx scripts/carga-historica-entregas.mts            → SOLO reporta (no toca nada)
//   npx tsx scripts/carga-historica-entregas.mts --aplicar  → carga
import fs from 'fs';
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) { let v = m[2].trim(); if (!/^["']/.test(v)) v = v.replace(/\s+#.*$/, '').trim(); process.env[m[1]] = v.replace(/^["']|["']$/g, ''); }
}

const APLICAR = process.argv.includes('--aplicar');

const pool = (await import('@/app/lib/db')).default;
const { construirResumenEjecutivo, involucradosEnEntrega } = await import('@/app/lib/entrega-proyecto');
const { ahoraChileSQL } = await import('@/app/lib/tz');

// `abierta_at` = "cuándo se confirmó que ganamos". Para una carga retroactiva ese instante NO es
// el momento de correr este script: es la fecha del ACTA de Mercado Público, que ya está en
// adjudicacion_cache. Usar ahora() haría que todos los proyectos dijeran que se ganaron el mismo
// día, borrando la fecha real. Solo si el acta no trae fecha se cae a updated_at del negocio.
const [negs]: any = await pool.query(
  `SELECT n.id, n.licitacion_codigo, n.licitacion_nombre, n.asignado_a,
          COALESCE(
            DATE_FORMAT(ac.fecha_adjudicacion, '%Y-%m-%d %H:%i:%s'),
            DATE_FORMAT(n.updated_at,          '%Y-%m-%d %H:%i:%s')
          ) AS ganado_at,
          ac.fecha_adjudicacion IS NULL AS sin_fecha_acta
     FROM negocios n
     LEFT JOIN entrega_proyecto e ON e.negocio_id = n.id
     LEFT JOIN adjudicacion_cache ac
       ON ac.licitacion_codigo COLLATE utf8mb4_general_ci = n.licitacion_codigo COLLATE utf8mb4_general_ci
    WHERE n.activo = TRUE AND n.estado_pipeline = 'ADJUDICADA' AND e.negocio_id IS NULL
    ORDER BY n.id`);

console.log(`\n  ${negs.length} adjudicada(s) sin entrega${APLICAR ? '' : '  (modo REPORTE — usa --aplicar para cargar)'}\n`);

let cargadas = 0;
const ahora = ahoraChileSQL();

for (const n of negs as any[]) {
  const resumen = await construirResumenEjecutivo(n.id, n.licitacion_codigo);
  console.log(`  · ${n.licitacion_codigo} — ${n.licitacion_nombre || '(sin nombre)'}` +
    `  ganado ${n.ganado_at}${Number(n.sin_fecha_acta) ? ' (sin fecha en el acta → updated_at)' : ''}` +
    (resumen.faltantes.length ? `  [${resumen.faltantes.length} faltante(s)]` : ''));

  if (!APLICAR) continue;

  // abierta_at = fecha REAL del acta. completada_at = ahora, que sí es real: es cuándo esta
  // carga las dio por reconocidas (nadie acusó recibo a mano, por eso `origen = HISTORICO`).
  const [r]: any = await pool.query(
    `INSERT IGNORE INTO entrega_proyecto (negocio_id, licitacion_codigo, abierta_at, origen, resumen, completada_at)
     VALUES (?, ?, ?, 'HISTORICO', ?, ?)`,
    [n.id, n.licitacion_codigo, n.ganado_at, JSON.stringify(resumen), ahora],
  );
  if (!r?.affectedRows) continue; // otra corrida la creó primero

  const involucrados = await involucradosEnEntrega(n.asignado_a);
  for (const uid of involucrados) {
    await pool.query(
      `INSERT IGNORE INTO entrega_acuse (negocio_id, usuario_id, notificado_at, acusado_at) VALUES (?, ?, ?, ?)`,
      [n.id, uid, ahora, ahora],
    );
  }
  cargadas++;
}

console.log(`\n  ${APLICAR ? `Cargadas: ${cargadas}/${negs.length}` : `Se cargarían ${negs.length} (usa --aplicar)`}\n`);
await pool.end();
