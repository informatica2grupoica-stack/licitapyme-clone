// Regresión FORMATO N°1-A de 4494-69-LE26. Correr con:
//   npx tsx --test app/lib/__tests__/anexos-formato-1a-4494.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { campoDeEtiquetaInequivoca } from '../anexos-determinista';
import { detectarCandidatosTabla } from '../anexos-detectar';
import { normalizarParaIds } from '../anexos-docx';
import { soltarAjusteDeImagenesDeEncabezado } from '../anexos-doc-legacy';

test('"DOMICILIO/CALLE" es la casilla de la calle', () => {
  assert.equal(campoDeEtiquetaInequivoca('DOMICILIO/CALLE'), 'direccion_calle');
});

const P = (id: string, t: string) => `<w:p w14:paraId="${id}"><w:r><w:t>${t}</w:t></w:r></w:p>`;
const celda = (id: string, t: string) => `<w:tc><w:tcPr><w:tcW w:w="2500" w:type="pct"/></w:tcPr>${P(id, t)}</w:tc>`;
const fila = (...c: string[]) => `<w:tr>${c.join('')}</w:tr>`;
const doc = (filas: string) => `<w:document xmlns:w="w" xmlns:w14="w14"><w:body><w:tbl><w:tblPr/>${filas}</w:tbl></w:body></w:document>`;

test('TELEFONO | E-MAIL con dos filas en blanco: la primera es el dato del oferente, la segunda queda manual', () => {
  const xml = normalizarParaIds(doc(
    fila(celda('00000001', 'TELEFONO'), celda('00000002', 'E-MAIL'))
    + fila(celda('00000003', ''), celda('00000004', ''))
    + fila(celda('00000005', ''), celda('00000006', '')),
  )).xml;
  const c = detectarCandidatosTabla(xml);
  assert.equal(c.length, 4);
  assert.deepEqual(c.map(x => !!x.soloManual), [false, false, true, true]);
});

test('lista con columna de nombre: sigue todo solo-manual', () => {
  const xml = normalizarParaIds(doc(
    fila(celda('00000001', 'NOMBRE'), celda('00000002', 'TELEFONO'))
    + fila(celda('00000003', ''), celda('00000004', ''))
    + fila(celda('00000005', ''), celda('00000006', '')),
  )).xml;
  assert.ok(detectarCandidatosTabla(xml).every(x => x.soloManual));
});

test('logo del encabezado: el ajuste de texto se suelta solo para convertir a PDF', async () => {
  const z = new JSZip();
  z.file('word/document.xml', '<w:document/>');
  z.file('word/header1.xml', '<w:hdr><wp:anchor><wp:wrapSquare wrapText="bothSides"/></wp:anchor></w:hdr>');
  const buf = await z.generateAsync({ type: 'nodebuffer' });
  const out = await JSZip.loadAsync(await soltarAjusteDeImagenesDeEncabezado(buf));
  assert.equal(await out.file('word/header1.xml')!.async('string'), '<w:hdr><wp:anchor><wp:wrapNone/></wp:anchor></w:hdr>');
});
