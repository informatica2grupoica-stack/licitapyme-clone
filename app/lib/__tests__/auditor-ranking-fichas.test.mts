// «¿Qué ficha cumple más?» del Auditor: orden, ganadora, empate y fichas sin comparar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rankearFichas, type OpcionParaRanking } from '../auditor-ranking-fichas';

const op = (id: number, cumple: number | null, total: number | null, noCumple = 0, fichas = ['f.pdf'], estado = 'NO_CUMPLE'): OpcionParaRanking => ({ id, nombre: `Modelo ${id}`, proveedor: null, fichas, estado, cumple, total, noCumple });

test('la que más requisitos cumple gana y va primera', () => {
  const r = rankearFichas([op(1, 3, 15), op(2, 9, 15), op(3, 5, 15)]);
  assert.deepEqual(r.filas.map(f => f.id), [2, 3, 1]);
  assert.equal(r.ganadoraId, 2);
  assert.equal(r.filas[0].pct, 60);
  assert.equal(r.ningunaCumple, true);
});
test('empate: no hay ganadora y se listan las empatadas; a igual cumplimiento gana la que tiene menos «no cumple»', () => {
  const e = rankearFichas([op(1, 1, 15, 5), op(2, 1, 15, 5), op(3, 0, 15, 2)]);
  assert.equal(e.ganadoraId, null); assert.deepEqual(e.empatan, [1, 2]);
  const d = rankearFichas([op(1, 4, 10, 6), op(2, 4, 10, 2)]);
  assert.equal(d.ganadoraId, 2);
});
test('las fichas sin comparar no entran al orden pero se avisan; sin fichas no cuentan', () => {
  const r = rankearFichas([op(1, 8, 10, 0, ['a.pdf'], 'CON_PENDIENTES'), op(2, null, null, 0, ['b.pdf'], 'NO_CORRIDO'), op(3, 9, 10, 0, [])]);
  assert.deepEqual(r.filas.map(f => f.id), [1]);
  assert.deepEqual(r.sinComparar.map(o => o.id), [2]);
  assert.equal(r.ganadoraId, null);   // una sola comparada: no hay contra quién ganar
});
test('si alguna cumple todo, no se avisa «ninguna cumple»', () => {
  assert.equal(rankearFichas([op(1, 10, 10, 0, ['a.pdf'], 'CUMPLE'), op(2, 5, 10)]).ningunaCumple, false);
});
