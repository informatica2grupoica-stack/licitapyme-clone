// Etapas de avance propias de cada empresa (migration-199): parte pura (sin BD).
import test from 'node:test';
import assert from 'node:assert/strict';
import { validarEtapa, esClaveEtapa, claveEtapa, idDeClave, BASES_ETAPA } from '../etapas-core';
import { registrarEtapasPropias, estadosParaSelector, normalizarEstado, getEstadoPipeline, claveVisibleDeNegocio, puedeCambiarEstadoPipeline, ESTADOS_PIPELINE } from '../pipeline';

const propias = [
  { id: 7, nombre: 'Cotizando proveedores', color: '#0D9488', base: 'EN_PROCESO', orden: 1 },
  { id: 9, nombre: 'Revisión legal', color: '#9333EA', base: 'POSTULADA', orden: 2 },
];

test('validarEtapa: pide nombre, color y una etapa base válida', () => {
  assert.equal(validarEtapa({ nombre: 'Cotizando', color: '#0D9488', base: 'EN_PROCESO' }), null);
  assert.match(validarEtapa({ nombre: ' ', color: '#0D9488', base: 'EN_PROCESO' }) ?? '', /nombre/i);
  assert.match(validarEtapa({ nombre: 'x'.repeat(41), color: '#0D9488', base: 'EN_PROCESO' }) ?? '', /largo/i);
  assert.match(validarEtapa({ nombre: 'Ok', color: 'rojo', base: 'EN_PROCESO' }) ?? '', /color/i);
});

test('las etapas que pone el cron o exigen motivo no se pueden usar como base', () => {
  const ids = BASES_ETAPA.map(b => b.id);
  for (const prohibida of ['ADJUDICADA', 'PERDIDA', 'REVOCADA', 'DESIERTA', 'DESCARTADA']) assert.equal(ids.includes(prohibida), false, prohibida);
  assert.match(validarEtapa({ nombre: 'Ganamos', color: '#16A34A', base: 'ADJUDICADA' }) ?? '', /equivale/i);
});

test('claves E<id>: se reconocen y no se confunden con las del sistema', () => {
  assert.equal(esClaveEtapa('E12'), true);
  assert.equal(esClaveEtapa('EN_PROCESO'), false);
  assert.equal(esClaveEtapa('E'), false);
  assert.equal(esClaveEtapa(null), false);
  assert.equal(idDeClave(claveEtapa(12)), 12);
});

test('con etapas propias registradas: el selector las pone justo después de su etapa base', () => {
  registrarEtapasPropias(propias);
  const ids = estadosParaSelector().map(e => e.id);
  assert.equal(ids.length, ESTADOS_PIPELINE.length + 2);
  assert.equal(ids[ids.indexOf('EN_PROCESO') + 1], 'E7');
  assert.equal(ids[ids.indexOf('POSTULADA') + 1], 'E9');
  assert.equal(getEstadoPipeline('E7')?.label, 'COTIZANDO PROVEEDORES');
  assert.equal(getEstadoPipeline('E7')?.color, '#0D9488');
  registrarEtapasPropias([]);
});

test('una etapa propia se comporta como su base: normalizarEstado y retrocesos', () => {
  registrarEtapasPropias(propias);
  assert.equal(normalizarEstado('E9'), 'POSTULADA');
  assert.equal(normalizarEstado('E7'), 'EN_PROCESO');
  // un asistente puede avanzar de En proceso a una etapa propia equivalente a Postulada, pero no retroceder
  assert.equal(puedeCambiarEstadoPipeline('EN_PROCESO', 'E9', false).permitido, true);
  assert.equal(puedeCambiarEstadoPipeline('POSTULADA', 'E7', false).permitido, false);
  assert.equal(puedeCambiarEstadoPipeline('POSTULADA', 'E7', true).permitido, true);
  registrarEtapasPropias([]);
});

test('claveVisibleDeNegocio: la etapa propia vigente manda; si no, la del sistema', () => {
  assert.equal(claveVisibleDeNegocio({ estado_pipeline: 'POSTULADA', etapa_clave: 'E9' }), 'E9');
  assert.equal(claveVisibleDeNegocio({ estado_pipeline: 'POSTULADA', etapa_clave: null }), 'POSTULADA');
  assert.equal(claveVisibleDeNegocio({}), 'ASIGNADO');
});

test('sin etapas propias todo queda como antes', () => {
  registrarEtapasPropias([]);
  assert.equal(estadosParaSelector().length, ESTADOS_PIPELINE.length);
  assert.equal(getEstadoPipeline('E99'), null);
  assert.equal(getEstadoPipeline('POSTULADA')?.label, 'POSTULADA');
});
