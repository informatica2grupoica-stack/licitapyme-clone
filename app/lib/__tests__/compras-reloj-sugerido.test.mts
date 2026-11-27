import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretarPlazoOfertado } from '../compras-reloj-sugerido';

test('plazo ofertado: hábiles, corridos y sin tipo (se asume corridos y se avisa)', () => {
  assert.deepEqual(interpretarPlazoOfertado('15 Días hábiles'), { dias: 15, tipo: 'HABILES', inferido: false });
  assert.deepEqual(interpretarPlazoOfertado('45 días corridos — Entrega en bodega del cliente'), { dias: 45, tipo: 'CORRIDOS', inferido: false });
  assert.deepEqual(interpretarPlazoOfertado('30 dias'), { dias: 30, tipo: 'CORRIDOS', inferido: true });
  assert.equal(interpretarPlazoOfertado('inmediata'), null);
  assert.equal(interpretarPlazoOfertado(null), null);
});
