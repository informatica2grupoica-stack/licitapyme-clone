// AUDITOR DE LA GENERACIÓN DE ANEXOS — corre el pipeline COMPLETO (leer → dividir → detectar →
// resolver → ESCRIBIR el .docx) sobre todos los anexos Word reales de la base, y reporta dónde se
// rompe. Es el complemento de scripts/doctor-anexos.mts: ese solo ANALIZA (¿entendí el documento?);
// este además GENERA (¿el archivo que se subiría sale sano?).
//
// POR QUÉ EXISTE (28-ago-2026): la etapa de escritura tiene fallos que el análisis no puede ver —
// un párrafo que se pierde (verificarParrafos), un fragmento con XML mal formado que Word se niega
// a abrir, una casilla que no se pudo escribir y se degrada a un aviso, un documento que ni
// siquiera se puede LEER porque el conversor de .doc no respondió. Todos esos caminos ya están
// cubiertos en el código con avisos y guardarraíles, pero nadie los estaba MIDIENDO sobre el
// universo real de documentos: solo se veían de a uno, cuando un humano abría el archivo.
//
//   npx tsx scripts/auditor-anexos-generacion.mts                → abiertas, hasta 200 documentos
//   npx tsx scripts/auditor-anexos-generacion.mts --todas        → también las cerradas
//   npx tsx scripts/auditor-anexos-generacion.mts --limite 800
//   npx tsx scripts/auditor-anexos-generacion.mts --paralelo 8
//   npx tsx scripts/auditor-anexos-generacion.mts --json salida.json
//   npx tsx scripts/auditor-anexos-generacion.mts --solo-lectura → no genera, solo mide la lectura
//
// Deliberadamente NO usa ninguna capa de red opcional (costeo, bases, órdenes de compra, OCR de
// imágenes): esas dependen del proveedor de IA y de qué licitación sea, así que meterían ruido y
// costo en una medición que busca aislar el motor. Lo que mide es lo que el motor hace SOLO.
import { readFileSync, writeFileSync } from 'node:fs';

for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}

const mysql = (await import('mysql2/promise')).default;
const { abrirDocx, normalizarParaIds, verificarXmlBienFormado } = await import('@/app/lib/anexos-docx');
const { dividirPorFormularios } = await import('@/app/lib/anexos-dividir');
const { analizarAnexoParaUI, generarAnexoFinal } = await import('@/app/lib/anexos-rellenar');
const { conCamposDerivados } = await import('@/app/lib/anexos-derivados');
const { analizarAnexo } = await import('@/app/lib/anexos-detectar');
const { resolverDeterminista, clasificarPendiente } = await import('@/app/lib/anexos-determinista');
const { unificarRunsDeMarcadores } = await import('@/app/lib/anexos-docx');
const { convertirDocADocx } = await import('@/app/lib/anexos-doc-legacy');

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const todas = process.argv.includes('--todas');
const soloLectura = process.argv.includes('--solo-lectura');
// Solo mide la CLASIFICACIÓN de cada anexo separado (administrativo/técnico/económico) — sin
// analizar ni generar, así que corre en un par de minutos sobre toda la base. Es la medición de
// `clasificarAnexo` (anexos-dividir.ts), que decide en qué caja de "Documentos y Bases" cae cada
// archivo al usar "Separar anexos".
const soloClasificacion = process.argv.includes('--clasificacion');
// Solo arma la lista de trabajo del diccionario administrativo (qué etiquetas quedan sin resolver
// y en cuántas licitaciones distintas aparecen), sin analizar ni generar — mismo costo que
// --clasificacion.
const soloDiccionario = process.argv.includes('--diccionario');
const limite = Number(arg('limite')) || 200;
const paralelo = Math.max(1, Number(arg('paralelo')) || 6);
const salidaJson = arg('json');

const pool = mysql.createPool({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 20000,
  connectionLimit: Math.max(4, paralelo),
});

const [empresas]: any = await pool.query('SELECT * FROM empresas ORDER BY id');
const porId = new Map<number, any>(empresas.map((e: any) => [e.id, conCamposDerivados(e)]));
const porDefecto = porId.get(empresas[0]?.id);

const [docs]: any = await pool.query(
  `SELECT d.id, d.licitacion_codigo, d.documento_nombre, d.documento_url_local,
          (SELECT n.empresa_id FROM negocios n WHERE n.licitacion_codigo = d.licitacion_codigo AND n.activo = TRUE LIMIT 1) AS empresa_id,
          (SELECT MAX(a.licitacion_cierre) FROM alertas_licitaciones a
            WHERE a.licitacion_codigo = CONVERT(d.licitacion_codigo USING utf8) COLLATE utf8_unicode_ci) AS cierre
     FROM documentos_cache d
    WHERE (d.documento_nombre LIKE '%.docx' OR d.documento_nombre LIKE '%.doc')
      AND d.categoria <> 'DOCUMENTOS_PROPIOS'
    ORDER BY d.id DESC LIMIT ?`, [limite]);

/** Una etapa del pipeline: si falla, se sabe EXACTAMENTE cuál y con qué mensaje. */
type Etapa = 'descarga' | 'conversion_doc' | 'apertura' | 'division' | 'analisis' | 'generacion' | 'integridad' | 'xml_fragmento';

interface Hallazgo {
  severidad: 'roto' | 'ciego' | 'revisar' | 'aviso';
  etapa: Etapa | null;
  codigo: string; documento: string; cierre: string | null;
  motivo: string;
  detectadas?: number; resueltas?: number;
  formularios?: number; avisos?: string[];
  /** El .docx de ENTRADA ya venía con XML inválido — el fallo no es nuestro. */
  entradaInvalida?: boolean;
  ms?: number;
}

// Categorías que NO son un fallo del diccionario administrativo: un precio, un plazo, una firma de
// un tercero o una decisión del oferente que quedan en blanco es lo CORRECTO — esos datos no salen
// de la ficha de la empresa. Lo que queda después de sacarlas es el cajón de "no reconocí esta
// etiqueta", que es justamente la lista de trabajo.
//
// Ojo con el nombre de ese cajón: `clasificarPendiente` (anexos-determinista.ts) lo rotula
// `no_aplica_al_oferente` — "la etiqueta no corresponde a ningún dato de la ficha". Eso es cierto
// para un encabezado, pero es engañoso para una etiqueta que SÍ pide la razón social escrita de
// una forma que el diccionario todavía no conoce: las dos caen en el mismo cajón. Por eso la
// lista hay que LEERLA, no contarla: acá aparecen mezcladas, y el ranking por número de
// licitaciones es lo que separa el título suelto de la etiqueta que se repite en todo el país.
const CATEGORIAS_FUERA_DE_ALCANCE = new Set([
  'especifico_licitacion', 'decision_del_usuario', 'declaracion_tercero', 'firma_timbre', 'firma_fecha',
]);

const etiquetasSinResolver = new Map<string, { n: number; muestra: string; categoria: string; docs: Set<string> }>();
const faltantesFicha = new Map<string, { n: number; docs: Set<string> }>();
const clasificaciones = new Map<string, number>();
const sinClasificar: { codigo: string; titulo: string }[] = [];
const hallazgos: Hallazgo[] = [];
const ahora = Date.now();
let revisados = 0, saltados = 0, sanos = 0;

const pendientes = docs.filter((d: any) => todas || (d.cierre && new Date(d.cierre).getTime() > ahora));
saltados = docs.length - pendientes.length;

async function auditar(d: any): Promise<void> {
  const base = { codigo: d.licitacion_codigo, documento: d.documento_nombre, cierre: d.cierre };
  const empresa = porId.get(d.empresa_id) ?? porDefecto;
  const t0 = Date.now();
  const roto = (etapa: Etapa, motivo: string): void => {
    hallazgos.push({ ...base, severidad: 'roto', etapa, motivo: motivo.slice(0, 220), ms: Date.now() - t0 });
  };

  // 1) Descarga
  let bruto: Buffer;
  try {
    const res = await fetch(d.documento_url_local);
    if (!res.ok) return roto('descarga', `HTTP ${res.status} al bajar el documento`);
    bruto = Buffer.from(await res.arrayBuffer());
  } catch (e: any) { return roto('descarga', String(e?.message || e)); }

  // 2) .doc legado → .docx (microservicio LibreOffice)
  let buf = bruto;
  if (/\.doc$/i.test(d.documento_nombre)) {
    try { buf = Buffer.from(await convertirDocADocx(bruto)); }
    catch (e: any) { return roto('conversion_doc', String(e?.message || e)); }
  }

  // 3) Apertura + validez del XML DE ENTRADA (para no atribuirnos un archivo que ya venía roto)
  let entradaInvalida = false;
  let xmlNormalizado: string;
  try {
    const { xml: crudo } = await abrirDocx(buf);
    entradaInvalida = !verificarXmlBienFormado(crudo).valido;
    xmlNormalizado = normalizarParaIds(crudo).xml;
  } catch (e: any) { return roto('apertura', String(e?.message || e)); }

  // 4) División en formularios (el paso de "Separar anexos")
  let partes: { nombreArchivo: string; buffer: Buffer }[];
  try {
    const fs = await dividirPorFormularios(buf, xmlNormalizado);
    partes = fs.length >= 2 ? fs : [{ nombreArchivo: d.documento_nombre, buffer: buf }];
  } catch (e: any) { return roto('division', String(e?.message || e)); }

  for (const parte of partes) {
    const ref = { ...base, documento: String(parte.nombreArchivo).slice(0, 90), formularios: partes.length, entradaInvalida };
    revisados++;

    // Clasificación (solo tiene sentido cuando el documento SÍ se dividió: un archivo que ya venía
    // suelto conserva la categoría que le puso Mercado Público, no pasa por clasificarAnexo).
    const cat = (parte as any).categoria as string | undefined;
    if (cat) {
      clasificaciones.set(cat, (clasificaciones.get(cat) || 0) + 1);
      if (cat === 'sin_clasificar') sinClasificar.push({ codigo: d.licitacion_codigo, titulo: String((parte as any).titulo || parte.nombreArchivo).slice(0, 80) });
    }
    if (soloClasificacion) continue;

    // Las etiquetas EN ALCANCE que quedaron sin resolver: es la lista de trabajo real del
    // diccionario administrativo. Un contador de "quedaron 12 de 16" no dice QUÉ arreglar; el
    // ranking de etiquetas repetidas entre organismos sí — arreglar la que aparece en 40
    // licitaciones vale por 40 licitaciones.
    //
    // Se pregunta al MOTOR directamente (analizarAnexo + resolverDeterminista), no a la salida de
    // pantalla: `analisis.pendientesCelda` viene filtrado para no repetir lo que ya se dibuja
    // dentro de una tabla, y las tablas son justamente donde vive el grueso de la identificación
    // del oferente (razón social, RUT, domicilio, representante). Mirando la pantalla, la lista
    // salía vacía y parecía que no faltaba nada.
    try {
      const det = analizarAnexo(unificarRunsDeMarcadores(normalizarParaIds(( await abrirDocx(parte.buffer)).xml).xml));
      const res = resolverDeterminista({
        candidatos: det.candidatosCelda, blancosInline: det.blancosInline,
        parrafos: det.parrafos, empresa,
      });
      // Campos de la FICHA que este anexo pide y están vacíos: es la otra mitad del problema, y
      // la que no se arregla tocando código — se arregla completando la ficha una vez.
      for (const f of (res as any).faltantesFicha || []) {
        const prev = faltantesFicha.get(f.nombre);
        if (prev) { prev.n++; prev.docs.add(d.licitacion_codigo); }
        else faltantesFicha.set(f.nombre, { n: 1, docs: new Set([d.licitacion_codigo]) });
      }
      const sinResolver: string[] = [
        ...res.celdaSinResolver.map((c: any) => c.etiqueta),
        ...res.inlineSinResolver.map((b: any) => b.textoMarcador || b.contexto || ''),
      ];
      for (const texto of sinResolver) {
        const limpio = (texto || '').trim();
        if (!limpio) continue;
        const { categoria } = clasificarPendiente(limpio);
        if (CATEGORIAS_FUERA_DE_ALCANCE.has(categoria)) continue;
        const clave = limpio.toLowerCase().replace(/\s+/g, ' ').slice(0, 70);
        const previo = etiquetasSinResolver.get(clave);
        if (previo) { previo.n++; previo.docs.add(d.licitacion_codigo); }
        else etiquetasSinResolver.set(clave, { n: 1, muestra: limpio.slice(0, 70), categoria, docs: new Set([d.licitacion_codigo]) });
      }
    } catch { /* la lista de trabajo es un extra: nunca invalida la auditoría del documento */ }
    if (soloDiccionario) continue;

    // 5) Análisis (lo mismo que ve la pantalla)
    let analisis: any;
    try { analisis = await analizarAnexoParaUI(parte.buffer, empresa); }
    catch (e: any) { hallazgos.push({ ...ref, severidad: 'roto', etapa: 'analisis', motivo: String(e?.message || e).slice(0, 220) }); continue; }


    const c = analisis.cobertura;
    if (c.severidad !== 'ok') {
      hallazgos.push({
        ...ref, severidad: c.severidad === 'ciego' ? 'ciego' : 'revisar', etapa: 'analisis',
        motivo: c.motivo, detectadas: c.casillasDetectadas, resueltas: c.casillasResueltas,
      });
    }

    if (soloLectura) { sanos++; continue; }

    // 6) GENERACIÓN REAL — el archivo que de verdad se subiría, con las respuestas humanas vacías.
    let gen: any;
    try { gen = await generarAnexoFinal(parte.buffer, empresa, {}); }
    catch (e: any) { hallazgos.push({ ...ref, severidad: 'roto', etapa: 'generacion', motivo: String(e?.message || e).slice(0, 220) }); continue; }

    // 7) Integridad: mismo guardarraíl que bloquea la subida en /api/anexos/generar
    if (!gen.integridad.parrafosIguales) {
      hallazgos.push({
        ...ref, severidad: 'roto', etapa: 'integridad',
        motivo: `Se perdieron/agregaron párrafos al escribir: ${gen.integridad.parrafosAntes} → ${gen.integridad.parrafosDespues}. En producción esto BLOQUEA la subida.`,
      });
      continue;
    }

    // 8) XML bien formado de cada fragmento final (Word se niega a abrir uno corrupto)
    let fragmentoRoto = false;
    try {
      const { xml: xmlFinal } = await abrirDocx(gen.buffer);
      const finales = await dividirPorFormularios(gen.buffer, xmlFinal);
      const candidatos = finales.length >= 2 ? finales.map(f => f.buffer) : [gen.buffer];
      for (const b of candidatos) {
        const chequeo = verificarXmlBienFormado((await abrirDocx(b)).xml);
        if (!chequeo.valido) {
          fragmentoRoto = true;
          hallazgos.push({
            ...ref, severidad: 'roto', etapa: 'xml_fragmento',
            motivo: `${entradaInvalida ? 'La ENTRADA ya venía inválida — ' : ''}fragmento generado mal formado: ${chequeo.error}`,
          });
          break;
        }
      }
    } catch (e: any) {
      fragmentoRoto = true;
      hallazgos.push({ ...ref, severidad: 'roto', etapa: 'xml_fragmento', motivo: String(e?.message || e).slice(0, 220) });
    }
    if (fragmentoRoto) continue;

    // 9) Avisos: casillas que el motor decidió NO escribir (duplicado, error de escritura, firma
    //    ambigua, firma/timbre que no se pudo descargar). No rompen el archivo, pero son trabajo
    //    manual silencioso — se cuentan para saber cuánto hay realmente.
    if (gen.avisos?.length) {
      hallazgos.push({ ...ref, severidad: 'aviso', etapa: 'generacion', motivo: gen.avisos[0], avisos: gen.avisos });
    } else if (c.severidad === 'ok') sanos++;
  }
}

// Concurrencia acotada: el cuello de botella es la descarga desde R2, no la CPU.
let cursor = 0;
let hechos = 0;
await Promise.all(Array.from({ length: paralelo }, async () => {
  for (;;) {
    const i = cursor++;
    if (i >= pendientes.length) return;
    await auditar(pendientes[i]).catch(e => {
      hallazgos.push({ severidad: 'roto', etapa: null, codigo: pendientes[i].licitacion_codigo, documento: pendientes[i].documento_nombre, cierre: pendientes[i].cierre, motivo: `Error no controlado: ${String(e?.message || e).slice(0, 180)}` });
    });
    hechos++;
    if (hechos % 10 === 0) process.stderr.write(`  … ${hechos}/${pendientes.length} documentos\n`);
  }
}));

if (faltantesFicha.size) {
  console.log(`
─── Datos de la FICHA DE EMPRESA que los anexos piden y están vacíos ───`);
  console.log('    (esto no se arregla con código: se completa una vez en /empresas)');
  for (const [nombre, r] of [...faltantesFicha.entries()].sort((a, b) => b[1].docs.size - a[1].docs.size)) {
    console.log(`  ${String(r.docs.size).padStart(3)} licitación(es) · ${String(r.n).padStart(4)} casilla(s) · ${nombre}`);
  }
}

if (clasificaciones.size) {
  const total = [...clasificaciones.values()].reduce((a, b) => a + b, 0);
  console.log(`\n─── Clasificación de los anexos separados (clasificarAnexo, anexos-dividir.ts) ───`);
  for (const [c, n] of [...clasificaciones.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)} (${String(Math.round(n * 100 / total)).padStart(2)}%) ${c}`);
  }
  if (sinClasificar.length) {
    console.log(`  Sin clasificar — primeros 30 títulos (caen en la caja genérica "Anexos Oferente"):`);
    for (const s2 of sinClasificar.slice(0, 30)) console.log(`     ${s2.codigo} · ${s2.titulo}`);
  }
}

const peso: Record<string, number> = { roto: 0, ciego: 1, revisar: 2, aviso: 3 };
hallazgos.sort((a, b) => (peso[a.severidad] - peso[b.severidad])
  || (new Date(a.cierre || 0).getTime() - new Date(b.cierre || 0).getTime()));

console.log(`\n${revisados} anexo(s) generados · ${pendientes.length} documento(s) de origen · ${saltados} de licitaciones cerradas omitidos${todas ? ' (ninguno: --todas)' : ''}\n`);

const marca: Record<string, string> = { roto: '💥 ROTO   ', ciego: '🔴 CIEGO  ', revisar: '🟡 REVISAR', aviso: '📝 AVISO  ' };
for (const h of hallazgos) {
  const cierra = h.cierre ? ` · cierra ${String(new Date(h.cierre).toISOString()).slice(0, 10)}` : '';
  const etapa = h.etapa ? ` [${h.etapa}]` : '';
  console.log(`${marca[h.severidad]} ${h.codigo}${cierra}${etapa}\n           ${String(h.documento).slice(0, 70)}\n           ${h.motivo}\n`);
}

const cuenta = (s: string) => hallazgos.filter(h => h.severidad === s).length;
console.log(`=== ${cuenta('roto')} roto(s) · ${cuenta('ciego')} ciego(s) · ${cuenta('revisar')} a revisar · ${cuenta('aviso')} con avisos · ${sanos} sano(s)`);

// Los ROTOS agrupados por etapa: dice de una si el problema es de LECTURA (descarga/conversión)
// o de ESCRITURA (integridad/XML) — dos trabajos distintos.
const porEtapa = new Map<string, number>();
for (const h of hallazgos.filter(x => x.severidad === 'roto')) porEtapa.set(h.etapa || '?', (porEtapa.get(h.etapa || '?') || 0) + 1);
if (porEtapa.size) console.log('Rotos por etapa:', [...porEtapa.entries()].map(([e, n]) => `${e}=${n}`).join(' · '));

// ── La lista de trabajo del diccionario ──────────────────────────────────────────────────────
// Ordenada por en cuántas LICITACIONES DISTINTAS aparece, no por total de apariciones: una
// etiqueta que sale 30 veces en un solo documento es un caso puntual; una que sale en 12
// licitaciones de organismos distintos es un formato de país y arreglarla las cubre todas.
const ranking = [...etiquetasSinResolver.values()]
  .sort((a, b) => (b.docs.size - a.docs.size) || (b.n - a.n))
  .slice(0, 40);
if (ranking.length) {
  console.log('\n─── Etiquetas EN ALCANCE que quedaron sin resolver (lista de trabajo del diccionario) ───');
  for (const r of ranking) {
    console.log(`  ${String(r.docs.size).padStart(3)} licitación(es) · ${String(r.n).padStart(4)} vez/veces · [${r.categoria}] "${r.muestra}"`);
  }
}

if (salidaJson) {
  writeFileSync(salidaJson, JSON.stringify({
    hallazgos,
    etiquetasSinResolver: [...etiquetasSinResolver.values()]
      .map(r => ({ ...r, docs: [...r.docs] }))
      .sort((a, b) => b.docs.length - a.docs.length),
  }, null, 2));
  console.log(`\n→ ${salidaJson}`);
}
await pool.end();
