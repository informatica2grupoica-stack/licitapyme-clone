// El precio y el presupuesto tienen que seguir a las líneas que SE OFERTAN.
// Caso real 1271359-92-LE26 (negocio 415), reportado por el usuario con la pantalla a la vista:
// se oferta 1 de 2 canastas por $19.556.323 y el bloque decía "Total ofertado (2 líneas)
// $39.112.646" — el mismo dinero contado dos veces, porque quedaba viva una fila `precio:total`
// de cuando el informe clasificaba la licitación como suma alzada. Y el Motor Comercial mostraba
// el presupuesto de la licitación ENTERA ($33.040.000) en vez del tope de la canasta ofertada.
//   npx tsx --test app/lib/__tests__/precio-lineas-ofertadas.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDeFilasPrecio, hayPreciosObsoletos, type FilaPrecioExistente } from '../checklist-comercial';
import { presupuestoDeLaOferta, calcularAlertasMotorComercial, type FilaCosteo } from '../motor-comercial';

const POR_LINEA = {
  modalidad: { tipo: 'por_linea' },
  presupuesto: { bruto: 39317600, con_iva: true },
  manifiesto_productos: [
    { linea: 1, descripcion: 'Pasto sintético', cantidad: 2500, unidad_medida: 'MT2', presupuesto_linea: 17839600 },
    { linea: 2, descripcion: 'Locker metálicos colores', cantidad: 33, unidad_medida: 'Un', presupuesto_linea: 21478000 },
  ],
};
const SUMA_ALZADA = { ...POR_LINEA, modalidad: { tipo: 'suma_alzada' } };

const fila = (id: number, claveOrigen: string, extra?: Partial<FilaPrecioExistente>): FilaPrecioExistente =>
  ({ id, claveOrigen, ofertamos: null, virgen: true, ...extra });

// ─── Filas de precio que sobran ───────────────────────────────────────────────────────────────
test('por línea: el "precio total" viejo se desactiva si tiene valor cargado y se borra si está virgen', () => {
  const conValor = planDeFilasPrecio([
    fila(406, 'precio:total', { virgen: false, ofertamos: true }),
    fila(18430, 'precio:linea:1'), fila(18431, 'precio:linea:2'),
  ], POR_LINEA);
  assert.deepEqual(conValor, { borrar: [], desactivar: [406] }, 'un número que escribió una persona no se borra');

  const virgen = planDeFilasPrecio([
    fila(406, 'precio:total'), fila(18430, 'precio:linea:1'),
  ], POR_LINEA);
  assert.deepEqual(virgen, { borrar: [406], desactivar: [] });
});

test('suma alzada: los que sobran son los precios POR LÍNEA (la regla es simétrica)', () => {
  const plan = planDeFilasPrecio([
    fila(406, 'precio:total', { virgen: false }),
    fila(18430, 'precio:linea:1'), fila(18431, 'precio:linea:2', { virgen: false }),
  ], SUMA_ALZADA);
  assert.deepEqual(plan, { borrar: [18430], desactivar: [18431] });
});

test('no toca nada si solo existe una de las dos formas, ni si ya está desactivada', () => {
  assert.deepEqual(planDeFilasPrecio([fila(1, 'precio:linea:1'), fila(2, 'precio:linea:2')], POR_LINEA),
    { borrar: [], desactivar: [] });
  assert.deepEqual(planDeFilasPrecio([fila(1, 'precio:total')], SUMA_ALZADA), { borrar: [], desactivar: [] });
  assert.deepEqual(
    planDeFilasPrecio([fila(1, 'precio:total', { virgen: false, ofertamos: false }), fila(2, 'precio:linea:1')], POR_LINEA),
    { borrar: [], desactivar: [] }, 'idempotente: no vuelve a desactivar lo ya desactivado');
});

test('por línea SIN líneas en el informe: el "precio total" es el fallback a propósito, no sobra', () => {
  const sinLineas = { modalidad: { tipo: 'por_linea' }, presupuesto: { bruto: 1000 } };
  assert.deepEqual(planDeFilasPrecio([fila(1, 'precio:total'), fila(2, 'precio:linea:1', { virgen: false })], sinLineas),
    { borrar: [], desactivar: [] });
});

test('hayPreciosObsoletos: dispara una vez y deja de disparar una vez reconciliado', () => {
  const activos = [
    { tipo: 'precio', clave_origen: 'precio:total', ofertamos: true },
    { tipo: 'precio', clave_origen: 'precio:linea:2', ofertamos: true },
  ];
  assert.equal(hayPreciosObsoletos(activos, POR_LINEA), true);
  assert.equal(hayPreciosObsoletos(
    [{ ...activos[0], ofertamos: false }, activos[1]], POR_LINEA), false);
  assert.equal(hayPreciosObsoletos([{ tipo: 'linea_tecnica', clave_origen: 'tecnico:linea:1', ofertamos: null }], POR_LINEA), false);
});

// ─── El presupuesto es el de lo que ofertamos ─────────────────────────────────────────────────
test('ofertando una sola canasta, el tope es el de ESA canasta (y en neto)', () => {
  const lineas = [
    { linea: 1, cantidad: 2500, presupuestoLinea: 17839600 },
    { linea: 2, cantidad: 33, presupuestoLinea: 21478000 },
  ];
  const soloLinea2 = presupuestoDeLaOferta(POR_LINEA, lineas, new Set([1]));
  assert.equal(Math.round(soloLinea2!), 18048739, 'el mismo neto que el comercial calcula a mano (21.478.000 / 1,19)');
  // Sin descartar nada manda el global, también en neto.
  assert.equal(Math.round(presupuestoDeLaOferta(POR_LINEA, lineas, new Set())!), Math.round(39317600 / 1.19));
});

test('si una línea ofertada no tiene tope propio utilizable, se vuelve al global (no se inventa un máximo)', () => {
  const sinTope = [
    { linea: 1, cantidad: 1, presupuestoLinea: 17839600 },
    { linea: 2, cantidad: 33, presupuestoLinea: null },
    { linea: 3, cantidad: 5, presupuestoLinea: 1000000 },
  ];
  assert.equal(Math.round(presupuestoDeLaOferta(POR_LINEA, sinTope, new Set([1]))!), Math.round(39317600 / 1.19));

  // Y el guardarraíl del "unitario" (2296-48-LE26) sigue mandando: 26.500.000 / 7 no es un tope.
  const unitario = { presupuesto: { neto: 26500000, con_iva: false } };
  const lineas = [{ linea: 1, cantidad: 7, presupuestoLinea: 3785714 }, { linea: 2, cantidad: 1, presupuestoLinea: 500000 }];
  assert.equal(presupuestoDeLaOferta(unitario, lineas, new Set([2])), 26500000);
});

test('el aviso global no se repite cuando el aviso por línea ya cubre todo lo ofertado', () => {
  const filas: FilaCosteo[] = [
    { item: 1, lineaPublicada: 1, detalle: 'Pasto', cantidad: 1, unidad: 'un', costoTotalNeto: 100, precioTotalNeto: 5_000_000 } as any,
    { item: 2, lineaPublicada: 2, detalle: 'Locker', cantidad: 33, unidad: 'Un', costoTotalNeto: 100, precioTotalNeto: 19_556_323 } as any,
  ];
  const lineasPublicadas = [
    { linea: 1, cantidad: 2500, unidad: 'MT2', presupuestoLinea: 17839600 / 1.19 },
    { linea: 2, cantidad: 33, unidad: 'Un', presupuestoLinea: 21478000 / 1.19 },
  ];
  const soloLinea2 = calcularAlertasMotorComercial({
    filas, totalAnexoEconomico: null, presupuestoPublicado: 21478000 / 1.19,
    lineasPublicadas, lineasExcluidas: new Set([1]),
  }).map(a => a.codigo);
  assert.ok(soloLinea2.includes('SOBRE_PRESUPUESTO_LINEA'));
  assert.ok(!soloLinea2.includes('SOBRE_PRESUPUESTO'), 'un solo problema, una sola alerta');

  // Con las dos líneas ofertadas y solo una pasada de tope, el aviso global sigue apareciendo:
  // ahí es el único que mira el conjunto.
  const ambas = calcularAlertasMotorComercial({
    filas, totalAnexoEconomico: null, presupuestoPublicado: 20_000_000,
    lineasPublicadas, lineasExcluidas: new Set(),
  }).map(a => a.codigo);
  assert.ok(ambas.includes('SOBRE_PRESUPUESTO'));
  assert.ok(ambas.includes('SOBRE_PRESUPUESTO_LINEA'));
});
