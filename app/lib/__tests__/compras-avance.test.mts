// Avance por producto de una licitación en Compras. Sin red ni base.
// Correr con: npx tsx --test app/lib/__tests__/compras-avance.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { armarAvance, type DatosProductoAvance } from '../compras-avance-core';

const vacio = (id: number, extra: Partial<DatosProductoAvance> = {}): DatosProductoAvance => ({
  id, correlativo: id, descripcion: `Producto ${id}`, subestado: 'PENDIENTE',
  cotizaciones: { n: 0, por: null, at: null }, eleccion: null, linea: null, sku: null, oc: null, ...extra,
});
const sinGlobales = { compra: null, margen: null };

test('producto sin nada: falta cotizar y el avance es 0', () => {
  const a = armarAvance([vacio(1)], sinGlobales);
  assert.equal(a.items[0].falta, 'Cotizar');
  assert.equal(a.hechos, 0);
  assert.equal(a.total, 7);   // 5 pasos del producto + compra + margen
});

test('3 cotizaciones y elegido: lo que sigue es aprobar, y queda quién lo hizo', () => {
  const p = vacio(1, { cotizaciones: { n: 3, por: 'Carolina', at: '2026-11-26 10:00:00' }, eleccion: { proveedor: 'Sinergia', por: 'Carolina', at: '2026-11-26 11:00:00' } });
  const a = armarAvance([p], sinGlobales);
  assert.equal(a.items[0].pasos[0].estado, 'hecho');
  assert.equal(a.items[0].pasos[1].por, 'Carolina');
  assert.equal(a.items[0].falta, 'Aprobar');
});

test('1 o 2 cotizaciones es parcial: se pide completar, no se da por hecho', () => {
  const a = armarAvance([vacio(1, { cotizaciones: { n: 2, por: 'Ana', at: null } })], sinGlobales);
  assert.equal(a.items[0].pasos[0].estado, 'parcial');
  assert.equal(a.items[0].pasos[0].texto, '2 de 3 cotizaciones');
  assert.match(a.items[0].falta!, /Completar cotizaciones/);
});

test('una línea rechazada va primero en «falta», aunque falten otras cosas', () => {
  const a = armarAvance([vacio(1, { linea: { estado: 'RECHAZADA', por: 'Jefe', at: null } })], sinGlobales);
  assert.equal(a.items[0].pasos[2].estado, 'rechazado');
  assert.match(a.items[0].falta!, /rechazó/);
});

test('compra aprobada en bloque da por aprobados los productos sin decisión propia', () => {
  const a = armarAvance([vacio(1)], { compra: { estado: 'APROBADA', por: 'Jefe', at: null }, margen: { estado: 'PENDIENTE', por: 'Ana', at: null } });
  assert.equal(a.items[0].pasos[2].estado, 'hecho');
  assert.equal(a.globales[0].estado, 'hecho');
  assert.equal(a.globales[1].estado, 'parcial');
});

test('comprado directo en Obuma (sin OC de Licitank) cuenta como OC hecha', () => {
  const a = armarAvance([vacio(1, { subestado: 'COMPRADO' })], sinGlobales);
  assert.equal(a.items[0].pasos[4].estado, 'hecho');
});

test('producto completo: sin «falta» y cuenta como completo', () => {
  const q = { por: 'Ana', at: '2026-11-26 09:00:00' };
  const p = vacio(1, { cotizaciones: { n: 3, ...q }, eleccion: { proveedor: 'X', ...q }, linea: { estado: 'APROBADA', ...q }, sku: { codigo: 'SKU-1', ...q }, oc: { numero: '4100', ...q } });
  const a = armarAvance([p], { compra: { estado: 'APROBADA', ...q }, margen: { estado: 'APROBADA', ...q } });
  assert.equal(a.items[0].falta, null);
  assert.equal(a.itemsCompletos, 1);
  assert.equal(a.porcentaje, 100);
});
