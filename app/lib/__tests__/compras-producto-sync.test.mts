// Emparejamiento costeo ↔ Productos y cobertura (bug de la calibración duplicada, #994).
//   npx tsx --test app/lib/__tests__/compras-producto-sync.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emparejarProductos } from '../compras-producto-sync';

test('caso real #994: la fila que gana su línea reutiliza el producto sin correlativo (no se duplica)', () => {
  const r = emparejarProductos(
    [{ id: 213, correlativo: 1, descripcion: 'Luminancímetros' }, { id: 227, correlativo: null, descripcion: 'calibracion' }],
    [{ lineaPublicada: 1, detalle: 'Luminancímetros' }, { lineaPublicada: 2, detalle: 'calibracion' }],
  );
  assert.deepEqual(r.existentePorFila, [213, 227]);
  assert.deepEqual(r.duplicados, []);
});

test('el estado ya duplicado (correlativo 2 y otro sin correlativo) se limpia: sobra el sin correlativo', () => {
  const r = emparejarProductos(
    [{ id: 213, correlativo: 1, descripcion: 'Luminancímetros' }, { id: 227, correlativo: null, descripcion: 'calibracion' }, { id: 228, correlativo: 2, descripcion: 'calibracion' }],
    [{ lineaPublicada: 1, detalle: 'Luminancímetros' }, { lineaPublicada: 2, detalle: 'calibracion' }],
  );
  assert.deepEqual(r.existentePorFila, [213, 228]);
  assert.deepEqual(r.duplicados, [227]);
});

test('un producto sin correlativo con OTRA descripción no se marca duplicado ni se toca', () => {
  const r = emparejarProductos(
    [{ id: 1, correlativo: 1, descripcion: 'A' }, { id: 2, correlativo: null, descripcion: 'flete especial' }],
    [{ lineaPublicada: 1, detalle: 'A' }],
  );
  assert.deepEqual(r.duplicados, []);
});

test('fila nueva sin coincidencia se crea; sin línea usa el primer libre sin correlativo (comportamiento de siempre)', () => {
  const r = emparejarProductos([{ id: 5, correlativo: null, descripcion: 'X' }], [{ lineaPublicada: 3, detalle: 'Y' }, { lineaPublicada: null, detalle: 'Z' }]);
  assert.deepEqual(r.existentePorFila, [null, 5]);
});

test('dos filas con la misma descripción no reclaman el mismo producto', () => {
  const r = emparejarProductos([{ id: 1, correlativo: null, descripcion: 'silla' }], [{ lineaPublicada: 1, detalle: 'silla' }, { lineaPublicada: 2, detalle: 'silla' }]);
  assert.deepEqual(r.existentePorFila, [1, null]);
});

test('compara sin tildes ni mayúsculas', () => {
  const r = emparejarProductos([{ id: 9, correlativo: null, descripcion: 'Calibración' }], [{ lineaPublicada: 2, detalle: 'calibracion' }]);
  assert.deepEqual(r.existentePorFila, [9]);
});

test('caso real #415: un grupo de suma alzada comparte la «Línea 2» entre 5 productos — se reutilizan, no se duplican en cada sincronización', () => {
  const filas = ['Locker', 'Bancas', 'Estante', 'Mesas', 'Carro'].map(d => ({ lineaPublicada: 2, detalle: d }));
  const existentes = filas.map((f, i) => ({ id: 100 + i, correlativo: 2, descripcion: f.detalle }));
  const r = emparejarProductos(existentes, filas);
  assert.deepEqual(r.existentePorFila, [100, 101, 102, 103, 104]);
  assert.deepEqual(r.duplicados, []);
});

test('#415: las copias ya duplicadas (mismo texto, misma línea) quedan como sobrantes y no reclaman el lugar del original', () => {
  const filas = [{ lineaPublicada: 2, detalle: 'Locker' }, { lineaPublicada: 2, detalle: 'Bancas' }];
  const existentes = [
    { id: 1, correlativo: 2, descripcion: 'Locker' }, { id: 2, correlativo: 2, descripcion: 'Bancas' },
    { id: 3, correlativo: 2, descripcion: 'Locker' }, { id: 4, correlativo: 2, descripcion: 'Bancas' },
  ];
  const r = emparejarProductos(existentes, filas);
  assert.deepEqual(r.existentePorFila, [1, 2]);
  assert.deepEqual(r.duplicados, [3, 4]);
});

test('#415: si una descripción cambió dentro del grupo, la fila toma el producto libre de su línea sin robarle el suyo a otra fila', () => {
  const filas = [{ lineaPublicada: 2, detalle: 'Locker nuevo nombre' }, { lineaPublicada: 2, detalle: 'Bancas' }];
  const existentes = [{ id: 1, correlativo: 2, descripcion: 'Locker' }, { id: 2, correlativo: 2, descripcion: 'Bancas' }];
  const r = emparejarProductos(existentes, filas);
  assert.deepEqual(r.existentePorFila, [1, 2]);
});
