// Tests de las piezas PURAS de auditor-comparacion-masiva.ts (26-ago-2026, auditoría técnica —
// el módulo no tenía ningún test). El resto del archivo depende de DB/IA/red (jobs de fondo,
// polling, llamadas a documentos_cache) y no se testea acá — la lógica que realmente causó el bug
// real "solo 3 de 88 líneas" (19-ago-2026, 3489-29-LP26) vive en auditor-segmentacion.ts y
// auditor-tecnico.ts, ambos con su propio test file.
// Correr con:
//   npx tsx --test app/lib/__tests__/auditor-comparacion-masiva.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mensajeDeError, nombreDeItem } from '../auditor-comparacion-masiva';

test('nombreDeItem quita el prefijo "Línea N — " que pone el checklist', () => {
  assert.equal(nombreDeItem('Línea 12 — SILLA DE RUEDAS'), 'SILLA DE RUEDAS');
  assert.equal(nombreDeItem('Línea 1 - Camilla'), 'Camilla');       // guion simple
  assert.equal(nombreDeItem('linea 3 – Monitor'), 'Monitor');        // en-dash, minúscula
});

test('nombreDeItem no toca un título que no trae el prefijo de línea', () => {
  assert.equal(nombreDeItem('SILLA DE RUEDAS'), 'SILLA DE RUEDAS');
});

test('nombreDeItem con título vacío/undefined no revienta', () => {
  assert.equal(nombreDeItem(''), '');
  assert.equal(nombreDeItem(undefined as unknown as string), '');
});

// mensajeDeError decide qué le dice el usuario cuando la corrida falla — que el mensaje sea claro
// y accionable (no un stack trace) es lo que evita que el usuario reintente a ciegas sin saber
// si vale la pena.
test('mensajeDeError reconoce 429/cuota y sugiere reintentar más tarde', () => {
  assert.match(mensajeDeError(new Error('429 Too Many Requests')), /sin cuota/i);
  assert.match(mensajeDeError(new Error('quota exceeded for this model')), /sin cuota/i);
});

test('mensajeDeError reconoce 503/saturación', () => {
  assert.match(mensajeDeError(new Error('503 Service Unavailable')), /saturad/i);
  assert.match(mensajeDeError(new Error('el servicio está saturado')), /saturad/i);
});

test('mensajeDeError con un error genérico da un mensaje accionable, no un stack crudo', () => {
  const msg = mensajeDeError(new Error('ECONNRESET at socket.js:123'));
  assert.match(msg, /No se pudo completar la comparación/);
  assert.match(msg, /ECONNRESET/);
});

test('mensajeDeError con algo que no es un Error (string suelto) no revienta', () => {
  const msg = mensajeDeError('fallo raro sin Error object');
  assert.match(msg, /No se pudo completar la comparación/);
});
