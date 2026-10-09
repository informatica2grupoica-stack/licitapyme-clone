import test from 'node:test';
import assert from 'node:assert/strict';
import { requisitosDelProducto } from '../auditor-tecnico-v2';

const r = (n: number, texto: string, producto?: string) => ({ n, texto, fuente: 'bases', criticidad: 'SIN_CLASIFICAR' as const, producto });

test('una línea con varios productos deja solo los del producto pedido, renumerados', () => {
  const todos = [r(1, 'Estructura metálica', 'Banca de camarín'), r(2, 'Dimensiones 150×45', 'Banca de camarín'), r(3, 'Estantes de 5 niveles', 'Biblioteca'), r(4, '3 cuerpos', 'Sofá 3 cuerpos'), r(5, '2 cuerpos', 'Sofá 2 cuerpos')];
  const banca = requisitosDelProducto(todos, 'Banca de camarín');
  assert.deepEqual(banca.map(x => [x.n, x.texto]), [[1, 'Estructura metálica'], [2, 'Dimensiones 150×45']]);
  assert.deepEqual(requisitosDelProducto(todos, 'Biblioteca').map(x => [x.n, x.texto]), [[1, 'Estantes de 5 niveles']]);
  assert.equal(requisitosDelProducto(todos, 'Sofá 2 cuerpos').length, 1);
});

test('una línea de un solo producto (sin rótulos) se devuelve completa', () => {
  const unico = [r(1, 'Pantalla 55"'), r(2, '4K')];
  assert.equal(requisitosDelProducto(unico, 'TELEVISOR 55"').length, 2);
});

test('un producto que no está rotulado en la línea no hereda los de los demás', () => {
  assert.deepEqual(requisitosDelProducto([r(1, 'x', 'Biblioteca')], 'Velador'), []);
});
