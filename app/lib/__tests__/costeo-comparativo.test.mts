// Tests del cuadro comparativo del costeo — contrastados contra el Excel REAL del comercial
// (COSTEO_1271359-92-LE26_2026-07-20.xlsx, hojas "NO VA canasta 1" y "canasta 2").
// Correr con:
//   npx tsx --test app/lib/__tests__/costeo-comparativo.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularComparativo, IVA } from '../costeo-comparativo';

/** Redondeo a 4 decimales: el Excel arrastra las colas de sus divisiones por 1,19. */
const cerca = (a: number, b: number, tol = 0.01) =>
  assert.ok(Math.abs(a - b) <= tol, `esperado ${b}, dio ${a}`);

// ─── Las fórmulas, celda por celda ────────────────────────────────────────────────────────────
// Hoja "canasta 2": K16 = 19.556.323 (venta neta), K17 = H12 = 15.645.075,63 (costo neto),
// F15 = 21.478.000 (presupuesto CON IVA) → K14 = 18.048.739,50.
test('replica celda por celda el bloque de totales del Excel (canasta 2 de 1271359-92-LE26)', () => {
  const c = calcularComparativo({
    ventaNeta: 19556323,
    costoNetoEstimado: 15645075.630252104,
    costoNetoReal: 0,
    filasConCostoReal: 0,
    filasTotales: 5,
    presupuestoNeto: 21478000 / IVA,
  });
  cerca(c.ventaConIva, 23272024.369999997);          // H16 = K16*1,19
  cerca(c.ventaIva, 3715701.37);                     // H17 = K16*19%
  cerca(c.utilidadEstimada, 3911247.3697478957);     // K18 = K16-K17
  cerca(c.margenEstimado!, 19.99991189421394);       // K19 = 1-(K17/K16), en %
  cerca(c.presupuestoNeto!, 18048739.49579832);      // K14 = F15/1,19
  cerca(c.distanciaPresupuesto!, -8.352846494086963); // K20 = 1-(K16/K14), en %
});

// ─── EL TOPE ES POR LÍNEA, NO GLOBAL ──────────────────────────────────────────────────────────
// Bug real (03-sep-2026): el cuadro comparaba TODO el costeo contra el presupuesto global de la
// licitación ($33.040.000 neto) y daba +40,8% de holgura para la canasta 2 — que en realidad iba
// 8,4% SOBRE su propio tope. En el Excel del comercial cada canasta tiene su celda "Presupuesto
// iva incluido" propia, y por eso mismo la canasta 1 quedó rotulada "NO VA": se pasaba 50%.
test('cada línea se mide contra SU tope: el global da una distancia que no existe', () => {
  const canasta2 = { ventaNeta: 19556323, costoNetoEstimado: 15645075.630252104, costoNetoReal: 0, filasConCostoReal: 0, filasTotales: 5 };
  const conTopeDeLinea = calcularComparativo({ ...canasta2, presupuestoNeto: 21478000 / IVA });
  const conTopeGlobal = calcularComparativo({ ...canasta2, presupuestoNeto: 33040000 });

  cerca(conTopeDeLinea.distanciaPresupuesto!, -8.35);
  assert.ok(conTopeDeLinea.distanciaPresupuesto! < 0, 'contra su tope real, la canasta 2 está POR ENCIMA');
  assert.ok(conTopeGlobal.distanciaPresupuesto! > 40, 'contra el global aparentaba 40% de holgura — ese era el bug');
});

test('la canasta que se pasa la mitad del tope se ve al tiro (por eso quedó "NO VA")', () => {
  const c = calcularComparativo({
    ventaNeta: 22492500,
    costoNetoEstimado: 16785714.285714287,
    costoNetoReal: 0, filasConCostoReal: 0, filasTotales: 1,
    presupuestoNeto: 17839600 / IVA,
  });
  cerca(c.distanciaPresupuesto!, -50.03741675822329); // K15 de la hoja "NO VA canasta 1"
  cerca(c.margenEstimado!, 25.37194937995204);        // K14 de esa misma hoja
});

// ─── EL PRESUPUESTO POR LÍNEA VIENE CON IVA ───────────────────────────────────────────────────
// Bug real (03-sep-2026): `presupuesto_linea` del informe guarda el monto tal como lo publican las
// bases, o sea CON IVA, y el editor lo estaba usando como si ya fuera neto — un tope 19% más alto
// del que existe. Los valores de abajo son los del informe REAL de 1271359-92-LE26 y coinciden al
// peso con los que el comercial tipeó a mano en su Excel (celdas F10 y F15).
test('el presupuesto por línea del informe es bruto: pasado a neto reproduce el Excel del comercial', () => {
  for (const [bruto, netoEsperado, venta, distanciaEsperada] of [
    [17839600, 14991260.50420168, 22492500, -50.03741675822329],  // línea 1 → K9 y K15 del Excel
    [21478000, 18048739.49579832, 19556323, -8.352846494086963],  // línea 2 → K14 y K20 del Excel
  ] as const) {
    const c = calcularComparativo({
      ventaNeta: venta, costoNetoEstimado: 0, costoNetoReal: 0,
      filasConCostoReal: 0, filasTotales: 1, presupuestoNeto: bruto / IVA,
    });
    cerca(c.presupuestoNeto!, netoEsperado);
    cerca(c.presupuestoConIva!, bruto);   // ida y vuelta: lo que se muestra en la celda amarilla
    cerca(c.distanciaPresupuesto!, distanciaEsperada);
  }
});

test('usar el bruto como si fuera neto infla el tope 19% y esconde que la oferta se pasó', () => {
  const comun = { ventaNeta: 19556323, costoNetoEstimado: 0, costoNetoReal: 0, filasConCostoReal: 0, filasTotales: 1 };
  const bien = calcularComparativo({ ...comun, presupuestoNeto: 21478000 / IVA });
  const mal = calcularComparativo({ ...comun, presupuestoNeto: 21478000 }); // el bug
  assert.ok(bien.distanciaPresupuesto! < 0, 'con el tope real la oferta está POR ENCIMA');
  assert.ok(mal.distanciaPresupuesto! > 0, 'con el bruto sin convertir aparentaba holgura');
});

// ─── Bloque REAL ──────────────────────────────────────────────────────────────────────────────
// En el Excel estas dos celdas están MALAS: N19 ("% Margen" real) apunta a las celdas de TEXTO de
// las etiquetas (por eso muestra #¡VALOR!) y N20 ("% de Variación") apunta a la SUMA del costo
// real, no a una variación (por eso marcaba 0%). Acá se implementa lo que querían decir.
test('sin costo real cargado, el bloque REAL queda vacío en vez de inventar una utilidad', () => {
  const c = calcularComparativo({
    ventaNeta: 19556323, costoNetoEstimado: 15645075.630252104,
    costoNetoReal: 0, filasConCostoReal: 0, filasTotales: 5, presupuestoNeto: null,
  });
  assert.equal(c.costoNetoReal, null);
  assert.equal(c.utilidadReal, null, 'con costo real 0 el Excel mostraba la venta entera como utilidad');
  assert.equal(c.margenReal, null);
  assert.equal(c.variacionCosto, null);
  assert.equal(c.realCompleto, false);
});

test('la variación se calcula sobre los totales: (costo real / costo estimado) − 1', () => {
  const costoNetoEstimado = 15645075.630252104;
  const c = calcularComparativo({
    ventaNeta: 19556323, costoNetoEstimado,
    costoNetoReal: costoNetoEstimado * 0.97, // se compró 3% más barato de lo cotizado
    filasConCostoReal: 5, filasTotales: 5, presupuestoNeto: null,
  });
  cerca(c.variacionCosto!, -3);
  cerca(c.utilidadReal!, 19556323 - costoNetoEstimado * 0.97);
  assert.ok(c.realCompleto, 'las 5 filas tienen costo real → el bloque REAL es un cierre');
});

test('costo real a medio cargar NO se declara completo (la utilidad real sale inflada)', () => {
  const c = calcularComparativo({
    ventaNeta: 19556323, costoNetoEstimado: 15645075.630252104,
    costoNetoReal: 6098067, filasConCostoReal: 1, filasTotales: 5, presupuestoNeto: null,
  });
  assert.equal(c.realCompleto, false);
  assert.equal(c.filasConCostoReal, 1);
});

// ─── Bordes ───────────────────────────────────────────────────────────────────────────────────
test('sin tope conocido no hay distancia que mostrar (nada de rellenar con el global)', () => {
  const c = calcularComparativo({
    ventaNeta: 1000, costoNetoEstimado: 800, costoNetoReal: 0,
    filasConCostoReal: 0, filasTotales: 1, presupuestoNeto: null,
  });
  assert.equal(c.distanciaPresupuesto, null);
  assert.equal(c.presupuestoConIva, null);
});

test('un costeo todavía en blanco no revienta ni divide por cero', () => {
  const c = calcularComparativo({
    ventaNeta: 0, costoNetoEstimado: 0, costoNetoReal: 0,
    filasConCostoReal: 0, filasTotales: 0, presupuestoNeto: null,
  });
  assert.equal(c.margenEstimado, null);
  assert.equal(c.utilidadEstimada, 0);
  assert.equal(c.realCompleto, false);
});

// ─── La alerta del Motor Comercial, con el mismo tope ──────────────────────────────────────────
// El editor y la alerta "Sobre presupuesto por línea" tienen que decir lo MISMO: si el cuadro
// muestra la línea 8,4% por encima de su tope, la alerta no puede quedarse muda. Antes se quedaba:
// comparaba el costeo neto contra el tope bruto, o sea con 19% de aire regalado.
test('la alerta por línea salta en el mismo punto en que el cuadro muestra distancia negativa', async () => {
  const { calcularAlertasMotorComercial } = await import('../motor-comercial');
  const bruto = 21478000;
  const filas = [{
    hoja: 'Línea 2', fila: 2, item: 1, detalle: 'Locker metálicos colores', lineaPublicada: 2,
    unidad: 'Un', cantidadOriginal: 33, costoUnitarioNeto: 184789.91596638656,
    costoTotalNeto: 6098067.226890757, precioUnitarioSinDecimales: 592615, precioTotalNeto: 19556323,
  }];
  const args = {
    filas, totalAnexoEconomico: null, presupuestoPublicado: 33040000,
    lineasPublicadas: [
      { linea: 1, cantidad: 2500, unidad: 'm2', presupuestoLinea: 17839600 / IVA },
      { linea: 2, cantidad: 33, unidad: 'Un', presupuestoLinea: bruto / IVA },
    ],
    lineasExcluidas: new Set([1]), // la canasta 1 es justamente la que quedó "NO VA"
  };
  const conTopeNeto = calcularAlertasMotorComercial(args as any);
  assert.ok(conTopeNeto.some(a => a.codigo === 'SOBRE_PRESUPUESTO_LINEA'),
    'con el tope en neto la línea 2 se pasa y tiene que alertar');

  // Y el cuadro comparativo, con ese mismo tope, muestra la distancia negativa que la justifica.
  const c = calcularComparativo({
    ventaNeta: 19556323, costoNetoEstimado: 6098067.226890757, costoNetoReal: 0,
    filasConCostoReal: 0, filasTotales: 1, presupuestoNeto: bruto / IVA,
  });
  assert.ok(c.distanciaPresupuesto! < 0);

  // El bug: con el tope sin convertir (bruto), la misma oferta no alertaba.
  const conTopeBruto = calcularAlertasMotorComercial({
    ...args, lineasPublicadas: [
      { linea: 1, cantidad: 2500, unidad: 'm2', presupuestoLinea: 17839600 },
      { linea: 2, cantidad: 33, unidad: 'Un', presupuestoLinea: bruto },
    ],
  } as any);
  assert.ok(!conTopeBruto.some(a => a.codigo === 'SOBRE_PRESUPUESTO_LINEA'),
    'así estaba antes: el tope bruto le regalaba 19% de aire y la alerta no salía');
});

// ─── Recargo s/costo ⇄ margen s/venta ─────────────────────────────────────────────────────────
// El usuario preguntó dos veces por qué arriba dice 25% y en el cuadro 20% (03-sep-2026): son los
// dos lados de la MISMA cifra. El Excel tiene los dos: el 1,25 incrustado en la fórmula de la
// columna I, y el 20% calculado en K19.
test('25% de recargo sobre el costo = 20% de margen sobre la venta (y al revés)', async () => {
  const { recargoParaMargen, margenDeRecargo } = await import('../costeo-comparativo');
  cerca(margenDeRecargo(25), 20);
  cerca(recargoParaMargen(20)!, 25);
  cerca(margenDeRecargo(27), 21.259842519685041);   // el ×1,27 de la plantilla
  cerca(margenDeRecargo(34), 25.373134328358208);   // el ×1,34 de la canasta 1 → su K14 marca 25%
  for (const m of [5, 12.5, 20, 25, 33.3, 60]) cerca(margenDeRecargo(recargoParaMargen(m)!), m);
});

test('un margen imposible no se aplica en vez de dar un precio infinito o negativo', async () => {
  const { recargoParaMargen } = await import('../costeo-comparativo');
  assert.equal(recargoParaMargen(100), null);
  assert.equal(recargoParaMargen(120), null);
  assert.equal(recargoParaMargen(NaN), null);
  assert.ok(recargoParaMargen(99)! > 9000, 'un margen de 99% exige un recargo enorme, pero es válido');
});

// ─── Recargo POR HOJA ─────────────────────────────────────────────────────────────────────────
// En el Excel real cada canasta vende con el suyo (×1,25 y ×1,34), incrustado en cada fórmula.
test('cada hoja puede vender con su propio recargo; la que no tiene usa el del costeo', async () => {
  const { editorAFilasCosteo } = await import('../costeo-editor');
  const fila = (id: string, valorConIva: number) => ({
    id, item: 1, lineaReal: null, detalle: 'x', unidad: 'UN', skuProveedor: '',
    cantidad: 1, valorConIva, costoRealUnitario: null, link1: '', link2: '', link3: '',
  });
  const filas = editorAFilasCosteo({
    modalidad: 'por_linea',
    margenVenta: 25,
    grupos: [
      { nombre: 'Línea 1', linea: 1, ofertamos: true, margenVenta: 34, filas: [fila('a', 11900)] },
      { nombre: 'Línea 2', linea: 2, ofertamos: true, filas: [fila('b', 11900)] }, // hereda el 25
    ],
  } as any);
  assert.equal(filas.length, 2);
  assert.equal(filas[0].precioUnitarioSinDecimales, Math.trunc(10000 * 1.34));
  assert.equal(filas[1].precioUnitarioSinDecimales, Math.trunc(10000 * 1.25));
});
