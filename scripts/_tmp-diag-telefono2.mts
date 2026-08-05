import { readFileSync } from 'node:fs';
const DIR = 'C:/Users/droku/AppData/Local/Temp/claude/D--licitapyme-clone/7bff778b-d15c-4340-aeaa-94a8e9fc99bd/scratchpad/anexos1114';
const { abrirDocx } = await import('@/app/lib/anexos-docx');
const buf = readFileSync(`${DIR}/RELLENO_ANEXO_N°_2-A_+_ANEXO_N°_2-B.docx`);
const { xml } = await abrirDocx(buf);
const i = xml.indexOf('3146 2445');
console.log(xml.slice(i - 700, i + 200));
