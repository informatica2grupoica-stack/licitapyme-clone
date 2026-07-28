// Auditoría de SINÓNIMOS de "cómo se adjudica" (a quién: GLOBAL vs POR_LINEAS) sobre TODA la base
// de licitaciones con documentos cacheados. Objetivo: encontrar frases reales que hoy NO dispara
// ningún detector determinista, para decidir si merecen un patrón nuevo (con criterio humano, cada
// hallazgo se revisa antes de codificarlo — no se agrega nada automáticamente).
//
// Solo lectura. NO llama al LLM, NO modifica nada. Corre los 5 detectores REALES de producción
// contra el texto ya cacheado de cada licitación y reporta los fragmentos con "adjudicaci..." +
// "línea/lote/ítem" cerca que NINGUNO de los 5 reconoce.
//
// Uso: npx tsx scripts/auditar-sinonimos-adjudicacion.mts [--limit=N]
import fs from 'fs';
import mysql from 'mysql2/promise';
import {
  detectarTipoAdjudicacionMultiple, detectarOfertaSubconjuntoItems,
  detectarParticipacionParcialPorLinea, detectarPresupuestoPorLinea,
  detectarFormulariosEconomicosPorArchivo,
} from '../app/lib/planilla-costeo-parser';

const env: Record<string, string> = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000,
});

const limitArg = process.argv.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;

type DocRow = { licitacion_codigo: string; documento_nombre: string; categoria: string | null; texto_extraido: string | null };

console.log('Cargando documentos cacheados (puede tardar un poco)...');
const [rows] = await pool.query<any[]>(
  `SELECT licitacion_codigo, documento_nombre, categoria, texto_extraido
   FROM documentos_cache
   WHERE texto_extraido IS NOT NULL AND CHAR_LENGTH(texto_extraido) >= 50`,
);
const docs = rows as DocRow[];
console.log(`${docs.length} documentos con texto, agrupando por licitación...`);

const porLicitacion = new Map<string, DocRow[]>();
for (const d of docs) {
  if ((d.categoria || '').toUpperCase() === 'DOCUMENTOS_PROPIOS') continue;
  if (/^COSTEO_/i.test(d.documento_nombre)) continue;
  const arr = porLicitacion.get(d.licitacion_codigo) || [];
  arr.push(d);
  porLicitacion.set(d.licitacion_codigo, arr);
}
console.log(`${porLicitacion.size} licitaciones distintas con documentos fuente.\n`);

// Ventana de contexto alrededor de "adjudicaci..." que además menciona línea/lote/ítem cerca —
// el mismo universo semántico que interesa a los 5 detectores existentes.
const reAdjLinea = /adjudicaci[oó]n[\s\S]{0,200}?\b(l[ií]neas?|lotes?|[ií]tems?)\b|adjudicar[\s\S]{0,200}?\b(l[ií]neas?|lotes?|[ií]tems?)\b|\b(l[ií]neas?|lotes?|[ií]tems?)\b[\s\S]{0,200}?adjudicaci[oó]n/gi;

let procesadas = 0;
const noReconocidos: { codigo: string; doc: string; frag: string }[] = [];
const vistos = new Set<string>(); // dedupe de fragmentos casi iguales (normalizado)

for (const [codigo, fuentesRaw] of porLicitacion) {
  if (procesadas >= LIMIT) break;
  procesadas++;
  const fuentes = fuentesRaw.map(d => ({ nombre: d.documento_nombre, texto: d.texto_extraido || '' }));

  // ¿Ya lo reconoce ALGUNO de los 5 detectores reales de producción?
  const yaReconocido =
    !!detectarTipoAdjudicacionMultiple(fuentes) ||
    !!detectarOfertaSubconjuntoItems(fuentes) ||
    !!detectarParticipacionParcialPorLinea(fuentes) ||
    !!detectarPresupuestoPorLinea(fuentes) ||
    detectarFormulariosEconomicosPorArchivo(fuentes).length >= 2;
  if (yaReconocido) continue; // esta licitación ya tiene evidencia dura — no es candidata

  // Busca fragmentos "adjudicación...línea" que ningún detector cazó, para revisión humana.
  for (const d of fuentes) {
    if (!d.texto) continue;
    reAdjLinea.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = reAdjLinea.exec(d.texto)) !== null) {
      const frag = m[0].replace(/\s+/g, ' ').trim();
      const clave = frag.toLowerCase().replace(/[^a-záéíóúñ ]/g, '').slice(0, 60);
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      noReconocidos.push({ codigo, doc: d.nombre, frag: frag.length > 220 ? frag.slice(0, 220) + '…' : frag });
    }
  }
}

console.log(`\n================ RESULTADO (${procesadas} licitaciones revisadas) ================`);
console.log(`Fragmentos "adjudicación + línea/lote/ítem" NO reconocidos por ningún detector: ${noReconocidos.length}\n`);
for (const n of noReconocidos) {
  console.log(`--- ${n.codigo}  [${n.doc}] ---`);
  console.log(`  "${n.frag}"\n`);
}

await pool.end();
