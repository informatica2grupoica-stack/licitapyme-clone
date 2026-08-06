import { readFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const mysql = (await import('mysql2/promise')).default;
const { analizarAnexoParaUI } = await import('@/app/lib/anexos-rellenar');
const { conCamposDerivados } = await import('@/app/lib/anexos-derivados');

const pool = mysql.createPool({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 20000,
});

const codigo = '4777-24-LE26';
const [[doc]]: any = await pool.query(
  `SELECT documento_url_local FROM documentos_cache WHERE licitacion_codigo=? AND documento_nombre='ANEXO_1-A.docx'`,
  [codigo],
);
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
const buffer = Buffer.from(await res.arrayBuffer());

const analisis = await analizarAnexoParaUI(buffer, empresa);
console.log('completadosAuto:', analisis.completadosAuto.length);
for (const c of analisis.completadosAuto) console.log(` "${c.etiqueta}" → ${c.campo} = "${c.valor}" (${c.via})`);
console.log('\npendientesCelda:', analisis.pendientesCelda.length);
for (const p of analisis.pendientesCelda) console.log(` "${p.etiqueta}" [${p.categoria}] ${p.motivo || ''}`);
console.log('\npendientesInline:', analisis.pendientesInline.length);
for (const p of analisis.pendientesInline) console.log(` "${p.contexto}" [${p.categoria}] ${p.motivo || ''}`);

await pool.end();
