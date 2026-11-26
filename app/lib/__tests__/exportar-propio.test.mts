// Exportación pedida por la propia empresa (Ley 21.719): límite de una cada 10 minutos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esperaParaExportar, MIN_ENTRE_EXPORTACIONES } from '../exportar-propio';

const MIN = 60_000;
test('la primera exportación no espera', () => {
  assert.equal(esperaParaExportar(null, Date.now()), 0);
});
test('dentro de la ventana avisa cuántos minutos faltan (redondeando hacia arriba)', () => {
  const ahora = 1_000_000_000;
  assert.equal(esperaParaExportar(ahora - 1 * MIN, ahora), MIN_ENTRE_EXPORTACIONES - 1);
  assert.equal(esperaParaExportar(ahora - (MIN_ENTRE_EXPORTACIONES * MIN - 1), ahora), 1);
  assert.equal(esperaParaExportar(ahora, ahora), MIN_ENTRE_EXPORTACIONES);
});
test('pasada la ventana vuelve a permitir', () => {
  const ahora = 1_000_000_000;
  assert.equal(esperaParaExportar(ahora - MIN_ENTRE_EXPORTACIONES * MIN, ahora), 0);
  assert.equal(esperaParaExportar(ahora - 60 * MIN, ahora), 0);
});
