import { readFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const mysql = (await import('mysql2/promise')).default;
const { generarAnexoFinal } = await import('@/app/lib/anexos-rellenar');
const { abrirDocx } = await import('@/app/lib/anexos-docx');
const { dividirPorFormularios } = await import('@/app/lib/anexos-dividir');
const { convertirDocADocx } = await import('@/app/lib/anexos-doc-legacy');

const pool = mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306) });
const [empRows]: any = await pool.query(`SELECT razon_social, rut, direccion, region, giro, tipo_persona_juridica, fecha_sociedad, representante_nombre, representante_rut, representante_cargo, email1, telefono1, banco_tipo_cuenta, banco_numero, banco_nombre, banco_email, firma_url FROM empresas WHERE id = 2`);
const empresa = empRows[0];

const [docs]: any = await pool.query(`SELECT documento_url_local, documento_nombre FROM documentos_cache WHERE licitacion_codigo = '4291-38-LP26' AND categoria='ANEXOS_OFERENTE' LIMIT 1`);
console.log('documento original:', docs[0]?.documento_nombre);
const res = await fetch(docs[0].documento_url_local);
let bufferOriginal = Buffer.from(await res.arrayBuffer());
if (/\.doc$/i.test(docs[0].documento_nombre)) {
  console.log('convirtiendo .doc a .docx...');
  bufferOriginal = Buffer.from(await convertirDocADocx(bufferOriginal));
  console.log('convertido, bytes:', bufferOriginal.length);
}

// Chequea el documento RECIÉN CONVERTIDO (antes de cualquier relleno nuestro)
const { xml: xmlConvertido } = await abrirDocx(bufferOriginal);
console.log('\n--- DOCUMENTO RECIÉN CONVERTIDO (LibreOffice) ---');
console.log('¿ya contiene xmlns:a=?', xmlConvertido.includes('xmlns:a='));
const raizConv = xmlConvertido.match(/<w:document\b[^>]*>/);
console.log('tag raíz:', raizConv?.[0]);

const resultado = await generarAnexoFinal(bufferOriginal, empresa, {});
const { xml: xmlCombinado } = await abrirDocx(resultado.buffer);
console.log('\n--- DOCUMENTO COMBINADO (después de rellenar) ---');
console.log('¿contiene xmlns:a=?', xmlCombinado.includes('xmlns:a='));
console.log('n <a:graphicFrameLocks>:', (xmlCombinado.match(/<a:graphicFrameLocks/g)||[]).length);
const raiz = xmlCombinado.match(/<w:document\b[^>]*>/);
console.log('tag raíz:', raiz?.[0]);

const formularios = await dividirPorFormularios(resultado.buffer, xmlCombinado);
console.log('\nformularios:', formularios.length);
const { writeFileSync, mkdirSync } = await import('node:fs');
mkdirSync('scripts/_out-4291', { recursive: true });
for (const f of formularios) {
  const { xml: xmlFrag } = await abrirDocx(f.buffer);
  const raizFrag = xmlFrag.match(/<w:document\b[^>]*>/)?.[0] || '';
  console.log(
    f.nombreSufijo,
    '| xmlns:a EN LA RAÍZ:', /xmlns:a\s*=/.test(raizFrag),
    '| n <a:graphicFrameLocks>:', (xmlFrag.match(/<a:graphicFrameLocks/g) || []).length,
  );
  writeFileSync(`scripts/_out-4291/ANEXO_${f.nombreSufijo}_FORMULARIOS_OBLIGATORIOS.docx`, f.buffer);
}
writeFileSync('scripts/_out-4291/_COMBINADO.docx', resultado.buffer);
await pool.end();
