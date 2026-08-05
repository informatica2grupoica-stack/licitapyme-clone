import { readFileSync } from 'node:fs';
const DIR = 'C:/Users/droku/AppData/Local/Temp/claude/D--licitapyme-clone/7bff778b-d15c-4340-aeaa-94a8e9fc99bd/scratchpad/anexos1114';
const { abrirDocx, normalizarParaIds, unificarRunsDeMarcadores, listarParrafos } = await import('@/app/lib/anexos-docx');
const buf = readFileSync(`${DIR}/ANEXO_N°_2-A_+_ANEXO_N°_2-B.docx`);
const { xml } = await abrirDocx(buf);
const { xml: conIds } = normalizarParaIds(xml);
const norm = unificarRunsDeMarcadores(conIds);
const parrafos = listarParrafos(norm);
for (const idx of [17, 18, 19, 20, 21, 22]) {
  const p = parrafos[idx];
  const re = new RegExp(`<w:p\b[^>]*w14:paraId="${p.paraId}"[^>]*>[\s\S]*?</w:p>`);
  const m = norm.match(re);
  console.log(`--- [${idx}] paraId=${p.paraId} vacio=${p.vacio} ---`);
  console.log(m ? m[0] : 'NO ENCONTRADO');
}
