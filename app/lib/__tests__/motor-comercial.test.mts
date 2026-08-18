// Regresión del Motor Comercial (30-jul-2026): el chequeo "Error de origen" comparaba `item`
// (posición del producto DENTRO de su hoja, reinicia en 1 en cada hoja LINEAn) contra el número
// de línea real de la licitación — dos cosas distintas en cualquier costeo por_linea con más de
// un sub-producto por línea. Disparaba en casi cualquier costeo real. Casos de acá replican el
// caso real (1738-18-LE26: 6 líneas, varias con 4-20 sub-ítems cada una).
//   npx tsx --test app/lib/__tests__/motor-comercial.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lineaDeHoja, calcularAlertasMotorComercial, lineaDeFila, totalPrecioDeLinea, type FilaCosteo,
} from '../motor-comercial';

function fila(over: Partial<FilaCosteo>): FilaCosteo {
  return {
    hoja: 'Costeo', fila: 4, item: 1, detalle: 'ítem', unidad: 'UN', cantidadOriginal: 1,
    costoUnitarioNeto: 100, costoTotalNeto: 100, precioUnitarioSinDecimales: 150, precioTotalNeto: 150,
    lineaPublicada: null,
    ...over,
  };
}

test('lineaDeHoja: "LINEA4" → 4, hojas normales → null', () => {
  assert.equal(lineaDeHoja('LINEA4'), 4);
  assert.equal(lineaDeHoja('linea 12'), 12);
  assert.equal(lineaDeHoja('Costeo'), null);
  assert.equal(lineaDeHoja('FERRETERIA'), null);
});

test('caso real: línea con 4 sub-ítems (item 1..4 reiniciado) NO dispara error de origen falso', () => {
  // Antes: comparaba item=1,2,3,4 contra líneas publicadas 1,2,3,4 y los descuadraba todos.
  const filas = [1, 2, 3, 4].map(item => fila({ hoja: 'LINEA1', lineaPublicada: 1, item, cantidadOriginal: 10 + item }));
  const alertas = calcularAlertasMotorComercial({
    filas, totalAnexoEconomico: null, presupuestoPublicado: null,
    lineasPublicadas: [{ linea: 1, cantidad: 6, unidad: 'UN', presupuestoLinea: null }],
  });
  assert.equal(alertas.find(a => a.codigo === 'ERROR_DE_ORIGEN'), undefined);
});

test('línea con UN solo sub-ítem: si la cantidad no calza, SÍ dispara (caso 1:1 válido)', () => {
  const filas = [fila({ hoja: 'LINEA2', lineaPublicada: 2, item: 1, cantidadOriginal: 999 })];
  const alertas = calcularAlertasMotorComercial({
    filas, totalAnexoEconomico: null, presupuestoPublicado: null,
    lineasPublicadas: [{ linea: 2, cantidad: 6, unidad: 'UN', presupuestoLinea: null }],
  });
  const err = alertas.find(a => a.codigo === 'ERROR_DE_ORIGEN');
  assert.ok(err, 'esperaba ERROR_DE_ORIGEN');
  assert.match(err!.detalle, /Línea\(s\) 2:/);
});

test('suma_alzada (una sola hoja "Costeo"): item SIGUE representando la línea (comportamiento previo intacto)', () => {
  const filas = [
    fila({ hoja: 'Costeo', lineaPublicada: null, item: 1, cantidadOriginal: 999 }),
    fila({ hoja: 'Costeo', lineaPublicada: null, item: 2, cantidadOriginal: 6 }),
  ];
  const alertas = calcularAlertasMotorComercial({
    filas, totalAnexoEconomico: null, presupuestoPublicado: null,
    lineasPublicadas: [
      { linea: 1, cantidad: 6, unidad: 'UN', presupuestoLinea: null },
      { linea: 2, cantidad: 6, unidad: 'UN', presupuestoLinea: null },
    ],
  });
  const err = alertas.find(a => a.codigo === 'ERROR_DE_ORIGEN');
  assert.ok(err);
  assert.match(err!.detalle, /Línea\(s\) 1:/);
  assert.doesNotMatch(err!.detalle, /2/);
});

test('SOBRE_PRESUPUESTO_LINEA: dispara aunque el total global esté BAJO el presupuesto global', () => {
  const filas = [
    fila({ hoja: 'LINEA1', lineaPublicada: 1, precioTotalNeto: 9_000_000 }),  // se pasa de SU línea
    fila({ hoja: 'LINEA2', lineaPublicada: 2, precioTotalNeto: 500_000 }),
  ];
  const alertas = calcularAlertasMotorComercial({
    filas, totalAnexoEconomico: null, presupuestoPublicado: 50_000_000, // global generoso, no se pasa
    lineasPublicadas: [
      { linea: 1, cantidad: null, unidad: null, presupuestoLinea: 5_000_000 }, // línea 1 se pasa
      { linea: 2, cantidad: null, unidad: null, presupuestoLinea: 5_000_000 },
    ],
  });
  assert.equal(alertas.find(a => a.codigo === 'SOBRE_PRESUPUESTO'), undefined, 'el global no debía dispararse');
  const err = alertas.find(a => a.codigo === 'SOBRE_PRESUPUESTO_LINEA');
  assert.ok(err, 'esperaba SOBRE_PRESUPUESTO_LINEA');
  assert.match(err!.detalle, /Línea\(s\) 1:/);
});

test('línea marcada "no ofertamos" se excluye del total, de sobre-presupuesto y del error de origen', () => {
  const filas = [
    fila({ hoja: 'LINEA1', lineaPublicada: 1, item: 1, precioTotalNeto: 100_000_000, cantidadOriginal: 999 }), // basura de una línea descartada
    fila({ hoja: 'LINEA2', lineaPublicada: 2, item: 1, precioTotalNeto: 500_000, cantidadOriginal: 6 }),
  ];
  const alertas = calcularAlertasMotorComercial({
    filas, totalAnexoEconomico: null, presupuestoPublicado: 1_000_000,
    lineasPublicadas: [
      { linea: 1, cantidad: 6, unidad: 'UN', presupuestoLinea: null },
      { linea: 2, cantidad: 6, unidad: 'UN', presupuestoLinea: null },
    ],
    lineasExcluidas: new Set([1]),
  });
  assert.equal(alertas.find(a => a.codigo === 'SOBRE_PRESUPUESTO'), undefined);
  assert.equal(alertas.find(a => a.codigo === 'ERROR_DE_ORIGEN'), undefined);
});

test('totalPrecioDeLinea suma todos los sub-ítems de la línea (no toma solo uno)', () => {
  const filas = [
    fila({ hoja: 'LINEA4', lineaPublicada: 4, item: 1, precioTotalNeto: 10_000 }),
    fila({ hoja: 'LINEA4', lineaPublicada: 4, item: 2, precioTotalNeto: 25_000 }),
    fila({ hoja: 'LINEA4', lineaPublicada: 4, item: 3, precioTotalNeto: 7_500 }),
  ];
  assert.equal(totalPrecioDeLinea(filas, 4), 42_500);
  assert.equal(totalPrecioDeLinea(filas, 99), null);
});

test('lineaDeFila: prioriza el nombre de hoja sobre item', () => {
  assert.equal(lineaDeFila(fila({ hoja: 'LINEA5', lineaPublicada: 5, item: 1 })), 5);
  assert.equal(lineaDeFila(fila({ hoja: 'Costeo', lineaPublicada: null, item: 3 })), 3);
});

// ── parsearCosteo: cualquier planilla, no solo la nuestra ────────────────────────────────────
// BUG REAL (18-ago-2026, "1787062742902_1_COSTEO_2296-48-LE26.xlsx"): la empresa cotiza en SU
// planilla histórica, donde los ítems arrancan en la fila 3 (no la 4) y las columnas están
// corridas. Con las posiciones fijas el fallo era SILENCIOSO y total: el único ítem real se
// perdía, itemsPrecioDeCosteo devolvía [] (el anexo de Oferta Económica salía en blanco) y
// totalesDeCosteo daba $0 — el motor comercial calculaba sus alertas contra un costeo vacío.
import ExcelJS from 'exceljs';
import { parsearCosteo, itemsPrecioDeCosteo, totalesDeCosteo } from '../motor-comercial';

async function libro(hojas: Array<{ nombre: string; filas: (string | number | null)[][] }>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const h of hojas) {
    const ws = wb.addWorksheet(h.nombre);
    h.filas.forEach((f, i) => ws.getRow(i + 1).values = [null, ...f]);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// Encabezados de la planilla histórica: "CONVERSION" por unidad, cantidad ANTES del costo, y una
// hoja "Datos Proveedor" que trae ITEM/Detalle/Cantidad pero NINGÚN precio de venta.
const CABECERA_EMPRESA = ['ITEM', 'Detalle', 'Cantidad', 'CONVERSION', 'VALOR C/ IVA', 'Costo unitario neto', 'Costo total neto', 'Precio unitario venta', 'Precio unitario sin decimales', 'Precio total neto'];

test('parsearCosteo: planilla propia de la empresa (ítems en la fila 3, columnas corridas)', async () => {
  const buf = await libro([{
    nombre: 'COSTEO',
    filas: [
      [null, null, null, null, null, null, null, null, 'PRECIOS PARA MERCADOPUBLICO', null],
      CABECERA_EMPRESA,
      [1, '7 juegos modulares', 7, 'unidad', 2890000, 2428571, 17000000, 3084285.71, 3084285, 21589995],
      [2, null, null, 'unidad', 0, null, null, null, null, null],
    ],
  }]);
  const filas = await parsearCosteo(buf);
  assert.equal(filas.length, 1, 'solo la fila con datos reales es un ítem');
  assert.equal(filas[0].detalle, '7 juegos modulares');
  assert.equal(filas[0].cantidadOriginal, 7);
  assert.equal(filas[0].unidad, 'unidad');
  // El precio unitario que se oferta es el SIN DECIMALES, no el del cálculo.
  assert.equal(filas[0].precioUnitarioSinDecimales, 3084285);
  assert.equal(totalesDeCosteo(filas).totalPrecioNeto, 21589995);
  assert.equal(itemsPrecioDeCosteo(filas).length, 1);
});

// Un pie ("COSTEADO POR: …") cae en la misma columna de precio total y, sumado, DUPLICA el costeo:
// en el caso real el total daba $68.872.084 en vez de $21.589.995.
test('parsearCosteo: las filas de PIE y las notas no se cuentan como ítems', async () => {
  const buf = await libro([{
    nombre: 'COSTEO',
    filas: [
      CABECERA_EMPRESA,
      [1, 'Producto real', 7, 'unidad', 100, 200, 300, 400, 3084285, 21589995],
      [null, 'COSTEADO POR: Mixi Araya', null, null, null, null, null, null, null, 25692094],
      [null, 'Todos los plazos y montos están en la página de referencia', null, null, null, null, null, null, null, 21589995],
    ],
  }]);
  const filas = await parsearCosteo(buf);
  assert.equal(filas.length, 1);
  assert.equal(totalesDeCosteo(filas).totalPrecioNeto, 21589995, 'el pie no puede duplicar el total');
});

// "Datos Proveedor" trae ITEM/Detalle/Cantidad y costos, pero NUNCA precio de venta — es lo único
// que la distingue de un costeo. Antes entraba con cientos de filas basura.
test('parsearCosteo: una hoja sin precio de venta no es un costeo y se ignora entera', async () => {
  const buf = await libro([
    { nombre: 'COSTEO', filas: [CABECERA_EMPRESA, [1, 'Producto', 1, 'unidad', 1, 1, 1, 1, 1000, 1000]] },
    { nombre: 'Datos Proveedor', filas: [['ITEM', 'Detalle', 'Cantidad', 'Costo unitario REAL', 'Costo total neto REAL'], [1, 'Otra cosa', 5, 10, 50]] },
    { nombre: 'Analisis', filas: [['ID'], ['Cliente'], ['Garantías', 'NO TIENE GARANTIAS']] },
  ]);
  const filas = await parsearCosteo(buf);
  assert.deepEqual([...new Set(filas.map(f => f.hoja))], ['COSTEO']);
});

// Los DOS formatos de "por línea" conviven en la realidad: una hoja por línea (lo que genera
// generar-costeo.ts) y una sola hoja con una COLUMNA "Línea". Antes solo se reconocía el primero.
test('parsearCosteo: por línea, tanto por hoja "LINEAn" como por columna "Línea"', async () => {
  const porHoja = await parsearCosteo(await libro([
    { nombre: 'LINEA1', filas: [CABECERA_EMPRESA, [1, 'A', 1, 'un', 1, 1, 1, 1, 100, 100]] },
    { nombre: 'LINEA2', filas: [CABECERA_EMPRESA, [1, 'B', 1, 'un', 1, 1, 1, 1, 200, 200]] },
  ]));
  assert.deepEqual(porHoja.map(f => f.lineaPublicada), [1, 2]);

  const porColumna = await parsearCosteo(await libro([{
    nombre: 'COSTEO',
    filas: [
      ['Línea', ...CABECERA_EMPRESA],
      [3, 1, 'A', 1, 'un', 1, 1, 1, 1, 100, 100],
      [7, 2, 'B', 1, 'un', 1, 1, 1, 1, 200, 200],
    ],
  }]));
  assert.deepEqual(porColumna.map(f => f.lineaPublicada), [3, 7]);
});

// El formato "suma alzada / costeo global": una sola hoja, sin ninguna noción de línea.
test('parsearCosteo: suma alzada deja lineaPublicada en null (no inventa líneas)', async () => {
  const filas = await parsearCosteo(await libro([{
    nombre: 'COSTEO', filas: [CABECERA_EMPRESA, [1, 'Servicio completo', 1, 'global', 1, 1, 1, 1, 5000, 5000]],
  }]));
  assert.equal(filas.length, 1);
  assert.equal(filas[0].lineaPublicada, null);
});

// ── "Sobre presupuesto por línea": el falso positivo de 2296-48-LE26 ─────────────────────────
// La alerta saltaba con un costeo CÓMODAMENTE bajo el presupuesto ($21.589.995 vs $22.268.908).
// Dos causas encadenadas: (1) la licitación es suma alzada, no tiene líneas independientes, y
// (2) el `presupuesto_linea` guardado era 26.500.000/7 = el precio máximo POR UNIDAD, comparado
// contra el TOTAL de la línea.
import { presupuestoDeLineaEsUnitario } from '../motor-comercial';

test('presupuestoDeLineaEsUnitario: reconoce el unitario disfrazado de tope de línea', () => {
  // Caso real: 3.785.714 × 7 = 26.500.000 = el presupuesto BRUTO publicado.
  assert.equal(presupuestoDeLineaEsUnitario({ cantidad: 7, presupuestoLinea: 3785714 }, 22268908), true);
  // Un tope de línea de verdad no reconstruye el global al multiplicarlo por la cantidad.
  assert.equal(presupuestoDeLineaEsUnitario({ cantidad: 7, presupuestoLinea: 22000000 }, 22268908), false);
  // Con cantidad 1 el unitario y el total son el mismo número: no hay nada que distinguir.
  assert.equal(presupuestoDeLineaEsUnitario({ cantidad: 1, presupuestoLinea: 22268908 }, 22268908), false);
  // Sin datos no se inventa nada.
  assert.equal(presupuestoDeLineaEsUnitario({ cantidad: 7, presupuestoLinea: null }, 22268908), false);
  assert.equal(presupuestoDeLineaEsUnitario({ cantidad: 7, presupuestoLinea: 100 }, null), false);
});

test('SOBRE_PRESUPUESTO_LINEA: no dispara en suma alzada (una sola línea)', () => {
  const alertas = calcularAlertasMotorComercial({
    filas: [fila({ item: 1, precioTotalNeto: 21589995, lineaPublicada: null })],
    totalAnexoEconomico: null,
    presupuestoPublicado: 22268908,
    lineasPublicadas: [{ linea: 1, cantidad: 7, unidad: 'Unidad', presupuestoLinea: 3785714 }],
  });
  assert.equal(alertas.some(a => a.codigo === 'SOBRE_PRESUPUESTO_LINEA'), false);
  // Y el chequeo GLOBAL tampoco: el costeo está bajo el presupuesto.
  assert.equal(alertas.some(a => a.codigo === 'SOBRE_PRESUPUESTO'), false);
});

test('SOBRE_PRESUPUESTO_LINEA: con varias líneas y topes reales, sigue disparando', () => {
  const alertas = calcularAlertasMotorComercial({
    filas: [
      fila({ hoja: 'LINEA1', item: 1, precioTotalNeto: 5000, lineaPublicada: 1 }),
      fila({ hoja: 'LINEA2', item: 1, precioTotalNeto: 900, lineaPublicada: 2 }),
    ],
    totalAnexoEconomico: null,
    presupuestoPublicado: 100000,
    lineasPublicadas: [
      { linea: 1, cantidad: 2, unidad: 'Unidad', presupuestoLinea: 1000 },  // 5000 > 1000 → alerta
      { linea: 2, cantidad: 2, unidad: 'Unidad', presupuestoLinea: 1000 },  // 900 < 1000 → no
    ],
  });
  const a = alertas.find(x => x.codigo === 'SOBRE_PRESUPUESTO_LINEA');
  assert.ok(a, 'debe seguir detectando el exceso real por línea');
  assert.match(a!.detalle, /1/);
  assert.doesNotMatch(a!.detalle.replace(/Línea\(s\) [^:]*/, ''), /\b2\b/);
});
