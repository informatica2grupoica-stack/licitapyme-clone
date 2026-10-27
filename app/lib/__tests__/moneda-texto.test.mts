// La moneda que escribe el Lector a veces es una frase (4022-19-LE26, cinturón EQ-27): el verificador la comparaba con 'CLP'
// tal cual y bloqueaba el costo. Se saca el código; si no hay uno reconocible se deja el texto para que el verificador avise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monedaDeTexto } from '../moneda-texto';
import { normalizarProductos, verificarOpcion } from '../auditor-opciones-core';

test('monedaDeTexto: el código dentro de una frase, el caso real de 4022-19-LE26', () => {
  assert.equal(monedaDeTexto('CLP (INFERIDO DEL SÍMBOLO $ Y FORMATO DE MILES CHILENO; LA PÁGINA NO DECLARA MONEDA)'), 'CLP');
  assert.equal(monedaDeTexto('clp (inferido del símbolo $)'), 'CLP');
  assert.equal(monedaDeTexto('USD'), 'USD');
  assert.equal(monedaDeTexto('USD (equivalente a CLP 36.250)'), 'USD', 'manda el primero que aparece');
});

test('monedaDeTexto: nombres comunes y vacío', () => {
  assert.equal(monedaDeTexto('pesos chilenos'), 'CLP');
  assert.equal(monedaDeTexto('Peso'), 'CLP');
  assert.equal(monedaDeTexto('$'), 'CLP');
  assert.equal(monedaDeTexto('US$'), 'USD');
  assert.equal(monedaDeTexto('Dólares'), 'USD');
  assert.equal(monedaDeTexto('euros'), 'EUR');
  assert.equal(monedaDeTexto(''), 'CLP');
  assert.equal(monedaDeTexto(undefined), 'CLP');
});

test('monedaDeTexto: una moneda desconocida no se supone: se deja el texto', () => {
  assert.equal(monedaDeTexto('Zloty polaco'), 'ZLOTY POLACO');
});

test('el precio con una frase de moneda ya no queda bloqueado (cinturón EQ-27)', () => {
  const salida: any = { productos: [{ producto: { tipo: 'Cinturón' }, comercial: {
    precios: [{ valor: '$69.852' }], moneda: 'CLP (INFERIDO DEL SÍMBOLO $ Y FORMATO DE MILES CHILENO; LA PÁGINA NO DECLARA MONEDA)', iva: 'incluido', iva_texto_literal: 'IVA incluido',
  } }] };
  const [p] = normalizarProductos(salida);
  assert.equal(p.moneda, 'CLP');
  assert.equal(p.conversion, undefined);
});
