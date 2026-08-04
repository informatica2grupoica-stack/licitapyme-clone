import { readFileSync } from 'node:fs';
const { abrirDocx, normalizarParaIds } = await import('@/app/lib/anexos-docx');
const { extraerTablasCrudo } = await import('@/app/lib/anexos-detectar');

const buf = readFileSync(process.argv[2]);
const { xml } = await abrirDocx(buf);
const { xml: norm } = normalizarParaIds(xml);
const tablas = extraerTablasCrudo(norm);
console.log('num tablas:', tablas.length);
tablas.forEach((t, i) => {
  console.log(`\n=== tabla ${i} (indicePrimero=${t.indicePrimero}) filas=${t.filas.length} ===`);
  t.filas.slice(0, 15).forEach((f, j) => {
    console.log(j, f.celdas.length, f.celdas.map(c => JSON.stringify(c.texto.slice(0, 25))).join(' | '));
  });
});
