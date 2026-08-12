// Regresión de la réplica visual del documento (anexos-documento-ui.ts) — el módulo más complejo
// del Anexo Creator sin ningún test propio hasta ahora (auditoría 12-ago-2026). Cubre lo esencial
// de construirDocumentoUI: alineación/formato de texto, marcador de lista numerada resuelto contra
// numbering.xml, blancos inline resueltos (auto/pendiente) en el lugar exacto del texto, blancos a
// nivel de párrafo, y tablas (simples y con una anidada adentro — esto último ejercita finDeTabla,
// que se movió a anexos-docx.ts compartido con anexos-dividir.ts en la misma auditoría).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  construirDocumentoUI, type MapaNumeracion, type BloqueParrafoUI, type BloqueTablaUI, type Resuelto,
} from '../anexos-documento-ui';

const NS = '<w:document xmlns:w="urn:w" xmlns:w14="urn:w14"><w:body>';
const FIN = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>';

function construir(cuerpo: string, opts: {
  porParrafo?: Map<number, Resuelto>;
  porBlancoInline?: Map<string, Resuelto>;
  tablasPorIndice?: Map<number, unknown>;
  numeracion?: MapaNumeracion;
} = {}) {
  return construirDocumentoUI({
    xml: NS + cuerpo + FIN,
    porParrafo: opts.porParrafo ?? new Map(),
    porBlancoInline: opts.porBlancoInline ?? new Map(),
    tablasPorIndice: opts.tablasPorIndice ?? new Map(),
    numeracion: opts.numeracion,
  });
}

test('párrafo centrado con texto en negrita conserva alineación y formato', () => {
  const bloques = construir('<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Título</w:t></w:r></w:p>') as BloqueParrafoUI[];
  assert.equal(bloques.length, 1);
  assert.equal(bloques[0].tipo, 'parrafo');
  assert.equal(bloques[0].alineacion, 'centro');
  assert.deepEqual(bloques[0].segmentos, [{ t: 'texto', v: 'Título', negrita: true, subrayado: false }]);
});

test('lista numerada usa el formato REAL de numbering.xml, no un default adivinado', () => {
  const numeracion: MapaNumeracion = new Map([['5:0', { formato: 'lowerLetter', textoNivel: '%1)', inicio: 1 }]]);
  const item = (texto: string) =>
    `<w:p><w:pPr><w:numPr><w:numId w:val="5"/><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>${texto}</w:t></w:r></w:p>`;
  const bloques = construir(item('Primero') + item('Segundo'), { numeracion }) as BloqueParrafoUI[];
  assert.equal(bloques[0].marcador, 'a)');
  assert.equal(bloques[1].marcador, 'b)');
});

test('blanco inline se resuelve como valor auto o como input, en el lugar exacto del texto', () => {
  const xml = '<w:p><w:r><w:t>Nombre: </w:t></w:r><w:r><w:t>____</w:t></w:r><w:r><w:t> RUT: </w:t></w:r><w:r><w:t>____</w:t></w:r></w:p>';
  const porBlancoInline = new Map<string, Resuelto>([
    ['1:0', { tipo: 'auto', valor: 'Empresa Ejemplo SPA', via: 'ia', etiqueta: 'Nombre' }],
    ['3:0', { tipo: 'pendiente', id: 'inline:3:0' }],
  ]);
  const bloques = construir(xml, { porBlancoInline }) as BloqueParrafoUI[];
  assert.deepEqual(bloques[0].segmentos, [
    { t: 'texto', v: 'Nombre: ', negrita: false, subrayado: false },
    { t: 'auto', v: 'Empresa Ejemplo SPA', via: 'ia', etiqueta: 'Nombre' },
    { t: 'texto', v: ' RUT: ', negrita: false, subrayado: false },
    { t: 'input', id: 'inline:3:0', largo: 4 },
  ]);
});

test('blanco a nivel de párrafo (celda vacía o "Etiqueta:") se agrega al final de los segmentos', () => {
  const porParrafo = new Map<number, Resuelto>([[0, { tipo: 'auto', valor: '76.123.456-7', via: 'ia', etiqueta: 'RUT' }]]);
  const bloques = construir('<w:p><w:r><w:t>RUT: </w:t></w:r></w:p>', { porParrafo }) as BloqueParrafoUI[];
  assert.deepEqual(bloques[0].segmentos, [
    { t: 'texto', v: 'RUT: ', negrita: false, subrayado: false },
    { t: 'auto', v: '76.123.456-7', via: 'ia', etiqueta: 'RUT' },
  ]);
});

test('una tabla se dibuja en su posición (tablasPorIndice) y la numeración sigue después de ella', () => {
  const xml = '<w:p><w:r><w:t>Antes</w:t></w:r></w:p>'
    + '<w:tbl><w:tblPr/><w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>celda</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    + '<w:p><w:r><w:t>Después</w:t></w:r></w:p>';
  const tablasPorIndice = new Map<number, unknown>([[1, { marcador: 'TABLA-1' }]]);
  const bloques = construir(xml, { tablasPorIndice });
  assert.equal(bloques.length, 3);
  assert.equal(bloques[0].tipo, 'parrafo');
  assert.equal(bloques[1].tipo, 'tabla');
  assert.deepEqual((bloques[1] as BloqueTablaUI<unknown>).tabla, { marcador: 'TABLA-1' });
  assert.equal(bloques[2].tipo, 'parrafo');
  assert.equal((bloques[2] as BloqueParrafoUI).indice, 2, 'el índice de párrafo sigue contando la tabla como 1 párrafo interno');
});

// Regresión de la consolidación de finDeTabla (auditoría 12-ago-2026): antes vivía duplicado acá y
// en anexos-dividir.ts; ahora los dos importan la misma función de anexos-docx.ts. Este caso —una
// tabla exterior con una tabla anidada dentro de una celda— es justo el que finDeTabla existe para
// resolver (contando anidamiento en vez de cortar en el primer </w:tbl>).
test('tabla con OTRA tabla anidada adentro: las dos se dibujan como bloques separados y la numeración sigue bien después', () => {
  const filaEncabezado = '<w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>encabezado</w:t></w:r></w:p></w:tc></w:tr>';
  const filaConAnidada = '<w:tr><w:tc><w:tcPr/>'
    + '<w:tbl><w:tblPr/><w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>interna</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    + '</w:tc></w:tr>';
  const xml = '<w:p><w:r><w:t>Antes</w:t></w:r></w:p>'
    + `<w:tbl><w:tblPr/>${filaEncabezado}${filaConAnidada}</w:tbl>`
    + '<w:p><w:r><w:t>Después</w:t></w:r></w:p>';
  // índices: 0 "Antes" · 1 "encabezado" (fila propia de la exterior) · 2 "interna" (fila de la
  // anidada) · 3 "Después".
  const tablasPorIndice = new Map<number, unknown>([[1, { marcador: 'EXTERIOR' }], [2, { marcador: 'ANIDADA' }]]);
  const bloques = construir(xml, { tablasPorIndice });

  assert.equal(bloques.length, 4, `se esperaban 4 bloques (párrafo, 2 tablas, párrafo): ${JSON.stringify(bloques)}`);
  assert.equal(bloques[0].tipo, 'parrafo');
  assert.equal(bloques[1].tipo, 'tabla');
  assert.deepEqual((bloques[1] as BloqueTablaUI<unknown>).tabla, { marcador: 'EXTERIOR' });
  assert.equal(bloques[2].tipo, 'tabla');
  assert.deepEqual((bloques[2] as BloqueTablaUI<unknown>).tabla, { marcador: 'ANIDADA' }, 'la anidada debe salir como SU PROPIO bloque, justo después de la exterior');
  assert.equal(bloques[3].tipo, 'parrafo');
  assert.equal((bloques[3] as BloqueParrafoUI).indice, 3, 'el párrafo de después no debe perder ni duplicar índices por la tabla anidada');
});
