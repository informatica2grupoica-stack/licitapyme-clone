// Tests de corregirTipoDeTolerancia — el guardarraíl que evita invertir un veredicto técnico.
// Correr con:
//   npx tsx --test app/lib/__tests__/tolerancia-tipo.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { corregirTipoDeTolerancia, evaluarCaracteristicaDeterminista } from '../auditor-tecnico-core';

// ─── EL CASO REAL ─────────────────────────────────────────────────────────────────────────────
// 611669-17-LE26 "LUMINANCÍMETROS": las bases pedían "Precisión: al menos +/-2,5%" y el
// clasificador lo guardó como PISO con valor 2,5. Pero ±2% es MEJOR precisión que ±2,5%.
test('caso real: "Precisión: al menos +/-2,5%" es un TECHO, no un piso', () => {
  assert.equal(corregirTipoDeTolerancia('Precisión: al menos +/-2,5%', 'PISO'), 'TECHO');
});

// Sin la corrección, el evaluador determinista da NO_CUMPLE a un equipo que cumple de sobra.
// Se prueba SIN unidad porque ese es el camino donde el determinista de verdad resuelve — ver el
// test de abajo sobre por qué el caso real zafó.
const ARGS = { valorRequeridoNumero: 2.5, valorRequeridoNumeroMax: null, unidadRequerida: null,
               valorOfertadoNumero: 2, unidadOfertadaOriginal: null };

test('sin corregir el tipo, el veredicto sale INVERTIDO', () => {
  assert.equal(evaluarCaracteristicaDeterminista({ ...ARGS, tipo: 'PISO' })?.veredicto, 'NO_CUMPLE');
  assert.equal(evaluarCaracteristicaDeterminista({ ...ARGS, tipo: 'TECHO' })?.veredicto, 'CUMPLE');
});

test('el flujo completo: se clasifica PISO, se corrige, y el veredicto sale bien', () => {
  const tipo = corregirTipoDeTolerancia('Precisión: al menos +/-2,5%', 'PISO');
  assert.equal(evaluarCaracteristicaDeterminista({ ...ARGS, tipo })?.veredicto, 'CUMPLE');
});

// POR QUÉ EL CASO REAL NO EXPLOTÓ: la unidad era "%", que no está en la tabla de conversión, así
// que el determinista se abstiene y decide la IA — que razonó bien. O sea el bug estaba ahí y
// sobrevivió de casualidad. Este test fija esa dependencia: si mañana "%" entrara a la tabla de
// unidades, el camino determinista se activaría y la corrección de tipo pasaría a ser lo único
// que evita el veredicto invertido.
test('con unidad "%" el determinista se abstiene (así zafó el caso real)', () => {
  assert.equal(evaluarCaracteristicaDeterminista({
    tipo: 'PISO', valorRequeridoNumero: 2.5, valorRequeridoNumeroMax: null, unidadRequerida: '%',
    valorOfertadoNumero: 2, unidadOfertadaOriginal: '%',
  }), null);
});

// ─── LAS DOS SEÑALES SON NECESARIAS ───────────────────────────────────────────────────────────
// Se exigen magnitud-de-error Y símbolo ±, para no dar vuelta requisitos que sí son un piso.
test('sin el símbolo ± NO se corrige: "Resolución de al menos 100 gr" es un piso de verdad', () => {
  assert.equal(corregirTipoDeTolerancia('Resolución: al menos 100 [gr]', 'PISO'), 'PISO');
  assert.equal(corregirTipoDeTolerancia('Memoria de datos: al menos 1.000 datos', 'PISO'), 'PISO');
  assert.equal(corregirTipoDeTolerancia('Ángulo de medición de al menos 1°', 'PISO'), 'PISO');
});

test('sin una magnitud de error NO se corrige, aunque lleve ±', () => {
  assert.equal(corregirTipoDeTolerancia('Altura regulable ±5 cm respecto del piso', 'PISO'), 'PISO');
});

test('reconoce las otras magnitudes de error', () => {
  for (const d of [
    'Exactitud: ±1,5%', 'Tolerancia de ±0,5 mm', 'Desviación máxima ±2°',
    'Incertidumbre de ±0,1', 'Repetibilidad ±0,2%', 'Error de medición ±1%',
  ]) {
    assert.equal(corregirTipoDeTolerancia(d, 'PISO'), 'TECHO', d);
  }
});

test('acepta las tres formas de escribir la tolerancia', () => {
  for (const d of ['Precisión ±2,5%', 'Precisión +/-2,5%', 'Precisión +-2,5%']) {
    assert.equal(corregirTipoDeTolerancia(d, 'PISO'), 'TECHO', d);
  }
});

// ─── SOLO DA VUELTA PISO ──────────────────────────────────────────────────────────────────────
// Nunca toca lo que ya está bien clasificado: es un guardarraíl, no un reclasificador.
test('no toca TECHO, EXACTO ni RANGO', () => {
  assert.equal(corregirTipoDeTolerancia('Precisión ±2,5%', 'TECHO'), 'TECHO');
  assert.equal(corregirTipoDeTolerancia('Precisión ±2,5%', 'EXACTO'), 'EXACTO');
  assert.equal(corregirTipoDeTolerancia('Precisión ±2,5%', 'RANGO'), 'RANGO');
});

// La señal puede venir en la cita textual de las bases y no en la descripción.
test('también mira el valor requerido textual', () => {
  assert.equal(corregirTipoDeTolerancia('Precisión de medición', 'PISO', 'al menos ±2,5%'), 'TECHO');
});

test('texto vacío no revienta', () => {
  assert.equal(corregirTipoDeTolerancia('', 'PISO'), 'PISO');
  assert.equal(corregirTipoDeTolerancia('Precisión', 'PISO', null), 'PISO');
});
