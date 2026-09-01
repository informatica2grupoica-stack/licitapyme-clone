// BUG REAL (1-sep-2026, FORMATO N°2 DECLARACIÓN SIMPLE DE ACEPTACIÓN DE BASES, 4328-32-LP26,
// reportado por el usuario con captura y con el reclamo directo "aún sigue así, ¿lo reparaste o
// no?"). "REEMPLAZAR ESTE TEXTO POR EL NOMBRE Y RUT DEL REPRESENTANTE LEGAL" vive SOLA en su
// propia celda de tabla, sin ninguna celda vacía al lado — ni rellenarCeldaVacia (exige texto
// vacío) ni rellenarFinDeParrafo (agrega al final, dejaría la instrucción pegada al dato real)
// sirven acá: el párrafo entero ES el placeholder y tiene que desaparecer, reemplazado por el
// valor real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reemplazarTextoDeParrafo, listarParrafos } from '../anexos-docx';

const parrafo = (texto: string, pPr = '') =>
  `<w:p w14:paraId="00000001">${pPr}<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${texto}</w:t></w:r></w:p>`;

test('reemplazarTextoDeParrafo: el placeholder desaparece por completo, reemplazado por el valor', () => {
  const xml = parrafo('REEMPLAZAR ESTE TEXTO POR EL NOMBRE Y RUT DEL REPRESENTANTE LEGAL');
  const out = reemplazarTextoDeParrafo(xml, '00000001', 'Santiago Osvaldo López Palavecino, RUT 15.875.453-3');
  const [p] = listarParrafos(out);
  assert.equal(p.texto, 'Santiago Osvaldo López Palavecino, RUT 15.875.453-3');
  assert.ok(!p.texto.includes('REEMPLAZAR'), 'el texto de instrucción no debe sobrevivir junto al dato real');
});

test('reemplazarTextoDeParrafo: conserva el <w:pPr> (alineación/formato del párrafo)', () => {
  const pPr = '<w:pPr><w:jc w:val="center"/></w:pPr>';
  const xml = parrafo('REEMPLAZAR ESTE TEXTO POR X', pPr);
  const out = reemplazarTextoDeParrafo(xml, '00000001', 'Valor real');
  assert.match(out, /<w:jc w:val="center"\/>/, 'el <w:pPr> del párrafo debe seguir intacto');
});

test('reemplazarTextoDeParrafo: no crea ni destruye párrafos (mismo conteo antes/después)', () => {
  const xml = `<w:document><w:body>${parrafo('REEMPLAZAR ESTE TEXTO POR X')}<w:p w14:paraId="00000002"><w:r><w:t>Otro párrafo</w:t></w:r></w:p></w:body></w:document>`;
  const out = reemplazarTextoDeParrafo(xml, '00000001', 'Valor real');
  assert.equal(listarParrafos(xml).length, listarParrafos(out).length);
});

test('reemplazarTextoDeParrafo: revienta con un aviso claro si el paraId no existe (no falla en silencio)', () => {
  const xml = parrafo('REEMPLAZAR ESTE TEXTO POR X');
  assert.throws(() => reemplazarTextoDeParrafo(xml, '99999999', 'Valor real'), /No se encontró el párrafo/);
});
