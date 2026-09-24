// Precio guardado por producto al homologar (bug del $0 de la calibración, proforma PanTai).
//   npx tsx --test app/lib/__tests__/compras-precio-homologacion.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { precioClpDeItemIA } from '../compras-precio-homologacion';

const base = { tipoCambio: 959.39, precioClpCotizacion: 3_741_621, totalItemsAsignados: 2 };

test('caso real PanTai: la IA devuelve null para la calibración → sin precio, NO $0', () => {
  assert.equal(precioClpDeItemIA({ ...base, precioUnitarioAsignado: null }), null);
  assert.equal(precioClpDeItemIA({ ...base, precioUnitarioAsignado: undefined }), null);
  assert.equal(precioClpDeItemIA({ ...base, precioUnitarioAsignado: '' }), null);
  assert.equal(precioClpDeItemIA({ ...base, precioUnitarioAsignado: 0 }), null);
  assert.equal(precioClpDeItemIA({ ...base, precioUnitarioAsignado: 'n/a' }), null);
});

test('precio propio en USD se convierte con el tipo de cambio congelado (Konica: 1.360 USD = $1.304.770)', () => {
  assert.equal(precioClpDeItemIA({ ...base, precioUnitarioAsignado: 1360 }), 1_304_770);
  assert.equal(precioClpDeItemIA({ ...base, precioUnitarioAsignado: '3900' }), 3_741_621);
});

test('documento en CLP: el precio propio se guarda tal cual (Ferrecert)', () => {
  assert.equal(precioClpDeItemIA({ precioUnitarioAsignado: 152_915, tipoCambio: null, precioClpCotizacion: 152_915, totalItemsAsignados: 1 }), 152_915);
});

test('un solo producto sin precio propio: usa el precio de la cotización (comportamiento de siempre)', () => {
  assert.equal(precioClpDeItemIA({ precioUnitarioAsignado: null, tipoCambio: 959.39, precioClpCotizacion: 4_699_092, totalItemsAsignados: 1 }), 4_699_092);
  assert.equal(precioClpDeItemIA({ precioUnitarioAsignado: null, tipoCambio: null, precioClpCotizacion: null, totalItemsAsignados: 1 }), null);
});

test('varios productos y uno sin precio propio: NO se le copia el precio de la cabecera', () => {
  assert.equal(precioClpDeItemIA({ ...base, precioUnitarioAsignado: null, totalItemsAsignados: 3 }), null);
});

test('valores raros no llegan como NaN ni como negativo', () => {
  assert.equal(precioClpDeItemIA({ ...base, precioUnitarioAsignado: -50 }), null);
  assert.equal(precioClpDeItemIA({ ...base, precioUnitarioAsignado: true }), null);
  assert.equal(precioClpDeItemIA({ ...base, precioUnitarioAsignado: NaN }), null);
});
