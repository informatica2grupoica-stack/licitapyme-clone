// «¿A qué líneas vamos?» solo cuando de verdad hay qué elegir — caso real 3712-74-LP26 (27-oct-2026):
// cotización por línea, adjudicación GLOBAL y una sola línea, y el banner decía «falta elegir».
// Correr con:
//   npx tsx --test app/lib/__tests__/selector-lineas-oferta.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hayLineasQueElegir } from '../checklist-comercial';

const informe = (tipo: string, adj?: string) => ({ modalidad: { tipo }, ...(adj ? { adjudicacion: { resultado: adj } } : {}) });

test('3712-74-LP26: por línea pero adjudicación GLOBAL y 1 línea → no se pregunta', () => {
  assert.equal(hayLineasQueElegir(informe('por_linea', 'GLOBAL'), 1), false);
});

test('adjudicación GLOBAL con varias líneas → todo o nada, no se pregunta', () => {
  assert.equal(hayLineasQueElegir(informe('por_linea', 'GLOBAL'), 5), false);
});

test('una sola línea → no hay qué elegir', () => {
  assert.equal(hayLineasQueElegir(informe('por_linea', 'POR_LINEAS'), 1), false);
});

test('por línea con varias líneas y adjudicación por línea, no clara o sin dato → se pregunta', () => {
  assert.equal(hayLineasQueElegir(informe('por_linea', 'POR_LINEAS'), 3), true);
  assert.equal(hayLineasQueElegir(informe('por_linea', 'NO_CLARO'), 3), true);
  assert.equal(hayLineasQueElegir(informe('por_linea'), 3), true);
});

test('suma alzada → no se pregunta', () => {
  assert.equal(hayLineasQueElegir(informe('suma_alzada', 'POR_LINEAS'), 3), false);
});
