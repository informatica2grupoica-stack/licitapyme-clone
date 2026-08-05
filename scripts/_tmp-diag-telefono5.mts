import { readFileSync } from 'node:fs';
const DIR = 'C:/Users/droku/AppData/Local/Temp/claude/D--licitapyme-clone/7bff778b-d15c-4340-aeaa-94a8e9fc99bd/scratchpad/anexos1114';
const { abrirDocx, normalizarParaIds, unificarRunsDeMarcadores } = await import('@/app/lib/anexos-docx');
const buf = readFileSync(`${DIR}/ANEXO_N°_2-A_+_ANEXO_N°_2-B.docx`);
const { xml } = await abrirDocx(buf);
const { xml: conIds } = normalizarParaIds(xml);
const norm = unificarRunsDeMarcadores(conIds);
const matches = [...norm.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)];
for (const idx of [15,16,17, 18, 19, 20, 21, 22, 23]) {
  console.log(`--- [${idx}] ---`);
  console.log((matches[idx]?.[0] ?? 'N/A').slice(0, 400));
}
