import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plazoOfertado, plazoCabe, esPlazoHabil, aCorridos } from '../compras-plazo-proveedor';

test('45 días hábiles NO caben en 15 días hábiles ofertados', () => {
  const r = plazoCabe({ dias: 45, habiles: true }, plazoOfertado('15 Días hábiles', 15)!);
  assert.equal(r.cabe, false);
  assert.equal(r.proveedorCorridos, 63);
  assert.equal(r.limiteCorridos, 21);
});
test('7 días hábiles caben en 15 días hábiles', () => {
  assert.equal(plazoCabe({ dias: 7, habiles: true }, { dias: 15, habiles: true }).cabe, true);
});
test('corridos contra hábiles se compara en corridos', () => {
  assert.equal(plazoCabe({ dias: 10, habiles: false }, { dias: 15, habiles: true }).cabe, true);   // 10 <= 21
  assert.equal(plazoCabe({ dias: 25, habiles: false }, { dias: 15, habiles: true }).cabe, false);  // 25 > 21
});
test('sin dato no hay plazo ofertado', () => {
  assert.equal(plazoOfertado('algo', null), null);
  assert.equal(plazoOfertado('algo', 0), null);
  assert.equal(esPlazoHabil('30 días hábiles (plazo estimado)'), true);
  assert.equal(aCorridos({ dias: 10, habiles: false }), 10);
});
