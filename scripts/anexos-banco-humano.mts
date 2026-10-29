// BANCO CONTRA LO QUE LLENÓ UNA PERSONA — compara lo que el motor escribe con lo que el equipo
// escribió de verdad en los anexos que subió a «Documentos propios».
//
//   npx tsx scripts/anexos-banco-humano.mts                  → todos los pares que encuentra
//   npx tsx scripts/anexos-banco-humano.mts --limite 40      → solo los primeros 40 documentos
//   npx tsx scripts/anexos-banco-humano.mts --lic 2827-102-LE26
//   npx tsx scripts/anexos-banco-humano.mts --json salida.json
//
// CÓMO FUNCIONA (solo .docx; los PDF no se pueden alinear con el original sin OCR):
//  1. Por cada .docx propio de una licitación busca, entre los .docx que NO son propios de esa
//     misma licitación (las bases, el anexo en blanco), el que más se le parece (≥70 % de sus
//     palabras están en el original).
//  2. Genera ese original con el motor (la misma empresa del negocio, costeo, Auditor y bases que
//     usa /api/anexos/generar, sin respuestas manuales).
//  3. Diferencia por palabras: lo que la persona INSERTÓ respecto del original vs lo que el motor
//     INSERTÓ, anclado a la misma posición del original. Los rellenos de raya (___ …… ---) no
//     cuentan como texto del original.
//  4. Cada inserción de la persona queda en una de: IGUAL (el motor puso lo mismo), PARECIDO
//     (≥60 % de palabras en común), DISTINTO (puso otra cosa) o FALTA (el motor no escribió nada).
//     Además cuenta lo que el motor escribió donde la persona no (SOBRA).
//
// Lo que se lee de acá: la lista «FALTA» agrupada por etiqueta es el trabajo pendiente del
// diccionario, ordenado por cuántas licitaciones distintas la piden.
//
// Ojo: un .docx propio puede ser uno que generó el propio sistema (entonces coincide solo) o un
// anexo corregido a mano; el banco no los distingue. Mirar los casos DISTINTO uno por uno antes de
// tocar una regla: el equipo a veces escribe algo que el motor no debe escribir (decisiones del
// oferente, texto libre).
import { readFileSync, writeFileSync } from 'node:fs';

for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*([^#]*)/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const mysql = (await import('mysql2/promise')).default;
const { abrirDocx, listarParrafos } = await import('@/app/lib/anexos-docx');
const { generarAnexoFinal } = await import('@/app/lib/anexos-rellenar');
const datos = await import('@/app/lib/anexos-datos');
const { convertirDocADocx } = await import('@/app/lib/anexos-doc-legacy');

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const limite = Number(arg('limite')) || 1000;
const soloLic = arg('lic');
const salidaJson = arg('json');

const pool = mysql.createPool({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectionLimit: 8,
});

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = (s: string) => sinTildes(s).toLowerCase().replace(/[^a-z0-9ñ$]/g, '');
const ES_RELLENO = /^[_.…\-–—\s]+$/;

/** Palabras del documento, sin las rayas de relleno. */
function palabras(xml: string): string[] {
  const out: string[] = [];
  for (const p of listarParrafos(xml)) {
    for (const w of (p.texto || '').split(/\s+/)) {
      if (!w) continue;
      // «____Nombre____» pegado: se limpia el relleno de los bordes, no se descarta la palabra.
      const limpia = w.replace(/^[_.…]{2,}/, '').replace(/[_.…]{2,}$/, '');
      if (!limpia || ES_RELLENO.test(limpia)) continue;
      out.push(limpia);
    }
  }
  return out;
}

interface Insercion { pos: number; texto: string }

/** Inserciones de `b` respecto de `a` (LCS por palabras normalizadas), ancladas a la posición en `a`. */
function inserciones(a: string[], b: string[]): Insercion[] | null {
  const A = a.map(norm), B = b.map(norm);
  let ini = 0;
  while (ini < A.length && ini < B.length && A[ini] === B[ini]) ini++;
  let fa = A.length, fb = B.length;
  while (fa > ini && fb > ini && A[fa - 1] === B[fb - 1]) { fa--; fb--; }
  const n = fa - ini, m = fb - ini;
  if (n * m > 60_000_000) return null;
  const w = m + 1;
  const dp = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = A[ini + i] === B[ini + j]
        ? dp[(i + 1) * w + j + 1] + 1
        : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const out: Insercion[] = [];
  let i = 0, j = 0, actual: Insercion | null = null;
  const cerrar = () => { if (actual) { out.push(actual); actual = null; } };
  while (i < n || j < m) {
    if (i < n && j < m && A[ini + i] === B[ini + j]) { cerrar(); i++; j++; }
    else if (j < m && (i >= n || dp[i * w + j + 1] >= dp[(i + 1) * w + j])) {
      if (!actual) actual = { pos: ini + i, texto: '' };
      actual.texto += (actual.texto ? ' ' : '') + b[ini + j];
      j++;
    } else { cerrar(); i++; }
  }
  cerrar();
  return out;
}

const tokensNorm = (s: string) => s.split(/\s+/).map(norm).filter(Boolean);
function solape(a: string, b: string): number {
  const x = new Set(tokensNorm(a)), y = new Set(tokensNorm(b));
  if (!x.size || !y.size) return 0;
  let c = 0; for (const t of x) if (y.has(t)) c++;
  return c / Math.min(x.size, y.size);
}
/** El texto que la persona escribió se parte distinto que el del motor (pos ±): se juntan las del mismo hueco. */
function cercanas(lista: Insercion[], pos: number, holgura: number): Insercion[] {
  return lista.filter(x => Math.abs(x.pos - pos) <= holgura);
}

type Veredicto = 'IGUAL' | 'PARECIDO' | 'DISTINTO' | 'FALTA';
interface Caso {
  licitacion: string; documento: string; original: string; veredicto: Veredicto;
  etiqueta: string; humano: string; motor: string;
}
interface Sobra { licitacion: string; documento: string; etiqueta: string; motor: string }

// ── Pares ──────────────────────────────────────────────────────────────────────────────────
const [propios]: any = await pool.query(
  `SELECT d.id, d.created_at, d.licitacion_codigo, d.documento_nombre, d.documento_url_local,
          (SELECT n.empresa_id FROM negocios n WHERE n.licitacion_codigo = d.licitacion_codigo AND n.activo = TRUE LIMIT 1) AS empresa_id
     FROM documentos_cache d
    WHERE d.categoria = 'DOCUMENTOS_PROPIOS' AND d.documento_nombre LIKE '%.docx'
      AND (d.documento_nombre LIKE '%nexo%' OR d.subcategoria LIKE '%nexo%' OR d.documento_nombre LIKE '%ormulario%' OR d.documento_nombre LIKE '%ormato%')
      ${soloLic ? 'AND d.licitacion_codigo = ?' : ''}
    ORDER BY d.id DESC LIMIT ?`,
  soloLic ? [soloLic, limite] : [limite]);

const casos: Caso[] = [];
const sobras: Sobra[] = [];
let anteriores = 0, sinPar = 0, sinInserciones = 0, demasiadoGrande = 0, errores = 0, comparados = 0;
const cacheOriginal = new Map<string, { palabras: string[]; motor: string[]; nombre: string } | null>();
// El .docx propio puede ser de OTRA empresa que la del negocio activo (Comercial MP, Claro…): la
// empresa del documento es la que tiene su RUT escrito en él, no la que el negocio tiene hoy.
const [empresasBd]: any = await pool.query('SELECT id, rut, updated_at FROM empresas');
const digitos = (s: string) => (s || '').replace(/[^0-9kK]/g, '').toLowerCase();

async function bajar(url: string, nombre: string): Promise<Buffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const b = Buffer.from(await r.arrayBuffer());
  return /\.doc$/i.test(nombre) ? await convertirDocADocx(b) : b;
}

async function procesar(h: any) {
  try {
    const bufH = await bajar(h.documento_url_local, h.documento_nombre);
    const palH = palabras((await abrirDocx(bufH)).xml);
    if (palH.length < 30) { sinPar++; return; }
    const normH = new Set(palH.map(norm));

    const [originales]: any = await pool.query(
      `SELECT id, documento_nombre, documento_url_local FROM documentos_cache
        WHERE licitacion_codigo = ? AND categoria <> 'DOCUMENTOS_PROPIOS'
          AND (documento_nombre LIKE '%.docx' OR documento_nombre LIKE '%.doc')`, [h.licitacion_codigo]);

    let mejor: { id: number; nombre: string; pal: string[]; score: number; url: string } | null = null;
    for (const o of originales) {
      try {
        const buf = await bajar(o.documento_url_local, o.documento_nombre);
        const pal = palabras((await abrirDocx(buf)).xml);
        const normO = new Set(pal.map(norm));
        let c = 0; for (const t of normH) if (normO.has(t)) c++;
        const score = c / Math.max(1, normH.size);
        if (!mejor || score > mejor.score) mejor = { id: o.id, nombre: o.documento_nombre, pal, score, url: o.documento_url_local };
      } catch { /* un original ilegible no frena el resto */ }
    }
    if (!mejor || mejor.score < 0.7) { sinPar++; return; }
    if (mejor.pal.length > 9000 || palH.length > 9000) { demasiadoGrande++; return; }

    // Lo que el motor escribe sobre ese original (una vez por original).
    const textoH = digitos(palH.join(' '));
    const deDoc = empresasBd.find((e: any) => digitos(e.rut).length >= 8 && textoH.includes(digitos(e.rut)));
    const empresaId = String(deDoc?.id || h.empresa_id || 1);
    // Una ficha que cambió DESPUÉS de que el equipo llenó el documento (otro representante, otro banco)
    // haría parecer error lo que era el dato vigente de entonces: esos documentos no sirven de vara.
    if (deDoc && h.created_at && new Date(h.created_at) < new Date(deDoc.updated_at)) { anteriores++; return; }
    const claveCache = mejor.id + ':' + empresaId;
    let cache = cacheOriginal.get(claveCache);
    if (cache === undefined) {
      try {
        const { bufferOriginal, empresa } = await datos.cargarDocumentoYEmpresa(h.licitacion_codigo, String(mejor.id), empresaId);
        const [items, bases, aud, exp] = await Promise.all([
          datos.obtenerItemsCosteoParaAnexo(h.licitacion_codigo), datos.obtenerTextoBasesParaAnexo(h.licitacion_codigo),
          datos.obtenerDatosAuditorParaAnexo(h.licitacion_codigo), datos.obtenerExperienciaOcParaAnexo(Number(empresaId)),
        ]);
        const r: any = await generarAnexoFinal(bufferOriginal, empresa as any, {}, items, bases, aud, exp);
        cache = { palabras: mejor.pal, motor: palabras((await abrirDocx(r.buffer)).xml), nombre: mejor.nombre };
      } catch { cache = null; }
      cacheOriginal.set(claveCache, cache);
    }
    if (!cache) { errores++; return; }

    const insH = inserciones(cache.palabras, palH);
    const insM = inserciones(cache.palabras, cache.motor);
    if (!insH || !insM) { demasiadoGrande++; return; }
    comparados++;
    if (!insH.length) { sinInserciones++; }

    const ctx = (pos: number) => cache!.palabras.slice(Math.max(0, pos - 6), pos).join(' ');
    const usadas = new Set<Insercion>();
    for (const ih of insH) {
      const cand = cercanas(insM, ih.pos, 1);
      cand.forEach(c => usadas.add(c));
      const motor = cand.map(c => c.texto).join(' ');
      let v: Veredicto;
      if (!motor) v = 'FALTA';
      else if (norm(motor) === norm(ih.texto)) v = 'IGUAL';
      else if (solape(ih.texto, motor) >= 0.6) v = 'PARECIDO';
      else v = 'DISTINTO';
      casos.push({ licitacion: h.licitacion_codigo, documento: h.documento_nombre, original: cache.nombre, veredicto: v, etiqueta: ctx(ih.pos), humano: ih.texto, motor });
    }
    for (const im of insM) if (!usadas.has(im) && !insH.some(ih => Math.abs(ih.pos - im.pos) <= 1)) {
      sobras.push({ licitacion: h.licitacion_codigo, documento: h.documento_nombre, etiqueta: ctx(im.pos), motor: im.texto });
    }
  } catch { errores++; }
}

const cola = [...propios];
await Promise.all(Array.from({ length: 4 }, async () => { while (cola.length) await procesar(cola.shift()); }));

// ── Informe ────────────────────────────────────────────────────────────────────────────────
const cuenta = (v: Veredicto) => casos.filter(c => c.veredicto === v).length;
console.log(`\nDocumentos propios .docx revisados: ${propios.length}`);
console.log(`  comparados con su original: ${comparados} · sin original que calce: ${sinPar} · muy grandes: ${demasiadoGrande} · errores: ${errores} · anteriores al último cambio de la ficha: ${anteriores}`);
console.log(`Inserciones de la persona: ${casos.length}`);
for (const v of ['IGUAL', 'PARECIDO', 'DISTINTO', 'FALTA'] as Veredicto[]) {
  console.log(`  ${v.padEnd(9)} ${String(cuenta(v)).padStart(5)}  ${(100 * cuenta(v) / Math.max(1, casos.length)).toFixed(1)} %`);
}
console.log(`Escrito por el motor donde la persona no escribió (SOBRA): ${sobras.length}`);

function agrupar<T extends { etiqueta: string; licitacion: string }>(lista: T[]) {
  const g = new Map<string, { n: number; lic: Set<string>; ej: T }>();
  for (const x of lista) {
    const k = x.etiqueta.split(' ').slice(-4).join(' ').toLowerCase();
    const e = g.get(k) || { n: 0, lic: new Set<string>(), ej: x };
    e.n++; e.lic.add(x.licitacion); g.set(k, e);
  }
  return [...g.entries()].sort((a, b) => b[1].lic.size - a[1].lic.size || b[1].n - a[1].n);
}
const mostrar = (titulo: string, lista: Caso[], extra: (c: Caso) => string) => {
  console.log(`\n── ${titulo} (etiqueta = últimas palabras antes del hueco; licitaciones distintas) ──`);
  for (const [k, e] of agrupar(lista).slice(0, 40)) console.log(`${String(e.lic.size).padStart(3)} lic ×${String(e.n).padEnd(3)} «${k}» ${extra(e.ej as Caso)}`);
};
mostrar('FALTA: la persona escribió y el motor no', casos.filter(c => c.veredicto === 'FALTA'), c => `→ persona: «${c.humano.slice(0, 50)}»`);
mostrar('DISTINTO: escribieron cosas diferentes', casos.filter(c => c.veredicto === 'DISTINTO'), c => `→ persona: «${c.humano.slice(0, 40)}» / motor: «${c.motor.slice(0, 40)}»`);
console.log('\n── SOBRA: el motor escribió y la persona no ──');
for (const [k, e] of agrupar(sobras as any).slice(0, 15)) console.log(`${String(e.lic.size).padStart(3)} lic ×${String(e.n).padEnd(3)} «${k}» → motor: «${(e.ej as any).motor.slice(0, 50)}»`);

if (salidaJson) { writeFileSync(salidaJson, JSON.stringify({ casos, sobras }, null, 1)); console.log(`\n→ ${salidaJson}`); }
process.exit(0);
