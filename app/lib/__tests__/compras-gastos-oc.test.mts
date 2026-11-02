// Gastos extra enlazados a la OC de Obuma que ya los respalda. Datos reales de 387-55-LE26 (negocio 1191).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ocsDisponiblesParaGasto, type OcObumaParaGasto } from '../compras-gastos-oc';
import { consolidarCostoReal } from '../costo-real-consolidado';
import { entradaComparativoDeFilas } from '../costeo-comparativo';

const OCS: OcObumaParaGasto[] = [
  { folio: '3996', proveedor: 'IMPORTADORA OFFICENTER CHILE LTDA', estado: 'FACTURADA', fecha: '2026-10-16', lineas: [
    { descripcion: 'BIBLIOTECA ESTANTES LIBREROS  2 PUERTAS MAPLE  - GRIS 180X80X40', subtotal: 1_112_000 },
    { descripcion: 'Transporte y palletizado en lugar de entrega Talagante', subtotal: 59_000 } ] },
  { folio: '3998', proveedor: 'Punta Ranco Spa', estado: 'FACTURADA', fecha: '2026-10-19', lineas: [
    { descripcion: 'SILLA DE OFICINA EJECUTIVA', subtotal: 441_117.67 }, { descripcion: 'TRANSPORTE', subtotal: 10_670 } ] },
  { folio: '4015', proveedor: 'JUAN CARLOS SALINAS CISTERNA', estado: 'FACTURADA', fecha: '2026-10-23', lineas: [
    { descripcion: 'TRANSPORTE Y ARMADO MOBILIARIO SANTIAGO LO MUERMOS', subtotal: 1_400_000 } ] },
  { folio: '3991', proveedor: 'DECO OULET', estado: 'ANULADA', fecha: '2026-10-17', lineas: [
    { descripcion: 'SOFA DE DOS CUERPOS TRANSPORTE', subtotal: 210_067 } ] },
  { folio: '4000', proveedor: 'Importadora FullMuebles Spa', estado: 'FACTURADA', fecha: '2026-10-21', lineas: [
    { descripcion: 'ESTACIÓN DE TRABAJO', subtotal: 1_092_395 } ] },
];
// Licitank emitió la 3998 con flete de $10.670: ya está en el plan de compra.
const PROPIAS = [{ folio: '3998', fleteMonto: 10_670 }, { folio: '4000', fleteMonto: 0 }];

test('387-55-LE26: ofrece el transporte de la 4015 y el palletizado de la 3996, nada más', () => {
  const r = ocsDisponiblesParaGasto(OCS, PROPIAS, []);
  assert.deepEqual(r.map(o => [o.folio, o.monto]), [['3996', 59_000], ['4015', 1_400_000]]);
  assert.equal(r[1].proveedor, 'JUAN CARLOS SALINAS CISTERNA');
});

test('no ofrece el flete que Licitank ya cargó en su propia OC, ni una OC anulada, ni productos', () => {
  const r = ocsDisponiblesParaGasto(OCS, PROPIAS, []);
  assert.equal(r.some(o => o.folio === '3998'), false);
  assert.equal(r.some(o => o.folio === '3991'), false);
  assert.equal(r.some(o => o.folio === '4000'), false);
});

test('una línea ya enlazada a un gasto no se vuelve a ofrecer (no se anota dos veces)', () => {
  const r = ocsDisponiblesParaGasto(OCS, PROPIAS, [{ ocObumaFolio: '4015', monto: 1_400_000 }]);
  assert.deepEqual(r.map(o => o.folio), ['3996']);
  // un gasto con otro monto en la misma OC no tapa la línea
  const otro = ocsDisponiblesParaGasto(OCS, PROPIAS, [{ ocObumaFolio: '4015', monto: 500 }]);
  assert.deepEqual(otro.map(o => o.folio), ['3996', '4015']);
});

// Consolidado: el gasto enlazado cuenta UNA vez en el costo real y Obuma se compara contra lo mismo.
test('consolidado 387: transporte con OC suma una vez y el contraste con Obuma queda parejo', () => {
  const costeo = entradaComparativoDeFilas([{ esExtra: false, tieneDatos: true, venta: 18_865_472, costoEstimado: 12_210_692, cantidad: 1, costoRealUnitario: 9_123_706 }], null);
  const gastos = 1_400_000 + 59_000;
  const sin = consolidarCostoReal({ costeo, gastosRegistrados: gastos, importacion: 0, obuma: { ocCreadas: 0, comprasCruzadas: 9_123_706 + gastos, facturas: 0 } });
  const con = consolidarCostoReal({ costeo, gastosRegistrados: gastos, gastosEnOc: gastos, importacion: 0, obuma: { ocCreadas: 0, comprasCruzadas: 9_123_706 + gastos, facturas: 0 } });
  assert.equal(sin.lineas.total, 9_123_706 + gastos);          // el total no cambia con gastosEnOc
  assert.equal(con.lineas.total, 9_123_706 + gastos);
  assert.equal(con.obuma!.diferenciaPct, 0);                   // con el gasto enlazado, costeo y Obuma calzan
  assert.ok((sin.obuma!.diferenciaPct as number) > 15);        // sin enlazar, Obuma parecía +16 %
});
