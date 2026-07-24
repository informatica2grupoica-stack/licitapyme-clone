// Diagnóstico puntual: por qué una licitación se leyó mal.
// Muestra sus documentos con la PRIORIDAD que les asigna el análisis (prioridadDoc), su tamaño
// y si se recortan por ser "relleno", más el veredicto de adjudicación (con su fuente y la
// evidencia, que es donde queda si un override determinista pisó al modelo) y el manifiesto.
//
//   npx tsx scripts/diag-licitacion.mts 5240-77-LP26
//
// Primer uso real (5240-77-LP26): dejó ver que los productos salían duplicados y mezclados con
// filas del cronograma y un RUT, y que el veredicto GLOBAL contradecía su propia cita.
import { cargarEnv } from './regresion/_env.js';
cargarEnv();
const pool = (await import('../app/lib/db.js')).default;

const CODIGO = process.argv[2] || '5240-77-LP26';
const MAX_RELLENO = 15_000;

// Copia exacta de prioridadDoc (app/lib/viabilidad-ia.ts) para no importar el módulo entero.
function prioridadDoc(nombre: string, categoria: string | null): number {
  const n = `${nombre} ${categoria || ''}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/aclarac|respuesta|consulta|foro/.test(n)) return 0;
  if (/especial/.test(n)) return 1;
  if (/(administrativ|bases).*(general)|general.*(administrativ|bases)|administrativ/.test(n)) return 2;
  if (/tecnic/.test(n)) return 3;
  if (/anexo|formulario|declarac/.test(n)) return 5;
  if (/plano|croquis|lamina|elevacion|planta|isometric|render|imagen|fotograf/.test(n)) return 9;
  return 4;
}

const [docs] = await pool.query(
  `SELECT documento_nombre, categoria, LENGTH(COALESCE(texto_extraido,'')) AS chars, size_bytes
     FROM documentos_cache WHERE licitacion_codigo = ? ORDER BY documento_nombre`, [CODIGO]) as any;

console.log(`\n═══ DOCUMENTOS de ${CODIGO} (${docs.length}) ═══`);
console.log('prio  chars   ¿recortado?  nombre');
for (const d of docs as any[]) {
  const p = prioridadDoc(d.documento_nombre, d.categoria);
  const protegido = p <= 3;
  const recorta = !protegido && d.chars > MAX_RELLENO;
  console.log(
    `  ${p}  ${String(d.chars).padStart(7)}  ${recorta ? `SÍ → ${MAX_RELLENO} (pierde ${d.chars - MAX_RELLENO})` : protegido ? 'no (protegido)' : 'no'}`.padEnd(46) +
    `${d.documento_nombre}${d.categoria ? ` [${d.categoria}]` : ''}`,
  );
}

const [rows] = await pool.query(
  `SELECT informe_ejecutivo FROM viabilidad_licitacion WHERE licitacion_codigo = ? LIMIT 1`, [CODIGO]) as any;
const fila = (rows as any[])[0];
if (!fila) { console.log('\nSin informe de viabilidad guardado.'); process.exit(0); }
const ie = typeof fila.informe_ejecutivo === 'string' ? JSON.parse(fila.informe_ejecutivo) : fila.informe_ejecutivo;
const inf = ie?._informe_ia_v3 ?? ie?._informe_ia;

console.log(`\n═══ INFORME (${inf?._schema || 'v2'}) ═══`);
console.log('adjudicación :', inf?.adjudicacion?.como_se_adjudica, '| estado', inf?.adjudicacion?.estado, '| conf', inf?.adjudicacion?.confianza);
console.log('  fuente     :', inf?.adjudicacion?.fuente);
console.log('  evidencia  :', String(inf?.adjudicacion?.evidencia || '').slice(0, 400));
console.log('modalidad    :', inf?.modalidad?.tipo, '| estructura_costeo:', inf?.estructura_costeo);
console.log('docs leídos  :', (inf?.documentos_leidos || []).length, '| no leídos:', inf?.documentos_no_leidos);

const items = inf?.manifiesto_productos || inf?.productos?.items || inf?.costeo?.items || [];
console.log(`\n═══ MANIFIESTO (${items.length} ítems) ═══`);
for (const it of items.slice(0, 60)) {
  console.log(`  L${String(it.linea ?? '?').padStart(3)} · ${String(it.cantidad ?? '—').padStart(5)} ${String(it.unidad_medida || it.unidad || '').padEnd(8)} ${String(it.descripcion || it.nombre || '').slice(0, 90)}${it.ruta ? `   ←${it.ruta}` : ''}`);
}
if (items.length > 60) console.log(`  … y ${items.length - 60} más`);

await pool.end();
