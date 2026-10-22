import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sacarCaracteresSueltos } from '../json-ia';

test('quita un "!" suelto entre dos campos (cotización DARTEL, 22-oct-2026)', () => {
  const crudo = '{"productos":[{"producto":{"tipo":"CONDUIT GALV","modelo":"1 ANSI C80.1",! "sku_proveedor":"237401266"}}]}';
  const r: any = sacarCaracteresSueltos(crudo);
  assert.equal(r.productos[0].producto.sku_proveedor, '237401266');
  assert.equal(r.productos[0].producto.modelo, '1 ANSI C80.1');
});
test('varios caracteres sueltos en el mismo JSON', () => {
  const r: any = sacarCaracteresSueltos('{"a":1,# "b":2,\n ¿ "c":3}');
  assert.deepEqual(r, { a: 1, b: 2, c: 3 });
});
test('JSON roto de verdad (texto cortado) no se inventa: devuelve null', () => {
  assert.equal(sacarCaracteresSueltos('{"a":1,"b":'), null);
  assert.equal(sacarCaracteresSueltos('{"a":1 "b":2}'), null);
  assert.equal(sacarCaracteresSueltos(''), null);
});
