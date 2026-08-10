// Genera el .docx FINAL de 2908-16-LE26 (no un análisis/simulación) usando exactamente
// generarAnexoFinal, la misma función que usa /api/anexos/generar. Sin respuestas manuales
// (respuestas={}): todo lo que no se resuelve solo queda en blanco para llenar a mano, como pidió
// el usuario (precios/costeo y la tabla de EXPERIENCIA quedan 100% manuales).
// No sube a R2 ni escribe en documentos_cache — solo entrega el archivo. Usa el .docx ya
// convertido a mano (Word COM) porque el conversor-doc no está disponible en este entorno local.
// Uso: npx tsx scripts/_generar-2908-16-le26.mts
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
const { dividirPorFormularios } = await import('@/app/lib/anexos-dividir');

const CODIGO = '2908-16-LE26';
const EMPRESA_ID = 1;
const DOCX_PATH = 'C:/Users/droku/AppData/Local/Temp/claude/D--licitapyme-clone/aa86d70f-a793-492f-9f25-44997cf92b81/scratchpad/anexo-2908-16-LE26.docx';
const OUT_DIR = 'C:/Users/droku/AppData/Local/Temp/claude/D--licitapyme-clone/aa86d70f-a793-492f-9f25-44997cf92b81/scratchpad';

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
console.log(`empresa=${empresa.razon_social} itemsCosteo=${itemsCosteo.length} basesTexto=${basesTexto.length} chars`);

const bufferOriginal = readFileSync(DOCX_PATH);
const resultado = await generarAnexoFinal(bufferOriginal, empresa, {}, itemsCosteo, basesTexto);

console.log(`\nintegridad.parrafosIguales=${resultado.integridad.parrafosIguales}`);
console.log(`completados=${resultado.completados} respondidos=${resultado.respondidos}`);
console.log(`avisos=${JSON.stringify(resultado.avisos)}`);

if (!resultado.integridad.parrafosIguales) {
  console.log('ABORTA: el documento generado no calza con el original.');
  await pool.end();
  process.exit(1);
}

const { xml: xmlFinal } = await abrirDocx(resultado.buffer);
const formularios = await dividirPorFormularios(resultado.buffer, xmlFinal);
console.log(`formularios detectados=${formularios.length}`);

const NOMBRE_BASE = 'Anexos_adm_tecnico_y_economico_obligatorios';
const candidatos = formularios.length >= 2
  ? formularios.map(f => ({ nombre: `ANEXO_${f.nombreSufijo}_${NOMBRE_BASE}.docx`, buffer: f.buffer }))
  : [{ nombre: `ANEXO_${NOMBRE_BASE}.docx`, buffer: resultado.buffer }];

for (const c of candidatos) {
  const { xml } = await abrirDocx(c.buffer);
  const chequeo = verificarXmlBienFormado(xml);
  console.log(`  ${c.nombre}: xml valido=${chequeo.valido} ${chequeo.error ?? ''}`);
  if (chequeo.valido) {
    const path = `${OUT_DIR}/${c.nombre}`;
    writeFileSync(path, c.buffer);
    console.log(`    -> guardado en ${path}`);
  }
}

await pool.end();
