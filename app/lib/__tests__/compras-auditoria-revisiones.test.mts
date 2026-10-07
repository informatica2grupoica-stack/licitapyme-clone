import { test } from 'node:test';
import assert from 'node:assert/strict';
import { revisionesPorCodigo } from '../compras-auditoria-cotizacion';

const prod: any = { id: 1, descripcion: 'Horno', cantidad: 1, montoUnitario: 16_243_500, correlativo: 1 };
const cot = (o: any = {}) => ({ plazo_entrega_dias: 7, plazo_entrega_texto: '7 dias habiles', vigencia_at: null, proveedor_rut: null, notas: null, descripcion_libre: null, ...o });
const lim15h = { dias: 15, habiles: true };

test('45 días hábiles contra 15 hábiles ofertados, sin reloj: NO_CUMPLE crítico', () => {
  const r = revisionesPorCodigo(cot({ plazo_entrega_dias: 45, plazo_entrega_texto: '45 dias habiles' }), prod, 14_200_000, null, lim15h);
  const p = r.find(x => x.area === 'plazo')!;
  assert.equal(p.resultado, 'NO_CUMPLE'); assert.equal(p.gravedad, 'critico');
});
test('7 días hábiles contra 15 hábiles: CUMPLE', () => {
  const p = revisionesPorCodigo(cot(), prod, 14_200_000, null, lim15h).find(x => x.area === 'plazo')!;
  assert.equal(p.resultado, 'CUMPLE');
});
test('sin reloj ni plazo ofertado: lo dice (no se calla)', () => {
  const p = revisionesPorCodigo(cot(), prod, 14_200_000, null, null).find(x => x.area === 'plazo')!;
  assert.equal(p.resultado, 'NO_VERIFICABLE');
});
test('precio 0 no es precio: sin "margen 100 %"', () => {
  const r = revisionesPorCodigo(cot(), prod, 0, null, lim15h);
  assert.ok(r.some(x => x.area === 'precio' && x.resultado === 'NO_VERIFICABLE'));
  assert.ok(!r.some(x => /Margen bruto/.test(x.explicacion)));
});
test('mínimo de venta mayor a lo necesario avisa', () => {
  const r = revisionesPorCodigo(cot({ notas: 'Precio valido solo comprando 2 unidades (minimo de venta)' }), prod, 14_200_000, null, lim15h);
  assert.ok(r.some(x => x.area === 'cantidad' && x.resultado === 'NO_CUMPLE'));
});
test('RUT inválido se marca', () => {
  const r = revisionesPorCodigo(cot({ proveedor_rut: '76.555.110-3' }), prod, 14_200_000, null, lim15h);
  assert.ok(r.some(x => x.area === 'proveedor' && x.resultado === 'NO_CUMPLE'));
});

test('vigencia vencida llega como Date desde MySQL y se detecta', () => {
  const r = revisionesPorCodigo(cot({ vigencia_at: new Date(2026, 6, 16) }), prod, 14_200_000, null, lim15h);
  assert.ok(r.some(x => x.area === 'vigencia' && x.resultado === 'NO_CUMPLE'));
  const ok = revisionesPorCodigo(cot({ vigencia_at: new Date(2099, 0, 1) }), prod, 14_200_000, null, lim15h);
  assert.ok(!ok.some(x => x.area === 'vigencia'));
});
