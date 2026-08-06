import { readFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const mysql = (await import('mysql2/promise')).default;
const { abrirDocx, normalizarParaIds, unificarRunsDeMarcadores, eliminarRespaldoVmlDuplicado, listarParrafos } = await import('@/app/lib/anexos-docx');
const { analizarAnexo, extraerTablasCrudo } = await import('@/app/lib/anexos-detectar');

const pool = mysql.createPool({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 20000,
});

const [[doc]]: any = await pool.query(`SELECT documento_url_local, documento_nombre FROM documentos_cache WHERE id = 18533`);
const res = await fetch(doc.documento_url_local);
const buffer = Buffer.from(await res.arrayBuffer());

const { zip, xml: xmlCrudoSinNormalizar } = await abrirDocx(buffer);
const xmlCrudo = eliminarRespaldoVmlDuplicado(xmlCrudoSinNormalizar);
const { xml: xmlConIds } = normalizarParaIds(xmlCrudo);
const xmlNormalizado = unificarRunsDeMarcadores(xmlConIds);

const analisis = analizarAnexo(xmlNormalizado, {});
console.log('candidatosCelda:', analisis.candidatosCelda.length);
for (const c of analisis.candidatosCelda) console.log(`  - [${c.indice}] "${c.etiqueta}" soloManual=${!!c.soloManual} dosPuntos=${!!c.dosPuntos} campoFijo=${c.campoFijo || ''}`);
console.log('camposConDosPuntos:', analisis.camposConDosPuntos.length);
for (const c of analisis.camposConDosPuntos) console.log(`  - [${c.indice}] "${c.etiqueta}"`);
console.log('blancosInline:', analisis.blancosInline.length);
for (const b of analisis.blancosInline) console.log(`  - contexto="${b.contexto}"`);
console.log('indicesSoloManual:', [...(analisis.indicesSoloManual || [])]);

const tablasCrudo = extraerTablasCrudo(xmlNormalizado);
console.log('\ntablasCrudo:', tablasCrudo.length);
for (const t of tablasCrudo) {
  console.log(` tabla indicePrimero=${t.indicePrimero} filas=${t.filas.length}`);
  for (const f of t.filas) {
    console.log('  fila:', f.celdas.map(c => `[idx=${c.indiceGlobal ?? '-'} texto="${c.texto}"]`).join(' '));
  }
}

await pool.end();

console.log('\n--- listarParrafos alrededor de la tabla (idx 0-30) ---');
const parrafos = listarParrafos(xmlNormalizado);
for (let i = 0; i <= 30 && i < parrafos.length; i++) {
  const p = parrafos[i];
  console.log(`  [${i}] vacio=${p.vacio} centrado=${p.centrado} texto="${(p.texto||'').slice(0,70)}"`);
}
