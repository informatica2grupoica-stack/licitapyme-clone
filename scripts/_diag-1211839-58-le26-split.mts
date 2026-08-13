import fs from 'node:fs';
const { abrirDocx, verificarXmlBienFormado } = await import('@/app/lib/anexos-docx');
const { dividirPorFormularios } = await import('@/app/lib/anexos-dividir');

const buffer = fs.readFileSync('D:/licitapyme-clone/scratch-formularios-1211839.docx');
const { xml } = await abrirDocx(buffer);
const divididos = await dividirPorFormularios(buffer, xml);
console.log(`Divididos: ${divididos.length}`);
for (const d of divididos) {
  const { xml: fxml } = await abrirDocx(d.buffer);
  const chequeo = verificarXmlBienFormado(fxml);
  console.log(`  · ${d.nombreArchivo} (${d.categoria}) — válido=${chequeo.valido}${chequeo.valido ? '' : ' ERROR: ' + chequeo.error}`);
}
