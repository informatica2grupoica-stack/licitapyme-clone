// Costo adicional a mano en el costeo digital (esCostoAdicional). Correr con:
//   npx tsx --test app/lib/__tests__/costeo-costo-adicional.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editorAFilasCosteo, entradaComparativoDeEstado, filasSinLink, type EstadoCosteoEditor, type FilaEditorCosteo } from '../costeo-editor';
import { calcularComparativo } from '../costeo-comparativo';
import { lineasDelCosteo } from '../auditor-compras-core';

const fila = (item: number, detalle: string, extra: Partial<FilaEditorCosteo> = {}): FilaEditorCosteo => ({
  id: `f${item}`, item, lineaReal: null, detalle, unidad: 'UN', skuProveedor: '', cantidad: null, valorConIva: null, costoRealUnitario: null,
  link1: '', link2: '', link3: '', ...extra,
});
// Réplica de la pestaña COSTEO de 1288505-5-LE26: 2 productos (con recargo propio de 193%) + flete y despacho escritos a mano como costo total.
const estado: EstadoCosteoEditor = { modalidad: 'suma_alzada', margenVenta: 27, grupos: [{ nombre: 'Costeo', linea: null, ofertamos: true, filas: [
  fila(1, 'APILADOR ELÉCTRICO', { cantidad: 1, valorConIva: 3200000, margenVenta: 193, link1: 'https://a.cl/x' }),
  fila(2, 'ELEVADOR ELÉCTRICO', { cantidad: 1, valorConIva: 4545706, margenVenta: 193, link1: 'https://a.cl/y' }),
  fila(3, 'Envío puerto de Valparaíso', { esCostoAdicional: true, costoAdicionalNeto: 1222216 }),
  fila(4, 'Despacho a Punta Arenas', { esCostoAdicional: true, costoAdicionalNeto: 1500000 }),
] }] };

test('el costo adicional suma al costo y baja el margen, pero no a la venta (igual que el Excel)', () => {
  const c = calcularComparativo(entradaComparativoDeEstado(estado, 19190000));
  assert.equal(c.ventaNeta, 19071359);
  assert.equal(Math.round(c.costoNetoEstimado), 9231213);        // 6.508.997 de productos + 2.722.216 adicionales
  assert.equal(Math.round((c.margenEstimado ?? 0) * 10) / 10, 51.6);
});

test('el costo adicional no es un ítem ofertado: queda fuera del anexo económico / Motor Comercial', () => {
  const filas = editorAFilasCosteo(estado);
  assert.deepEqual(filas.map(f => f.detalle), ['APILADOR ELÉCTRICO', 'ELEVADOR ELÉCTRICO']);
});

test('no exige link y no es una línea auditable', () => {
  assert.deepEqual(filasSinLink(estado), []);
  const l = lineasDelCosteo(estado).filter(x => x.esGastoExtra).map(x => x.detalle);
  assert.deepEqual(l, ['Envío puerto de Valparaíso', 'Despacho a Punta Arenas']);
});

test('sin costos adicionales el resultado es el de siempre', () => {
  const sin: EstadoCosteoEditor = { ...estado, grupos: [{ ...estado.grupos[0], filas: estado.grupos[0].filas.slice(0, 2) }] };
  const c = calcularComparativo(entradaComparativoDeEstado(sin, 19190000));
  assert.equal(Math.round(c.costoNetoEstimado), 6508997);
});

test('un costo real cargado a un costo adicional suma como gasto adicional, sin bloquear el cierre', () => {
  const conReal: EstadoCosteoEditor = { ...estado, grupos: [{ ...estado.grupos[0], filas: estado.grupos[0].filas.map(f => f.id === 'f3' ? { ...f, costoRealUnitario: 1300000 } : f.id === 'f1' || f.id === 'f2' ? { ...f, costoRealUnitario: 2000000 } : f) }] };
  const c = calcularComparativo(entradaComparativoDeEstado(conReal, null));
  assert.equal(c.gastosAdicionales, 1300000);
  assert.equal(c.realCompleto, true);
});
