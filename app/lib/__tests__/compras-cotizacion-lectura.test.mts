import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ivaIncluidoDelTexto, netoDesdeBruto, vigenciaDelTexto, incluyeFleteDelTexto, minimoDeVentaDelTexto, textoLegible, precioONull,
} from '../compras-cotizacion-lectura';

test('IVA: incluido, neto y silencio', () => {
  assert.equal(ivaIncluidoDelTexto('PRECIOS IVA INCLUIDO Garantia 12 meses'), true);
  assert.equal(ivaIncluidoDelTexto('Valores con IVA incluido'), true);
  assert.equal(ivaIncluidoDelTexto('el notebook te sale 505 mil + iva c/u'), false);
  assert.equal(ivaIncluidoDelTexto('Neto $21.100.000 IVA 19% $4.009.000 TOTAL $25.109.000'), null);
});
test('neto desde bruto: 17.493.000 con IVA = 14.700.000 neto', () => {
  assert.equal(netoDesdeBruto(17_493_000), 14_700_000);
});
test('vigencia: emisión + días y "válida hasta"', () => {
  assert.equal(vigenciaDelTexto('Fecha: 01-07-2026 ... Validez de la oferta: 15 dias'), '2026-07-16');
  assert.equal(vigenciaDelTexto('Fecha: 07-10-2026 Offer valid for 15 days'), '2026-10-22');
  assert.equal(vigenciaDelTexto('Cotización válida hasta el 30/10/2026'), '2026-10-30');
  assert.equal(vigenciaDelTexto('Validez de la oferta: 15 dias'), null); // sin fecha de emisión no se inventa
  assert.equal(vigenciaDelTexto('sin datos'), null);
});
test('flete incluido / no incluido / silencio', () => {
  assert.equal(incluyeFleteDelTexto('Despacho incluido en Santiago'), true);
  assert.equal(incluyeFleteDelTexto('Flete no incluido'), false);
  assert.equal(incluyeFleteDelTexto('retiras en Quilicura'), null);
  assert.equal(incluyeFleteDelTexto('Plazo de entrega 7 dias'), null);
});
test('mínimo de venta', () => {
  assert.equal(minimoDeVentaDelTexto('Precio valido solo comprando 2 unidades (minimo de venta)'), 2);
  assert.equal(minimoDeVentaDelTexto('mínimo 1 unidad'), null);
});
test('textoLegible quita HTML y markdown', () => {
  const s = textoLegible('<div align="center">\n\n# Tecno SpA\n\n</div>\n<table><tr><td>Item</td><td>Precio</td></tr></table>');
  assert.ok(!/[<>]/.test(s));
  assert.match(s, /Tecno SpA/);
  assert.match(s, /Item \| Precio/);
});
test('precio 0 no es precio', () => {
  assert.equal(precioONull(0), null);
  assert.equal(precioONull(null), null);
  assert.equal(precioONull(Number.NaN), null);
  assert.equal(precioONull(14_200_000), 14_200_000);
});

test('vigencia en cotizaciones reales: ROMCO y Barcepan', () => {
  const romco = 'PRESUPUESTO N° 19941 LUNES, 05 DE OCTUBRE DE 2026 Nombre: Cristobal ... CONDICIONES GENERALES :: -1. VALIDEZ DE COTIZACION ES DE 15 DIAS. / NOTA DE VENTA';
  assert.equal(vigenciaDelTexto(romco), '2026-10-20');
  const barcepan = 'Santiago, 06 de Octubre de 2026.- Señores ... Condiciones de Venta • Duración de la cotización: 15 días.';
  assert.equal(vigenciaDelTexto(barcepan), '2026-10-21');
  assert.equal(vigenciaDelTexto('Válida hasta el 30 de octubre de 2026'), '2026-10-30');
});
test('IVA en cotizaciones reales: "Precios Netos en Pesos + IVA" es neto', () => {
  assert.equal(ivaIncluidoDelTexto('Precios Netos en Pesos + IVA. Descuento por pago contado: 2 %'), false);
  assert.equal(ivaIncluidoDelTexto('Sub Total 20.332.500 IVA 3.863.175 TOTAL 24.195.680'), null);
});
test('flete en cotizaciones reales: Barcepan "Precios puestos en bodegas" y ROMCO "fletes de cargo del cliente"', () => {
  assert.equal(incluyeFleteDelTexto('4. Fletes y Traslados son de cargo y responsabilidad del cliente.'), null);
  assert.equal(incluyeFleteDelTexto('Valores no incluyen traslado de equipos'), null);
});
