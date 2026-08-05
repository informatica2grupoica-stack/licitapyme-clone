import { readFileSync, writeFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const mysql = (await import('mysql2/promise')).default;
const { generarAnexoFinal } = await import('@/app/lib/anexos-rellenar');
const { conCamposDerivados } = await import('@/app/lib/anexos-derivados');
const pool = mysql.createPool({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 20000,
});
const [erows]: any = await pool.query(`SELECT razon_social, rut, direccion, region, giro, tipo_persona_juridica, fecha_sociedad,
  fecha_escritura, notaria, numero_repertorio, fojas_numero_anio,
  representante_nombre, representante_rut, representante_cargo,
  email1, telefono1, banco_tipo_cuenta, banco_numero, banco_nombre, banco_email, firma_url
  FROM empresas WHERE id = 1`);
const empresa = conCamposDerivados(erows[0]);
const [rows]: any = await pool.query(`SELECT documento_url_local FROM documentos_cache WHERE id=21202`);
const res = await fetch(rows[0].documento_url_local);
const buffer = Buffer.from(await res.arrayBuffer());
const gen = await generarAnexoFinal(buffer, empresa, {});
writeFileSync('C:/Users/droku/AppData/Local/Temp/claude/D--licitapyme-clone/7bff778b-d15c-4340-aeaa-94a8e9fc99bd/scratchpad/full_1058086.docx', gen.buffer);
console.log('escrito. integridad:', gen.integridad);
await pool.end();
