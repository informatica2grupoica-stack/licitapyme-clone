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

test('1 instalación para 200 unidades: se reparte el monto, no se redondea la cantidad a 0,01 (1202333-67-LE26)', () => {
  const [a] = adicionalesDesdeIA([{ concepto: 'INSTALACIÓN', cantidadLinea: 1, precioUnitario: 400_000 }], 200, igual);
  assert.equal(a.cantidad * a.precioUnitario * 200, 400_000);
  assert.match(a.concepto, /^INSTALACIÓN \(1 × \$400\.000 repartido en 200 u\)$/);
});

import { cotizacionEsPorUnidad, baseDeCotizacionPorUnidad } from '../compras-adicionales-ia';
// Tipo «cotización de UNA unidad» (set/kit). Caso real: 3789-30-LE26, 30 sets de podología, cotización Megamed #278 = 1 set ($171.671 neto).
const SET = [
  ['ALICATE FRONTAL 14 CM', 5, 9900], ['PINZA ANATOMICA 14 CM', 1, 2980], ['PINZA QUIRURGICA 14 CM', 3, 3344.67], ['PINZA KELLY RECTA 14 CM', 1, 3800],
  ['PINZA MOSQUITO RECTA 12 CM', 1, 3800], ['MANGO BISTURI Nº 4', 2, 1550], ['MANGO BISTURI Nº 3', 2, 1550], ['TIJERA RECTA ROMA 14 CM', 4, 3000],
  ['TIJERA MAYO CURVA 17 CM', 3, 4700], ['TIJERA MAYO RECTA 17 CM', 3, 4700], ['COPELA ACERO INOX', 2, 882.35], ['GUBIA PODOLOGICA', 5, 2655.46],
  ['ALICATE RECTO PEDIATRICO', 1, 8344.54], ['CAJA AC INOX LISA', 3, 10590],
].map(([concepto, cantidadLinea, precioUnitario]) => ({ concepto, cantidadLinea, precioUnitario }));
test('set cotizado por unidad: no se divide por 30 y la línea de cabecera no cuenta dos veces', () => {
  assert.equal(cotizacionEsPorUnidad(SET, 30), true);
  const adic = adicionalesDesdeIA(SET, 30, igual);
  assert.equal(adic.length, 14);
  assert.ok(adic.every(a => a.cantidad >= 1));                       // nada de 0,1 caja por set
  const { base, adicionales } = baseDeCotizacionPorUnidad(adic, 9900);   // el precio de cabecera era el del alicate
  assert.equal(base, 49500);                                          // 5 alicates
  assert.equal(adicionales.length, 13);
  const total = (base ?? 0) + adicionales.reduce((s, a) => s + a.cantidad * a.precioUnitario, 0);
  assert.ok(Math.abs(total - 171671) <= 2, `total ${total}`);         // = neto del documento, no $15.623
});
test('lote cotizado completo: se sigue dividiendo (no es por unidad)', () => {
  const lote = [{ concepto: 'Silla ruedas', cantidadLinea: 30, precioUnitario: 100 }, { concepto: 'Cojín', cantidadLinea: 30, precioUnitario: 10 }, { concepto: 'Freno', cantidadLinea: 60, precioUnitario: 5 }, { concepto: 'Bolso', cantidadLinea: 30, precioUnitario: 3 }];
  assert.equal(cotizacionEsPorUnidad(lote, 30), false);
  assert.equal(adicionalesDesdeIA(lote, 30, igual)[2].cantidad, 2);
});
test('pocas líneas o solo servicios (flete, instalación): no se confunde con «por unidad»', () => {
  assert.equal(cotizacionEsPorUnidad(SET.slice(0, 3), 30), false);
  const serv = [{ concepto: 'Flete', cantidadLinea: 1, precioUnitario: 1 }, { concepto: 'Instalación', cantidadLinea: 1, precioUnitario: 1 }, { concepto: 'Capacitación', cantidadLinea: 1, precioUnitario: 1 }, { concepto: 'Envío', cantidadLinea: 1, precioUnitario: 1 }];
  assert.equal(cotizacionEsPorUnidad(serv, 30), false);
  assert.equal(cotizacionEsPorUnidad(SET, 1), false);                 // producto de 1 unidad: ya es por unidad
});
test('base por unidad: sin línea de igual precio no se toca nada', () => {
  const a = [{ concepto: 'x', cantidad: 1, precioUnitario: 500 }];
  assert.deepEqual(baseDeCotizacionPorUnidad(a, 9900), { base: 9900, adicionales: a });
});
