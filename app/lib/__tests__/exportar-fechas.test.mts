// Formato de fecha/hora de las exportaciones a Excel (18-ago-2026, pedido del usuario: fecha y hora
// en columnas separadas, y las del mismo día agrupadas).
//   npx tsx --test app/lib/__tests__/exportar-fechas.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { fechaHoraParaExcel, ordenarPorFecha, hojaDeFilas } from '../exportar-fechas';

test('fechaHoraParaExcel: separa en dos columnas, fecha real (día de Chile) y hora de Chile', () => {
  // 17:00 UTC = 13:00 en Chile (UTC-4). El cierre real de 2296-48-LE26.
  const r = fechaHoraParaExcel('2026-08-18T17:00:00.000Z');
  assert.equal(r.iso, '2026-08-18');
  assert.equal(r.hora, '13:00');
  const f = r.fecha as Date;
  assert.deepEqual([f.getFullYear(), f.getMonth() + 1, f.getDate()], [2026, 8, 18]);
});

// 02:00 UTC del 19 sigue siendo el 18 por la noche en Chile: la fecha NO debe correrse un día.
test('fechaHoraParaExcel: usa el día de Chile, no el de UTC', () => {
  assert.equal(fechaHoraParaExcel('2026-08-19T02:00:00.000Z').iso, '2026-08-18');
});

test('hoja de Excel: la fecha sale como fecha real con formato dd-mm-yyyy', () => {
  const ws = hojaDeFilas(XLSX, [{ Cierre: fechaHoraParaExcel('2026-08-09T17:00:00.000Z').fecha }]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'x');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const leido = XLSX.read(buf, { type: 'buffer', cellNF: true });
  const celda = leido.Sheets['x']['A2'];
  assert.equal(celda.t, 'n');
  assert.equal(celda.v, 46243); // 9-ago-2026 como serie de Excel, entera (sin hora)
  assert.equal(celda.z, 'dd-mm-yyyy');
  assert.equal(XLSX.utils.format_cell(celda), '09-08-2026');
});

test('fechaHoraParaExcel: valores vacíos o inválidos no producen "Invalid Date"', () => {
  for (const v of [null, undefined, '', 'no es fecha']) {
    assert.deepEqual(fechaHoraParaExcel(v as any), { fecha: '', hora: '', iso: '' });
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
