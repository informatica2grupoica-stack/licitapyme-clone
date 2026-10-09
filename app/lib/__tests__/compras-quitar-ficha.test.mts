// Quitar UNA ficha de un modelo de Compras (se subió la equivocada): guardias de código para que no se rompa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../compras-fichas.ts', import.meta.url), 'utf8');

test('quitar una ficha la deja no vigente (no borra el modelo ni el historial) y no reaparece como pendiente', () => {
  const f = src.slice(src.indexOf('export async function quitarFichaDeOpcion'));
  assert.match(f, /SET vigente = 0/);
  assert.match(f, /olvidarDocumentoDeCompras/);
  assert.doesNotMatch(f.slice(0, f.indexOf('export async function olvidarDocumentoDeCompras')), /DELETE FROM auditor_respaldo/);
});

test('volver a subir una ficha quitada la reactiva: el chequeo de «ya existe» solo mira las vigentes', () => {
  const g = src.slice(src.indexOf('async function agregarFichaCompras'));
  assert.match(g.slice(0, 700), /producto_idx = \? AND vigente = 1/);
});
