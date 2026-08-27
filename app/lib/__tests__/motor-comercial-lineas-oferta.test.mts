// Tests del MOTOR COMERCIAL frente al selector de líneas a ofertar (migración 78).
//
// El motor ya sabía excluir líneas (`lineasExcluidas`); lo que estaba mal era CÓMO se armaba ese
// conjunto — se derivaba de filas del checklist marcadas "no ofertamos", y una línea descartada
// en el selector ya ni siquiera genera fila. Estos tests fijan el comportamiento del motor con el
// conjunto bien armado, que es lo que el usuario reportó ("que no me alerte por líneas a las que
// no me presento").
//
// Correr con:
//   npx tsx --test app/lib/__tests__/motor-comercial-lineas-oferta.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularAlertasMotorComercial, type FilaCosteo } from '../motor-comercial';

// Costeo de 3 líneas. La 2 se cotizó (el Excel se generó antes de decidir) pero NO se oferta.
const fila = (over: Partial<FilaCosteo>): FilaCosteo => ({
  item: null, descripcion: 'x', unidad: null, cantidadOriginal: null,
  costoTotalNeto: null, precioTotalNeto: null, lineaPublicada: null, ...over,
} as FilaCosteo);

const FILAS: FilaCosteo[] = [
  fila({ item: 1, lineaPublicada: 1, precioTotalNeto: 1_000_000, costoTotalNeto: 800_000 }),
  fila({ item: 2, lineaPublicada: 2, precioTotalNeto: 5_000_000, costoTotalNeto: 4_000_000 }),
  fila({ item: 3, lineaPublicada: 3, precioTotalNeto: 2_000_000, costoTotalNeto: 1_500_000 }),
];

const PUBLICADAS = [
  { linea: 1, cantidad: null, unidad: null, presupuestoLinea: 1_200_000 },
  { linea: 2, cantidad: null, unidad: null, presupuestoLinea: 3_000_000 },  // el costeo se pasa acá
  { linea: 3, cantidad: null, unidad: null, presupuestoLinea: 2_500_000 },
];

const codigos = (a: ReturnType<typeof calcularAlertasMotorComercial>) => a.map(x => x.codigo).sort();

test('sin excluir nada, la línea 2 dispara "sobre presupuesto por línea" (línea base)', () => {
  const alertas = calcularAlertasMotorComercial({
    filas: FILAS, totalAnexoEconomico: null, presupuestoPublicado: 20_000_000,
    lineasPublicadas: PUBLICADAS,
  });
  assert.ok(codigos(alertas).includes('SOBRE_PRESUPUESTO_LINEA'));
});

// Este es el reclamo textual del usuario: se postula solo a algunas líneas y el sistema alertaba
// por el descuadre de una línea a la que no se presenta.
test('excluida la línea 2, deja de alertar por ella', () => {
  const alertas = calcularAlertasMotorComercial({
    filas: FILAS, totalAnexoEconomico: null, presupuestoPublicado: 20_000_000,
    lineasPublicadas: PUBLICADAS, lineasExcluidas: new Set([2]),
  });
  assert.ok(!codigos(alertas).includes('SOBRE_PRESUPUESTO_LINEA'));
});

test('el total ofertado deja de contar la línea excluida', () => {
  // Ofertamos 1 y 3 = 3.000.000. Si el total se calculara con la línea 2 (8.000.000) el checklist
  // parecería descuadrado contra el costeo.
  const alertas = calcularAlertasMotorComercial({
    filas: FILAS, totalAnexoEconomico: 3_000_000, presupuestoPublicado: 20_000_000,
    lineasPublicadas: PUBLICADAS, lineasExcluidas: new Set([2]),
  });
  assert.ok(!codigos(alertas).includes('DISCORDANCIA_COSTEO_ANEXO'));
});

test('sin excluir, ese mismo total SÍ se ve descuadrado (el filtro es lo que cambia)', () => {
  const alertas = calcularAlertasMotorComercial({
    filas: FILAS, totalAnexoEconomico: 3_000_000, presupuestoPublicado: 20_000_000,
    lineasPublicadas: PUBLICADAS,
  });
  assert.ok(codigos(alertas).includes('DISCORDANCIA_COSTEO_ANEXO'));
});

// Excluir no debe volverse una manera de esconder problemas reales de lo que SÍ se oferta.
test('un descuadre en una línea que SÍ se oferta sigue alertando', () => {
  const alertas = calcularAlertasMotorComercial({
    filas: FILAS, totalAnexoEconomico: null, presupuestoPublicado: 20_000_000,
    lineasPublicadas: [
      ...PUBLICADAS.slice(0, 2),
      { linea: 3, cantidad: null, unidad: null, presupuestoLinea: 500_000 },  // ahora la 3 se pasa
    ],
    lineasExcluidas: new Set([2]),
  });
  assert.ok(codigos(alertas).includes('SOBRE_PRESUPUESTO_LINEA'));
});

test('venta bajo costo en una línea excluida no alerta; en una ofertada sí', () => {
  const conPerdida = [
    fila({ item: 1, lineaPublicada: 1, precioTotalNeto: 1_000_000, costoTotalNeto: 800_000 }),
    fila({ item: 2, lineaPublicada: 2, precioTotalNeto: 100, costoTotalNeto: 5_000_000 }),
  ];
  const excluida = calcularAlertasMotorComercial({
    filas: conPerdida, totalAnexoEconomico: null, presupuestoPublicado: null,
    lineasPublicadas: PUBLICADAS, lineasExcluidas: new Set([2]),
  });
  assert.ok(!codigos(excluida).includes('VENTA_BAJO_COSTO'));

  const sinExcluir = calcularAlertasMotorComercial({
    filas: conPerdida, totalAnexoEconomico: null, presupuestoPublicado: null,
    lineasPublicadas: PUBLICADAS,
  });
  assert.ok(sinExcluir.map(a => a.codigo).includes('VENTA_BAJO_COSTO'));
});

// Fail-open: un negocio sin decisión guardada y sin marcas manuales llega acá con un Set vacío y
// tiene que comportarse EXACTAMENTE como antes de la migración 78.
test('un conjunto de excluidas vacío no cambia nada respecto de no pasarlo', () => {
  const args = {
    filas: FILAS, totalAnexoEconomico: 8_000_000, presupuestoPublicado: 5_000_000,
    lineasPublicadas: PUBLICADAS,
  };
  assert.deepEqual(
    codigos(calcularAlertasMotorComercial({ ...args, lineasExcluidas: new Set<number>() })),
    codigos(calcularAlertasMotorComercial(args)),
  );
});
