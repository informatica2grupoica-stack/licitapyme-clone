// Tests de detectarDeltaForo() — la pieza pura de control-foro.ts (26-ago-2026, auditoría
// técnica; el módulo no tenía ningún test). Esta función decide si un bloque APROBADO del
// checklist debe revertirse a OBSERVADO porque el organismo cambió algo en el foro de preguntas
// mientras se preparaba la oferta — un falso negativo acá deja pasar una aclaración real sin
// avisar; un falso positivo revierte aprobaciones sin necesidad.
// Correr con:
//   npx tsx --test app/lib/__tests__/control-foro.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectarDeltaForo } from '../control-foro';
import type { PreguntaRespuesta } from '../mp-preguntas-respuestas';

function pr(numero: number | null, pregunta: string, respuesta: string | null): PreguntaRespuesta {
  return { numero, fechaPregunta: null, pregunta, fechaRespuesta: null, respuesta };
}

test('sin cambios entre las dos fotos, no hay delta', () => {
  const foto = [pr(1, '¿Se acepta factura electrónica?', 'Sí, se acepta.')];
  assert.deepEqual(detectarDeltaForo(foto, foto), []);
});

test('una pregunta con número nuevo (no estaba en la foto anterior) es PREGUNTA_NUEVA', () => {
  const anterior = [pr(1, '¿Se acepta factura electrónica?', 'Sí.')];
  const actual = [...anterior, pr(2, '¿Cuál es el plazo de entrega máximo?', null)];
  const delta = detectarDeltaForo(anterior, actual);
  assert.equal(delta.length, 1);
  assert.equal(delta[0].tipo, 'PREGUNTA_NUEVA');
  assert.equal(delta[0].numero, 2);
});

test('una pregunta que antes no tenía respuesta y ahora sí es RESPUESTA_PUBLICADA', () => {
  const anterior = [pr(2, '¿Cuál es el plazo de entrega máximo?', null)];
  const actual = [pr(2, '¿Cuál es el plazo de entrega máximo?', '15 días corridos.')];
  const delta = detectarDeltaForo(anterior, actual);
  assert.equal(delta.length, 1);
  assert.equal(delta[0].tipo, 'RESPUESTA_PUBLICADA');
  assert.equal(delta[0].numero, 2);
});

// El caso que justifica la reversión de aprobación: el organismo YA había respondido, pero
// corrige el contenido de la respuesta (una aclaración posterior, una fe de erratas).
test('una respuesta ya publicada que CAMBIA de contenido es CONTENIDO_CAMBIO', () => {
  const anterior = [pr(3, '¿Se puede ofertar en cuotas?', 'No se acepta.')];
  const actual = [pr(3, '¿Se puede ofertar en cuotas?', 'Se acepta hasta en 3 cuotas.')];
  const delta = detectarDeltaForo(anterior, actual);
  assert.equal(delta.length, 1);
  assert.equal(delta[0].tipo, 'CONTENIDO_CAMBIO');
});

test('una respuesta idéntica letra por letra NO genera delta (no re-dispara el mismo aviso)', () => {
  const anterior = [pr(3, '¿Se puede ofertar en cuotas?', 'No se acepta.')];
  const actual = [pr(3, '¿Se puede ofertar en cuotas?', 'No se acepta.')];
  assert.deepEqual(detectarDeltaForo(anterior, actual), []);
});

test('preguntas SIN número (numero=null) se ignoran — no hay cómo emparejarlas de forma estable', () => {
  const anterior: PreguntaRespuesta[] = [];
  const actual = [pr(null, 'Pregunta sin número asignado por el portal', null)];
  assert.deepEqual(detectarDeltaForo(anterior, actual), []);
});

test('una pregunta que desaparece del foro actual no genera delta (solo se mira ACTUAL vs anterior)', () => {
  const anterior = [pr(1, 'Pregunta A', 'Respuesta A'), pr(2, 'Pregunta B', 'Respuesta B')];
  const actual = [pr(1, 'Pregunta A', 'Respuesta A')];   // la 2 ya no viene en el scrape actual
  assert.deepEqual(detectarDeltaForo(anterior, actual), [], 'el módulo compara ACTUAL contra anterior, no al revés');
});

test('varios cambios a la vez se reportan todos, cada uno con su número', () => {
  const anterior = [
    pr(1, 'Pregunta A', null),
    pr(2, 'Pregunta B', 'Respuesta original'),
  ];
  const actual = [
    pr(1, 'Pregunta A', 'Ahora sí respondida'),
    pr(2, 'Pregunta B', 'Respuesta corregida'),
    pr(3, 'Pregunta C nueva', null),
  ];
  const delta = detectarDeltaForo(anterior, actual);
  assert.equal(delta.length, 3);
  assert.deepEqual(delta.map(d => d.tipo).sort(), ['CONTENIDO_CAMBIO', 'PREGUNTA_NUEVA', 'RESPUESTA_PUBLICADA'].sort());
});

test('fotos vacías no revientan', () => {
  assert.deepEqual(detectarDeltaForo([], []), []);
});
