// OC nacional con una línea EXENTA (impuesto específico del combustible), con Obuma SIMULADO: no escribe nada.
// Reproduce la OC 4058 (neto 35.810 + impuesto exento 7.537 + IVA 6.804 = 50.151). Sin red ni base.
// Correr con: npx tsx --test app/lib/__tests__/obuma-oc-exento-linea.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.OBUMA_SIMULAR = '1';
const { crearOrdenCompraObuma } = await import('../obuma');

const base = {
  proveedorRut: '76930671-4', proveedorRazonSocial: 'COMERCIAL Y SERVICIOS JP LIMITADA', fecha: '2026-11-20', formaPagoId: '1', referencia: '387-55-LE26',
  concepto: 'inventario', fechaEntrega: '2026-11-20', metodoDespacho: 'Retiro',
};

async function conDoc(datos: Parameters<typeof crearOrdenCompraObuma>[0]) {
  let doc: any = null;
  const warn = console.warn;
  console.warn = (...a: unknown[]) => { const t = String(a[1] ?? ''); if (String(a[0]).includes('SIMULADO')) { try { doc = JSON.parse(String(a[1])); } catch { doc = t; } } };
  try { const r = await crearOrdenCompraObuma(datos); return { r, doc }; } finally { console.warn = warn; }
}

test('combustible + impuesto exento: el IVA solo sobre lo afecto (como la 4058)', async () => {
  const { r } = await conDoc({ ...base, items: [
    { productoIdObuma: '111', codigoComercial: 'COMB', nombre: 'combustible interno', cantidad: 1, precioUnitarioNeto: 35810 },
    { productoIdObuma: null, codigoComercial: null, nombre: 'impuesto especifico', cantidad: 1, precioUnitarioNeto: 7537, exento: true },
  ] });
  assert.equal(r.iva, 6804);
  assert.equal(r.subtotalNeto, 43347);
  assert.equal(r.total, 50151);
});

test('sin líneas exentas todo sigue como antes (19 % del total)', async () => {
  const { r } = await conDoc({ ...base, items: [{ productoIdObuma: null, codigoComercial: null, nombre: 'cosa', cantidad: 2, precioUnitarioNeto: 1000 }], fleteMonto: 500 });
  assert.equal(r.subtotalNeto, 2500);
  assert.equal(r.iva, 475);
  assert.equal(r.total, 2975);
});

test('el flete sigue siendo afecto aunque haya una línea exenta', async () => {
  const { r } = await conDoc({ ...base, items: [{ productoIdObuma: null, codigoComercial: null, nombre: 'imp', cantidad: 1, precioUnitarioNeto: 1000, exento: true }], fleteMonto: 1000 });
  assert.equal(r.iva, 190);
  assert.equal(r.total, 2190);
});
