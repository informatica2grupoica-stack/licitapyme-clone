import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parearNegocio, reparacionesDeUnidad, type CotizacionPareo, type ProductoPareo } from '../compras-pareo-global-core';

const doc = (lineas: Array<[string, number, number, string?]>) =>
  'LÍNEAS DEL DOCUMENTO (leídas y verificadas; el precio unitario ya trae el descuento de la línea):\n'
  + lineas.map(([d, q, pu, u], i) => `${i + 1}. ${d} | cantidad ${q}${u ? ' ' + u : ''} | precio unitario ${pu} | total ${q * pu}`).join('\n') + '\n\nTexto del documento.';
const cot = (id: number, proveedor: string, lineas: Array<[string, number, number, string?]>): CotizacionPareo => ({
  id, proveedor_nombre: proveedor, moneda: 'CLP', tipo_cambio_usado: null, notas: null, descuento_pct: null,
  precio_total: lineas.reduce((s, [, q, pu]) => s + q * pu, 0), flete_monto: null, descripcion_libre: doc(lineas),
} as CotizacionPareo);
const P = (id: number, descripcion: string, cantidad: number, unidad = 'un'): ProductoPareo => ({ id, descripcion, cantidad, unidad });
const ia = (r: any) => async () => ({ content: JSON.stringify(r), finishReason: 'stop' });
const TUBO = P(728, 'Tubería HDPE de 63 mm, PE100, PN10 (R/100).', 100);

test('reparación de unidad: tubería 63 mm «R/100» a $239.000 = $2.390/m × 100 y la línea trae 400 m → vuelve a $2.390 (1356, r46)', async () => {
  const c = cot(366, 'Dicran', [['Tubería HDPE PE100 D63 PN10', 400, 2390, 'MT'], ['Codo HDPE 63 mm', 20, 9490]]);
  const R = await parearNegocio({ productos: [TUBO], cotizaciones: [c], llamarIA: ia({}) });
  const rep = reparacionesDeUnidad({ itemsGuardados: [{ cotizacionId: 366, productoId: 728, precioBase: 239000 }], lineas: R.lineas, productos: [TUBO] });
  assert.equal(rep.length, 1);
  assert.equal(rep[0].precio, 2390);
});

test('reparación de unidad: un precio que SÍ es por rollo (la línea trae solo lo pedido) no se toca', async () => {
  const c = cot(367, 'Otro', [['Tubería HDPE PE100 D63 PN10 rollo 100 m', 100, 239000, 'R']]);
  const R = await parearNegocio({ productos: [TUBO], cotizaciones: [c], llamarIA: ia({}) });
  assert.equal(reparacionesDeUnidad({ itemsGuardados: [{ cotizacionId: 367, productoId: 728, precioBase: 239000 }], lineas: R.lineas, productos: [TUBO] }).length, 0);
});

test('reparación de unidad: una línea que no se parece al producto no sirve de base', async () => {
  const c = cot(366, 'Dicran', [['Tubería HDPE PE100 D63 PN10', 400, 2390, 'MT'], ['Codo HDPE 63 mm', 20, 9490]]);
  const R = await parearNegocio({ productos: [TUBO], cotizaciones: [c], llamarIA: ia({}) });
  assert.equal(reparacionesDeUnidad({ itemsGuardados: [{ cotizacionId: 366, productoId: 728, precioBase: 189800 }], lineas: R.lineas, productos: [TUBO] }).length, 0);
});
