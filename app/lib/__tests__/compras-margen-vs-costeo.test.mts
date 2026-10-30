// Margen del costeo inicial vs margen con las cotizaciones (27-oct-2026, pedido de Carolina). Misma venta en los dos lados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { margenCosteoVsCotizaciones, type EntradaMargen } from '../compras-margen-vs-costeo';

const e = (id: number, cantidad: number, venta: number | null, costeo: number | null, cotizado: number | null, proveedor: string | null = 'Prov'): EntradaMargen =>
  ({ id, descripcion: `Producto ${id}`, cantidad, venta, costeo, cotizado, proveedor });

test('margen inicial y con cotizaciones: misma venta, solo cambia el costo de lo cotizado', () => {
  const r = margenCosteoVsCotizaciones([
    e(1, 2, 1000, 800, 700),   // cotizada más barata: venta 2.000, costo 1.600 → 1.400
    e(2, 1, 500, 400, null),   // sin cotizar: se queda al costo costeado
  ]);
  assert.equal(r.total.venta, 2500);
  assert.equal(r.total.costoInicial, 2000);
  assert.equal(r.total.costoNuevo, 1800);
  assert.equal(r.total.margenInicial, 500);
  assert.equal(r.total.margenNuevo, 700);
  assert.equal(r.total.pctInicial, 20);            // 500 / 2.500 sobre la venta
  assert.equal(r.total.pctNuevo, 28);              // 700 / 2.500
  assert.equal(r.total.puntos, 8);
  assert.equal(r.total.recargoInicial, 25);        // 500 / 2.000 sobre el costo
  assert.equal(r.cotizadas.n, 1);
  assert.equal(r.sinCotizar.n, 1);
  assert.equal(r.sinCotizar.margenInicial, r.sinCotizar.margenNuevo, 'lo sin cotizar no cambia de margen');
});

test('la suma de las líneas es exactamente el total (las líneas se redondean a pesos antes de sumar)', () => {
  const r = margenCosteoVsCotizaciones([e(1, 3, 333.4, 200.2, 190.7), e(2, 7, 99.9, 70.3, 71.1)]);
  assert.equal(r.total.venta, r.lineas.reduce((s, l) => s + l.venta, 0));
  assert.equal(r.total.costoNuevo, r.lineas.reduce((s, l) => s + l.costoNuevo, 0));
  assert.equal(r.total.margenNuevo, r.total.venta - r.total.costoNuevo);
});

test('una cotización más cara que lo costeado baja el margen y se cuenta', () => {
  const r = margenCosteoVsCotizaciones([e(1, 1, 1000, 800, 900), e(2, 1, 1000, 800, 700)]);
  assert.equal(r.conMenosMargen, 1);
  assert.equal(r.lineas[0].margenNuevo, 100);
  assert.equal(r.lineas[0].puntos, -10);
  assert.equal(r.lineas[1].puntos, 10);
});

test('sin precio de venta o sin costo costeado la línea no entra al margen, pero se cuenta', () => {
  const r = margenCosteoVsCotizaciones([e(1, 1, 1000, 800, 700), e(2, 1, null, 400, 300), e(3, 1, 500, null, 300), e(4, 1, 0, 100, null)]);
  assert.equal(r.lineas.length, 1);
  assert.equal(r.sinVenta, 2);
  assert.equal(r.sinCosteo, 1);
});

test('sin ninguna línea con venta y costeo: todo en cero y porcentajes null, sin dividir por cero', () => {
  const r = margenCosteoVsCotizaciones([e(1, 1, null, 400, 300)]);
  assert.equal(r.total.venta, 0);
  assert.equal(r.total.pctInicial, null);
  assert.equal(r.total.puntos, null);
});

test('un costo cotizado de 0 no cuenta como cotización (precio no leído)', () => {
  const r = margenCosteoVsCotizaciones([e(1, 1, 1000, 800, 0)]);
  assert.equal(r.lineas[0].cotizada, false);
  assert.equal(r.lineas[0].margenNuevo, r.lineas[0].margenInicial);
});

test('costeo de Compras: margen con sus costos; la línea que Compras no costeó cuenta al costo inicial', () => {
  const r = margenCosteoVsCotizaciones([
    { id: 1, descripcion: 'A', cantidad: 2, venta: 150, costeo: 100, cotizado: null, proveedor: null, compras: 120 },
    { id: 2, descripcion: 'B', cantidad: 1, venta: 200, costeo: 100, cotizado: null, proveedor: null },
  ]);
  assert.equal(r.total.nCompras, 1);
  assert.equal(r.total.costoCompras, 240 + 100);          // A: 120×2; B sigue al costo inicial
  assert.equal(r.total.margenCompras, 500 - 340);
  assert.equal(r.total.pctCompras, 32);
  assert.equal(r.total.puntosCompras, -8);                 // inicial 500-300=200 → 40 %
});
