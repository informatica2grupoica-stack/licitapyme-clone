// Opciones de funcionamiento por empresa (migration-200): aprobaciones del Auditor. Parte pura (sin BD).
import test from 'node:test';
import assert from 'node:assert/strict';
import { aprobacionRequerida, normalizarOpciones, esModoAprobacion, OPCIONES_POR_DEFECTO } from '../opciones-empresa-core';

test('automático: pide aprobación solo si la empresa tiene más de un usuario', () => {
  assert.equal(aprobacionRequerida('auto', 1, 4), false);   // solo el admin
  assert.equal(aprobacionRequerida('auto', 0, 4), false);
  assert.equal(aprobacionRequerida('auto', 2, 4), true);
  assert.equal(aprobacionRequerida('auto', 9, 4), true);
});

test('siempre y nunca no dependen de cuántos usuarios hay', () => {
  assert.equal(aprobacionRequerida('siempre', 1, 4), true);
  assert.equal(aprobacionRequerida('nunca', 9, 4), false);
});

test('Grupo ICA (cliente 1) conserva siempre su flujo de aprobación', () => {
  for (const m of ['auto', 'siempre', 'nunca'] as const) assert.equal(aprobacionRequerida(m, 1, 1), true, m);
});

test('normalizarOpciones: acepta objeto o texto y cae al valor por defecto si algo viene mal', () => {
  assert.equal(OPCIONES_POR_DEFECTO.aprobaciones_auditor, 'auto');
  assert.equal(normalizarOpciones(null).aprobaciones_auditor, 'auto');
  assert.equal(normalizarOpciones({ aprobaciones_auditor: 'nunca' }).aprobaciones_auditor, 'nunca');
  assert.equal(normalizarOpciones('{"aprobaciones_auditor":"siempre"}').aprobaciones_auditor, 'siempre');
  assert.equal(normalizarOpciones('esto no es json').aprobaciones_auditor, 'auto');
  assert.equal(normalizarOpciones({ aprobaciones_auditor: 'hackeo' }).aprobaciones_auditor, 'auto');
  assert.equal(esModoAprobacion('auto'), true);
  assert.equal(esModoAprobacion('otro'), false);
});
