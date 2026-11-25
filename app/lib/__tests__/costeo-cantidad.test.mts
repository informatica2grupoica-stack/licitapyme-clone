// Detección de cambios de CANTIDAD en el costeo digital (aviso a admin + señal roja).
// Correr con:  npx tsx --test app/lib/__tests__/costeo-cantidad.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cambiosDeCantidad } from '../costeo-cantidad';
import type { EstadoCosteoEditor, FilaEditorCosteo } from '../costeo-editor';

const fila = (p: Partial<FilaEditorCosteo> & { id: string }): FilaEditorCosteo => ({
  item: 1, lineaReal: null, detalle: 'X', unidad: 'UN', skuProveedor: '',
  cantidad: null, valorConIva: null, costoRealUnitario: null, link1: '', link2: '', link3: '', ...p,
});
const estado = (filas: FilaEditorCosteo[]): EstadoCosteoEditor => ({
  modalidad: 'suma_alzada', margenVenta: 30, grupos: [{ nombre: 'Costeo', linea: null, ofertamos: true, filas }],
});

test('sin guardado previo no hay con qué comparar', () => {
  assert.deepEqual(cambiosDeCantidad(null, estado([fila({ id: 'a', cantidad: 5 })])), []);
});

test('cantidad distinta en un ítem que ya existía', () => {
  const antes = estado([fila({ id: 'a', detalle: 'Taladro', cantidad: 5 }), fila({ id: 'b', detalle: 'Broca', cantidad: 2 })]);
  const despues = estado([fila({ id: 'a', detalle: 'Taladro', cantidad: 8 }), fila({ id: 'b', detalle: 'Broca', cantidad: 2 })]);
  assert.deepEqual(cambiosDeCantidad(antes, despues), ['«Taladro»: 5 → 8']);
});

test('cambiar precio, link o detalle no es cambiar la cantidad', () => {
  const antes = estado([fila({ id: 'a', cantidad: 5, valorConIva: 1000 })]);
  const despues = estado([fila({ id: 'a', cantidad: 5, valorConIva: 2000, link1: 'https://x.cl', detalle: 'Otro' })]);
  assert.deepEqual(cambiosDeCantidad(antes, despues), []);
});

test('agregar o quitar un ítem no cuenta; la cantidad pasa de vacío a número sí', () => {
  const antes = estado([fila({ id: 'a', detalle: 'Sierra', cantidad: null }), fila({ id: 'b', cantidad: 1 })]);
  const despues = estado([fila({ id: 'a', detalle: 'Sierra', cantidad: 3 }), fila({ id: 'c', cantidad: 9 })]);
  assert.deepEqual(cambiosDeCantidad(antes, despues), ['«Sierra»: vacío → 3']);
});

test('los costos adicionales no llevan cantidad', () => {
  const antes = estado([fila({ id: 'a', esCostoAdicional: true, cantidad: 1 })]);
  const despues = estado([fila({ id: 'a', esCostoAdicional: true, cantidad: 4 })]);
  assert.deepEqual(cambiosDeCantidad(antes, despues), []);
});

test('un ítem que cambia de hoja con otra cantidad se detecta igual (se empareja por id)', () => {
  const antes: EstadoCosteoEditor = { modalidad: 'por_linea', margenVenta: 30, grupos: [
    { nombre: 'LINEA1', linea: 1, ofertamos: true, filas: [fila({ id: 'a', detalle: 'Casco', cantidad: 10 })] },
    { nombre: 'LINEA2', linea: 2, ofertamos: true, filas: [] },
  ] };
  const despues: EstadoCosteoEditor = { modalidad: 'por_linea', margenVenta: 30, grupos: [
    { nombre: 'LINEA1', linea: 1, ofertamos: true, filas: [] },
    { nombre: 'LINEA2', linea: 2, ofertamos: true, filas: [fila({ id: 'a', detalle: 'Casco', cantidad: 12 })] },
  ] };
  assert.deepEqual(cambiosDeCantidad(antes, despues), ['«Casco»: 10 → 12']);
});
