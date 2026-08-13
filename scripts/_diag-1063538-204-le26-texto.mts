import fs from 'node:fs';
const { abrirDocx } = await import('@/app/lib/anexos-docx');
const buffer = fs.readFileSync('C:/Users/droku/Downloads/1786629340433_FORMULARIOS_1063538-204-LE26_ARRIENDO_DE_LITROTRIPTOR_NEUMATICO__.docx');
const { xml } = await abrirDocx(buffer);
const texto = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>|<w:(?:br|cr)\b[^>]*\/?>/g)]
  .map(m => (m[1] !== undefined ? m[1] : '\n')).join('');
// Mostrar cada header "FORMULARIO" con ~150 chars después.
const re = /FORMULARIO\s*N[°ºO]?\.?\s*\d+/gi;
let m;
while ((m = re.exec(texto)) !== null) {
  const despues = texto.slice(m.index, m.index + 180).replace(/\n+/g, ' | ').trim();
  console.log(despues);
  console.log('---');
}
