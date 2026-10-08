import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretarPlazoOfertado, sugerirReloj } from '../compras-reloj-sugerido';

test('plazo ofertado: hábiles, corridos y sin tipo (se asume corridos y se avisa)', () => {
  assert.deepEqual(interpretarPlazoOfertado('15 Días hábiles'), { dias: 15, tipo: 'HABILES', inferido: false });
  assert.deepEqual(interpretarPlazoOfertado('45 días corridos — Entrega en bodega del cliente'), { dias: 45, tipo: 'CORRIDOS', inferido: false });
  assert.deepEqual(interpretarPlazoOfertado('30 dias'), { dias: 30, tipo: 'CORRIDOS', inferido: true });
  assert.equal(interpretarPlazoOfertado('inmediata'), null);
  assert.equal(interpretarPlazoOfertado(null), null);
});

test('reloj sugerido: parte de la aceptación de la OC; sin OC o sin plazo no inventa nada', () => {
  const s = sugerirReloj({ aceptadaAt: '2026-10-05', emitidaAt: '2026-10-04', plazoOfertadoTexto: '15 Días hábiles' });
  assert.equal(s?.fechaInicio, '2026-10-05'); assert.equal(s?.origenFecha, 'aceptacion_oc'); assert.equal(s?.plazoTipo, 'HABILES');
  assert.equal(sugerirReloj({ aceptadaAt: null, emitidaAt: '2026-10-04 10:00:00', plazoOfertadoTexto: '10 días corridos' })?.origenFecha, 'emision_oc');
  assert.equal(sugerirReloj({ aceptadaAt: null, emitidaAt: null, plazoOfertadoTexto: '10 días' }), null);
  assert.equal(sugerirReloj({ aceptadaAt: '2026-10-05', emitidaAt: null, plazoOfertadoTexto: null }), null);
});
