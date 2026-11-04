// Ruteo de fichas en Compras (negocio 296, 1191688-50-LE26): varias líneas del costeo bajo el mismo ítem + ficha con hoja de condiciones sin precios.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { esSoloComercial } from '../compras-fichas';
const src = readFileSync(new URL('../compras-fichas.ts', import.meta.url), 'utf8');

test('el producto de una línea se busca contra TODAS las líneas (con correlativo repetido, la ficha de los fonos caía en el pantalón)', () => {
  assert.match(src, /const productoDeLinea = \(linea: LineaCosteo, productos: ProductoCompra\[\], lineas: LineaCosteo\[\]\)/);
  assert.doesNotMatch(src, /lineaDeProducto\(p, \[linea\]\)/);
});

const prod = (o: any) => ({ marca: '', modelo: '', sku: '', precio: null, preciosMultiples: [], ...o });
test('una ficha con hoja de condiciones comerciales pero sin precios sigue siendo ficha', () => {
  assert.equal(esSoloComercial('cotizacion_formal', [prod({ marca: 'Andes Work', modelo: 'AW-POL-ROC' })] as any), false);
});
test('una cotización con precios, o sin marca/modelo, no es ficha', () => {
  assert.equal(esSoloComercial('cotizacion_formal', [prod({ marca: 'Andes Work', modelo: 'AW-POL-ROC', precio: 1000 })] as any), true);
  assert.equal(esSoloComercial('cotizacion_formal', [prod({})] as any), true);
  assert.equal(esSoloComercial('ficha_tecnica', [prod({ precio: 1000 })] as any), false);
});

test('el resumen de características de la ficha se le pasa a la IA que decide la línea (acotado y sin vacíos)', async () => {
  const { resumenCaracteristicas } = await import('../compras-fichas');
  assert.equal(resumenCaracteristicas(undefined), '');
  assert.equal(resumenCaracteristicas({ caracteristicas: [{ nombre: 'Color', valor: 'Amarillo fluorescente' }, { nombre: 'Norma', valor: '' }, { nombre: 'Cintas', valor: 'reflectantes 50 mm' }] }), ' — según la ficha: Color: Amarillo fluorescente; Cintas: reflectantes 50 mm');
  assert.ok(resumenCaracteristicas({ caracteristicas: Array.from({ length: 50 }, (_, i) => ({ nombre: `c${i}`, valor: 'x'.repeat(30) })) }).length < 400);
  assert.ok(src.includes('resumenCaracteristicas(ex.data!.salida.productos?.[idx])'));
});
