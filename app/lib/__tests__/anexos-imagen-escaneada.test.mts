// Regresión de la detección de secciones "pegadas como foto" (4-ago-2026, ver anexos-imagen-escaneada.ts).
// Caso real: 1019-79-LP26, ANEXO N°7 "Autorización pagos a través de bancos" — el organismo pegó
// el formulario ESCANEADO en el .docx en vez de escribirlo como texto. anexos-detectar.ts (que
// solo lee <w:t>) no ve nada ahí: 0 candidatos, la sección desaparecía en silencio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { extraerImagenesGrandes } from '../anexos-imagen-escaneada';
import { normalizarParaIds } from '../anexos-docx';

// PNG 1x1 válido (transparente) — no importa el contenido real, solo que sea un archivo de
// imagen válido dentro del zip; el OCR no se prueba acá (harían falta credenciales/red).
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const NS = '<w:document xmlns:w="urn:w" xmlns:wp="urn:wp" xmlns:a="urn:a" xmlns:r="urn:r" xmlns:w14="urn:w14"><w:body>';
const FIN = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>';
const p = (texto: string) => `<w:p><w:r><w:t xml:space="preserve">${texto}</w:t></w:r></w:p>`;

// cx/cy en EMU (360000 por cm). rId referencia una relación de imagen.
const drawing = (rId: string, cxCm: number, cyCm: number) =>
  `<w:p><w:r><w:drawing><wp:anchor><wp:extent cx="${cxCm * 360000}" cy="${cyCm * 360000}"/>`
  + `<a:graphic><a:graphicData><pic:blipFill xmlns:pic="urn:pic"><a:blip r:embed="${rId}"/></pic:blipFill></a:graphicData></a:graphic>`
  + `</wp:anchor></w:drawing></w:r></w:p>`;

async function crearDocxDePrueba(xmlCuerpo: string, imagenes: { rId: string; archivo: string }[]): Promise<JSZip> {
  const zip = new JSZip();
  zip.file('word/document.xml', NS + xmlCuerpo + FIN);
  const relaciones = imagenes
    .map(img => `<Relationship Id="${img.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${img.archivo}"/>`)
    .join('');
  zip.file('word/_rels/document.xml.rels',
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relaciones}</Relationships>`);
  for (const img of imagenes) zip.file(`word/media/${img.archivo}`, PNG_1X1);
  return zip;
}

test('extraerImagenesGrandes: descarta logos chicos, toma el formulario grande, y ubica el título cercano', async () => {
  const xmlCuerpo = p('ANEXO N°7')
    + p('AUTORIZACIÓN PAGOS A TRAVÉS DE BANCOS')
    + p('')
    + drawing('rId1', 15.5, 14.0)   // el formulario escaneado real (grande)
    + p('Un logo pequeño arriba de la firma:')
    + drawing('rId2', 2, 0.05);      // línea decorativa / logo, debe descartarse

  const zip = await crearDocxDePrueba(xmlCuerpo, [
    { rId: 'rId1', archivo: 'image1.png' },
    { rId: 'rId2', archivo: 'image2.png' },
  ]);
  const xmlCrudo = await zip.file('word/document.xml')!.async('string');
  const { xml } = normalizarParaIds(xmlCrudo);

  const imagenes = await extraerImagenesGrandes(zip, xml);
  assert.equal(imagenes.length, 1, 'solo la imagen grande debe sobrevivir al filtro de tamaño');
  assert.equal(imagenes[0].tituloCercano, 'AUTORIZACIÓN PAGOS A TRAVÉS DE BANCOS');
});

test('extraerImagenesGrandes: sin ninguna imagen sustancial, devuelve vacío (no revienta)', async () => {
  const xmlCuerpo = p('Un párrafo normal') + p('Otro más');
  const zip = await crearDocxDePrueba(xmlCuerpo, []);
  const xmlCrudo = await zip.file('word/document.xml')!.async('string');
  const { xml } = normalizarParaIds(xmlCrudo);
  const imagenes = await extraerImagenesGrandes(zip, xml);
  assert.deepEqual(imagenes, []);
});

test('extraerImagenesGrandes: una forma vectorial (sin r:embed) no se confunde con una foto', async () => {
  // Mismo tamaño grande que un formulario real, pero SIN r:embed — es una línea/figura dibujada,
  // no una imagen (caso real: la "diagonal" de 1019-79-LP26, cx=5847715 cy=8125459 sin embed).
  const xmlCuerpo = p('Título cualquiera')
    + `<w:p><w:r><w:drawing><wp:anchor><wp:extent cx="5847715" cy="8125459"/>`
    + `<a:graphic><a:graphicData><wps:wsp xmlns:wps="urn:wps"/></a:graphicData></a:graphic>`
    + `</wp:anchor></w:drawing></w:r></w:p>`;
  const zip = await crearDocxDePrueba(xmlCuerpo, []);
  const xmlCrudo = await zip.file('word/document.xml')!.async('string');
  const { xml } = normalizarParaIds(xmlCrudo);
  const imagenes = await extraerImagenesGrandes(zip, xml);
  assert.deepEqual(imagenes, []);
});
