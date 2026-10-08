import test from 'node:test';
import assert from 'node:assert/strict';
import { mismoProveedor } from '../compras-directas';

test('mismo proveedor: mismo RUT (con o sin puntos), o mismo nombre si no hay RUT', () => {
  assert.equal(mismoProveedor({ nombre: 'ABC SA', rut: '96.874.559-K' }, { nombre: 'ABC S.A.', rut: '96874559-k' }), true);
  assert.equal(mismoProveedor({ nombre: 'ABC SA', rut: null }, { nombre: 'abc sa', rut: '96.874.559-K' }), true);
  assert.equal(mismoProveedor({ nombre: 'ABC SA', rut: '96.874.559-K' }, { nombre: 'ABC SA', rut: '76.000.111-2' }), false);
  assert.equal(mismoProveedor({ nombre: 'Sodimac', rut: null }, { nombre: 'Easy', rut: null }), false);
});
