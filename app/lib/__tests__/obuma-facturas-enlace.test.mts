// Formatos reales de `compra_oc_facturada_tipo_dcto` vistos en Obuma (nov-2026). Sin red.
// Correr con: npx tsx --test app/lib/__tests__/obuma-facturas-enlace.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paresFacturaDeOc } from '../obuma-facturas-enlace';

const p = (tipoDcto: string, folioDte: string) => ({ tipoDcto, folioDte });

test('formato clásico 33#folio', () => {
  assert.deepEqual(paresFacturaDeOc(',33#101006'), [p('33', '101006')]);
});

test('formato con T y espacios (OC 4035 ELECTROCOM)', () => {
  assert.deepEqual(paresFacturaDeOc(',T33 # 7280216'), [p('33', '7280216')]);
  assert.deepEqual(paresFacturaDeOc(',T34 # 5029'), [p('34', '5029')]);
});

test('la misma factura en los dos formatos cuenta una vez (OC 4020)', () => {
  assert.deepEqual(paresFacturaDeOc(',T33 # 5039,33#5039'), [p('33', '5039')]);
  assert.deepEqual(paresFacturaDeOc(',33#493072,33#493072'), [p('33', '493072')]);
});

test('varias facturas y basura alrededor (OC 3971, 4008)', () => {
  assert.deepEqual(paresFacturaDeOc(',33#1068172,33#1068541,T33 # 1068541'), [p('33', '1068172'), p('33', '1068541')]);
  assert.deepEqual(paresFacturaDeOc('#,T33 # 57'), [p('33', '57')]);
});

test('vacío o sin pares', () => {
  assert.deepEqual(paresFacturaDeOc(''), []);
  assert.deepEqual(paresFacturaDeOc(null), []);
  assert.deepEqual(paresFacturaDeOc(','), []);
});
