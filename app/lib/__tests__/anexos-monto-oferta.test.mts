// Regresión del anexo económico SIN tabla de ítems (anexos-monto-oferta.ts) — funciones puras.
//
// Caso real 2585-87-LE26 (Municipalidad de Arica, ANEXO Nº6): el documento entero pide UN solo
// monto ("OFERTA VALOR") y no tiene ni filas de producto ni columna de precio unitario, así que el
// motor de precios del Anexo Creator se quedaba sin candidatos y la única casilla de plata salía en
// blanco con el costeo completo cargado. Los tests fijan tanto lo que ahora SÍ se llena como las
// abstenciones que impiden escribir un monto equivocado en una oferta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  totalNetoDeItemsCosteo, tipoDeMontoDeOferta, porcentajeIvaDeclarado, resolverMontoUnicoOferta,
} from '../anexos-monto-oferta';
import type { ItemCosteoPrecio } from '../motor-comercial';

// Los dos ítems reales del costeo de 2585-87-LE26 (editor, modalidad suma alzada).
const ITEMS_REALES: ItemCosteoPrecio[] = [
  { descripcion: 'MOTO ACUATICA', precioUnitario: 25_583_840, unidad: 'Unidad', cantidad: 1 },
  { descripcion: 'CUATRIMOTO', precioUnitario: 8_946_025, unidad: 'Unidad', cantidad: 2 },
];
const TOTAL_REAL = 43_475_890; // 25.583.840 × 1 + 8.946.025 × 2

const SIN_TABLA = { hayTablaDeItems: false, porcentajeIva: null };

test('totalNetoDeItemsCosteo: Σ cantidad × precio unitario (caso real 2585-87-LE26)', () => {
  assert.equal(totalNetoDeItemsCosteo(ITEMS_REALES), TOTAL_REAL);
});

test('totalNetoDeItemsCosteo: un ítem sin cantidad invalida el total entero (nunca asume 1)', () => {
  assert.equal(totalNetoDeItemsCosteo([...ITEMS_REALES, { descripcion: 'FLETE', precioUnitario: 100_000, unidad: null, cantidad: null }]), null);
  assert.equal(totalNetoDeItemsCosteo([{ descripcion: 'X', precioUnitario: 1000, unidad: null, cantidad: 0 }]), null);
  assert.equal(totalNetoDeItemsCosteo([]), null);
});

test('tipoDeMontoDeOferta: reconoce el rótulo real "OFERTA VALOR" pese a la columna basura de la etiqueta', () => {
  assert.equal(tipoDeMontoDeOferta('OFERTA VALOR — “ADQ. DE VEHICULOS ACUATICOS Y TODOTERRENO DE ACUERDO A ORD. N° 167/2026'), 'neutro');
  assert.equal(tipoDeMontoDeOferta('VALOR TOTAL DE LA OFERTA'), 'neutro');
  assert.equal(tipoDeMontoDeOferta('MONTO TOTAL OFERTADO NETO'), 'neto');
  assert.equal(tipoDeMontoDeOferta('VALOR TOTAL DE LA OFERTA IVA INCLUIDO'), 'bruto');
});

test('tipoDeMontoDeOferta: se abstiene en todo lo que no es EL monto de la oferta', () => {
  // Un precio unitario es del motor de precios, nunca de acá.
  assert.equal(tipoDeMontoDeOferta('CASCO DE SEGURIDAD — Precio unitario'), null);
  // Palabra ajena al vocabulario cerrado: no se escribe lo que no se entiende.
  assert.equal(tipoDeMontoDeOferta('TOTAL TRABAJADORES'), null);
  assert.equal(tipoDeMontoDeOferta('VALOR DE LA GARANTÍA DE SERIEDAD'), null);
  assert.equal(tipoDeMontoDeOferta('PRESUPUESTO DISPONIBLE'), null);
  // El monto en palabras lo escribe un humano.
  assert.equal(tipoDeMontoDeOferta('VALOR TOTAL DE LA OFERTA EN PALABRAS'), null);
  // "Oferta" sin plata y plata sin oferta: ninguna de las dos sola alcanza.
  assert.equal(tipoDeMontoDeOferta('FECHA DE LA OFERTA'), null);
  // Rótulo que menciona neto Y con IVA a la vez: no dice qué va en ESTA casilla.
  assert.equal(tipoDeMontoDeOferta('VALOR OFERTA NETO Y CON IVA'), null);
});

test('porcentajeIvaDeclarado: solo el % que el propio documento asocia al IVA', () => {
  assert.equal(porcentajeIvaDeclarado(['Al valor neto se agrega IVA 19%']), 19);
  assert.equal(porcentajeIvaDeclarado(['19 % de I.V.A.']), 19);
  // Un porcentaje de otra cosa (criterio de evaluación) no es la tasa de IVA.
  assert.equal(porcentajeIvaDeclarado(['El criterio precio pondera 60%']), null);
  assert.equal(porcentajeIvaDeclarado([]), null);
});

test('resolverMontoUnicoOferta: llena la casilla única con el neto del costeo (caso real)', () => {
  const out = resolverMontoUnicoOferta(['OFERTA VALOR — “ADQ. DE VEHICULOS ACUATICOS'], TOTAL_REAL, SIN_TABLA);
  assert.equal(out.length, 1);
  assert.equal(out[0].valor, '$43.475.890');
  assert.equal(out[0].tipo, 'neutro');
});

test('resolverMontoUnicoOferta: con tabla de ítems en el documento no escribe nada (ese total lo suma el pie)', () => {
  assert.deepEqual(resolverMontoUnicoOferta(['OFERTA VALOR'], TOTAL_REAL, { hayTablaDeItems: true, porcentajeIva: null }), []);
});

test('resolverMontoUnicoOferta: sin costeo utilizable no escribe nada', () => {
  assert.deepEqual(resolverMontoUnicoOferta(['OFERTA VALOR'], null, SIN_TABLA), []);
  assert.deepEqual(resolverMontoUnicoOferta(['OFERTA VALOR'], 0, SIN_TABLA), []);
});

test('resolverMontoUnicoOferta: el bruto exige que el documento declare su IVA', () => {
  assert.deepEqual(resolverMontoUnicoOferta(['MONTO DE LA OFERTA IVA INCLUIDO'], 1_000_000, SIN_TABLA), []);
  const out = resolverMontoUnicoOferta(['MONTO DE LA OFERTA IVA INCLUIDO'], 1_000_000, { hayTablaDeItems: false, porcentajeIva: 19 });
  assert.equal(out.length, 1);
  assert.equal(out[0].valor, '$1.190.000');
  assert.equal(out[0].tipo, 'bruto');
});

test('resolverMontoUnicoOferta: neto y bruto juntos se llenan los dos; dos del mismo tipo, ninguno', () => {
  const par = resolverMontoUnicoOferta(
    ['VALOR OFERTA NETO', 'VALOR OFERTA IVA INCLUIDO'], 1_000_000,
    { hayTablaDeItems: false, porcentajeIva: 19 },
  );
  assert.deepEqual(par.map(m => m.valor).sort(), ['$1.000.000', '$1.190.000']);

  // Dos casillas que piden el MISMO monto (¿el de qué línea?) — ambigüedad real, se abstiene.
  assert.deepEqual(resolverMontoUnicoOferta(['VALOR TOTAL OFERTADO', 'MONTO DE LA OFERTA'], 1_000_000, SIN_TABLA), []);
  assert.deepEqual(resolverMontoUnicoOferta(['VALOR OFERTA NETO', 'MONTO OFERTADO NETO'], 1_000_000, SIN_TABLA), []);
});
