// El patrón con que proxy.ts reconoce un negocio de Compras en la URL (para el filtro por empresa).
import { test } from 'node:test';
import assert from 'node:assert/strict';
const RE = /^\/(?:api\/)?compras\/(\d+)(?:\/|$)/;
test('reconoce /compras/<id> y /api/compras/<id>/… y nada más', () => {
  assert.equal('/compras/1191'.match(RE)?.[1], '1191');
  assert.equal('/api/compras/1191/cotizaciones/5'.match(RE)?.[1], '1191');
  assert.equal('/api/compras/708'.match(RE)?.[1], '708');
  for (const u of ['/compras', '/compras/proveedores', '/api/compras/dashboard', '/api/compras/gastos/categorias', '/comprasx/12', '/api/compras/12abc'])
    assert.equal(RE.test(u), false, u);
});
