import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectarPorDecidir, patronDeLinea, claveCaso } from '../compras-por-decidir-core';
import { lineasDelNegocio, type CotizacionPareo } from '../compras-pareo-global-core';

const doc = (lineas: Array<[string, number, number]>) =>
  'LÍNEAS DEL DOCUMENTO (leídas y verificadas; el precio unitario ya trae el descuento de la línea):\n'
  + lineas.map(([d, q, pu], i) => `${i + 1}. ${d} | cantidad ${q} | precio unitario ${pu} | total ${q * pu}`).join('\n') + '\n\nTexto del PDF';
const cot = (id: number, proveedor: string, lineas: Array<[string, number, number]>): CotizacionPareo => ({
  id, proveedor_nombre: proveedor, moneda: 'CLP', tipo_cambio_usado: null, notas: null, descuento_pct: null,
  precio_total: lineas.reduce((s, [, q, pu]) => s + q * pu, 0), flete_monto: null, descripcion_libre: doc(lineas),
});
const BETA = { id: 724, descripcion: 'Dosificadora de cloro ProMinent BETA 5, modelo BT5B1008PVT2000UA010000.', cantidad: 2, unidad: 'un', subestado: 'COTIZANDO' };

test('la dosificadora Aqua de Koslan frente a la ProMinent BETA sale por decidir, con ahorro frente a lo que ya hay', () => {
  const c = cot(474, 'Koslan', [['109368 BOMBA DOSIFICADORA AQUA HC151+ CST M80', 2, 171884]]);
  const r = detectarPorDecidir({ productos: [BETA], lineas: lineasDelNegocio([c]), itemsGuardados: [{ cotizacionId: 1, productoId: 724, precioBase: 400000 }], decididas: new Set() });
  assert.equal(r.length, 1);
  assert.equal(r[0].productoId, 724);
  assert.equal(r[0].precioNeto, 171884);
  assert.equal(r[0].ahorro, 228116);
});

test('no se ofrece si ya está asignada, si no es más barata que lo que hay, o si ya se decidió', () => {
  const c = cot(474, 'Koslan', [['109368 BOMBA DOSIFICADORA AQUA HC151+ CST M80', 2, 171884]]);
  const lineas = lineasDelNegocio([c]);
  const base = { productos: [BETA], lineas, decididas: new Set<string>() };
  assert.equal(detectarPorDecidir({ ...base, itemsGuardados: [{ cotizacionId: 474, productoId: 724, precioBase: 171884 }] }).length, 0, 'ya asignada');
  assert.equal(detectarPorDecidir({ ...base, itemsGuardados: [{ cotizacionId: 1, productoId: 724, precioBase: 100000 }] }).length, 0, 'ya hay algo más barato');
  const clave = claveCaso(474, 724, lineas[0].descripcion);
  assert.equal(detectarPorDecidir({ ...base, itemsGuardados: [], decididas: new Set([clave]) }).length, 0, 'ya decidida');
  assert.equal(detectarPorDecidir({ ...base, itemsGuardados: [] }).length, 1, 'producto sin precio: sí se ofrece');
});

test('un producto que ya avanzó (aprobado, comprado) no recibe casos, y diésel ≠ gasolina no es una equivalencia por decidir', () => {
  const c = cot(1, 'X', [['GENERADOR BENCINERO 6.8KW ELECTRICO MOD.DFD9000H', 1, 791000]]);
  const diesel = { id: 719, descripcion: 'Generador eléctrico diésel insonorizado,7kVA.', cantidad: 1, unidad: 'un', subestado: 'COTIZANDO' };
  assert.equal(detectarPorDecidir({ productos: [diesel], lineas: lineasDelNegocio([c]), itemsGuardados: [], decididas: new Set() }).length, 0);
  const c2 = cot(2, 'Koslan', [['109368 BOMBA DOSIFICADORA AQUA HC151+ CST M80', 2, 171884]]);
  assert.equal(detectarPorDecidir({ productos: [{ ...BETA, subestado: 'COMPRADO' }], lineas: lineasDelNegocio([c2]), itemsGuardados: [], decididas: new Set() }).length, 0);
});

test('patronDeLinea toma el código del modelo (HC151+, 6SR27-10) o, si no hay, las 3 primeras palabras', () => {
  assert.equal(patronDeLinea('109368 BOMBA DOSIFICADORA AQUA HC151+ CST M80'), 'HC151+');
  assert.equal(patronDeLinea('BOMBA DOSIFICADORA AQUA HC151+ CST M80'), 'HC151+');
  assert.equal(patronDeLinea('BOMBA POZO PEDROLLO 6SR27-10'), '6SR27-10');
  assert.equal(patronDeLinea('Bomba de agua grande azul'), 'Bomba de agua');
});
