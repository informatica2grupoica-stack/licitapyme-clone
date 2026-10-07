//   npx tsx --test app/lib/__tests__/compras-precio-vs-costeo.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compararPrecioConCosteo, textoComparacionPrecio } from '../compras-precio-vs-costeo';

test('más barata que lo costeado', () => {
  const c = compararPrecioConCosteo(13_622_000, 14_700_000);
  assert.equal(c.veredicto, 'MEJOR'); assert.equal(c.diffMonto, -1_078_000); assert.equal(c.diffPct, -7.3);
});
test('más cara que lo costeado', () => {
  const c = compararPrecioConCosteo(7_500_000, 6_990_000);
  assert.equal(c.veredicto, 'PEOR'); assert.equal(c.diffMonto, 510_000); assert.equal(c.diffPct, 7.3);
});
test('±1 % es igual', () => {
  assert.equal(compararPrecioConCosteo(100_500, 100_000).veredicto, 'IGUAL');
  assert.equal(compararPrecioConCosteo(99_200, 100_000).veredicto, 'IGUAL');
  assert.equal(compararPrecioConCosteo(101_500, 100_000).veredicto, 'PEOR');
});
test('sin costo o sin precio no se inventa nada', () => {
  assert.equal(compararPrecioConCosteo(null, 100).veredicto, 'SIN_COMPARAR');
  assert.equal(compararPrecioConCosteo(100, null).veredicto, 'SIN_COMPARAR');
  assert.equal(compararPrecioConCosteo(100, 0).veredicto, 'SIN_COMPARAR');
  assert.equal(compararPrecioConCosteo(0, 100).veredicto, 'SIN_COMPARAR');
});
test('el texto dice cuánto y en qué sentido', () => {
  const m = compararPrecioConCosteo(13_622_000, 14_700_000);
  assert.match(textoComparacionPrecio(m, 13_622_000, 14_700_000), /MÁS BARATA.*1\.078\.000.*7,3 % menos/);
  const p = compararPrecioConCosteo(7_500_000, 6_990_000);
  assert.match(textoComparacionPrecio(p, 7_500_000, 6_990_000), /MÁS CARA.*510\.000.*7,3 % más/);
});
test('si falta algo, dice qué falta', () => {
  assert.match(textoComparacionPrecio(compararPrecioConCosteo(null, 100), null, 100), /no tiene un precio asignado/);
  assert.match(textoComparacionPrecio(compararPrecioConCosteo(100, null), 100, null), /no tiene un costo/);
});
test('una diferencia enorme avisa que probablemente es otro producto', () => {
  const c = compararPrecioConCosteo(13_622_000, 753_811);
  assert.match(textoComparacionPrecio(c, 13_622_000, 753_811), /OTRO producto/);
  assert.doesNotMatch(textoComparacionPrecio(compararPrecioConCosteo(13_622_000, 14_700_000), 13_622_000, 14_700_000), /OTRO producto/);
});

import { precioEfectivo, totalAdicionales } from '../compras-precio-vs-costeo';
test('adicionales: horno + quemador y carro + 15 bandejas (caso real 457)', () => {
  assert.equal(precioEfectivo(12_000_000, [{ concepto: 'Quemador', cantidad: 1, precioUnitario: 800_000 }]), 12_800_000);
  assert.equal(precioEfectivo(485_000, [{ concepto: 'Bandejas', cantidad: 15, precioUnitario: 20_500 }]), 792_500);
  assert.equal(totalAdicionales([{ concepto: 'a', cantidad: 2, precioUnitario: 100 }, { concepto: 'b', cantidad: 1, precioUnitario: 50 }]), 250);
});
test('adicionales: sin base no hay precio, sin adicionales es el base, basura se ignora', () => {
  assert.equal(precioEfectivo(null, [{ concepto: 'x', cantidad: 1, precioUnitario: 5 }]), null);
  assert.equal(precioEfectivo(1000, []), 1000);
  assert.equal(totalAdicionales([{ concepto: 'x', cantidad: NaN, precioUnitario: 5 }]), 0);
});
