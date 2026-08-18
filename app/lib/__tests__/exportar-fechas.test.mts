// Formato de fecha/hora de las exportaciones a Excel (18-ago-2026, pedido del usuario: fecha y hora
// en columnas separadas, y las del mismo día agrupadas).
//   npx tsx --test app/lib/__tests__/exportar-fechas.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fechaHoraParaExcel, ordenarPorFecha } from '../exportar-fechas';

test('fechaHoraParaExcel: separa en dos columnas, fecha en ISO y hora de Chile', () => {
  // 17:00 UTC = 13:00 en Chile (UTC-4). El cierre real de 2296-48-LE26.
  const r = fechaHoraParaExcel('2026-08-18T17:00:00.000Z');
  assert.equal(r.fecha, '2026-08-18');
  assert.equal(r.hora, '13:00');
});

test('fechaHoraParaExcel: valores vacíos o inválidos no producen "Invalid Date"', () => {
  for (const v of [null, undefined, '', 'no es fecha']) {
    assert.deepEqual(fechaHoraParaExcel(v as any), { fecha: '', hora: '' });
  }
});

// El formato ISO es lo que hace que el orden alfabético de Excel sea el cronológico. Con el formato
// anterior (DD-MM-YYYY como texto) "09-08" quedaba DESPUÉS de "18-08" y las del mismo día salían
// desparramadas por toda la planilla.
test('la fecha ISO ordena cronológicamente como texto', () => {
  const dias = ['2026-08-18', '2026-08-09', '2026-08-13', '2026-08-11'];
  assert.deepEqual([...dias].sort(), ['2026-08-09', '2026-08-11', '2026-08-13', '2026-08-18']);
});

test('ordenarPorFecha: agrupa por día, desempata por hora y manda las sin fecha al final', () => {
  const filas = [
    { id: 'c', f: '2026-08-13', h: '16:00' },
    { id: 'x', f: '', h: '' },
    { id: 'a', f: '2026-08-11', h: '12:00' },
    { id: 'b', f: '2026-08-13', h: '09:30' },
    { id: 'd', f: '2026-08-09', h: '15:00' },
  ];
  const orden = ordenarPorFecha(filas, f => f.f, f => f.h).map(f => f.id);
  // 09 → 11 → 13 (las dos del 13 juntas, la de las 09:30 antes) → sin fecha al final.
  assert.deepEqual(orden, ['d', 'a', 'b', 'c', 'x']);
});

test('ordenarPorFecha no muta el arreglo original', () => {
  const filas = [{ f: '2026-08-13' }, { f: '2026-08-09' }];
  ordenarPorFecha(filas, f => f.f);
  assert.equal(filas[0].f, '2026-08-13');
});
