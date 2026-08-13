// Diagnóstico puntual 4928-14-LP26: por qué la adjudicación salió GLOBAL pese a que las bases
// dicen "se desarrollará en Adjudicación en Líneas". Solo lectura.
// Uso: npx tsx scripts/_diag-4928-14-lp26.mts
import { readFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim(); }
const mysql = (await import('mysql2/promise')).default;
const {
  detectarTipoAdjudicacionMultiple, detectarOfertaSubconjuntoItems,
  detectarParticipacionParcialPorLinea, detectarPresupuestoPorLinea,
  detectarLenguajePorLinea, detectarFormulariosEconomicosPorArchivo,
} = await import('@/app/lib/planilla-costeo-parser');

const COD = '4928-14-LP26';
const pool = mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 20000 });

const [docsRows] = await pool.query(
  `SELECT documento_nombre AS nombre, categoria, texto_extraido AS texto
     FROM documentos_cache WHERE licitacion_codigo = ? AND texto_extraido IS NOT NULL AND texto_extraido <> ''`,
  [COD],
) as any[];
const docs = docsRows as { nombre: string; categoria: string; texto: string }[];
console.log(`Documentos con texto cacheado: ${docs.length}`);
for (const d of docs) console.log(`  - ${d.nombre} (${d.categoria}) — ${d.texto.length} caracteres`);

console.log('\n== Detectores deterministas sobre el texto real ==');
console.log('detectarTipoAdjudicacionMultiple:', detectarTipoAdjudicacionMultiple(docs));
console.log('detectarOfertaSubconjuntoItems:', detectarOfertaSubconjuntoItems(docs));
console.log('detectarParticipacionParcialPorLinea:', detectarParticipacionParcialPorLinea(docs));
console.log('detectarPresupuestoPorLinea:', detectarPresupuestoPorLinea(docs));
console.log('detectarLenguajePorLinea:', detectarLenguajePorLinea(docs));
console.log('detectarFormulariosEconomicosPorArchivo:', detectarFormulariosEconomicosPorArchivo(docs));

// Buscar la frase textual que citó el usuario, en el texto real.
const frase = /adjudicaci[oó]n\s+en\s+l[ií]neas?/gi;
for (const d of docs) {
  let m: RegExpExecArray | null;
  frase.lastIndex = 0;
  while ((m = frase.exec(d.texto)) !== null) {
    console.log(`\n[${d.nombre}] contexto de "${m[0]}":`);
    console.log('  …' + d.texto.slice(Math.max(0, m.index - 80), m.index + 200).replace(/\s+/g, ' ') + '…');
  }
}

console.log('\n== Informe de viabilidad guardado ==');
const [vRows] = await pool.query(
  `SELECT informe_ejecutivo FROM viabilidad_licitacion WHERE licitacion_codigo = ? ORDER BY id DESC LIMIT 1`,
  [COD],
) as any[];
const informe = (vRows as any[])[0]?.informe_ejecutivo;
if (informe) {
  const obj = typeof informe === 'string' ? JSON.parse(informe) : informe;
  const v3 = obj?._informe_ia_v3 || obj?._informe_ia;
  console.log('adjudicacion:', JSON.stringify(v3?.adjudicacion, null, 2));
  const items = v3?.productos?.items || v3?.costeo?.items || [];
  console.log(`items en el manifiesto: ${items.length}`);
  if (items.length) console.log(JSON.stringify(items.slice(0, 5), null, 2));
} else {
  console.log('Sin informe_ejecutivo guardado para este código.');
}

await pool.end();
