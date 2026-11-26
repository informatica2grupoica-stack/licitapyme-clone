// Neto de una factura con impuesto específico del combustible (OC 4058, opción A; OC 4088 y 4093, hechas a mano). Sin red ni base.
// Correr con: npx tsx --test app/lib/__tests__/obuma-factura-neto.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { netoDeFactura } from '../obuma-factura-neto';

test('con el IVA de la factura: total − IVA (OC 4088, factura 167761)', () => {
  assert.equal(netoDeFactura({ total: 40000, iva: 4439 }), 35561);
});

test('factura guardada sin IVA que vale lo mismo que la OC: usa el IVA de la OC (OC 4058: ÷ 1,19 daba 42.144)', () => {
  const oc = { total: 50150.9, iva: 6803.9 };
  assert.equal(netoDeFactura({ total: 50151 }, oc), 43347);
  assert.equal(netoDeFactura({ total: 50151 }), 42144);   // sin OC no hay forma de saberlo: se divide por 1,19
});

test('factura distinta de la OC (parcial) sin IVA: ÷ 1,19 como siempre', () => {
  assert.equal(netoDeFactura({ total: 119000 }, { total: 238000, iva: 38000 }), 100000);
});

test('OC sin combustible: todo igual que antes', () => {
  assert.equal(netoDeFactura({ total: 8748047 }, { total: 8748047, iva: 1396747 }), 7351300);
  assert.equal(netoDeFactura({ total: null }), 0);
});
