// Lectura del presupuesto: casos reales de la auditoría del 29-oct-2026 sobre 1.133 informes v4.
//   npx tsx --test app/lib/__tests__/presupuesto-lectura-montos.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretarMonto, interpretarPorLinea, escalarLineasEnMiles, brutoDesdeTexto, sumaLineasCuadra } from '../viabilidad-v4/presupuesto';
import * as cv from '../cv/v4/presupuesto';

test('una frase sin cifra no es un monto: el N° del numeral no es el presupuesto (2905-52-LE26)', () => {
  assert.equal(interpretarMonto('Monto disponible: El monto disponible para cada línea se encuentra específicado en el numeral 13 de las presentes Bases de Litación').pesos, null);
  // Lo que sí sigue siendo monto.
  assert.equal(interpretarMonto('52000000').pesos, 52_000_000);
  assert.equal(interpretarMonto('$ 10.710.-').pesos, 10_710);
  assert.equal(interpretarMonto('VALOR SUBTOTAL IVA INCLUIDO 77.611').pesos, 77_611);
  assert.equal(interpretarMonto('$52 millones').pesos, 52_000_000);
});

test('montos por línea en miles sin «M$» se escalan cuando la suma ×1.000 da el total (1057898-88-LP26)', () => {
  const l = interpretarPorLinea(['10.710', '19.040', '2.042', '15.102', '19.040', '6.412'].map((m, i) => ({ linea: `L${i + 1}`, monto_texto: `$ ${m}.-` })), false);
  assert.equal(escalarLineasEnMiles(l, 72_345_000), true);
  assert.deepEqual(l.map(x => x.monto_pesos), [10_710_000, 19_040_000, 2_042_000, 15_102_000, 19_040_000, 6_412_000]);
  assert.equal(l[0].neto, Math.round(10_710 / 1.19) * 1000);
  assert.equal(sumaLineasCuadra(l, 72_345_000), true);
});

test('no escala si la suma no da el total o si ya hay montos en millones', () => {
  // 1002588-103-LE26: líneas reales en pesos, suman el total sin multiplicar.
  const ok = interpretarPorLinea([{ linea: 'L1', monto_texto: '$3.099.971.-' }, { linea: 'L2', monto_texto: '$1.675.544.-' }, { linea: 'L3', monto_texto: '$12.224.485.-' }], false);
  assert.equal(escalarLineasEnMiles(ok, 17_000_000), false);
  // 2905-52-LE26: precios chicos de verdad, el total no es la suma ×1.000.
  const chicos = interpretarPorLinea([{ linea: 'L1', monto_texto: '$832.203' }, { linea: 'L2', monto_texto: '$74.492' }], false);
  assert.equal(escalarLineasEnMiles(chicos, 17_917_360), false);
  assert.equal(escalarLineasEnMiles(chicos, null), false);
});

test('el texto citado manda sobre el bruto del modelo (2711-19-LP26, 1057898-74-LE26, 1063534-9-LE26)', () => {
  assert.deepEqual(brutoDesdeTexto('$72.911.000', 61_163_293.28, false), { bruto: 72_911_000, cambia: true, miles: false });
  assert.equal(brutoDesdeTexto('$14.544.000.-', 17_287_376, false)!.bruto, 14_544_000);
  assert.equal(brutoDesdeTexto('$14.129.000.- IVA incluido', 14_271_899, false)!.cambia, true);
  // Igual (±1 %) o sin cifra: no cambia nada.
  assert.equal(brutoDesdeTexto('$28.003.098', 28_003_098, false)!.cambia, false);
  assert.equal(brutoDesdeTexto('según numeral 13 de las bases', 13, false), null);
  // "M$" y puntos de miles leídos como decimal (casos anteriores, siguen igual).
  assert.equal(brutoDesdeTexto('M$ 872.079', 872_079, false)!.bruto, 872_079_000);
  assert.equal(brutoDesdeTexto('$28.003.098', 28.003098, false)!.bruto, 28_003_098);
  // Texto en NETO: el bruto es el texto × 1,19; si es exento, el texto tal cual.
  assert.equal(brutoDesdeTexto('$10.000.000 neto', null, false)!.bruto, 11_900_000);
  assert.equal(brutoDesdeTexto('$10.000.000 neto', null, true)!.bruto, 10_000_000);
});

test('un monto por línea «(neto)» queda CON IVA en monto_pesos y su neto no se descuenta dos veces (1488-39-LE26)', () => {
  const [l] = interpretarPorLinea([{ linea: 'L1', monto_texto: '$11.400.000 (neto)' }], false);
  assert.equal(l.neto, 11_400_000);
  assert.equal(l.monto_pesos, Math.round(11_400_000 * 1.19));
  // Las 6 líneas netas ahora cuadran con el total IVA incluido ($36.271.200 = $30.480.000 × 1,19).
  const seis = interpretarPorLinea(['11.400.000', '11.400.000', '780.000', '600.000', '500.000', '5.800.000'].map((m, i) => ({ linea: `L${i + 1}`, monto_texto: `$${m} (neto)` })), false);
  assert.equal(sumaLineasCuadra(seis, 36_271_200), true);
  // Exento: sin IVA que sumar ni restar.
  assert.equal(interpretarPorLinea([{ linea: 'L1', monto_texto: '$11.400.000 (neto)' }], true)[0].monto_pesos, 11_400_000);
});

test('la copia cv/v4 se comporta igual', () => {
  assert.equal(cv.interpretarMonto('…en el numeral 13 de las presentes Bases').pesos, null);
  assert.equal(cv.brutoDesdeTexto('$72.911.000', 61_163_293, false)!.bruto, 72_911_000);
});

test('con dos montos en el texto no se elige ninguno: queda el del modelo (4697-25-LP26, 948354-149-LE26)', () => {
  assert.equal(brutoDesdeTexto('LINEA 1 EQUIPOS $36.419.000.- LINEA 2 EQUIPAMIENTO $46.882.000.-', 83_301_000, false), null);
  assert.equal(brutoDesdeTexto('$20.168.067.- Valor neto $24.000.000.- con impuestos incluidos', 24_000_000, false), null);
  // El mismo monto repetido (cifra + glosa) sigue siendo uno.
  assert.equal(brutoDesdeTexto('$ 17.000.000.- (Diecisiete millones de pesos) IVA incluido. Total $17.000.000', 17_000_000, false)!.cambia, false);
});
