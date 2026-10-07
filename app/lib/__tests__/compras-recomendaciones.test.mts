import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recomendarCombinaciones, type CombinacionMin } from '../compras-recomendaciones';

const c = (clave: string, costoTotal: number, diasEstimados: number | null, viajes: number, proveedores: string[], peorCumple = 'CUMPLE'): CombinacionMin =>
  ({ clave, costoTotal, diasEstimados, viajes, nProveedores: proveedores.length, proveedores, peorCumple });

const COMBOS = [
  c('A', 19_000_000, 30, 3, ['X', 'Y', 'Z']),
  c('B', 20_400_000, 10, 3, ['X', 'Y', 'W']),
  c('C', 20_100_000, 30, 1, ['ROMCO'], 'INFERIOR_NEGOCIABLE'),
  c('D', 21_000_000, 12, 1, ['Austral']),
  c('E', 22_300_000, 8, 1, ['Andes']),
  c('F', 19_800_000, 12, 2, ['X', 'Austral']),
];

test('se muestran pocas, no cientos', () => {
  assert.ok(recomendarCombinaciones(COMBOS).length <= 6);
});
test('más barata y más rápida salen de las que cumplen (la inferior no gana aunque sea barata)', () => {
  const r = recomendarCombinaciones(COMBOS);
  const barata = r.find(x => x.etiquetas.includes('MAS_BARATA'))!;
  const rapida = r.find(x => x.etiquetas.includes('MAS_RAPIDA'))!;
  assert.equal(barata.comb.clave, 'A');
  assert.equal(rapida.comb.clave, 'E');
});
test('«todo a un proveedor»: una por proveedor, de menor a mayor costo', () => {
  const uno = recomendarCombinaciones(COMBOS).filter(x => x.etiquetas.includes('UN_PROVEEDOR')).map(x => x.comb.clave);
  assert.deepEqual(uno.sort(), ['C', 'D', 'E']);   // un proveedor cada una
});
test('si una misma combinación gana varias etiquetas, sale una sola tarjeta con todas', () => {
  const r = recomendarCombinaciones([c('S', 10, 5, 1, ['Solo'])]);
  assert.equal(r.length, 1);
  assert.deepEqual([...r[0].etiquetas].sort(), ['EQUILIBRADA', 'MAS_BARATA', 'MAS_RAPIDA', 'UN_PROVEEDOR']);
});
test('sin combinaciones: nada', () => assert.deepEqual(recomendarCombinaciones([]), []));
test('si ninguna cumple, se recomienda entre las inferiores negociables', () => {
  const r = recomendarCombinaciones([c('P', 5, 9, 2, ['A', 'B'], 'INFERIOR_NEGOCIABLE'), c('Q', 6, 4, 2, ['A', 'C'], 'INFERIOR_NEGOCIABLE')]);
  assert.equal(r.find(x => x.etiquetas.includes('MAS_BARATA'))!.comb.clave, 'P');
  assert.equal(r.find(x => x.etiquetas.includes('MAS_RAPIDA'))!.comb.clave, 'Q');
});
