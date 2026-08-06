import { readFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const mysql = (await import('mysql2/promise')).default;
const { abrirDocx, normalizarParaIds, unificarRunsDeMarcadores, eliminarRespaldoVmlDuplicado, listarParrafos } = await import('@/app/lib/anexos-docx');
const { analizarAnexo } = await import('@/app/lib/anexos-detectar');

const pool = mysql.createPool({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 20000,
});

const [[doc]]: any = await pool.query(`SELECT documento_url_local, documento_nombre FROM documentos_cache WHERE id = 18530`);
const res = await fetch(doc.documento_url_local);
const buffer = Buffer.from(await res.arrayBuffer());

const { xml: xmlCrudoSinNormalizar } = await abrirDocx(buffer);
const xmlCrudo = eliminarRespaldoVmlDuplicado(xmlCrudoSinNormalizar);
const { xml: xmlConIds } = normalizarParaIds(xmlCrudo);
const xmlNormalizado = unificarRunsDeMarcadores(xmlConIds);

const analisis = analizarAnexo(xmlNormalizado, {});
console.log('blancosInline:', analisis.blancosInline.length);
for (const b of analisis.blancosInline) {
  console.log(`\n contexto="${b.contexto}"`);
  console.log(' parrafoCompleto:', b.parrafoCompleto);
}

await pool.end();
