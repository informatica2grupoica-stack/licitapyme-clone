import test from 'node:test';
import assert from 'node:assert/strict';
import { describirAccionCompras, conBitacoraCompras } from '../compras-bitacora';

test('describe en español lo que hizo la persona', () => {
  const d = describirAccionCompras;
  assert.equal(d('POST', '/api/compras/1191/cotizaciones', {}), 'Registró una cotización');
  assert.equal(d('DELETE', '/api/compras/1191/cotizaciones/57', null), 'Eliminó la cotización #57');
  assert.equal(d('PATCH', '/api/compras/1191/aprobaciones', { tipo: 'COMPRA', decision: 'APROBAR' }), 'Aprobó la aprobación de compra');
  assert.equal(d('PATCH', '/api/compras/1191/aprobaciones', { tipo: 'MARGEN', decision: 'RECHAZAR' }), 'Rechazó la aprobación de margen');
  assert.equal(d('POST', '/api/compras/1191/fichas', { accion: 'complementar' }), 'Complementó un dato técnico de una ficha');
  assert.equal(d('POST', '/api/compras/1191/asignar', { coencargadoIds: [3] }), 'Cambió los otros encargados del negocio');
  assert.equal(d('POST', '/api/compras/1191/asignar', { encargadoId: 3 }), 'Asignó o cambió al encargado principal');
  assert.equal(d('POST', '/api/compras/1191/gastos', {}), 'Agregó un gasto extra');
  assert.match(d('PUT', '/api/compras/1191/algo-nuevo', {}), /Modificó «algo-nuevo»/);
});

test('el wrapper devuelve tal cual la respuesta del handler y no registra si hubo error', async () => {
  const resp = new Response('{"error":"x"}', { status: 400 });
  const h = conBitacoraCompras(async (_r: Request, _c: unknown) => resp, 'POST');
  const out = await h(new Request('http://x/api/compras/1/gastos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), { params: Promise.resolve({ negocioId: '1' }) });
  assert.equal(out, resp);
});
