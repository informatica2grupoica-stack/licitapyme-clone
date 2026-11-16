// CASOS REALES de cotizaciones que se leyeron mal y se repararon. Cada uno queda aquí para que el sistema no vuelva a equivocarse
// en ellos cuando se toque el lector, la homologación o los adicionales. Regla: al reparar una cotización real, agregar su caso.
// (Los casos más antiguos tienen su prueba en compras-cotizacion-lineas, compras-cotizacion-lectura, compras-adicionales-ia,
//  compras-precio-vs-costeo y caracteristicas-seccion.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineasDesdeTabla, precioPorUnidadDeProducto, conversionDesdeTexto } from '../compras-cotizacion-lineas';
import { adicionalesDesdeIA, baseDeCotizacionPorUnidad, cotizacionEsPorUnidad } from '../compras-adicionales-ia';
import { vaIncluidoEnOtro, precioEfectivo } from '../compras-precio-vs-costeo';

// ── 3789-30-LE26 (negocio 1089), Sinergia Trade #319, 16-nov-2026 ─────────────────────────────────────────────────────────────────────
// 30 «Set Instrumental de Podología». La cotización trae las piezas de los 30 sets (150 alicates, 90 pinzas…) y 5 % de descuento al final:
// subtotal $3.429.102,90 − 5 % = neto $3.257.647,76. Errores reparados: el alicate de cabecera contado dos veces como «producto solo»
// ($113.765 por set), el kit con base $0 tomado como «va incluido en otro producto», y cada pieza a peso entero hacia abajo.
const TEXTO_SINERGIA = `LÍNEAS DEL DOCUMENTO (leídas y verificadas; el precio unitario ya trae el descuento de la línea):
1. Alicate recto 14 cm (±1cm) | cantidad 150 | precio unitario 5454 | total 818100
2. Pinza Anatómica 14,5 cm | cantidad 90 | precio unitario 1672 | total 150480
3. Pinza Quirúrgica 1x2 dtes | cantidad 90 | precio unitario 1168 | total 105120
4. Pinza Kelly Recta 14 cm | cantidad 30 | precio unitario 2436.97 | total 73109
5. Pinza mosquito recta 14 | cantidad 30 | precio unitario 1672.27 | total 50168
6. Mango Bisturí N°4 | cantidad 60 | precio unitario 831.93 | total 49916
7. Mango Bisturí N°3 | cantidad 60 | precio unitario 831.93 | total 49916
8. Tijera quirúrgica ROMA ROMA 14CM | cantidad 120 | precio unitario 3101 | total 372120
9. Tijera Mayo Curva 17 cm | cantidad 90 | precio unitario 3101 | total 279090
10. Tijera Mayo Recta 17 cm | cantidad 90 | precio unitario 3101 | total 279090
11. Escariador Fino 17 cm (±1 | cantidad 60 | precio unitario 1672.27 | total 100336
12. Copela ac. Inox. 9cm | cantidad 60 | precio unitario 924.37 | total 55462
13. Gubia podología (0,5 / 1MM / 2MM / 3MM) | cantidad 150 | precio unitario 1336 | total 200400
14. alicates podológico pediatrico | cantidad 60 | precio unitario 5285.72 | total 317143
15. Caja quirúrgica 17 cm x 7 | cantidad 90 | precio unitario 5873.94 | total 528655

SUB-TOTAL | $3.429.102,90
DESCUENTO 5% | $171.455,15
$3.257.647,76`;
const NETO_DOC = 3257647.76;
const SETS = 30;
const desc5 = (n: number) => n * 0.95;

test('3789-30-LE26 Sinergia: se leen las 15 piezas con su cantidad y precio', () => {
  const lineas = lineasDesdeTabla(TEXTO_SINERGIA);
  assert.equal(lineas.length, 15);
  assert.deepEqual([lineas[0].cantidad, lineas[0].precioUnitario], [150, 5454]);
  assert.equal(lineas[3].precioUnitario, 2436.97);                  // los decimales del documento no se pierden al leer
});

test('3789-30-LE26 Sinergia: kit del lote → base $0, 15 componentes por set, nunca bajo el neto del documento', () => {
  const lineas = lineasDesdeTabla(TEXTO_SINERGIA);
  const raw = lineas.map(l => ({ concepto: l.descripcion, cantidadLinea: l.cantidad, precioUnitario: l.precioUnitario }));
  assert.equal(cotizacionEsPorUnidad(raw, SETS), false);            // trae el lote completo: se divide por 30
  const adic = adicionalesDesdeIA(raw, SETS, desc5);
  assert.equal(adic.length, 15);
  assert.deepEqual(adic.slice(0, 3).map(a => a.cantidad), [5, 3, 3]);
  const k = baseDeCotizacionPorUnidad(adic, desc5(5454));            // precio de cabecera = el alicate
  assert.equal(k.base, 0);                                           // sin «producto solo» que repita el alicate
  assert.equal(k.adicionales.length, 15);
  const efectivo = precioEfectivo(k.base, k.adicionales)!;
  const exacto = NETO_DOC / SETS;                                    // $108.588,26 por set
  assert.ok(efectivo >= exacto && efectivo - exacto < 40, `por set ${efectivo}`);   // piezas a peso hacia arriba: hoy $108.609
  assert.ok(efectivo < 113765 - 4000, 'el alicate volvió a contarse dos veces');
  // Un kit con precio no «va incluido en otro producto» (se puede elegir solo); un producto en $0 sin precio sí.
  assert.equal(vaIncluidoEnOtro({ precioBase: 0, precioUnitario: efectivo }), false);
  assert.equal(vaIncluidoEnOtro({ precioBase: 0, precioUnitario: 0 }), true);
});

// ── 2736-44-LE26 (negocio 1525), MCT cot. 621206, 10-nov-2026 ─────────────────────────────────────────────────────────────────────────
// La línea cobra por METRO y el producto se compra por ROLLO de 68 m: se guardaba $2.000 «por rollo» (98,6 % bajo lo costeado).
// Igual con clavos por KG contra caja de 25 kilos. (Texto armado con los datos de la memoria del caso, no copiado letra a letra.)
test('2736-44-LE26 MCT: precio por metro/kilo se pasa a rollo/caja solo si el factor está en el producto', () => {
  const doc = 'FOLIO INCOLORO 2 MTS X 0.20MM | 140 | MT. | $2.000\nCLAVOS VOLCANITA 1 1/4 | 25 | KG. | $3.300';
  const rollo = 'Rollo nylon transparente 0,20 mm, 68mts';
  const r = precioPorUnidadDeProducto({ unidadLinea: 'MT', precioLinea: 2000, cantidadPorUnidad: 68 }, rollo, doc);
  assert.equal(r?.precio, 136000);
  assert.equal(precioPorUnidadDeProducto({ unidadLinea: 'MT', precioLinea: 2000, cantidadPorUnidad: 50 }, rollo, doc), null);   // 50 no está en el producto
  const caja = 'Clavo volcanita, caja de 25 kilos';
  const conv = conversionDesdeTexto(3300, caja, doc);
  assert.equal(conv?.cantidadPorUnidad, 25);
  assert.equal(precioPorUnidadDeProducto(conv, caja, doc)?.precio, 82500);
});
