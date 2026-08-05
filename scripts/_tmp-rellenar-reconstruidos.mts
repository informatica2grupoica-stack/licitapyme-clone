import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const DIR = 'C:/Users/droku/AppData/Local/Temp/claude/D--licitapyme-clone/7bff778b-d15c-4340-aeaa-94a8e9fc99bd/scratchpad/anexos1114';
const { default: pool } = await import('@/app/lib/db');
const { conCamposDerivados } = await import('@/app/lib/anexos-derivados');
const { generarAnexoFinal, analizarAnexoParaUI } = await import('@/app/lib/anexos-rellenar');
const { verificarXmlBienFormado, abrirDocx } = await import('@/app/lib/anexos-docx');

const [er]: any = await pool.query(`SELECT * FROM empresas WHERE id = 1`);
const empresa = conCamposDerivados(er[0]);
await pool.end();

for (const f of readdirSync(DIR).filter(n => n.endsWith('.docx') && !n.includes('RELLENO'))) {
  const buf = readFileSync(`${DIR}/${f}`);
  try {
    const an: any = await analizarAnexoParaUI(buf, empresa);
    const gen = await generarAnexoFinal(buf, empresa, {});
    writeFileSync(`${DIR}/RELLENO_${f}`, gen.buffer);
    const chk = verificarXmlBienFormado((await abrirDocx(gen.buffer)).xml);
    console.log(`${f.slice(0, 32).padEnd(34)} auto=${String(an.completadosAuto.length).padStart(2)} pendCelda=${String(an.pendientesCelda.length).padStart(2)} pendInline=${String(an.pendientesInline.length).padStart(2)} | escritos=${gen.completados} xml=${chk.valido}`);
    for (const c of an.completadosAuto.slice(0, 6)) console.log(`      ✓ ${(c.etiqueta || '').slice(0, 46)} => ${c.valor}`);
  } catch (e) {
    console.log(`${f.slice(0, 32).padEnd(34)} ERROR: ${String(e).slice(0, 90)}`);
  }
}
