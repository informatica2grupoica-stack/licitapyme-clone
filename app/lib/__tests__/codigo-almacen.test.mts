// El código con que se guardan los documentos de una empresa («c4:CODIGO») vuelve al código de la licitación; ICA y los oficiales quedan igual.
import test from 'node:test';
import assert from 'node:assert/strict';
import { codigoDeAlmacen, codigoAlmacenDocs } from '../tenant';

test('empresa cliente: quita su prefijo', () => assert.equal(codigoDeAlmacen(4, 'c4:123-45-LE26'), '123-45-LE26'));
test('empresa cliente: un código oficial queda igual', () => assert.equal(codigoDeAlmacen(4, '123-45-LE26'), '123-45-LE26'));
test('empresa cliente: no quita el prefijo de otra empresa', () => assert.equal(codigoDeAlmacen(4, 'c2:123-45-LE26'), 'c2:123-45-LE26'));
test('ICA: el código queda tal cual', () => assert.equal(codigoDeAlmacen(1, '123-45-LE26'), '123-45-LE26'));
test('ida y vuelta', () => { for (const c of [1, 2, 4]) assert.equal(codigoDeAlmacen(c, codigoAlmacenDocs(c, 'X-1')), 'X-1'); });
