// CORRIGE las entregas cuya fecha quedó mal escrita por la carga histórica del 30-jul-2026.
//
// QUÉ PASÓ: la carga retroactiva guardó `abierta_at = ahora()` en las 34 entregas históricas, así
// que la pantalla mostraba "Ganado el 30 de julio" en TODAS — pisando la fecha real de cada acta
// (que va del 1 de junio al 23 de julio). Además el resumen guardaba `fechaAdjudicacion` con el
// toString() de JS ("Tue Jul 14 2026 13:53:37 GMT-0400 (hora estándar de Chile)"), que depende
// del locale del proceso.
//
// QUÉ HACE: reescribe `abierta_at` con la fecha REAL del acta (adjudicacion_cache) y regenera el
// resumen con construirResumenEjecutivo ya corregido, que ahora formatea la fecha en SQL.
//
// Regenerar el resumen NO reescribe ninguna decisión del equipo (producto, costeo, plazos salen
// del paquete congelado, que no se toca): corrige el formato de un dato externo, igual que
// repararContactosFaltantes. Solo toca entregas cuya fecha efectivamente esté mal.
//
// Uso:
//   npx tsx scripts/corregir-fechas-entregas.mts            → SOLO reporta
//   npx tsx scripts/corregir-fechas-entregas.mts --aplicar  → corrige
import fs from 'fs';
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) { let v = m[2].trim(); if (!/^["']/.test(v)) v = v.replace(/\s+#.*$/, '').trim(); process.env[m[1]] = v.replace(/^["']|["']$/g, ''); }
}

const APLICAR = process.argv.includes('--aplicar');

const pool = (await import('@/app/lib/db')).default;
const { construirResumenEjecutivo } = await import('@/app/lib/entrega-proyecto');

const [filas]: any = await pool.query(
  `SELECT e.negocio_id, e.licitacion_codigo, e.origen,
          DATE_FORMAT(e.abierta_at, '%Y-%m-%d %H:%i:%s')        AS abierta_at,
          DATE_FORMAT(ac.fecha_adjudicacion, '%Y-%m-%d %H:%i:%s') AS acta_at
     FROM entrega_proyecto e
     LEFT JOIN adjudicacion_cache ac
       ON ac.licitacion_codigo COLLATE utf8mb4_general_ci = e.licitacion_codigo COLLATE utf8mb4_general_ci
    ORDER BY e.negocio_id`);

console.log(`\n  ${filas.length} entrega(s) revisadas${APLICAR ? '' : '  (modo REPORTE — usa --aplicar para corregir)'}\n`);

let corregidas = 0, sinActa = 0, yaOk = 0;

for (const f of filas as any[]) {
  if (!f.acta_at) {
    sinActa++;
    console.log(`  ? ${f.licitacion_codigo} — el acta no trae fecha, se deja como está (${f.abierta_at})`);
    continue;
  }
  if (f.abierta_at === f.acta_at) { yaOk++; continue; }

  console.log(`  ✔ ${f.licitacion_codigo}`);
  console.log(`      decía : ${f.abierta_at}`);
  console.log(`      real  : ${f.acta_at}   (acta de MP)`);

  if (!APLICAR) { corregidas++; continue; }

  // Resumen regenerado con el código ya corregido (fecha formateada en SQL).
  const resumen = await construirResumenEjecutivo(f.negocio_id, f.licitacion_codigo);
  await pool.query(
    `UPDATE entrega_proyecto SET abierta_at = ?, resumen = ? WHERE negocio_id = ?`,
    [f.acta_at, JSON.stringify(resumen), f.negocio_id],
  );
  corregidas++;
}

console.log(`\n  ${APLICAR ? 'Corregidas' : 'Se corregirían'}: ${corregidas} · ya correctas: ${yaOk} · sin fecha en el acta: ${sinActa}\n`);
await pool.end();
