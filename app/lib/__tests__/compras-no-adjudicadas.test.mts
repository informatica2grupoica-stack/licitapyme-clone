// Líneas ofertadas y no ganadas (caso real 1173418-1-LE26, negocio 457).
//   npx tsx --test app/lib/__tests__/compras-no-adjudicadas.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidirNoAdjudicadas, esSubestadoFuera } from '../compras-no-adjudicadas';

const nuestra = (c: number) => ({ correlativo: c, rutProveedor: '77.111.111-1', proveedor: 'COMERCIAL MP', montoUnitario: 100, esNuestra: true });
const ajena = (c: number) => ({ correlativo: c, rutProveedor: '76.222.222-2', proveedor: 'MAQUIPAN', montoUnitario: 90, esNuestra: false });
const prod = (id: number, correlativo: number | null, subestado = 'PENDIENTE') => ({ id, correlativo, subestado });

test('caso real 457: 4 líneas, ganamos 1, 2 y 4 → solo la 3 queda NO_ADJUDICADA', () => {
  const d = decidirNoAdjudicadas(
    [prod(232, 1), prod(233, 2), prod(234, 3), prod(235, 4)],
    [nuestra(1), nuestra(2), ajena(3), nuestra(4)], true);
  assert.deepEqual(d.marcar, [234]);
  assert.deepEqual(d.restaurar, []);
  assert.deepEqual(d.conflictos, []);
  assert.equal(d.omitido, null);
});

test('adjudicación global (acta sin líneas o con una sola): no se toca nada', () => {
  assert.deepEqual(decidirNoAdjudicadas([prod(1, null)], [], true).marcar, []);
  assert.deepEqual(decidirNoAdjudicadas([prod(1, 1)], [ajena(1)], true).marcar, []);
  assert.ok(decidirNoAdjudicadas([prod(1, 1)], [nuestra(1)], true).omitido);
});

test('acta sin confirmar adjudicación: no se toca nada', () => {
  assert.deepEqual(decidirNoAdjudicadas([prod(1, 1), prod(2, 2)], [nuestra(1), ajena(2)], false).marcar, []);
});

test('si el acta no marca NINGUNA línea como nuestra, no se marca nada (nunca esconder todo)', () => {
  assert.deepEqual(decidirNoAdjudicadas([prod(1, 1), prod(2, 2)], [ajena(1), ajena(2)], true).marcar, []);
});

test('numeración del costeo que no calza con el acta (caso 1114-12): no se toca nada', () => {
  const d = decidirNoAdjudicadas([prod(1, 1), prod(2, 2)], [nuestra(1), ajena(3)], true);
  assert.deepEqual(d.marcar, []);
  assert.ok(d.omitido);
});

test('línea del acta sin proveedor (RUT desconocido) no cuenta como perdida', () => {
  const sinRut = { correlativo: 2, rutProveedor: null, proveedor: null, montoUnitario: null, esNuestra: false };
  assert.deepEqual(decidirNoAdjudicadas([prod(1, 1), prod(2, 2)], [nuestra(1), sinRut], true).marcar, []);
});

test('línea perdida con la compra ya avanzada: NO se marca, queda como conflicto para mirar a mano', () => {
  const d = decidirNoAdjudicadas([prod(1, 1), prod(2, 2, 'COMPRADO')], [nuestra(1), ajena(2)], true);
  assert.deepEqual(d.marcar, []);
  assert.deepEqual(d.conflictos, [{ productoId: 2, correlativo: 2, subestado: 'COMPRADO' }]);
});

test('COTIZANDO sí se marca (todavía no se gastó nada); RENUNCIADO se respeta', () => {
  assert.deepEqual(decidirNoAdjudicadas([prod(1, 1), prod(2, 2, 'COTIZANDO')], [nuestra(1), ajena(2)], true).marcar, [2]);
  const d = decidirNoAdjudicadas([prod(1, 1), prod(2, 2, 'RENUNCIADO')], [nuestra(1), ajena(2)], true);
  assert.deepEqual(d.marcar, []);
  assert.deepEqual(d.conflictos, []);
});

test('idempotente: una línea ya NO_ADJUDICADA no se vuelve a marcar', () => {
  const d = decidirNoAdjudicadas([prod(1, 1), prod(2, 2, 'NO_ADJUDICADA')], [nuestra(1), ajena(2)], true);
  assert.deepEqual(d.marcar, []);
  assert.deepEqual(d.restaurar, []);
});

test('si el acta corrige y la línea pasa a ser nuestra, se restaura', () => {
  const d = decidirNoAdjudicadas([prod(1, 1), prod(2, 2, 'NO_ADJUDICADA')], [nuestra(1), nuestra(2)], true);
  assert.deepEqual(d.restaurar, [2]);
});

test('productos sin correlativo (gastos extra, filas manuales) nunca se tocan', () => {
  const d = decidirNoAdjudicadas([prod(1, 1), prod(2, 2), prod(9, null)], [nuestra(1), ajena(2)], true);
  assert.deepEqual(d.marcar, [2]);
});

test('correlativos repetidos en productos o en el acta: no se toca nada', () => {
  assert.deepEqual(decidirNoAdjudicadas([prod(1, 2), prod(2, 2)], [nuestra(1), ajena(2)], true).marcar, []);
  assert.deepEqual(decidirNoAdjudicadas([prod(1, 1), prod(2, 2)], [nuestra(1), ajena(2), ajena(2)], true).marcar, []);
});

test('esSubestadoFuera: RENUNCIADO y NO_ADJUDICADA salen de la cobertura; el resto no', () => {
  assert.equal(esSubestadoFuera('NO_ADJUDICADA'), true);
  assert.equal(esSubestadoFuera('RENUNCIADO'), true);
  for (const s of ['PENDIENTE', 'COTIZANDO', 'COMPRADO', 'EN_BODEGA', 'LISTO_ENTREGA', 'ENTREGADO']) assert.equal(esSubestadoFuera(s), false);
});
