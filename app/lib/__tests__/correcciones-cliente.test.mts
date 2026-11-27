// Correcciones de la prueba como cliente nuevo (2026-11-27): recargo por empresa, pantallas de cliente y UTM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizarOpciones, esRecargoValido } from '../opciones-empresa-core';

test('recargo del costeo por empresa: sin configurar o inválido = el del sistema', () => {
  assert.equal(normalizarOpciones(null).recargo_costeo, null);
  for (const malo of ['30', -1, 301, NaN, true]) assert.equal(normalizarOpciones({ recargo_costeo: malo }).recargo_costeo, null, String(malo));
  assert.equal(normalizarOpciones('{"recargo_costeo":0}').recargo_costeo, 0, 'cero es un recargo válido');
  assert.deepEqual(normalizarOpciones({ recargo_costeo: 35.5, aprobaciones_auditor: 'nunca' }), { aprobaciones_auditor: 'nunca', recargo_costeo: 35.5 });
  assert.equal(esRecargoValido(300), true);
});

test('guardia: solo el costeo NUEVO toma el recargo de la empresa', () => {
  const s = readFileSync('app/api/negocios/[id]/comercial/costeo-editor/route.ts', 'utf8');
  assert.match(s, /else if \(desdeViab\) \{[\s\S]{0,420}recargo_costeo != null \? \{ \.\.\.desdeViab, margenVenta: recargo_costeo \}/);
});

test('guardia: el radar de un cliente no muestra el prefiltro de ICA y Mi empresa no queda cargando', () => {
  const radar = readFileSync('app/radar/page.tsx', 'utf8');
  assert.match(radar, /const conPrefiltroIA = usuario\?\.clienteId === 1;/);
  assert.match(radar, /\.filter\(g => conPrefiltroIA \|\| g\.key !== 'excluidas_pref'\)/);
  assert.match(readFileSync('app/components/ConfigurarEmpresa.tsx', 'utf8'), /if \(noAplica\) return null;/);
});

test('guardia: el respaldo de la UTM es solo para la UTM y solo del mismo mes', () => {
  assert.match(readFileSync('app/lib/tipo-cambio.ts', 'utf8'), /if \(moneda !== 'UTM'\) return null;[\s\S]{0,400}hoy\.slice\(0, 7\)\}-01/);
});
