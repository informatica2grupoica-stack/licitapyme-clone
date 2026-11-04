// OC nacional vs internacional hacia Obuma (04-nov-2026). Revisa el JSON que se manda a comprasOc.create.json, con fetch
// simulado (NO toca Obuma). Lo internacional se modeló sobre las OC hechas a mano en Obuma (folios 174, 384, 385):
// moneda extranjera (rel_moneda_id 3 = USD), precios con decimales, líneas exentas, IVA 0 y exento = total.
// Correr con:
//   npx tsx --test app/lib/__tests__/obuma-oc-internacional.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.OBUMA_API_TOKEN = 'token-de-prueba';
const { crearOrdenCompraObuma } = await import('../obuma');

function simularObuma() {
  const enviados: any[] = [];
  globalThis.fetch = (async (url: string, init?: any) => {
    if (String(url).includes('comprasOc.create.json')) {
      enviados.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ data: [{ compra_oc_id: '999' }] }));
    }
    return new Response(JSON.stringify({ data: [{ compra_oc_id: '999', compra_oc_folio: '5000' }] }));
  }) as any;
  return enviados;
}

const base = {
  proveedorRut: '76.000.000-0', proveedorRazonSocial: 'PROVEEDOR', fecha: '2026-11-04', formaPagoId: '1',
  referencia: '1234-5-LE26',
  items: [
    { productoIdObuma: '10', codigoComercial: 'A1', nombre: 'Laptop', cantidad: 105, precioUnitarioNeto: 372 },
    { productoIdObuma: '11', codigoComercial: 'A2', nombre: 'Mouse', cantidad: 105, precioUnitarioNeto: 3.45 },
  ],
};

test('nacional: pesos, IVA 19 %, sin campos internacionales (igual que antes)', async () => {
  const enviados = simularObuma();
  const r = await crearOrdenCompraObuma({ ...base, items: [{ ...base.items[0], precioUnitarioNeto: 10000.4 }] });
  const doc = enviados[0].docs[0];
  assert.equal(doc.oc_moneda, '1');
  assert.equal(doc.oc_internacional, '0');
  assert.equal(doc.oc_neto, String(1050042));
  assert.equal(doc.oc_iva, String(Math.round(1050042 * 0.19)));
  assert.equal(doc.oc_exento, undefined);
  assert.equal(doc.oc_internacional_tipocambio, undefined);
  assert.equal(doc.oc_detalle[0].producto_precio, 10000);
  assert.equal(doc.oc_detalle[0].producto_exento, undefined);
  assert.equal(r.total, 1050042 + Math.round(1050042 * 0.19));
});

test('internacional: USD con decimales, exenta, sin IVA, con tipo de cambio', async () => {
  const enviados = simularObuma();
  const r = await crearOrdenCompraObuma({ ...base, internacional: true, monedaId: '3', tipoCambio: 943.52, fleteMonto: 120.5 });
  const doc = enviados[0].docs[0];
  assert.equal(doc.oc_moneda, '3');
  assert.equal(doc.oc_internacional, '1');
  assert.equal(doc.oc_internacional_tipocambio, '943.52');
  assert.equal(doc.oc_detalle[1].producto_precio, 3.45);
  assert.equal(doc.oc_detalle[1].subtotal, 362.25);
  assert.ok(doc.oc_detalle.every((it: any) => it.producto_exento === '1'));
  // 39060 + 362,25 + flete 120,5
  assert.equal(doc.oc_exento, '39542.75');
  assert.equal(doc.oc_iva, '0');
  assert.equal(doc.oc_neto, '0');
  assert.equal(doc.oc_total, '39542.75');
  assert.equal(r.total, 39542.75);
});

test('internacional sin moneda o sin tipo de cambio: no se manda nada', async () => {
  const enviados = simularObuma();
  await assert.rejects(crearOrdenCompraObuma({ ...base, internacional: true, monedaId: '1', tipoCambio: 900 }), /moneda extranjera/);
  await assert.rejects(crearOrdenCompraObuma({ ...base, internacional: true, monedaId: '3', tipoCambio: 0 }), /tipo de cambio/);
  assert.equal(enviados.length, 0);
});
