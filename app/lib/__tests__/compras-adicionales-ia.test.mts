import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adicionalesDesdeIA, faltantesDesdeIA } from '../compras-adicionales-ia';

const igual = (n: number) => n;
test('18 bandejas para 1 carro: 18 por unidad; para 2 carros: 9', () => {
  const raw = [{ concepto: 'Bandejas 60x40', cantidadLinea: 18, precioUnitario: 32000 }];
  assert.deepEqual(adicionalesDesdeIA(raw, 1, igual), [{ concepto: 'Bandejas 60x40', cantidad: 18, precioUnitario: 32000 }]);
  assert.equal(adicionalesDesdeIA(raw, 2, igual)[0].cantidad, 9);
});
test('el precio pasa por la conversión a neto', () => {
  assert.equal(adicionalesDesdeIA([{ concepto: 'Quemador', cantidadLinea: 1, precioUnitario: 1_190_000 }], 1, n => n / 1.19)[0].precioUnitario, 1_000_000);
});
test('se descartan líneas sin nombre, sin precio o con precio 0', () => {
  assert.deepEqual(adicionalesDesdeIA([{ concepto: '', cantidadLinea: 1, precioUnitario: 10 }, { concepto: 'x', cantidadLinea: 1, precioUnitario: 0 }, { concepto: 'y', cantidadLinea: 0, precioUnitario: 5 }, null], 1, igual), []);
  assert.deepEqual(adicionalesDesdeIA('basura', 1, igual), []);
});
test('faltantes: solo con producto y concepto', () => {
  assert.deepEqual(faltantesDesdeIA([{ producto: 1, concepto: 'quemador' }, { producto: 'x', concepto: 'a' }, { producto: 2 }]), [{ producto: 1, concepto: 'quemador' }]);
});

import { incluidosDesdeIA } from '../compras-adicionales-ia';
test('la IA responde con códigos P1, P2…: se aceptan igual que el número solo', () => {
  assert.deepEqual(faltantesDesdeIA([{ producto: 'P1', concepto: 'quemador' }]), [{ producto: 1, concepto: 'quemador' }]);
  assert.deepEqual(incluidosDesdeIA([{ producto: 'P3', incluidoEn: 'P1' }, { producto: 'P2', incluidoEn: null }]), [{ producto: 3, en: 1 }]);
});

import { citaVerificada } from '../compras-adicionales-ia';
const DOC = 'Horno rotatorio ... Quemador: consultar con ventas | Precios netos + IVA. Incluye 1 carro 18x60x40';
test('cita verificada: literal en el documento (sin importar tildes ni mayúsculas)', () => {
  assert.equal(citaVerificada('Quemador: consultar con ventas', DOC), true);
  assert.equal(citaVerificada('INCLUYE 1 carro 18x60x40', DOC), true);
});
test('cita inventada o ausente: no vale', () => {
  assert.equal(citaVerificada('no se menciona el quemador', DOC), false);
  assert.equal(citaVerificada(null, DOC), false);
  assert.equal(citaVerificada('quemador', DOC), false);   // una sola palabra
});
test('faltantes e incluidos sin cita verificada se descartan', () => {
  assert.deepEqual(faltantesDesdeIA([{ producto: 'P1', concepto: 'quemador', cita: 'no se menciona' }], DOC), []);
  assert.equal(faltantesDesdeIA([{ producto: 'P1', concepto: 'quemador', cita: 'Quemador: consultar con ventas' }], DOC).length, 1);
  assert.deepEqual(incluidosDesdeIA([{ producto: 'P3', incluidoEn: 'P1', citaIncluido: 'el carro viene con el horno' }], DOC), []);
  assert.equal(incluidosDesdeIA([{ producto: 'P3', incluidoEn: 'P1', citaIncluido: 'Incluye 1 carro 18x60x40' }], DOC).length, 1);
});
