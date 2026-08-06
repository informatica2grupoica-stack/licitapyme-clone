import { readFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const mysql = (await import('mysql2/promise')).default;
const { generarAnexoFinal } = await import('@/app/lib/anexos-rellenar');
const { abrirDocx, verificarXmlBienFormado } = await import('@/app/lib/anexos-docx');
const { dividirPorFormularios, detectarFormularios } = await import('@/app/lib/anexos-dividir');
const { conCamposDerivados } = await import('@/app/lib/anexos-derivados');

const pool = mysql.createPool({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 20000,
});

const codigo = '4777-24-LE26';
const [rows]: any = await pool.query(
  `SELECT documento_nombre, documento_url_local FROM documentos_cache WHERE licitacion_codigo=? AND documento_nombre LIKE '%ANEXO%2%'`,
  [codigo],
);
console.log('candidatos:', rows.map((r: any) => r.documento_nombre));

const doc = rows.find((r: any) => /ANEXO.?2/i.test(r.documento_nombre) && !/N2_/.test(r.documento_nombre));
if (!doc) { console.log('no encontrado documento base ANEXO 2'); process.exit(1); }
console.log('usando:', doc.documento_nombre);

const [[negocio]]: any = await pool.query(
  `SELECT empresa_id FROM negocios WHERE licitacion_codigo=? AND activo=TRUE AND empresa_id IS NOT NULL LIMIT 1`,
  [codigo],
);
const [[empresaCruda]]: any = await pool.query(
  `SELECT razon_social, rut, direccion, region, giro, tipo_persona_juridica, fecha_sociedad,
          fecha_escritura, notaria, numero_repertorio, fojas_numero_anio,
          representante_nombre, representante_rut, representante_cargo,
          email1, telefono1, banco_tipo_cuenta, banco_numero, banco_nombre, banco_email,
          banco_titular_nombre, banco_titular_rut, firma_url, timbre_url
     FROM empresas WHERE id=?`,
  [negocio.empresa_id],
);
const empresa = conCamposDerivados(empresaCruda);

const res = await fetch(doc.documento_url_local);
const bufferOriginal = Buffer.from(await res.arrayBuffer());

const entrada = await abrirDocx(bufferOriginal);
console.log('entrada válida:', verificarXmlBienFormado(entrada.xml).valido);

const resultado = await generarAnexoFinal(bufferOriginal, empresa, {}, [], '');
console.log('parrafosIguales:', resultado.integridad.parrafosIguales);

const { xml: xmlFinal } = await abrirDocx(resultado.buffer);
console.log('combinado válido:', verificarXmlBienFormado(xmlFinal).valido);
{ const fs = await import('node:fs'); fs.writeFileSync('scripts/_out-combinado.xml', xmlFinal); }

const formularios = detectarFormularios(xmlFinal);
console.log('formularios detectados:', formularios.map(f => f.titulo));

const fragmentos = await dividirPorFormularios(resultado.buffer, xmlFinal);
for (const f of fragmentos) {
  const { xml } = await abrirDocx(f.buffer);
  const chequeo = verificarXmlBienFormado(xml);
  console.log(`fragmento ${f.nombreSufijo} ("${f.titulo}"):`, chequeo.valido ? 'OK' : chequeo.error);
  if (!chequeo.valido) {
    const fs = await import('node:fs');
    fs.writeFileSync(`scripts/_out-frag-${f.nombreSufijo}.xml`, xml);
    console.log(`  -> volcado a scripts/_out-frag-${f.nombreSufijo}.xml (${xml.length} chars)`);
  }
}

await pool.end();
