// Tests de la lectura de MARCA / MODELO / FABRICANTE desde la ficha del proveedor.
// El caso real es 611669-17-LE26 (LUMINANCÍMETROS, "Ficha tecnica original LS-150.pdf").
// Correr con:
//   npx tsx --test app/lib/__tests__/producto-ofertado.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extraerProductoOfertado, marcaDesdeDominio, modeloDesdeEncabezado,
  modeloDesdeNombreArchivo, tieneAlgo,
} from '../producto-ofertado';

// ─── FICHA TABULADA: lo etiquetado manda ──────────────────────────────────────────────────────
test('lee las etiquetas en castellano', () => {
  const p = extraerProductoOfertado([
    'ESPECIFICACIONES',
    'Marca: Bosch',
    'Modelo: GWS 750-125',
    'Fabricante: Robert Bosch GmbH',
    'País de fabricación: Alemania',
  ].join('\n'));
  assert.equal(p.marca, 'Bosch');
  assert.equal(p.modelo, 'GWS 750-125');
  assert.equal(p.fabricante, 'Robert Bosch GmbH');
  assert.equal(p.paisFabricacion, 'Alemania');
});

test('lee las etiquetas en inglés (las fichas de fábrica vienen así)', () => {
  const p = extraerProductoOfertado('Brand: Konica Minolta\nModel: LS-150\nMade in: Japan');
  assert.equal(p.marca, 'Konica Minolta');
  assert.equal(p.modelo, 'LS-150');
  assert.equal(p.paisFabricacion, 'Japan');
});

test('acepta el valor en el renglón siguiente (tablas que se parten al extraer)', () => {
  const p = extraerProductoOfertado('Marca:\nKonica Minolta\nModelo:\nLS-150');
  assert.equal(p.marca, 'Konica Minolta');
  assert.equal(p.modelo, 'LS-150');
});

// Riesgo real: "equivalente a la marca Bosch" es lo que piden las BASES, no lo que ofertamos.
// Copiarlo sería declarar ante el organismo una marca que quizá no vamos a entregar.
test('NO toma la marca cuando aparece a mitad de una frase', () => {
  // La etiqueta tiene que abrir el renglón. "…equivalente a la marca: Bosch" es lo que piden las
  // BASES como referencia, no lo que ofertamos: tomarlo sería declarar ante el organismo una marca
  // que quizá no vamos a entregar.
  assert.equal(extraerProductoOfertado('El equipo debe ser equivalente a la marca: Bosch o superior').marca, null);
  assert.equal(extraerProductoOfertado('Se aceptan equipos de marca Bosch o equivalente').marca, null);
  // Al principio del renglón sí es una etiqueta de la ficha.
  assert.equal(extraerProductoOfertado('Marca: Bosch').marca, 'Bosch');
});

test('un rótulo vacío o con guion no cuenta como dato', () => {
  for (const v of ['Marca: ---', 'Marca: N/A', 'Marca:   ', 'Marca: s/i']) {
    assert.equal(extraerProductoOfertado(v).marca, null, v);
  }
});

test('no toma frases largas como si fueran la marca', () => {
  const largo = 'Marca: ' + 'x'.repeat(120);
  assert.equal(extraerProductoOfertado(largo).marca, null);
});

// ─── FOLLETO COMERCIAL: el caso real, sin etiquetas ───────────────────────────────────────────
// La ficha del LS-150 no dice "Marca:" en ninguna parte — la palabra "marca" solo aparece en
// "marcas registradas". Hay que leer las señales que el folleto sí trae.
const FOLLETO = [
  '[[PÁGINA 1]]',
  'Medidor de Luminancia LS-150',
  'Nuevos modelos con mayor precisión y comodidad!',
  'El Medidor de Luminancia LS-150 mide luminancia de 0.001 a 999,900 cd/m2.',
  '',
  'KONICA MINOLTA, el logo de Konica Minolta y su símbolo de marca son marcas registradas.',
  '101 WILLIAMS DRIVE, RAMSEY, NJ 07446 • SENSING.KONICAMINOLTA.COM',
].join('\n');

test('caso real: saca la marca del sitio web del fabricante', () => {
  assert.equal(marcaDesdeDominio(FOLLETO), 'Konica Minolta');
});

// El dominio dice CUÁL es la marca; el texto dice CÓMO se escribe. Sin esto quedaría
// "KONICAMINOLTA" todo junto, que es feo en un documento que presenta el organismo.
test('usa la grafía separada que trae el propio texto', () => {
  assert.equal(marcaDesdeDominio('visita SENSING.KONICAMINOLTA.COM'), 'KONICAMINOLTA');
  assert.equal(marcaDesdeDominio('Konica Minolta · SENSING.KONICAMINOLTA.COM'), 'Konica Minolta');
});

test('ignora subdominios y dominios que no dicen nada de la marca', () => {
  assert.equal(marcaDesdeDominio('escribir a ventas@gmail.com'), null);
  assert.equal(marcaDesdeDominio('www.youtube.com/watch'), null);
});

test('caso real completo: marca, fabricante y modelo del folleto', () => {
  const p = extraerProductoOfertado(FOLLETO, 'Ficha tecnica original LS-150.pdf');
  assert.equal(p.marca, 'Konica Minolta');
  assert.equal(p.fabricante, 'Konica Minolta');
  assert.equal(p.modelo, 'LS-150');
  // El folleto NO dice país ni año: quedan vacíos, no se inventan.
  assert.equal(p.paisFabricacion, null);
  assert.equal(p.anioFabricacion, null);
});

// ─── MODELO ───────────────────────────────────────────────────────────────────────────────────
test('saca el modelo del encabezado cuando hay uno solo', () => {
  assert.equal(modeloDesdeEncabezado('Medidor de Luminancia LS-150\nAlta precisión'), 'LS-150');
});

// Un folleto de dos equipos no dice cuál ofertamos: eso es una decisión comercial, no algo que se
// deduzca del documento. Ante la duda no elige.
test('con varios modelos en el encabezado NO elige ninguno', () => {
  assert.equal(modeloDesdeEncabezado('Medidor de Luminancia LS-150/LS-160'), null);
});

test('saca el modelo del nombre del archivo como último recurso', () => {
  assert.equal(modeloDesdeNombreArchivo('Ficha tecnica original LS-150.pdf'), 'LS-150');
  assert.equal(modeloDesdeNombreArchivo('catalogo general.pdf'), null);
});

// Lo etiquetado siempre le gana a la deducción: si la ficha DICE el modelo, se usa ese.
test('el dato etiquetado le gana al nombre del archivo', () => {
  const p = extraerProductoOfertado('Modelo: LS-160', 'Ficha tecnica original LS-150.pdf');
  assert.equal(p.modelo, 'LS-160');
});

test('sin ninguna señal, todo queda en null', () => {
  const p = extraerProductoOfertado('Documento sin datos de producto.');
  assert.equal(tieneAlgo(p), false);
  assert.deepEqual(p, { marca: null, modelo: null, fabricante: null, paisFabricacion: null, anioFabricacion: null });
});
