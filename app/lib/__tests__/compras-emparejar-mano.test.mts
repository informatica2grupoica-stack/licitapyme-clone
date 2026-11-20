import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidatasParaProducto, envaseDeclarado, resumenAsignacion, type CotizacionParaEmparejar } from '../compras-emparejar-mano';

const doc = (lineas: Array<[string, number, number, string?]>) =>
  'LÍNEAS DEL DOCUMENTO (leídas y verificadas; el precio unitario ya trae el descuento de la línea):\n'
  + lineas.map(([d, q, pu, u], i) => `${i + 1}. ${d} | cantidad ${q}${u ? ' ' + u : ''} | precio unitario ${pu} | total ${q * pu}`).join('\n') + '\n\nTexto del documento.';
const cot = (id: number, proveedor: string, lineas: Array<[string, number, number, string?]>, items: CotizacionParaEmparejar['items'] = []): CotizacionParaEmparejar => ({
  id, proveedor_nombre: proveedor, moneda: 'CLP', tipo_cambio_usado: null, notas: null, descuento_pct: null,
  precio_total: lineas.reduce((s, [, q, pu]) => s + q * pu, 0), flete_monto: null, descripcion_libre: doc(lineas), items,
});
const COPLA = { id: 798, descripcion: 'Copla HDPE de 110 mm,PN10.', cantidad: 10, unidad: 'un' };

test('copla 110 PN10 (1356): PN16 sirve (aviso verde), la de 90 mm choca y va al final, y se ve quién ya usa cada línea', () => {
  const dicran = cot(371, 'Dicran', [['Copla HDPE EF 110 PN16', 30, 5200], ['Copla HDPE EF 90 mm', 20, 5100]], [{ productoId: 800, precioBase: 5100 }]);
  const ingap = cot(359, 'INGAP', [['Copla electrofusión 110 mm PN10', 10, 7416.5]], [{ productoId: 798, precioBase: 7416.5 }]);
  const filas = candidatasParaProducto(COPLA, [COPLA, { id: 800, descripcion: 'Copla HDPE de 90 mm.' }], [dicran, ingap]);
  assert.equal(filas.length, 3);
  assert.equal(filas[filas.length - 1].descripcion, 'Copla HDPE EF 90 mm', 'la de otra medida va al final');
  assert.equal(filas[filas.length - 1].tono, 'malo');
  const pn16 = filas.find(f => f.descripcion.includes('PN16'))!;
  assert.equal(pn16.tono, 'ok');
  assert.ok(pn16.avisos.some(a => /más de lo pedido|Trae más/.test(a.texto)), 'avisa que trae más presión');
  assert.equal(filas.find(f => f.descripcion.includes('PN10'))!.esActual, true, 'INGAP ya es la oferta guardada de este producto');
  assert.equal(filas.find(f => f.descripcion === 'Copla HDPE EF 90 mm')!.yaEnProducto, 'Copla HDPE de 90 mm.');
});

test('cantidad: si la línea cotiza menos de lo que piden, queda en dudoso con el número a la vista', () => {
  const hst = { id: 74, descripcion: 'Máquina de fusión HDPE Hürner HST 300 Smart, 20-160 mm.', cantidad: 3 };
  const filas = candidatasParaProducto(hst, [hst], [cot(371, 'Dicran', [['Electrofusora Ritmo Elektra Light 160 (20–160 mm)', 2, 1375000]])]);
  assert.equal(filas[0].tono, 'dudoso');
  assert.ok(filas[0].avisos.some(a => a.texto === 'Cotiza 2 y piden 3'));
});

test('envase declarado y resumen de la asignación', () => {
  assert.equal(envaseDeclarado('Tubería HDPE de 63 mm, PE100, PN10 (R/100).'), 100);
  assert.equal(envaseDeclarado('Tubería HDPE de 110 mm,PN10(50 m).'), 50);
  assert.equal(envaseDeclarado('Copla HDPE de 110 mm,PN10.'), null);
  const r = resumenAsignacion(COPLA, 5200, 4800);
  assert.equal(r.total, 52000);
  assert.equal(r.costeadoTotal, 48000);
  assert.equal(r.difPct, 8.3);
});

test('copla 110 (1356 en producción): E.F.110 PN16 e INGAP d=110 van antes que E.F.090 y E.F.063, que avisan que hablan de otro tamaño', () => {
  const dicran = cot(371, 'Dicran', [['HDPE COPLA E.F.090', 10, 5100], ['HDPE COPLA E.F.063', 30, 2860], ['HDPE COPLA E.F.110 PN16', 40, 5200]]);
  const ingap = cot(359, 'INGAP', [['Coplas EF PE100 PN16 d= 110 mm', 40, 7416.5]]);
  const filas = candidatasParaProducto(COPLA, [COPLA], [dicran, ingap]);
  assert.deepEqual(filas.slice(0, 2).map(f => f.descripcion).sort(), ['Coplas EF PE100 PN16 d= 110 mm', 'HDPE COPLA E.F.110 PN16']);
  const e090 = filas.find(f => f.descripcion.endsWith('090'))!;
  assert.equal(e090.tono, 'dudoso');
  assert.ok(e090.avisos.some(a => /habla de 90 y piden 110/.test(a.texto)));
  assert.ok(!e090.avisos.some(a => /no muestra diferencia/.test(a.texto)), 'ya no dice que está todo bien');
});
