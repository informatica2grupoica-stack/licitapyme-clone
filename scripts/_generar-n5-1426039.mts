import { readFileSync, writeFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const mysql = (await import('mysql2/promise')).default;
const { generarAnexoFinal } = await import('@/app/lib/anexos-rellenar');
const { conCamposDerivados } = await import('@/app/lib/anexos-derivados');
const { obtenerItemsCosteoParaAnexo, obtenerTextoBasesParaAnexo } = await import('@/app/lib/anexos-datos');
const { abrirDocx, verificarXmlBienFormado } = await import('@/app/lib/anexos-docx');

const CODIGO = '1426039-8-LE26';
const EMPRESA_ID = 2;
const URL_ORIGINAL = 'https://pub-722f3e1c29d74bcb8ee49776fe8a2c0d.r2.dev/1426039-8-LE26/1786052734182_ANEXO_N__5.docx';
const OUT_PATH = 'C:/Users/droku/AppData/Local/Temp/claude/D--licitapyme-clone/aa86d70f-a793-492f-9f25-44997cf92b81/scratchpad/ANEXO_N5_1426039_FIX.docx';

const pool = mysql.createPool({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 20000,
});

const [empRows]: any = await pool.query(
  `SELECT razon_social, rut, direccion, region, giro, tipo_persona_juridica, fecha_sociedad,
          fecha_escritura, notaria, numero_repertorio, fojas_numero_anio,
          representante_nombre, representante_rut, representante_cargo,
          email1, telefono1, banco_tipo_cuenta, banco_numero, banco_nombre, banco_email,
          banco_titular_nombre, banco_titular_rut, firma_url, timbre_url
     FROM empresas WHERE id = ?`, [EMPRESA_ID],
);
const empresa = conCamposDerivados(empRows[0]);

const itemsCosteo = await obtenerItemsCosteoParaAnexo(CODIGO);
const basesTexto = await obtenerTextoBasesParaAnexo(CODIGO);

const res = await fetch(URL_ORIGINAL);
const bufferOriginal = Buffer.from(await res.arrayBuffer());

const resultado = await generarAnexoFinal(bufferOriginal, empresa, {}, itemsCosteo, basesTexto);
console.log(`integridad=${resultado.integridad.parrafosIguales} completados=${resultado.completados} respondidos=${resultado.respondidos}`);
console.log(`avisos=${JSON.stringify(resultado.avisos)}`);

const { xml } = await abrirDocx(resultado.buffer);
const chequeo = verificarXmlBienFormado(xml);
console.log(`xml valido=${chequeo.valido} ${chequeo.error ?? ''}`);
if (chequeo.valido) {
  writeFileSync(OUT_PATH, resultado.buffer);
  console.log(`guardado en ${OUT_PATH}`);
}

await pool.end();
