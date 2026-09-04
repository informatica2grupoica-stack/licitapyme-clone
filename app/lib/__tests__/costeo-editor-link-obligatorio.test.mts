// El link del producto es OBLIGATORIO en todo ítem ya cotizado del costeo (decisión del usuario,
// 04-sep-2026): sin él, el precio con el que se oferta no tiene de dónde volver a revisarse.
// Correr con:
//   npx tsx --test app/lib/__tests__/costeo-editor-link-obligatorio.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filasSinLink, type EstadoCosteoEditor, type FilaEditorCosteo } from '../costeo-editor';
import { esLinkDeProducto } from '../costeo-comparativo';

const fila = (p: Partial<FilaEditorCosteo> & { id: string }): FilaEditorCosteo => ({
  item: 1, lineaReal: null, detalle: 'Producto', unidad: 'Unidad', skuProveedor: '',
  cantidad: 1, valorConIva: null, costoRealUnitario: null, link1: '', link2: '', link3: '', ...p,
});

const conFilas = (filas: FilaEditorCosteo[], ofertamos = true): EstadoCosteoEditor => ({
  modalidad: 'suma_alzada', margenVenta: 27,
  grupos: [{ nombre: 'Costeo', linea: null, ofertamos, filas }],
});

test('un ítem cotizado sin link bloquea el guardado', () => {
  const faltan = filasSinLink(conFilas([fila({ id: 'a', detalle: 'Plataforma satelital', valorConIva: 3822519 })]));
  assert.equal(faltan.length, 1);
  assert.equal(faltan[0].detalle, 'Plataforma satelital');
});

test('sirve cualquiera de los tres links, no solo el primero', () => {
  for (const campo of ['link1', 'link2', 'link3'] as const) {
    const f = fila({ id: 'a', valorConIva: 100, [campo]: 'https://www.falabella.com/p/12345' });
    assert.equal(filasSinLink(conFilas([f])).length, 0, `${campo} debería alcanzar`);
  }
});

test('una fila todavía sin cotizar se puede guardar sin link — el costeo se llena de a poco', () => {
  // Recién traída del manifiesto de viabilidad: descripción y cantidad, sin precio ni link.
  assert.equal(filasSinLink(conFilas([fila({ id: 'a', detalle: 'Sensor de presión', cantidad: 4 })])).length, 0);
});

test('una hoja que no se oferta no necesita respaldo', () => {
  const f = fila({ id: 'a', valorConIva: 100 });
  assert.equal(filasSinLink(conFilas([f], false)).length, 0);
  assert.equal(filasSinLink(conFilas([f], true)).length, 1);
});

test('una nota en vez de un link no cuenta como respaldo', () => {
  for (const texto of ['pendiente', 'cotizado por mail', 'lo mando el proveedor', '—', 'ver correo']) {
    assert.equal(filasSinLink(conFilas([fila({ id: 'a', valorConIva: 100, link1: texto })])).length, 1, `"${texto}" no es un link`);
  }
});

test('el link se acepta como llegue: con protocolo o pegado a secas', () => {
  assert.ok(esLinkDeProducto('https://www.sodimac.cl/sodimac-cl/product/123'));
  assert.ok(esLinkDeProducto('http://proveedor.cl/ficha?id=9'));
  assert.ok(esLinkDeProducto('falabella.com/p/12345'));         // pegado sin protocolo
  assert.ok(esLinkDeProducto('www.mercadolibre.cl/MLC-99'));
  assert.ok(!esLinkDeProducto(''));
  assert.ok(!esLinkDeProducto('   '));
  assert.ok(!esLinkDeProducto(null));
  assert.ok(!esLinkDeProducto('https://'));                     // protocolo pelado
  assert.ok(!esLinkDeProducto('sodimac'));                      // sin dominio
  assert.ok(!esLinkDeProducto('https://sodimac.cl y otro'));    // una frase no es un link
});

test('reporta todas las que faltan, con su hoja, para poder nombrarlas en el error', () => {
  const estado: EstadoCosteoEditor = {
    modalidad: 'por_linea', margenVenta: 27,
    grupos: [
      { nombre: 'Línea 1', linea: 1, ofertamos: true, filas: [
        fila({ id: 'a', item: 1, detalle: 'Con link', valorConIva: 100, link1: 'https://x.cl/p/1' }),
        fila({ id: 'b', item: 2, detalle: 'Sin link', valorConIva: 200 }),
      ] },
      { nombre: 'Línea 2', linea: 2, ofertamos: true, filas: [
        fila({ id: 'c', item: 1, detalle: '', valorConIva: 300 }),   // sin descripción: se nombra por su fila
      ] },
    ],
  };
  assert.deepEqual(filasSinLink(estado), [
    { hoja: 'Línea 1', item: 2, detalle: 'Sin link' },
    { hoja: 'Línea 2', item: 1, detalle: 'fila 1' },
  ]);
});
