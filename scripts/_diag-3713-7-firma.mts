import { readFileSync, writeFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const mysql = (await import('mysql2/promise')).default;
const { abrirDocx, normalizarParaIds, unificarRunsDeMarcadores, eliminarRespaldoVmlDuplicado, listarParrafos } = await import('@/app/lib/anexos-docx');
const { analizarAnexo, detectarLineasFirma, detectarSecciones } = await import('@/app/lib/anexos-detectar');
const { analizarAnexoParaUI, generarAnexoFinal } = await import('@/app/lib/anexos-rellenar');
const { conCamposDerivados } = await import('@/app/lib/anexos-derivados');

const pool = mysql.createPool({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 20000,
});

const codigo = '3713-7-LE26';
const [docs]: any = await pool.query(
  `SELECT id, documento_nombre, documento_url_local FROM documentos_cache WHERE licitacion_codigo=? AND id=22127`,
  [codigo],
);
const doc = docs[0];
console.log('Documento:', doc.documento_nombre, doc.id);

const [empresaRows]: any = await pool.query(
  `SELECT razon_social, rut, direccion, region, giro, tipo_persona_juridica, fecha_sociedad,
          fecha_escritura, notaria, numero_repertorio, fojas_numero_anio,
          representante_nombre, representante_rut, representante_cargo,
          email1, telefono1, banco_tipo_cuenta, banco_numero, banco_nombre, banco_email, firma_url, timbre_url
     FROM empresas WHERE id = 2`,
);
const empresa = conCamposDerivados(empresaRows[0]);
console.log('Empresa:', empresa.razon_social, '| representante:', empresa.representante_nombre, empresa.representante_rut);

const res = await fetch(doc.documento_url_local);
const buffer = Buffer.from(await res.arrayBuffer());

const { xml: xmlCrudoSinNormalizar } = await abrirDocx(buffer);
const xmlCrudo = eliminarRespaldoVmlDuplicado(xmlCrudoSinNormalizar);
const { xml: xmlConIds } = normalizarParaIds(xmlCrudo);
const xmlNormalizado = unificarRunsDeMarcadores(xmlConIds);

const parrafos = listarParrafos(xmlNormalizado);
console.log(`\nTotal parrafos: ${parrafos.length}`);
console.log('\n--- Párrafos que mencionan firma/nombre/rut/representante/vilos ---');
for (let i = 0; i < parrafos.length; i++) {
  const t = parrafos[i].texto;
  if (/firma|representante|vilos|nombre completo|perjurio|comisión del delito/i.test(t)) {
    console.log(` [${i}] vacio=${parrafos[i].vacio} texto="${t}"`);
  }
}

console.log('\n--- LINEAS DE FIRMA detectadas ---');
const lineas = detectarLineasFirma(parrafos);
console.log(JSON.stringify(lineas, null, 2));

const analisis = await analizarAnexoParaUI(buffer, empresa);
console.log('\n--- firma (analisis UI) ---');
console.log(JSON.stringify(analisis.firma, null, 2));

writeFileSync('scripts/_out-3713-analisis.json', JSON.stringify(analisis, null, 2), 'utf8');
console.log('\nGuardado analisis completo en scripts/_out-3713-analisis.json');

const gen = await generarAnexoFinal(buffer, empresa, {});
console.log('\nintegridad:', gen.integridad);
writeFileSync('scripts/_out-3713-generado.docx', gen.buffer);
console.log('Guardado .docx generado en scripts/_out-3713-generado.docx');

await pool.end();
