import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codigoReadjudicadaEn, fusionarReadjudicacion, type RespuestaAdjudicacion, type LineaAdjudicada } from '../adjudicacion.js';
import { claveLicitacionSinTipo } from '../compras.js';

const l = (correlativo: number, monto: number, proveedor: string, rut: string): LineaAdjudicada =>
  ({ correlativo, cantidad: 1, montoUnitario: monto, proveedor, rutProveedor: rut });
const base = (codigo: string, lineas: LineaAdjudicada[], adj = true): RespuestaAdjudicacion => ({
  success: true, codigo, estado: 'Adjudicada', codigoEstado: 8, esAdjudicada: adj, fechaAdjudicacion: '2026-07-27T00:00:00Z',
  fechaEstimadaAdjudicacion: null, fechaAperturaTecnica: null, adjudicacion: { tipo: 4, numeroResolucion: codigo, numeroOferentes: 11, urlActa: null },
  lineasAdjudicadas: lineas, montoAdjudicadoTotal: null, ganamos: false, montoNuestro: null, desdeCache: false,
});

test('detecta «Readjudicada en Id» en el nombre', () => {
  assert.equal(codigoReadjudicadaEn('MATERIALES - Readjudicada en Id 2827-72-R126'), '2827-72-R126');
  assert.equal(codigoReadjudicadaEn('MATERIALES PROYECTO SENDERO'), null);
});

test('clave sin tipo: LP26 y R126 son el mismo proceso', () => {
  assert.equal(claveLicitacionSinTipo('2827-72-LP26'), '2827-72-26');
  assert.equal(claveLicitacionSinTipo('2827-72-R126'), '2827-72-26');
  assert.equal(claveLicitacionSinTipo('1271359-92-LE26'), claveLicitacionSinTipo('1271359-92-R126'));
});

test('la línea 4 pisa a CNF y las líneas 1-3 quedan con DIMACO', () => {
  const orig = base('2827-72-LP26', [l(1, 19209000, 'DIMACO', '85.067.500-7'), l(2, 50190870, 'DIMACO', '85.067.500-7'),
    l(3, 10629870, 'DIMACO', '85.067.500-7'), l(4, 10378500, 'CNF', '78.155.185-6')]);
  const nueva = base('2827-72-R126', [l(4, 25749900, 'CLARO ARZ', '76.902.659-2')]);
  const r = fusionarReadjudicacion(orig, nueva);
  assert.equal(r.lineasAdjudicadas.length, 4);
  assert.equal(r.lineasAdjudicadas[3].rutProveedor, '76.902.659-2');
  assert.equal(r.lineasAdjudicadas[0].proveedor, 'DIMACO');
  assert.equal(r.readjudicadaEn, '2827-72-R126');
  assert.equal(r.montoAdjudicadoTotal, 19209000 + 50190870 + 10629870 + 25749900);
});

test('si la nueva no trae adjudicatarios, no cambia nada', () => {
  const orig = base('A', [l(1, 100, 'X', '1-9')]);
  assert.equal(fusionarReadjudicacion(orig, base('B', [])), orig);
  assert.equal(fusionarReadjudicacion(orig, base('B', [l(1, 5, 'Y', '2-7')], false)), orig);
});
