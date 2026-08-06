import { readFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const mysql = (await import('mysql2/promise')).default;
const { abrirDocx, normalizarParaIds, unificarRunsDeMarcadores, eliminarRespaldoVmlDuplicado, listarParrafos } = await import('@/app/lib/anexos-docx');
const { analizarAnexo, detectarSecciones } = await import('@/app/lib/anexos-detectar');

const pool = mysql.createPool({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 20000,
});

const codigo = '4777-24-LE26';
const [docs]: any = await pool.query(
  `SELECT id, documento_nombre, documento_url_local FROM documentos_cache WHERE licitacion_codigo=? AND documento_nombre LIKE '%1%A%'`,
  [codigo],
);
console.log('Documentos candidatos:', docs.map((d: any) => ({ id: d.id, nombre: d.documento_nombre })));

const doc = docs.find((d: any) => /1.?A/i.test(d.documento_nombre)) || docs[0];
if (!doc) { console.log('No se encontró el documento'); process.exit(1); }
console.log('\nUsando:', doc.documento_nombre, doc.id);

const res = await fetch(doc.documento_url_local);
const buffer = Buffer.from(await res.arrayBuffer());

const { xml: xmlCrudoSinNormalizar } = await abrirDocx(buffer);
const xmlCrudo = eliminarRespaldoVmlDuplicado(xmlCrudoSinNormalizar);
const { xml: xmlConIds } = normalizarParaIds(xmlCrudo);
const xmlNormalizado = unificarRunsDeMarcadores(xmlConIds);

const parrafos = listarParrafos(xmlNormalizado);
console.log('\n--- Primeros 25 párrafos ---');
for (let i = 0; i < Math.min(25, parrafos.length); i++) {
  console.log(` [${i}] vacio=${parrafos[i].vacio} texto="${parrafos[i].texto}"`);
}

const secciones = detectarSecciones(parrafos);
console.log('\nSECCIONES:', JSON.stringify(secciones, null, 2));

const analisis = analizarAnexo(xmlNormalizado);
console.log('\ncandidatosCelda:');
for (const c of analisis.candidatosCelda) console.log(` [${c.indice}] "${c.etiqueta}" soloManual=${!!c.soloManual}`);
console.log('\nindicesSoloManual:', [...analisis.indicesSoloManual]);
console.log('\nblancosInline:', analisis.blancosInline.length);
for (const b of analisis.blancosInline) console.log(` contexto="${b.contexto}" parrafoCompleto="${b.parrafoCompleto}"`);

await pool.end();
