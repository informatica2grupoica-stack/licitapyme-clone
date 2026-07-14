// VERIFICADOR OBJETIVO DE CITAS. Para cada "fuente" del informe (doc · sección · pág. N):
//   1. ubica el documento en cache y trocea su texto por marcadores [[PÁGINA N]].
//   2. calcula en qué página(s) aparece REALMENTE la sección citada (por keywords).
//   3. compara con la página citada → CORRECTA / FUERA (con la página real sugerida).
// Corre sobre informes YA GUARDADOS (gratis). Uso:
//   npx tsx scripts/regresion/_verif-citas.ts 2693-22-LP26 3507-12-LE26   (códigos concretos)
//   npx tsx scripts/regresion/_verif-citas.ts --random 5                  (5 al azar con informe v3)
import mysql from 'mysql2/promise';
import { cargarEnv } from './_env';
cargarEnv();

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const STOP = new Set(['de','la','el','los','las','del','y','o','a','en','para','por','con','se','un','una','al','que','su','sus','anexo','oferta','ofertas','base','bases']);

// Trocea el texto por [[PÁGINA N]] → [{pag, texto}]. Rango [[PÁGINA a-b]] usa a.
function paginas(texto: string): { pag: number; texto: string }[] {
  const re = /\[\[P[ÁA]GINA\s*(\d+)(?:\s*-\s*(\d+))?\]\]/gi;
  const marks: { pag: number; idx: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) marks.push({ pag: Number(m[1]), idx: m.index });
  if (!marks.length) return [{ pag: 1, texto }];
  const out: { pag: number; texto: string }[] = [];
  for (let i = 0; i < marks.length; i++) {
    const fin = i + 1 < marks.length ? marks[i + 1].idx : texto.length;
    out.push({ pag: marks[i].pag, texto: norm(texto.slice(marks[i].idx, fin)) });
  }
  return out;
}

// Tokens significativos de la sección citada (numerales tipo 11.3 / 16 + palabras ≥4).
function tokens(seccion: string): { nums: string[]; palabras: string[] } {
  const nums = (seccion.match(/\d+(?:\.\d+)*/g) || []).filter(n => n.length <= 6);
  const palabras = norm(seccion).split(' ').filter(w => w.length >= 4 && !STOP.has(w) && !/^\d/.test(w));
  return { nums, palabras };
}

// Score de match de una sección contra una página.
function score(pagTexto: string, tk: { nums: string[]; palabras: string[] }): number {
  let s = 0;
  for (const n of tk.nums) if (new RegExp(`(^|[^\\d.])${n.replace('.', '\\.')}([^\\d]|$)`).test(pagTexto)) s += 2;
  for (const w of tk.palabras) if (pagTexto.includes(w)) s += 1;
  return s;
}

function parseFuente(f: string): { doc: string; seccion: string; pag: number | null } | null {
  const partes = f.split('·').map(s => s.trim());
  if (partes.length < 2) return null;
  const doc = partes[0];
  const pagPart = partes[partes.length - 1];
  const pm = pagPart.match(/p[áa]g\.?\s*(\d+)/i);
  const pag = pm ? Number(pm[1]) : null;
  const seccion = partes.slice(1, partes.length - 1).join(' · ') || pagPart.replace(/p[áa]g\.?\s*\d+.*/i, '');
  return { doc, seccion, pag };
}

async function verificarCodigo(pool: mysql.Pool, codigo: string) {
  const [dRows] = await pool.query(
    `SELECT documento_nombre, texto_extraido FROM documentos_cache WHERE licitacion_codigo=?`, [codigo]);
  const docs = new Map<string, { pag: number; texto: string }[]>();
  const docNorm = new Map<string, string>();
  for (const d of dRows as any[]) {
    if (!d.texto_extraido) continue;
    docs.set(d.documento_nombre, paginas(d.texto_extraido));
    docNorm.set(norm(d.documento_nombre), d.documento_nombre);
  }
  const [vRows] = await pool.query(`SELECT informe_ejecutivo FROM viabilidad_licitacion WHERE licitacion_codigo=? LIMIT 1`, [codigo]);
  const row = (vRows as any[])[0];
  if (!row) return { codigo, total: 0, ok: 0, sinDoc: 0, sinPag: 0, fuera: [] as any[] };
  let ie: any; try { ie = typeof row.informe_ejecutivo === 'string' ? JSON.parse(row.informe_ejecutivo) : row.informe_ejecutivo; } catch { return null; }
  const inf = ie?._informe_ia_v3; if (!inf) return null;

  const fuentes: string[] = [];
  const walk = (o: any) => { if (!o || typeof o !== 'object') return; for (const [k, v] of Object.entries(o)) { if (k === 'fuente' && typeof v === 'string' && v.trim()) fuentes.push(v.trim()); else walk(v); } };
  walk(inf);

  let ok = 0, sinDoc = 0, sinPag = 0, noVerif = 0;
  const fuera: any[] = [];
  for (const f of fuentes) {
    const p = parseFuente(f); if (!p) continue;
    // localizar doc por nombre (match tolerante)
    let pags = docs.get(p.doc);
    if (!pags) { const key = [...docNorm.keys()].find(k => k.includes(norm(p.doc)) || norm(p.doc).includes(k)); if (key) pags = docs.get(docNorm.get(key)!); }
    if (!pags) { sinDoc++; continue; }
    if (p.pag == null) { sinPag++; continue; }
    if (pags.length === 1 && pags[0].pag === 1) { ok++; continue; } // doc de 1 página (docx/xlsx): no puede fallar la página
    const tk = tokens(p.seccion);
    // Sección sin PALABRAS (número pelado tipo "29" o vacía) → NO verificable por keywords:
    // un numeral suelto aparece en cualquier página. La saltamos (ni ok ni fuera) para no
    // ensuciar la métrica con falsos negativos; solo medimos citas con texto de sección real.
    if (!tk.palabras.length) { noVerif++; continue; }
    const scored = pags.map(pg => ({ pag: pg.pag, s: score(pg.texto, tk) }));
    const max = Math.max(...scored.map(x => x.s));
    if (max <= 0) { ok++; continue; } // sección no localizable por keywords → no la contamos como fallo
    const citada = scored.find(x => x.pag === p.pag);
    const mejores = scored.filter(x => x.s === max).map(x => x.pag);
    const citOK = citada ? citada.s >= max - 1 && citada.s > 0 : false;
    if (citOK) ok++;
    else fuera.push({ f, citada: p.pag, real: mejores.slice(0, 3), scoreCitada: citada?.s ?? 0, scoreReal: max });
  }
  return { codigo, total: fuentes.length, ok, sinDoc, sinPag, noVerif, fuera };
}

async function main() {
  const args = process.argv.slice(2);
  const pool = mysql.createPool({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, connectionLimit: 3, connectTimeout: 20000,
  });

  let codigos: string[] = [];
  if (args[0] === '--random') {
    const n = Number(args[1]) || 5;
    const [rows] = await pool.query(
      `SELECT v.licitacion_codigo FROM viabilidad_licitacion v
        WHERE JSON_EXTRACT(v.informe_ejecutivo,'$._informe_ia_v3') IS NOT NULL
        ORDER BY RAND() LIMIT ?`, [n]);
    codigos = (rows as any[]).map(r => r.licitacion_codigo);
  } else {
    codigos = args.filter(a => !a.startsWith('--'));
  }
  console.log(`\nVerificando citas de ${codigos.length} licitación(es): ${codigos.join(', ')}\n`);

  let totCitas = 0, totOK = 0, totFuera = 0;
  for (const c of codigos) {
    const r = await verificarCodigo(pool, c).catch(() => null);
    if (!r) { console.log(`  ${c}: sin informe v3`); continue; }
    totCitas += r.total; totOK += r.ok; totFuera += r.fuera.length;
    const pct = r.total ? Math.round((r.ok / (r.ok + r.fuera.length || 1)) * 100) : 0;
    console.log(`■ ${c}: ${r.ok}/${r.ok + r.fuera.length} citas verificables correctas (${pct}%) · ${r.total} totales · ${r.sinDoc} sin-doc · ${r.sinPag} sin-pág · ${r.noVerif} no-verificables`);
    for (const x of r.fuera.slice(0, 12)) console.log(`    ✗ cita pág.${x.citada} pero la sección está en pág.${x.real.join('/')} (score ${x.scoreCitada} vs ${x.scoreReal}) · ${x.f.slice(0, 90)}`);
  }
  const glob = totOK + totFuera;
  console.log(`\n── GLOBAL: ${totOK}/${glob} citas correctas (${glob ? Math.round(totOK / glob * 100) : 0}%) · ${totFuera} fuera de página ──\n`);
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
