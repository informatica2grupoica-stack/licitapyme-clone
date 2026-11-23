// Monto costeado = solo las líneas que ganamos.
//   npx tsx --test app/lib/__tests__/compras-costeo-ganadas.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costeoSoloGanadas } from '../compras-costeo-ganadas';

const fila = (lineaReal: number | null, cantidad: number, costo: number, o: any = {}): any =>
  ({ id: `${lineaReal}-${cantidad}-${costo}`, lineaReal, cantidad, costoRegistradoNeto: costo, costoEstimadoNeto: costo, ofertamos: true, esGastoExtra: false, ...o });

test('gana solo la línea 5 de 2 postuladas: resta el costo de la 1', () => {
  const r = costeoSoloGanadas(1000, [fila(1, 2, 100), fila(1, 1, 300), fila(5, 1, 500)],
    [{ correlativo: 1, esNuestra: false, rutProveedor: '1-9' }, { correlativo: 5, esNuestra: true }]);
  assert.equal(r.costo, 500); assert.deepEqual(r.ganadas, [5]); assert.deepEqual(r.perdidas, [1]); assert.equal(r.parcial, true);
});
test('gana todo: el total no cambia', () => {
  const r = costeoSoloGanadas(1000, [fila(1, 1, 400), fila(5, 1, 600)], [{ correlativo: 1, esNuestra: true }, { correlativo: 5, esNuestra: true }]);
  assert.equal(r.costo, 1000); assert.equal(r.parcial, false);
});
test('línea sin proveedor en el acta (desierta) no se resta; líneas no postuladas tampoco', () => {
  const r = costeoSoloGanadas(1000, [fila(5, 1, 1000), fila(2, 1, 50, { ofertamos: false })],
    [{ correlativo: 2, esNuestra: false, rutProveedor: '1-9' }, { correlativo: 3, esNuestra: false, rutProveedor: null }, { correlativo: 5, esNuestra: true }]);
  assert.equal(r.costo, 1000); assert.equal(r.parcial, false);
});
test('filas sin número de línea se avisan y no se restan', () => {
  const r = costeoSoloGanadas(1000, [fila(null, 1, 300), fila(1, 1, 700)], [{ correlativo: 1, esNuestra: false, rutProveedor: '1-9' }]);
  assert.equal(r.costo, 300); assert.equal(r.filasSinLinea, true);
});
