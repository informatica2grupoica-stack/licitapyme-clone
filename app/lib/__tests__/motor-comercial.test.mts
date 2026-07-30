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
