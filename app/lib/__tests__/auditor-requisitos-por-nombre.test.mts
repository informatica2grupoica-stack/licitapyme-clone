// 4022-19-LE26 (27-oct-2026): la viabilidad se re-analizó y puso los 7 productos bajo «L1», pero el costeo seguía con las líneas 1 a 7:
// las líneas 3 y 5 quedaron «sin requisitos técnicos» y su ficha no se comparaba. Se busca el producto por nombre en todo el informe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productosCrudosDeLinea, productoDeInformePorNombre } from '../auditor-tecnico-core';

const informe = { productos: { items: [
  { linea: 'L1', nombre: 'Panel Solar Enertik Policristalino 120W', caracteristicas: ['Panel Solar Enertik Policristalino 120W'] },
  { linea: 'L1', nombre: 'TUBO 4" X 3MM X 6 METROS GALVANIZADO', caracteristicas: ['TUBO 4" X 3MM X 6 METROS GALVANIZADO'] },
  { linea: 'L1', nombre: 'SmartSolar MPPT 100/50 | Victron', caracteristicas: ['SmartSolar MPPT 100/50 | Victron'] },
] } };

test('la línea 3 del costeo no existe en el informe (todo es L1)', () => {
  assert.equal(productosCrudosDeLinea(informe, 3).length, 0);
});

test('se encuentra el producto por nombre, ignorando tildes, mayúsculas y signos, y dice en qué línea del informe está', () => {
  const r = productoDeInformePorNombre(informe, 'Tubo 4" x 3mm x 6 metros galvanizado');
  assert.equal(r?.linea, 1);
  assert.deepEqual(r?.productos[0].caracteristicas, ['TUBO 4" X 3MM X 6 METROS GALVANIZADO']);
  assert.equal(productoDeInformePorNombre(informe, 'smartsolar mppt 100/50 victron')?.productos.length, 1);
});

test('sin coincidencia exacta no se adivina: nombre distinto, vacío, o dos productos con el mismo nombre', () => {
  assert.equal(productoDeInformePorNombre(informe, 'Tubo 4"'), null, 'una parte del nombre no basta');
  assert.equal(productoDeInformePorNombre(informe, ''), null);
  const repetido = { productos: { items: [
    { linea: 'L1', nombre: 'Mesa', caracteristicas: ['madera'] }, { linea: 'L2', nombre: 'Mesa', caracteristicas: ['metal'] },
  ] } };
  assert.equal(productoDeInformePorNombre(repetido, 'Mesa'), null, 'ambiguo: nunca mezclar los requisitos de otro ítem');
});
