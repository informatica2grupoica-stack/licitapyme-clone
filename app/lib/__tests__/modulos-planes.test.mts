// Planes Básico / Pro (2026-11-18): qué módulos usa de verdad una empresa-cliente y qué ve en los menús.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modulosDeCliente, normalizarPlan, MODULOS_ACTIVABLES, rutaPermitida } from '../modulos';

test('plan viejo o vacío cuenta como Básico', () => {
  for (const p of ['BASE', 'EQUIPO', '', null, undefined, 'basico']) assert.equal(normalizarPlan(p), 'BASICO');
  assert.equal(normalizarPlan('pro'), 'PRO');
});

test('Básico = radar y negocios: sin viabilidad, resultado, auditor ni postulación', () => {
  const m = modulosDeCliente('BASICO', null);
  assert.deepEqual(m, ['radar', 'negocios']);
  for (const no of ['viabilidad', 'resultado', 'auditor', 'anexos', 'costeo'] as const) assert.ok(!m.includes(no), no);
});

test('Pro trae viabilidad, resultado y costeo; nunca lo que todavía no está separado por empresa', () => {
  const m = modulosDeCliente('PRO', null);
  for (const si of ['radar', 'negocios', 'viabilidad', 'resultado', 'costeo'] as const) assert.ok(m.includes(si), si);
  for (const x of m) assert.ok(MODULOS_ACTIVABLES.includes(x), x);
  assert.ok(!m.includes('ia_chat'), 'la Consulta a la IA es adicional');
});

test('adicionales se suman al plan y se filtra lo no activable o inventado', () => {
  const m = modulosDeCliente('BASE', JSON.stringify(['radar', 'negocios', 'viabilidad', 'compras', 'hackeo']));
  assert.deepEqual(m, ['radar', 'negocios', 'viabilidad']); // cliente 2 de hoy: Básico + Viabilidad, sin Compras
  assert.ok(modulosDeCliente('BASICO', ['ia_chat']).includes('ia_chat'));
});

test('el servidor niega a un Básico las rutas de lo que no contrató', () => {
  const basico = modulosDeCliente('BASICO', null);
  assert.equal(rutaPermitida('/api/cv/viabilidad-ia/123', 2, basico).ok, false);
  assert.equal(rutaPermitida('/api/negocios/5/comercial', 2, basico).ok, false);
  assert.equal(rutaPermitida('/puente', 2, basico).ok, true);
  assert.equal(rutaPermitida('/dashboard', 2, basico).ok, true);
  assert.equal(rutaPermitida('/', 2, basico).ok, true);
  assert.equal(rutaPermitida('/ordenes-compra', 2, basico).ok, true);
  assert.equal(rutaPermitida('/api/ordenes-compra/listado', 2, basico).ok, true);
  assert.equal(rutaPermitida('/compras', 2, basico).ok, false);
  assert.equal(rutaPermitida('/api/cv/viabilidad-ia/123', 2, modulosDeCliente('PRO', null)).ok, true);
});
