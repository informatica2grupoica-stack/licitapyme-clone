const { abrirDocx, normalizarParaIds, unificarRunsDeMarcadores, eliminarRespaldoVmlDuplicado, listarParrafos } = await import('@/app/lib/anexos-docx');
const { analizarAnexo, detectarCandidatosTabla } = await import('@/app/lib/anexos-detectar');
const { resolverAnexoConIA } = await import('@/app/lib/anexos-ia-motor');
const { conCamposDerivados } = await import('@/app/lib/anexos-derivados');
const fs = await import('node:fs');
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const mysql = (await import('mysql2/promise')).default;
const pool = mysql.createPool({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 20000,
});
const [empRows]: any = await pool.query(
  `SELECT razon_social, rut, direccion, region, giro, representante_nombre, representante_rut, representante_cargo,
          email1, telefono1, banco_tipo_cuenta, banco_numero, banco_nombre, banco_email
     FROM empresas WHERE id = 2`,
);
const empresa = conCamposDerivados(empRows[0]);

const res = await fetch('https://pub-722f3e1c29d74bcb8ee49776fe8a2c0d.r2.dev/1426039-8-LE26/1786052736576_ANEXO_N__6.docx');
const buffer = Buffer.from(await res.arrayBuffer());
const { xml: xmlCrudoSinNormalizar } = await abrirDocx(buffer);
const xmlCrudo = eliminarRespaldoVmlDuplicado(xmlCrudoSinNormalizar);
const { xml: xmlConIds } = normalizarParaIds(xmlCrudo);
const xmlNormalizado = unificarRunsDeMarcadores(xmlConIds);
const analisis = analizarAnexo(xmlNormalizado);
const parrafos = listarParrafos(xmlNormalizado);

console.log('candidatosTabla con Banco/Cuenta/Correo/Razon/Rut/Giro/Direccion:');
const tabla = detectarCandidatosTabla(xmlNormalizado);
for (const c of tabla) {
  if (/Banco|Cuenta|Correo|Raz[oó]n|Rut|Giro|Direcci[oó]n|Nombre|Apellido/i.test(c.etiqueta)) {
    console.log(`  indice=${c.indice} etiqueta="${c.etiqueta}" soloManual=${!!c.soloManual}`);
  }
}
console.log('\ncamposConDosPuntos con Raz/Rut:');
for (const c of analisis.camposConDosPuntos) console.log(`  indice=${c.indice} etiqueta="${c.etiqueta}"`);

const resultado = await resolverAnexoConIA({
  candidatos: [...analisis.candidatosCelda.filter(c => !analisis.indicesSoloManual.has(c.indice)), ...analisis.camposConDosPuntos],
  blancosInline: [], parrafos, empresa,
});
console.log('\nresoluciones para candidatos con Banco/Cuenta/Correo/Nombre/Apellido/Razon:');
for (const c of [...analisis.candidatosCelda, ...analisis.camposConDosPuntos]) {
  if (/Banco|Cuenta|Correo|Raz[oó]n|Nombre|Apellido/i.test(c.etiqueta)) {
    console.log(`  [${c.indice}] "${c.etiqueta}" =>`, JSON.stringify(resultado.celda.get(c.indice)));
  }
}

await pool.end();
