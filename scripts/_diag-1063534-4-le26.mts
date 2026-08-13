// Diagnóstico puntual 1063534-4-LE26: re-análisis siguió saliendo GLOBAL. Solo lectura.
// Uso: npx tsx scripts/_diag-1063534-4-le26.mts
import { readFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim(); }
const mysql = (await import('mysql2/promise')).default;
const {
  detectarTipoAdjudicacionMultiple, detectarOfertaSubconjuntoItems,
  detectarParticipacionParcialPorLinea, detectarPresupuestoPorLinea,
  detectarLenguajePorLinea, detectarFormulariosEconomicosPorArchivo,
} = await import('@/app/lib/planilla-costeo-parser');

const COD = '1063534-4-LE26';
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

// Buscar cualquier mención de "línea"/"lote"/"ítem" cerca de "adjudicaci" para ver qué dicen
// realmente las bases, sin depender de que algún detector ya la reconozca.
const buscar = /[^.]{0,120}adjudicaci[oó]n[^.]{0,200}\./gi;
for (const d of docs) {
  let m: RegExpExecArray | null;
  buscar.lastIndex = 0;
  let n = 0;
  while ((m = buscar.exec(d.texto)) !== null && n < 15) {
    if (/l[ií]nea|lote|[ií]tem/i.test(m[0])) {
      console.log(`\n[${d.nombre}] frase con "adjudicaci..." + línea/lote/ítem:`);
      console.log('  ' + m[0].replace(/\s+/g, ' ').trim());
      n++;
    }
  }
}

console.log('\n== Informe de viabilidad guardado ==');
const [vRows] = await pool.query(
  `SELECT id, created_at, updated_at, informe_ejecutivo FROM viabilidad_licitacion WHERE licitacion_codigo = ? ORDER BY id DESC LIMIT 1`,
  [COD],
) as any[];
const fila = (vRows as any[])[0];
if (fila) {
  console.log(`id=${fila.id} created_at=${fila.created_at} updated_at=${fila.updated_at}`);
  const obj = typeof fila.informe_ejecutivo === 'string' ? JSON.parse(fila.informe_ejecutivo) : fila.informe_ejecutivo;
  const v3 = obj?._informe_ia_v3 || obj?._informe_ia;
  console.log('adjudicacion:', JSON.stringify(v3?.adjudicacion, null, 2));
  const items = v3?.productos?.items || v3?.costeo?.items || [];
  console.log(`items en el manifiesto: ${items.length}`);
  if (items.length) console.log(JSON.stringify(items.slice(0, 8), null, 2));
} else {
  console.log('Sin informe_ejecutivo guardado para este código.');
}

// Cuántos ítems trae el catálogo real de la API de Mercado Público (tabla local, si existe).
try {
  const [itemsMP] = await pool.query(
    `SELECT COUNT(*) n FROM licitacion_items WHERE licitacion_codigo = ?`, [COD],
  ) as any[];
  console.log('\nÍtems en licitacion_items (API MP, tabla local):', (itemsMP as any[])[0]?.n);
} catch (e) {
  console.log('\n(no se pudo consultar licitacion_items —', String(e).slice(0, 150), ')');
}

await pool.end();
