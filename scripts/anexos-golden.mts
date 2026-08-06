// Golden set del Anexo Creator — compara lo que ESCRIBE EL SISTEMA contra lo que ESCRIBIÓ UN
// HUMANO en anexos de licitaciones que la empresa ya postuló de verdad.
//
//   npx tsx scripts/anexos-golden.mts                 → resumen + detalle de fallas
//   npx tsx scripts/anexos-golden.mts --todo          → además lista los aciertos
//   npx tsx scripts/anexos-golden.mts --codigo 1493-28-LE26
//
// Cómo funciona: el anexo ORIGINAL (vacío, el que descargamos de Mercado Público y guardamos en
// documentos_cache) y el anexo LLENO A MANO tienen la MISMA estructura de párrafos — el humano
// solo escribió dentro de las celdas, no agregó ni quitó nada. Así que el texto que hoy está en el
// párrafo N del documento lleno ES la respuesta correcta para el blanco que el detector encuentra
// en el párrafo N del original. Eso da una verdad de referencia por casilla, sin que nadie tenga
// que etiquetar nada a mano.
//
// Veredictos por casilla:
//   OK       el sistema escribió lo mismo que el humano
//   DISTINTO ambos escribieron, pero cosas distintas  → error de PRECISIÓN (lo grave)
//   FALTA    el humano escribió y el sistema dejó en blanco → error de COBERTURA
//   DEMÁS    el sistema escribió y el humano lo dejó en blanco → posible dato de más
//   -        ninguno de los dos escribió (casilla que no aplicaba)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const mysql = (await import('mysql2/promise')).default;
const { analizarAnexo } = await import('@/app/lib/anexos-detectar');
const { normalizarParaIds, abrirDocx, listarParrafos } = await import('@/app/lib/anexos-docx');
const { analizarAnexoParaUI } = await import('@/app/lib/anexos-rellenar');
const { convertirDocADocx } = await import('@/app/lib/anexos-doc-legacy');
const { conCamposDerivados } = await import('@/app/lib/anexos-derivados');

const RAIZ = process.env.GOLDEN_ANEXOS
  || 'C:/Users/droku/Downloads/anexos-20260803T163934Z-1-001/anexos';

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const soloCodigo = arg('codigo');
const verTodo = process.argv.includes('--todo');

const pool = mysql.createPool({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 20000,
});

// Los .doc legado hay que convertirlos igual que en producción, y los .pdf no se pueden comparar
// celda por celda (no tienen estructura de párrafos de Word) — se saltan.
async function cargar(buffer: Buffer, nombre: string): Promise<Buffer> {
  return /\.doc$/i.test(nombre) ? Buffer.from(await convertirDocADocx(buffer)) : buffer;
}

// Compara ignorando mayúsculas, tildes, puntuación y espacios: el humano escribe "76.902.659-2"
// y nosotros también, pero un "Región del Bío Bío" vs "REGION DEL BIO BIO" es el MISMO acierto.
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^\w@]+/g, '').trim();

interface Fila { empresa: string; codigo: string; archivo: string; ruta: string }
const golden: Fila[] = [];
for (const emp of readdirSync(RAIZ)) {
  const pe = join(RAIZ, emp);
  if (!statSync(pe).isDirectory()) continue;
  for (const cod of readdirSync(pe)) {
    const pc = join(pe, cod);
    if (!statSync(pc).isDirectory()) continue;
    for (const f of readdirSync(pc)) {
      if (!/\.docx?$/i.test(f)) continue;
      golden.push({ empresa: emp, codigo: cod, archivo: f, ruta: join(pc, f) });
    }
  }
}

const empresasCache = new Map<number, any>();
async function empresaDe(id: number) {
  if (empresasCache.has(id)) return empresasCache.get(id);
  const [rows]: any = await pool.query(
    `SELECT razon_social, rut, direccion, region, giro, tipo_persona_juridica, fecha_sociedad,
            fecha_escritura, notaria, numero_repertorio, fojas_numero_anio,
            representante_nombre, representante_rut, representante_cargo,
            email1, telefono1, banco_tipo_cuenta, banco_numero, banco_nombre, banco_email, firma_url, timbre_url
       FROM empresas WHERE id = ?`, [id]);
  const e = conCamposDerivados(rows[0]);
  empresasCache.set(id, e);
  return e;
}

const total = { ok: 0, distinto: 0, falta: 0, faltaFicha: 0, faltaOferta: 0, demas: 0, vacias: 0 };
const fallas: string[] = [];

for (const g of golden) {
  if (soloCodigo && g.codigo !== soloCodigo) continue;

  // El original que corresponde: mismo código y nombre de archivo que TERMINA igual (los llenos a
  // veces traen un prefijo de timestamp del portal, ej. "1783908486429_FORMATOS.docx").
  const [docs]: any = await pool.query(
    `SELECT id, documento_nombre, documento_url_local FROM documentos_cache
      WHERE licitacion_codigo = ? AND (categoria IS NULL OR categoria <> 'DOCUMENTOS_PROPIOS')`, [g.codigo]);
  const base = g.archivo.replace(/^\d{10,}_/, '');
  const doc = (docs as any[]).find(d => d.documento_nombre === base)
    || (docs as any[]).find(d => norm(d.documento_nombre) === norm(base));
  if (!doc) { console.log(`· ${g.codigo}/${g.archivo} — sin original en BD, se salta`); continue; }

  const [negs]: any = await pool.query(
    `SELECT empresa_id FROM negocios WHERE licitacion_codigo = ? AND activo = TRUE AND empresa_id IS NOT NULL LIMIT 1`, [g.codigo]);
  const empresaId = negs[0]?.empresa_id;
  if (!empresaId) { console.log(`· ${g.codigo} — sin empresa asignada, se salta`); continue; }
  const empresa = await empresaDe(empresaId);

  try {
    const res = await fetch(doc.documento_url_local);
    if (!res.ok) throw new Error(`original HTTP ${res.status}`);
    const bufOriginal = await cargar(Buffer.from(await res.arrayBuffer()), doc.documento_nombre);
    const bufLleno = await cargar(readFileSync(g.ruta), g.archivo);

    const { xml } = normalizarParaIds((await abrirDocx(bufOriginal)).xml);
    const analisis = analizarAnexo(xml);
    const parrafosLlenos = listarParrafos(normalizarParaIds((await abrirDocx(bufLleno)).xml).xml);

    // Alinear por CONTENIDO, no por índice. Al escribir en el Word, el humano casi siempre termina
    // agregando o partiendo párrafos (Word lo hace solo al tabular entre celdas), así que comparar
    // "párrafo N contra párrafo N" descartaba 18 de 24 archivos por falsa "estructura distinta".
    // Recorrido codicioso: cuando los dos textos calzan, avanzan ambos; cuando el original está
    // VACÍO (es justo un blanco a rellenar), lo que haya enfrente en el lleno es la respuesta del
    // humano; y si el lleno insertó algo, se busca el texto del original un poco más adelante.
    const alinear = (orig: any[], lleno: any[]): Map<number, number> => {
      const mapa = new Map<number, number>();
      let i = 0, j = 0;
      while (i < orig.length && j < lleno.length) {
        const a = norm(orig[i].texto || ''), b = norm(lleno[j].texto || '');
        if (a === b || !a) { mapa.set(i, j); i++; j++; continue; }
        let k = -1;
        for (let t = j + 1; t < Math.min(j + 15, lleno.length); t++) {
          if (norm(lleno[t].texto || '') === a) { k = t; break; }
        }
        if (k >= 0) { mapa.set(i, k); i++; j = k + 1; } else { i++; }
      }
      return mapa;
    };
    const mapaAlineado = alinear(analisis.parrafos, parrafosLlenos);

    // Calidad de la alineación: qué porcentaje de los párrafos CON TEXTO del original se
    // reencontró en el lleno. Bajo 60% los dos documentos no son la misma plantilla y comparar
    // sería inventar errores.
    const conTexto = analisis.parrafos.filter((p: any) => (p.texto || '').trim());
    const anclados = conTexto.filter((p: any) => {
      const j2 = mapaAlineado.get(p.indice);
      return j2 != null && norm(parrafosLlenos[j2]?.texto || '') === norm(p.texto);
    }).length;
    const calidad = conTexto.length ? anclados / conTexto.length : 0;
    if (calidad < 0.6) {
      console.log(`· ${g.codigo}/${g.archivo} — no calza con el original (solo ${Math.round(calidad * 100)}% de los párrafos coincide), se salta`);
      continue;
    }

    const analizado = await analizarAnexoParaUI(bufOriginal, empresa);
    const nuestro = new Map<number, { campo: string; valor: string }>(
      analizado.completadosAuto.filter(m => m.indice != null).map(m => [m.indice!, { campo: m.campo, valor: m.valor }]));

    const local = { ok: 0, distinto: 0, falta: 0, faltaFicha: 0, faltaOferta: 0, demas: 0, vacias: 0 };
    const detalle: string[] = [];
    for (const c of analisis.candidatosCelda) {
      const jLleno = mapaAlineado.get(c.indice);
      const humano = (jLleno != null ? parrafosLlenos[jLleno]?.texto || '' : '').trim();
      const mio = nuestro.get(c.indice);
      if (!humano && !mio) { local.vacias++; continue; }
      if (humano && !mio) {
        // Distinguir los dos tipos de "no lo llenamos", que exigen soluciones OPUESTAS:
        //  · FICHA  → el humano escribió un dato que SÍ tenemos guardado. Es una falla nuestra
        //             de detección/mapeo, y se arregla con diccionario o prompt.
        //  · OFERTA → el humano escribió contenido de la propuesta (descripción del producto,
        //             precio, plazo, garantía, una X en un checkbox). No sale de la ficha de la
        //             empresa: ninguna mejora del prompt de identificación lo va a resolver.
        const deFicha = Object.values(empresa).some((v: any) => v && norm(String(v)) === norm(humano));
        if (deFicha) { local.faltaFicha++; detalle.push(`   FALTA-FICHA  "${c.etiqueta.slice(0, 52)}"  → el humano puso: "${humano.slice(0, 45)}"`); }
        else { local.faltaOferta++; }
        local.falta++;
      } else if (!humano && mio) {
        local.demas++;
        detalle.push(`   DEMÁS    "${c.etiqueta.slice(0, 55)}"  → pusimos: "${mio.valor.slice(0, 45)}" (${mio.campo})`);
      } else if (norm(humano) === norm(mio!.valor)) {
        local.ok++;
        if (verTodo) detalle.push(`   OK       "${c.etiqueta.slice(0, 55)}"  = "${humano.slice(0, 45)}"`);
      } else {
        local.distinto++;
        detalle.push(`   DISTINTO "${c.etiqueta.slice(0, 55)}"\n              humano:  "${humano.slice(0, 60)}"\n              sistema: "${mio!.valor.slice(0, 60)}" (${mio!.campo})`);
      }
    }

    total.ok += local.ok; total.distinto += local.distinto;
    total.falta += local.falta; total.demas += local.demas; total.vacias += local.vacias;
    total.faltaFicha += local.faltaFicha; total.faltaOferta += local.faltaOferta;

    console.log(`\n${'='.repeat(78)}\n[${g.codigo}] ${g.archivo}  (${g.empresa})`);
    console.log(`  OK=${local.ok}  DISTINTO=${local.distinto}  FALTA=${local.falta} (ficha ${local.faltaFicha} / oferta ${local.faltaOferta})  DEMÁS=${local.demas}`);
    detalle.forEach(d => console.log(d));
    if (local.distinto || local.falta) fallas.push(`${g.codigo}/${g.archivo}`);
  } catch (e: any) {
    console.log(`· ${g.codigo}/${g.archivo} — ERROR: ${e?.message || e}`);
  }
}

const conDato = total.ok + total.distinto + total.falta;
console.log(`\n${'#'.repeat(78)}`);
console.log(`GOLDEN SET — casillas que el humano SÍ llenó: ${conDato}`);
console.log(`  Acertadas (OK):        ${total.ok}   → cobertura ${conDato ? Math.round(100 * total.ok / conDato) : 0}%`);
console.log(`  Escritas distinto:     ${total.distinto}`);
console.log(`  Que no llenamos:       ${total.falta}`);
console.log(`     · dato de la FICHA (falla nuestra):     ${total.faltaFicha}`);
console.log(`     · contenido de la OFERTA (no está en la ficha): ${total.faltaOferta}`);
console.log(`  Escritas de más:       ${total.demas}   (el humano las dejó en blanco)`);
console.log(`${'#'.repeat(78)}`);

await pool.end();
