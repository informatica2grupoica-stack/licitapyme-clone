// Notas de crédito del proyecto de Obuma contra las OC. Caso real 2736-44-LE26, OC 4055 (Textil Ranco): 5 facturas de $1,8 M (33, 35, 36, 38, 39),
// 4 notas de crédito (5 a 8) y solo la 39 enlazada a la OC. Correr con: npx tsx --test app/lib/__tests__/compras-notas-factura.test.mts
import test from 'node:test';
import assert from 'node:assert/strict';
import { asociarNotasAOc } from '../compras-notas-factura';

const nc = (folio: string) => ({ folio, tipo: '61', proveedorNombre: 'TEXTIL RANCO SPA', total: -2_142_000, neto: -1_800_000, observacion: null, fecha: '13-11-2026' });
const NOTAS = ['5', '6', '7', '8'].map(nc);
const OC = [{ folio: '4055', proveedor: 'Textil Ranco SpA', facturasNeto: [1_800_000] }];

test('sin saber qué anulan las notas, se restan como antes (caso viejo)', () => {
  const r = asociarNotasAOc(NOTAS, OC);
  assert.equal(r.get('4055')?.length, 4);
});

test('4 notas anulan 4 facturas sueltas de Obuma: la OC 4055 no pierde nada', () => {
  const sueltas = ['33', '35', '36', '38'].map(() => ({ proveedor: 'Textil Ranco SpA', neto: 1_800_000 }));
  assert.equal(asociarNotasAOc(NOTAS, OC, sueltas).get('4055'), undefined);
});

test('solo se consume una factura suelta por nota: 2 sueltas y 4 notas → 2 notas siguen restando', () => {
  const sueltas = [{ proveedor: 'Textil Ranco SpA', neto: 1_800_000 }, { proveedor: 'Textil Ranco SpA', neto: 1_800_000 }];
  assert.equal(asociarNotasAOc(NOTAS, OC, sueltas).get('4055')?.length, 2);
});

test('una suelta de otro proveedor o de otro monto no consume la nota', () => {
  const sueltas = [{ proveedor: 'OTRO SPA', neto: 1_800_000 }, { proveedor: 'Textil Ranco SpA', neto: 500_000 }];
  assert.equal(asociarNotasAOc(NOTAS, OC, sueltas).get('4055')?.length, 4);
});
