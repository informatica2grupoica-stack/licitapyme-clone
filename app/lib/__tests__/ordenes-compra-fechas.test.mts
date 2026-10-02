// La fecha de la OC se guarda TAL CUAL la entrega la API de Mercado Público (hora de Chile), sin pasar
// por UTC. Bug real 1-oct-2026: se guardaba +3/+4 h y una OC aceptada a las 22:31 quedaba con el día siguiente.
//   npx tsx --test app/lib/__tests__/ordenes-compra-fechas.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fechaMySQL } from '../ordenes-compra';

test('fechaMySQL conserva la hora que entrega la API (casos reales comparados contra MP)', () => {
  assert.equal(fechaMySQL('2026-09-02T20:45:03.887'), '2026-09-02 20:45:03'); // antes: 2026-09-03 00:45:03
  assert.equal(fechaMySQL('2026-06-10T22:31:46.99'), '2026-06-10 22:31:46');   // antes: día 11
  assert.equal(fechaMySQL('2026-08-13T15:36:01'), '2026-08-13 15:36:01');
});

test('fechaMySQL: no depende de la zona del proceso', () => {
  for (const tz of ['America/Santiago', 'UTC', 'Asia/Tokyo']) {
    process.env.TZ = tz;
    assert.equal(fechaMySQL('2026-09-02T20:45:03.887'), '2026-09-02 20:45:03');
  }
});

test('fechaMySQL: formato DD-MM-YYYY hh:mm:ss y solo fecha', () => {
  assert.equal(fechaMySQL('02-09-2026 20:45:03'), '2026-09-02 20:45:03');
  assert.equal(fechaMySQL('2026-09-02'), '2026-09-02 00:00:00');
});

test('fechaMySQL: con zona explícita se lleva a hora de Chile', () => {
  // 2026-09-03T00:45:03Z = 20:45 del 2 en Chile (UTC-4: el horario de verano parte el 6-sep)
  assert.equal(fechaMySQL('2026-09-03T00:45:03Z'), '2026-09-02 20:45:03');
});

test('fechaMySQL: vacío o inválido → null', () => {
  for (const v of [null, undefined, '', 'no es fecha']) assert.equal(fechaMySQL(v), null);
});
