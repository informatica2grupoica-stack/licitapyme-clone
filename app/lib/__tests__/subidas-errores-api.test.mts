// Tope de 20 MB y extensiones de las subidas de Compras + mensajes de error que pueden verse en pantalla (02-nov-2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorDeArchivoSubido, MAX_SUBIDA_BYTES } from '../subidas';
import { mensajeSeguro } from '../errores-api';

test('subidas: 20 MB exactos pasan, un byte más no', () => {
  assert.equal(errorDeArchivoSubido({ name: 'cot.pdf', size: MAX_SUBIDA_BYTES }), null);
  assert.match(errorDeArchivoSubido({ name: 'cot.pdf', size: MAX_SUBIDA_BYTES + 1 })!, /20 MB/);
});
test('subidas: svg, html y ejecutables se rechazan; pdf/docx/xlsx/imagen pasan', () => {
  for (const n of ['a.svg', 'a.html', 'a.exe', 'a.js', 'sin_extension']) assert.ok(errorDeArchivoSubido({ name: n, size: 10 }), n);
  for (const n of ['A.PDF', 'b.docx', 'c.xlsx', 'd.jpg', 'e.png', 'f.zip']) assert.equal(errorDeArchivoSubido({ name: n, size: 10 }), null, n);
});
test('errores: un mensaje de negocio se muestra tal cual', () => {
  assert.equal(mensajeSeguro(new Error('Falta el link (Link 1) donde cotizaste el costo real.'), 'No se pudo'), 'Falta el link (Link 1) donde cotizaste el costo real.');
});
test('errores: los del sistema (MySQL, red, código) no salen al navegador', () => {
  assert.equal(mensajeSeguro(Object.assign(new Error("Unknown column 'x' in 'field list'"), { code: 'ER_BAD_FIELD_ERROR', sqlMessage: 'x' }), 'No se pudo'), 'No se pudo');
  assert.equal(mensajeSeguro(new Error('connect ECONNREFUSED 127.0.0.1:3306'), 'No se pudo'), 'No se pudo');
  assert.equal(mensajeSeguro(new Error("Cannot read properties of undefined (reading 'id')"), 'No se pudo'), 'No se pudo');
  assert.equal(mensajeSeguro(new Error('boom at fn (D:/app/lib/x.ts:10:5)'), 'No se pudo'), 'No se pudo');
  assert.equal(mensajeSeguro(null, 'No se pudo'), 'No se pudo');
  assert.equal(mensajeSeguro(new Error(''), 'No se pudo'), 'No se pudo');
});
