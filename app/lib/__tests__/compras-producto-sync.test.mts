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
