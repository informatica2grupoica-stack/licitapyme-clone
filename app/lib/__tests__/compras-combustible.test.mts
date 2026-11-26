// Gasto extra «Combustible»: números reales de la OC 4058 (387-55-LE26, factura 33 N° 186536). Sin red ni base.
// Correr con: npx tsx --test app/lib/__tests__/compras-combustible.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avisosCarga, calcularCarga, cuadraConFactura, lineasOcCombustible, normalizarPatente, parsearLitros, totalesOc, validarCarga, type CargaCombustible } from '../compras-combustible-core';

const c4058: CargaCombustible = { tipo: 'DIESEL', litros: 40, netoAfecto: 35810, impuestoEspecifico: 7537, patente: 'ab-cd12' };

test('la carga de la OC 4058 cuadra con la factura 186536 ($50.151)', () => {
  const r = calcularCarga(c4058);
  assert.equal(r.iva, 6804);
  assert.equal(r.totalFactura, 50151);
  assert.equal(r.costo, 43347);                       // neto + impuesto: lo que cuesta de verdad (el IVA es crédito)
  assert.ok(cuadraConFactura(c4058, 50151));
  assert.ok(!cuadraConFactura(c4058, 50400));
});

test('validación: tipo, litros, enteros y patente', () => {
  assert.equal(validarCarga(c4058), null);
  assert.match(validarCarga({ ...c4058, litros: 0 })!, /litros/);
  assert.match(validarCarga({ ...c4058, netoAfecto: 0 })!, /neto/);
  assert.match(validarCarga({ ...c4058, netoAfecto: 35810.5 })!, /enteros/);
  assert.match(validarCarga({ ...c4058, impuestoEspecifico: -1 })!, /impuesto/);
  assert.match(validarCarga({ ...c4058, patente: 'X' })!, /patente/);
  assert.equal(validarCarga({ ...c4058, patente: '' }), null);
  assert.equal(validarCarga({ ...c4058, impuestoEspecifico: 0 }), null);
  assert.match(validarCarga({ ...c4058, tipo: 'AGUA' as any })!, /tipo/);
});

test('patente se normaliza', () => assert.equal(normalizarPatente(' ab-cd.12 '), 'ABCD12'));

test('líneas de la OC: combustible afecto + «impuesto especifico» exento, igual que la 4058', () => {
  const l = lineasOcCombustible(c4058, 'COMBUSTIBLE INTERNO');
  assert.equal(l.length, 2);
  assert.deepEqual([l[0].nombre, l[0].precioUnitarioNeto, l[0].exento], ['COMBUSTIBLE INTERNO', 35810, false]);
  assert.deepEqual([l[1].nombre, l[1].precioUnitarioNeto, l[1].exento], ['IMPUESTO ESPECIFICO', 7537, true]);
  assert.match(l[0].descripcion!, /40 L de Diésel · patente ABCD12/);
  assert.equal(lineasOcCombustible({ ...c4058, impuestoEspecifico: 0 }, 'X').length, 1);   // sin impuesto no se inventa la línea
});

test('totales de la OC: el IVA solo sobre lo afecto; reproduce los montos de la 4058', () => {
  const lineas = lineasOcCombustible(c4058, 'COMBUSTIBLE INTERNO').map(x => ({ subtotal: x.cantidad * x.precioUnitarioNeto, exento: x.exento }));
  const t = totalesOc(lineas, false, Math.round);
  assert.deepEqual(t, { afecto: 35810, exento: 7537, iva: 6804, subtotal: 43347, total: 50151 });
  // Internacional: todo exento, sin IVA (comportamiento anterior)
  const i = totalesOc([{ subtotal: 100, exento: false }, { subtotal: 50, exento: false }], true, n => Math.round(n * 100) / 100);
  assert.deepEqual(i, { afecto: 0, exento: 150, iva: 0, subtotal: 150, total: 150 });
  // Nacional sin líneas exentas: igual que antes (19 % del total)
  assert.deepEqual(totalesOc([{ subtotal: 1000, exento: false }], false, Math.round), { afecto: 1000, exento: 0, iva: 190, subtotal: 1000, total: 1190 });
});

test('avisos: un neto por litro muy distinto al habitual se avisa; con pocas cargas previas no se avisa', () => {
  const prev = [40, 38, 42].map(l => ({ tipo: 'DIESEL', litros: l, netoAfecto: Math.round(l * 895), impuestoEspecifico: Math.round(l * 188) }));
  assert.deepEqual(avisosCarga(c4058, prev), []);                                   // 895 $/L y 188 $/L: lo normal
  assert.equal(avisosCarga({ ...c4058, netoAfecto: 80000 }, prev).length, 1);       // 2.000 $/L: digitación mala
  assert.equal(avisosCarga({ ...c4058, impuestoEspecifico: 20000 }, prev).length, 1);
  assert.deepEqual(avisosCarga({ ...c4058, netoAfecto: 80000 }, prev.slice(0, 1)), []);
  assert.deepEqual(avisosCarga({ ...c4058, tipo: 'PARAFINA', netoAfecto: 80000 }, prev), []);
});

test('aviso de litros mal digitados aun sin historial (36,19 L escrito 3619: $9 por litro)', () => {
  const c: CargaCombustible = { tipo: 'GASOLINA_93', litros: 3619, netoAfecto: 34318, impuestoEspecifico: 17138 };
  assert.equal(avisosCarga(c, []).length, 1);
  assert.deepEqual(avisosCarga({ ...c, litros: 36.19 }, []), []);
});

test('litros: coma decimal, punto decimal en cargas chicas y miles de verdad', () => {
  assert.equal(parsearLitros('25,757'), 25.757);
  assert.equal(parsearLitros('36.19'), 36.19);
  assert.equal(parsearLitros('25.757'), 25.757);
  assert.equal(parsearLitros('1.250,5'), 1250.5);
  assert.equal(parsearLitros('1.250.000'), 1250000);
  assert.equal(parsearLitros('120'), 120);
});
