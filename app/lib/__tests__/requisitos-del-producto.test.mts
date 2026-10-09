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

// REGRESIÓN 387-55-LE26: la «línea 1» del informe agrupaba 21 muebles (84 requisitos) y el Auditor se los pasaba TODOS a cada producto.
import { requisitosParaLinea } from '../auditor-tecnico-v2';
import { readFileSync } from 'node:fs';

test('requisitosParaLinea: cada mueble recibe solo los suyos, nunca la lista completa', () => {
  const nombres = ['Banca de camarín', 'Biblioteca', 'Butaca de 3 cuerpos', 'Velador'];
  const todos = nombres.flatMap((p, i) => [r(i * 10 + 1, `req A de ${p}`, p), r(i * 10 + 2, `req B de ${p}`, p)]);
  for (const p of nombres) {
    const mios = requisitosParaLinea(todos, p);
    assert.equal(mios.length, 2);
    assert.ok(mios.every(x => x.producto === p));
  }
  assert.deepEqual(requisitosParaLinea(todos, 'Producto que no existe'), []);
});

test('el comparador del Auditor filtra por producto SIEMPRE (usa el nombre de la línea si no le pasan uno)', () => {
  const src = readFileSync(new URL('../auditor-comparador-v3.ts', import.meta.url), 'utf8');
  assert.match(src, /const productoReq = soloProducto \|\| nombreLinea;/);
  assert.match(src, /requisitosDeLinea\(negocioId, licitacionCodigo, lineaReal, productoReq\)/);
});

test('todo consumidor de requisitosDeLinea pasa el producto del ítem (nunca los requisitos de toda la línea del informe)', () => {
  const ver = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
  assert.match(ver('../auditor-prepostulacion.ts'), /requisitosDeLinea\(negocioId, licitacionCodigo, l\.lineaReal, /);
  assert.match(ver('../auditor-tecnico-v2.ts'), /requisitosDeLinea\(negocioId, licitacionCodigo, lineaReal, nombreLinea\)/);
  assert.match(ver('../auditor-opciones.ts'), /est\.resultado\.filas\.length !== reqTotal/);   // una comparación con requisitos ajenos no se muestra
});
