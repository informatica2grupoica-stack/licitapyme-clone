// «Unidades para este negocio» (migration-184), con los números reales de la OC 3811 (negocio 256). Sin red ni base.
// Correr con: npx tsx --test app/lib/__tests__/oc-unidades-negocio.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descontarUnidadesAjenas, netoDeCompra, type CompraObumaFila } from '../obuma-compras';
import { claveLineaOc } from '../compras-oc-lineas-negocio';

const oc3811 = (): CompraObumaFila => ({
  compraOcId: '271495', folio: '3811', fechaIngreso: null, referencia: null, estado: 'FACTURADA',
  subtotal: 0, neto: 0, iva: 0, total: 6942245, proveedorRut: null, proveedorRazonSocial: 'NINGBO', proveedorObumaId: '198850',
  items: [
    { descripcion: 'RL-900DZ KAMA 186FE 10HP', cantidad: 2, precio: 3300400, subtotal: 6600800, lineaId: '1437752' },
    { descripcion: 'SPARE PART AIR FILTER', cantidad: 6, precio: 26970, subtotal: 161820, lineaId: '1437754' },
  ],
  facturas: [], excluidoNeto: 0, totalOriginal: null, internacional: true, din: ['2850014688'],
});

test('OC exenta (3811): 1 de 2 rodillos descuenta $3.300.400 del costo', () => {
  const aj = new Map([[claveLineaOc('271495', '1437752'), { cantidadTotal: 2, cantidadNegocio: 1, nota: 'stock' }]]);
  const r = descontarUnidadesAjenas(oc3811(), aj);
  assert.equal(netoDeCompra(r), 6942245 - 3300400);
  assert.equal(r.excluidoNeto, 3300400);
  assert.equal(r.totalOriginal, 6942245);
  assert.equal(r.items[0].cantidadNegocio, 1);
  assert.equal(r.subtotal, 0);   // exenta: el subtotal 0 no se vuelve negativo
});

test('OC con IVA: descuenta también el 19 %', () => {
  const c = { ...oc3811(), subtotal: 1000, neto: 1000, iva: 190, total: 1190, items: [{ descripcion: 'x', cantidad: 2, precio: 500, subtotal: 1000, lineaId: '1' }] };
  const r = descontarUnidadesAjenas(c, new Map([[claveLineaOc('271495', '1'), { cantidadTotal: 2, cantidadNegocio: 1, nota: null }]]));
  assert.equal(Math.round(netoDeCompra(r)), 500);
  assert.equal(Math.round(r.total!), 595);
});

test('sin ajuste, o con todas las unidades, no cambia nada', () => {
  const c = oc3811();
  assert.equal(descontarUnidadesAjenas(c, new Map()), c);
  const todas = new Map([[claveLineaOc('271495', '1437752'), { cantidadTotal: 2, cantidadNegocio: 2, nota: null }]]);
  assert.equal(netoDeCompra(descontarUnidadesAjenas(c, todas)), 6942245);
});

test('más unidades que las de la OC se acotan al máximo (no suma costo negativo)', () => {
  const aj = new Map([[claveLineaOc('271495', '1437752'), { cantidadTotal: 2, cantidadNegocio: 9, nota: null }]]);
  assert.equal(netoDeCompra(descontarUnidadesAjenas(oc3811(), aj)), 6942245);
});
