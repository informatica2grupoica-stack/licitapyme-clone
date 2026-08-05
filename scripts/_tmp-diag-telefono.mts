import { readFileSync } from 'node:fs';
const DIR = 'C:/Users/droku/AppData/Local/Temp/claude/D--licitapyme-clone/7bff778b-d15c-4340-aeaa-94a8e9fc99bd/scratchpad/anexos1114';
const { abrirDocx, normalizarParaIds } = await import('@/app/lib/anexos-docx');
const buf = readFileSync(`${DIR}/ANEXO_N°_2-A_+_ANEXO_N°_2-B.docx`);
const { xml } = await abrirDocx(buf);
const { xml: norm } = normalizarParaIds(xml);
const i = norm.indexOf('Teléfono de Contacto');
// Encontrar la 2da ocurrencia (2-B)
const i2 = norm.indexOf('Teléfono de Contacto', i + 5);
console.log('=== contexto alrededor de la 2da "Teléfono de Contacto" ===');
console.log(norm.slice(i2 - 300, i2 + 900));
