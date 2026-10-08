import test from 'node:test';
import assert from 'node:assert/strict';
import { aplicarDespacho, condicionDesdeLegacy, condicionesPara, esCondicion, esDespacho } from '../compras-despacho';

test('proveedor despacha y cobra el flete aparte (caso ABC): cuesta, pero queda marcado como no incluido', () => {
  assert.deepEqual(aplicarDespacho('PROVEEDOR', 'APARTE', 23512), { incluyeFlete: false, fleteMonto: 23512 });
});

test('proveedor despacha con flete incluido o sin costo: el flete ya está resuelto', () => {
  assert.deepEqual(aplicarDespacho('PROVEEDOR', 'INCLUIDO', 5000), { incluyeFlete: true, fleteMonto: null });
  assert.deepEqual(aplicarDespacho('PROVEEDOR', 'SIN_COSTO', null), { incluyeFlete: true, fleteMonto: null });
});

test('lo retiramos nosotros: sin costo es $0 explícito; por confirmar no inventa monto', () => {
  assert.deepEqual(aplicarDespacho('RETIRO_PROPIO', 'SIN_COSTO', null), { incluyeFlete: false, fleteMonto: 0 });
  assert.deepEqual(aplicarDespacho('RETIRO_PROPIO', 'POR_CONFIRMAR', 9999), { incluyeFlete: false, fleteMonto: null });
  assert.deepEqual(aplicarDespacho('TRANSPORTISTA', 'APARTE', null), { incluyeFlete: false, fleteMonto: null });
});

test('sin condición no cambia lo que había (cotización antigua)', () => {
  assert.deepEqual(aplicarDespacho(null, null, 1200), { incluyeFlete: null, fleteMonto: 1200 });
});

test('«incluido en el precio» solo se ofrece si despacha el proveedor', () => {
  assert.ok(condicionesPara('PROVEEDOR').some(o => o.value === 'INCLUIDO'));
  assert.ok(!condicionesPara('TIENDA').some(o => o.value === 'INCLUIDO'));
  assert.ok(!condicionesPara('RETIRO_PROPIO').some(o => o.value === 'INCLUIDO'));
});

test('cotizaciones antiguas: la condición sale de incluye_flete + flete_monto', () => {
  assert.equal(condicionDesdeLegacy(null, null), '');
  assert.equal(condicionDesdeLegacy(true, null), 'INCLUIDO');
  assert.equal(condicionDesdeLegacy(false, 0), 'SIN_COSTO');
  assert.equal(condicionDesdeLegacy(false, 15000), 'APARTE');
  assert.equal(condicionDesdeLegacy(false, null), 'POR_CONFIRMAR');
});

test('valores desconocidos se rechazan', () => {
  assert.equal(esDespacho('PROVEEDOR'), true);
  assert.equal(esDespacho('COURIER'), false);
  assert.equal(esCondicion('APARTE'), true);
  assert.equal(esCondicion(''), false);
});
