// «Traer desde Documentos» (28-oct-2026). Correr con:
//   npx tsx --test app/lib/__tests__/anexos-traer.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documentosPropiosDeOferta, esDocumentoSuelto, proponerReparto, tituloDesdeArchivo, type DocPropio } from '../anexos-traer';

const doc = (id: number, nombre: string, subcategoria: string | null = null, categoria = 'DOCUMENTOS_PROPIOS'): DocPropio =>
  ({ id, documento_nombre: nombre, documento_url_local: `https://r2/${id}`, categoria, subcategoria });

// Lo que había en Documentos de 4022-19-LE26 el 28-oct.
const DOCS_4022 = [
  doc(30616, 'BASES_LIC_4022-19-LE26_pdf.pdf', null, 'BASES_TECNICAS'),
  doc(30879, 'ANEXO_LICITACIÓN_PÚBLICA_5.pdf', 'Anexos Administrativos'),
  doc(30939, 'Ficha (texto) NIMAC 12.8V 100Ah.txt', 'fichas_tecnicas'),
  doc(30943, '1793024402501_fICHA_CANERIAS_2.pdf', 'fichas_tecnicas'),
  doc(30967, 'ANEXO N° 1.pdf'), doc(30968, 'ANEXO N° 2.pdf'), doc(30969, 'ANEXO N° 3.pdf'),
  doc(30970, 'ANEXO N° 4.pdf'), doc(30971, 'ANEXO N° 5.pdf'), doc(30972, 'FICHA TECNICA.pdf'),
  doc(1, 'COSTEO_4022-19-LE26_2026-10-27.xlsx', 'costeo'),
];
const PUNTOS_4022 = [
  { id: 34017, titulo: 'Anexo Administrativo 1 - Declaración Jurada de identificación del Proponente', estado: 'PENDIENTE' },
  { id: 34018, titulo: 'Anexo Administrativo 2 - Declaración Jurada Simple de no estar inhabilitado para ofertar', estado: 'PENDIENTE' },
  { id: 35390, titulo: 'Anexo Técnico 3 - Oferta Técnica', estado: 'PENDIENTE' },
  { id: 34020, titulo: 'Anexo Económico 4 - Oferta Económica', estado: 'PENDIENTE' },
];

test('4022-19-LE26: sueltos = los 5 anexos firmados + la ficha; fuera bases, generados, fichas de cotización y costeo', () => {
  const sueltos = documentosPropiosDeOferta(DOCS_4022).filter(d => esDocumentoSuelto(d, new Set()));
  assert.deepEqual(sueltos.map(d => d.documento_nombre), ['ANEXO N° 1.pdf', 'ANEXO N° 2.pdf', 'ANEXO N° 3.pdf', 'ANEXO N° 4.pdf', 'ANEXO N° 5.pdf', 'FICHA TECNICA.pdf']);
});

test('un archivo ya cargado en una casilla deja de estar suelto', () => {
  assert.equal(esDocumentoSuelto(doc(30967, 'ANEXO N° 1.pdf'), new Set(['https://r2/30967'])), false);
});

test('4022-19-LE26: cada anexo va a su punto; el 5 y la ficha quedan sin punto (no se adivina)', () => {
  const sueltos = documentosPropiosDeOferta(DOCS_4022).filter(d => esDocumentoSuelto(d, new Set()));
  const r = Object.fromEntries(proponerReparto(sueltos, PUNTOS_4022).map(p => [p.doc.documento_nombre, p.itemId]));
  assert.deepEqual(r, {
    'ANEXO N° 1.pdf': 34017, 'ANEXO N° 2.pdf': 34018, 'ANEXO N° 3.pdf': 35390, 'ANEXO N° 4.pdf': 34020,
    'ANEXO N° 5.pdf': null, 'FICHA TECNICA.pdf': null,
  });
});

test('un punto ya aprobado no recibe propuestas', () => {
  const r = proponerReparto([doc(9, 'ANEXO N° 1.pdf')], [{ ...PUNTOS_4022[0], estado: 'APROBADO' }]);
  assert.equal(r[0].itemId, null);
});

test('título de un punto nuevo = nombre del archivo sin extensión', () => {
  assert.equal(tituloDesdeArchivo('ANEXO N° 5.pdf'), 'ANEXO N° 5');
  assert.equal(tituloDesdeArchivo('FICHA_TECNICA.pdf'), 'FICHA TECNICA');
});
