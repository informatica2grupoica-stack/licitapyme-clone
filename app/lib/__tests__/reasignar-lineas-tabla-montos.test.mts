// 1057448-45-LP26: 6 ítems con monto propio; el modelo los emitió todos como L1.
//   npx tsx --test app/lib/__tests__/reasignar-lineas-tabla-montos.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reasignarLineasPorTablaDeMontos, type FilaManifiesto } from '../viabilidad-v4/productos';

const fila = (descripcion: string, cantidad: number): FilaManifiesto => ({
  linea: 1, categoria: null, descripcion, modelo: '', cantidad, unidad_medida: '', unidad_inferida: true, presupuesto_linea: 36250000, tipo: 'generico', ruta: '',
});
const porLinea = [
  [1, 'GABINETE ALMACENAMIENTO DE LÁMINAS 29 Equipamiento 40001311-0 $36.250.000.-'],
  [2, 'GABINETE ALMACENAMIENTO DE TACOS 48 Equipamiento 40001311-0 $60.000.000.-'],
  [3, 'ESTUFA DE SECADO 2 Equipos 40001311-0 $14.242.000.-'],
  [4, 'IMPRESORA DE LAMINAS 4 Equipos 40001311-0 $85.680.000.-'],
  [5, 'CENTRO DE INCLUSION CON PLACA DE ENFRIAMIENTO 1 Equipos 40001311-0 $28.322.000.-'],
  [6, 'PLACA DE ENFRIAMIENTO 3 Equipos 40001311-0 $17.136.000.-'],
].map(([numero, frase]) => ({ numero: numero as number, cita: { frase: frase as string } }));

test('los 6 ítems quedan en L1..L6 aunque el modelo los puso todos en L1 (y con palabras partidas)', () => {
  const man = [
    fila('PLACA DE ENFRIAMIENTO', 3), fila('GABINETE ALMACENAMIEN TO DE LAMINAS', 29), fila('GABINETE ALMACENAMIENTO DE TACOS', 48),
    fila('ESTUFA DE SECADO', 2), fila('IMPRESORA DE LÁMINAS', 4), fila('CENTRO DE INCLUSIÓN CON PLACA DE ENFRIAMIENTO', 1),
  ];
  const r = reasignarLineasPorTablaDeMontos(man, porLinea);
  assert.equal(r.cambiado, true);
  assert.deepEqual(man.map(m => [m.linea, m.cantidad]), [[1, 29], [2, 48], [3, 2], [4, 4], [5, 1], [6, 3]]);
});

test('no toca nada si las líneas ya estaban bien separadas o el cruce no cuadra', () => {
  const bien = [fila('GABINETE ALMACENAMIENTO DE LÁMINAS', 29), fila('GABINETE ALMACENAMIENTO DE TACOS', 48), fila('ESTUFA DE SECADO', 2), fila('IMPRESORA DE LÁMINAS', 4), fila('CENTRO DE INCLUSIÓN CON PLACA DE ENFRIAMIENTO', 1), fila('PLACA DE ENFRIAMIENTO', 3)];
  bien.forEach((m, i) => { m.linea = i + 1; });
  assert.equal(reasignarLineasPorTablaDeMontos(bien, porLinea).cambiado, false);
  const raro = [fila('SILLA', 1), fila('MESA', 2), fila('ESTUFA DE SECADO', 2), fila('X ITEM', 4), fila('OTRO COSA', 1), fila('PLACA DE ENFRIAMIENTO', 3)];
  assert.equal(reasignarLineasPorTablaDeMontos(raro, porLinea).cambiado, false);
  assert.ok(raro.every(m => m.linea === 1));
});
