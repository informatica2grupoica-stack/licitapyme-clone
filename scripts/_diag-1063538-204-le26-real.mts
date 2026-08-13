import fs from 'node:fs';
const { abrirDocx } = await import('@/app/lib/anexos-docx');
const { dividirPorFormularios, detectarFormularios, clasificarAnexo } = await import('@/app/lib/anexos-dividir');

const buffer = fs.readFileSync('C:/Users/droku/Downloads/1786629340433_FORMULARIOS_1063538-204-LE26_ARRIENDO_DE_LITROTRIPTOR_NEUMATICO__.docx');
const { xml } = await abrirDocx(buffer);
const formularios = detectarFormularios(xml);
console.log(`Detectados ${formularios.length} formularios:\n`);
for (const f of formularios) console.log(`  · "${f.titulo}"`);

const divididos = await dividirPorFormularios(buffer, xml);
console.log(`\nDivididos ${divididos.length}:\n`);
for (const d of divididos) {
  console.log(`  · categoria=${d.categoria.padEnd(15)} nombreArchivo=${d.nombreArchivo}`);
  console.log(`    titulo="${d.titulo}"`);
}
