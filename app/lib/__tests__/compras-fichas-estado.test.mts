// Varias fichas en un producto: basta con que un modelo cumpla.
import test from 'node:test';
import assert from 'node:assert/strict';
import { estadoDeProductoConFichas as estado } from '../compras-fichas-estado';

test('si algún modelo cumple, el producto cumple aunque otro no', () => {
  assert.equal(estado(['NO_CUMPLE', 'CUMPLE']), 'CUMPLE');
});
test('«No cumple» solo cuando no cumple ninguno', () => {
  assert.equal(estado(['NO_CUMPLE', 'NO_CUMPLE']), 'NO_CUMPLE');
  assert.equal(estado(['NO_CUMPLE', 'CON_PENDIENTES']), 'CON_PENDIENTES');
  assert.equal(estado(['NO_CUMPLE', 'NO_CORRIDO']), 'NO_CORRIDO');
});
test('sin fichas no hay estado', () => {
  assert.equal(estado([]), null);
});
