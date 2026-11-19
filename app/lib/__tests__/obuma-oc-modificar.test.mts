// Modificar una OC ya creada (comprasOc.update.json) y descripción de producto/líneas (22-nov-2026).
// Fetch simulado: NO toca Obuma. Correr con:
//   npx tsx --test app/lib/__tests__/obuma-oc-modificar.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.OBUMA_API_TOKEN = 'token-de-prueba';
const obuma = await import('../obuma');
const { armarDocActualizacionOc, leerOcObuma, modificarOrdenCompraObuma, crearOrdenCompraObuma, crearProductoObuma, textoSeguroObuma } = obuma;

const cab = {
  compra_oc_id: '500', compra_oc_folio: '4100', compra_oc_estado: 'SOLICITADA', compra_oc_fecha_ingreso: '2026-11-05 10:59:46',
  compra_oc_referencia: '1234-5-LE26', compra_oc_observacion: 'Compra para licitación 1234-5-LE26', compra_oc_forma_pago: 'TRANSFERENCIA',
  compra_oc_fecha_entrega_productos: '06-11-2026', compra_oc_metodo_despacho: 'Por cuenta COMPRADOR', compra_oc_concepto: 'inventario',
  compra_oc_concepto_gasto: '0', compra_oc_descuento_pesos: '0', compra_oc_descuento_porciento: '0', compra_oc_internacional: '0',
  compra_oc_internacional_tipocambio: '0', compra_oc_centro_costo: '24160', rel_moneda_id: '1', rel_proveedor_id: '77', rel_sucursal_id: '0',
  compra_oc_neto: '300', compra_oc_iva: '57', compra_oc_total: '357',
};
const linea = (cod: string, nombre: string, cant: string, precio: string, extra: any = {}) => ({
  ...cab, cod_id: cod, producto_id: '9' + cod, producto_nombre: nombre, producto_descripcion: '', codigo_comercial: 'C' + cod, unidad_medida: 'UN',
  cantidad: cant, cantidad_facturada: '0', cantidad_despachada: '0', precio, descuento: '0', subtotal: String(Number(cant) * Number(precio)), producto_exento: '0', ...extra,
});
const filas = [linea('1', 'HORNO', '2', '100'), linea('2', 'FLETE / DESPACHO', '1', '100')];

function simular(respuestaFilas: any[] = filas) {
  const posts: { url: string; body: any }[] = [];
  globalThis.fetch = (async (url: string, init?: any) => {
    const u = String(url);
    if (init?.method === 'POST') { posts.push({ url: u, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ result: { result: 0, result_detail: 'ok' }, data: null })); }
    if (u.includes('findById.json/500')) return new Response(JSON.stringify({ data: respuestaFilas }));
    if (u.includes('proveedores.findById')) return new Response(JSON.stringify({ data: [{ proveedor_id: '77', proveedor_rut: '76.000.000-0', proveedor_razon_social: 'PROVEEDOR SPA' }] }));
    if (u.includes('contabilidadCentrosDeCostos')) return new Response(JSON.stringify({ data: [{ ccc_id: '24160', ccc_codigo: 'PROY-198', ccc_nombre: 'X', ccc_activo: '1' }] }));
    return new Response(JSON.stringify({ data: [{ producto_id: '1', producto_codigo_comercial: '602', producto_descripcion: 'DESC DE OBUMA' }] }));
  }) as any;
  return posts;
}

test('leerOcObuma junta las filas (una por línea) en una orden con sus líneas', async () => {
  simular();
  const oc = await leerOcObuma('500');
  assert.equal(oc!.lineas.length, 2);
  assert.equal(oc!.lineas[0].precio, 100);
  assert.equal(oc!.fechaEntrega, '06-11-2026');
});

test('armarDoc: reenvía TODA la orden con el cambio, recalcula neto/IVA y manda oc_id y centro de costo por código', async () => {
  simular();
  const actual = (await leerOcObuma('500'))!;
  const r = armarDocActualizacionOc(actual, { lineas: [{ codId: '1', cantidad: 3, precio: 150, descripcion: 'Horno 6 bandejas' }], fechaEntrega: '2026-12-01' }, { proveedorRut: '76.000.000-0', proveedorRazonSocial: 'PROVEEDOR SPA', centroCostoCodigo: 'PROY-198' });
  const d: any = r.doc;
  assert.equal(d.oc_id, '500');
  assert.equal(d.oc_detalle.length, 2);                       // las dos líneas, no solo la cambiada
  assert.equal(d.oc_detalle[0].cantidad, '3');
  assert.equal(d.oc_detalle[0].precio, 150);
  assert.equal(d.oc_detalle[0].producto_precio, 150);
  assert.equal(d.oc_detalle[0].producto_descripcion, 'Horno 6 bandejas');
  assert.equal(d.oc_detalle[1].precio, 100);                  // el flete queda igual
  assert.equal(d.oc_neto, '550');                              // 3×150 + 100
  assert.equal(d.oc_iva, String(Math.round(550 * 0.19)));
  assert.equal(d.oc_total, String(550 + Math.round(550 * 0.19)));
  assert.equal(d.oc_centro_costo, 'PROY-198');
  assert.equal(d.oc_fecha_entrega_productos, '01-12-2026');
  assert.equal(d.oc_concepto_gasto, undefined);                // «0» no se reenvía
  assert.equal(d.oc_sucursal, obuma.SUCURSAL_TALAGANTE);
  assert.equal(r.total, 550 + Math.round(550 * 0.19));
});

test('armarDoc: bloquea anuladas, facturadas, con descuento, y líneas que no existen', async () => {
  const base = (await (async () => { simular(); return leerOcObuma('500'); })())!;
  const ctx = { proveedorRut: null, proveedorRazonSocial: 'P', centroCostoCodigo: null };
  assert.throws(() => armarDocActualizacionOc({ ...base, estado: 'ANULADA' }, {}, ctx), /anulada/);
  assert.throws(() => armarDocActualizacionOc({ ...base, lineas: [{ ...base.lineas[0], cantidadFacturada: 1 }] }, {}, ctx), /facturados/);
  assert.throws(() => armarDocActualizacionOc({ ...base, lineas: [{ ...base.lineas[0], descuento: 5 }] }, {}, ctx), /descuentos/);
  assert.throws(() => armarDocActualizacionOc(base, { lineas: [{ codId: '999', cantidad: 1 }] }, ctx), /no existe/);
  assert.throws(() => armarDocActualizacionOc(base, { lineas: [{ codId: '1', cantidad: 0 }] }, ctx), /cantidad/);
});

test('armarDoc internacional: sin IVA, todo exento, 2 decimales', async () => {
  simular();
  const base = (await leerOcObuma('500'))!;
  const intl = { ...base, internacional: true, tipoCambio: 900, lineas: base.lineas.map(l => ({ ...l, exento: true })) };
  const r = armarDocActualizacionOc(intl, { lineas: [{ codId: '1', precio: 3.456 }] }, { proveedorRut: null, proveedorRazonSocial: 'P', centroCostoCodigo: null });
  const d: any = r.doc;
  assert.equal(d.oc_iva, '0');
  assert.equal(d.oc_neto, '0');
  assert.equal(d.oc_detalle[0].precio, 3.46);
  assert.equal(d.oc_exento, String(6.92 + 100));
  assert.equal(d.oc_internacional_tipocambio, '900');
});

test('modificarOrdenCompraObuma con OBUMA_SIMULAR=1: lee pero NO escribe', async () => {
  const posts = simular();
  process.env.OBUMA_SIMULAR = '1';
  try {
    const r = await modificarOrdenCompraObuma('500', { observacion: 'nueva' });
    assert.equal(r.simulado, true);
    assert.equal(posts.length, 0);
  } finally { delete process.env.OBUMA_SIMULAR; }
});

test('modificarOrdenCompraObuma: manda el POST de update y falla si Obuma no guardó lo pedido', async () => {
  const posts = simular();   // Obuma "ignora" el cambio: releer devuelve lo mismo
  await assert.rejects(modificarOrdenCompraObuma('500', { lineas: [{ codId: '1', cantidad: 5 }] }), /no quedó como se pidió/);
  assert.equal(posts.length, 1);
  assert.ok(posts[0].url.endsWith('/comprasOc.update.json'));
  assert.equal(posts[0].body.docs[0].oc_id, '500');
});

test('modificarOrdenCompraObuma: ok cuando la relectura trae lo nuevo', async () => {
  const posts: any[] = [];
  let actualizado = false;
  const total = String(600 + Math.round(600 * 0.19));   // 5×100 + flete 100 = 600 neto
  const nuevas = [linea('1', 'HORNO', '5', '100', { compra_oc_total: total, compra_oc_neto: '600' }), linea('2', 'FLETE / DESPACHO', '1', '100', { compra_oc_total: total, compra_oc_neto: '600' })];
  globalThis.fetch = (async (url: string, init?: any) => {
    const u = String(url);
    if (init?.method === 'POST') { posts.push(JSON.parse(init.body)); actualizado = true; return new Response(JSON.stringify({ result: { result: 0 } })); }
    if (u.includes('findById.json/500')) return new Response(JSON.stringify({ data: actualizado ? nuevas : filas }));
    if (u.includes('proveedores.findById')) return new Response(JSON.stringify({ data: [{ proveedor_rut: '76.000.000-0', proveedor_razon_social: 'P' }] }));
    return new Response(JSON.stringify({ data: [] }));
  }) as any;
  const r = await modificarOrdenCompraObuma('500', { lineas: [{ codId: '1', cantidad: 5 }] });
  assert.equal(r.simulado, false);
  assert.equal(r.despues!.lineas[0].cantidad, 5);
  assert.equal(posts.length, 1);
});

test('descripción: va como producto_descripcion al crear el producto y en las líneas de la OC (sin apóstrofes), y se omite si está vacía', async () => {
  const enviados: any[] = [];
  globalThis.fetch = (async (url: string, init?: any) => {
    if (init?.method === 'POST') { enviados.push({ url: String(url), body: JSON.parse(init.body) }); return new Response(JSON.stringify({ result: { result: 0, result_detail: 'producto creado. producto_id:55' }, data: [{ compra_oc_id: '999' }] })); }
    return new Response(JSON.stringify({ data: [{ producto_id: '55', producto_codigo_comercial: '602', compra_oc_id: '999', compra_oc_folio: '1' }] }));
  }) as any;
  await crearProductoObuma({ nombre: 'Horno', codigoComercial: '602', subcategoriaId: '1', costoClpNeto: 100, descripcion: `Horno de 1.5' con "bandejas"` });
  assert.equal(enviados[0].body.producto_descripcion, 'Horno de 1.5" con "bandejas"');
  await crearProductoObuma({ nombre: 'Horno', codigoComercial: '602', subcategoriaId: '1', costoClpNeto: 100, descripcion: '   ' });
  assert.equal(enviados[1].body.producto_descripcion, undefined);

  await crearOrdenCompraObuma({
    proveedorRut: '1-9', proveedorRazonSocial: 'P', fecha: '2026-11-05', formaPagoId: '1', referencia: 'R',
    items: [{ productoIdObuma: '55', codigoComercial: '602', nombre: 'Horno', cantidad: 1, precioUnitarioNeto: 100, descripcion: 'Con soporte' }, { productoIdObuma: null, codigoComercial: null, nombre: 'Otro', cantidad: 1, precioUnitarioNeto: 10 }],
  });
  const det = enviados[2].body.docs[0].oc_detalle;
  assert.equal(det[0].producto_descripcion, 'Con soporte');
  assert.equal(det[1].producto_descripcion, undefined);
  assert.equal(textoSeguroObuma(`5' x 3`), '5" x 3');
});
