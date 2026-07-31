// Regenera el resumen ejecutivo de las entregas YA guardadas para que tengan los campos nuevos
// (garantías, multas por atraso, riesgos/alertas de viabilidad, documentos propios — agregados
// 2026-07-31 a pedido explícito: "entre mas informacion mejor asi estan consientes de las
// multas"). Sin esto, las 35 entregas que ya existen quedarían con el resumen viejo hasta que algo
// más las tocara — el objetivo es que el usuario los vea AHORA al entrar a /entregas.
//
// Solo reescribe `resumen`. NO toca `abierta_at`, `origen` ni `completada_at`: eso ya quedó
// correcto (ver corregir-fechas-entregas.mts). Es un refresh de contenido, no una recarga.
//
// Uso:
//   npx tsx scripts/regenerar-resumenes-entregas.mts            → SOLO reporta
//   npx tsx scripts/regenerar-resumenes-entregas.mts --aplicar  → regenera
import fs from 'fs';
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) { let v = m[2].trim(); if (!/^["']/.test(v)) v = v.replace(/\s+#.*$/, '').trim(); process.env[m[1]] = v.replace(/^["']|["']$/g, ''); }
}

const APLICAR = process.argv.includes('--aplicar');

const pool = (await import('@/app/lib/db')).default;
const { construirResumenEjecutivo } = await import('@/app/lib/entrega-proyecto');

const [filas]: any = await pool.query(
  `SELECT negocio_id, licitacion_codigo FROM entrega_proyecto ORDER BY negocio_id`);

console.log(`\n  ${filas.length} entrega(s)${APLICAR ? '' : '  (modo REPORTE — usa --aplicar para regenerar)'}\n`);

let conMultas = 0, conGarantias = 0, conRiesgos = 0, conDocumentos = 0;

for (const f of filas as any[]) {
  const resumen = await construirResumenEjecutivo(f.negocio_id, f.licitacion_codigo);
  if (resumen.multas) conMultas++;
  if (resumen.garantias.length) conGarantias++;
  if (resumen.riesgosViabilidad.length || resumen.alertasViabilidad.length) conRiesgos++;
  if (resumen.documentosPropios.length) conDocumentos++;

  console.log(`  · ${f.licitacion_codigo}` +
    (resumen.multas ? ' [multas]' : '') +
    (resumen.garantias.length ? ` [${resumen.garantias.length} garantía(s)]` : '') +
    (resumen.riesgosViabilidad.length || resumen.alertasViabilidad.length ? ` [${resumen.riesgosViabilidad.length + resumen.alertasViabilidad.length} riesgo/alerta]` : '') +
    (resumen.documentosPropios.length ? ` [${resumen.documentosPropios.length} doc(s)]` : ''));

  if (APLICAR) {
    await pool.query(`UPDATE entrega_proyecto SET resumen = ? WHERE negocio_id = ?`,
      [JSON.stringify(resumen), f.negocio_id]);
  }
}

console.log(`\n  Con multas: ${conMultas} · con garantías: ${conGarantias} · con riesgos/alertas: ${conRiesgos} · con documentos: ${conDocumentos} (de ${filas.length})\n`);
await pool.end();
