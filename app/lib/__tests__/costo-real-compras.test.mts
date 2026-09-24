// Costo real de Compras: ítems agregados = gasto extra, comparativo real, consolidado, cierre, desvíos.
//   npx tsx --test app/lib/__tests__/costo-real-compras.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularComparativo, entradaComparativoDeFilas, costoRealDeFila, alertasDeDesvio, UMBRAL_DESVIO_PCT,
  type FilaParaComparativo,
} from '../costeo-comparativo';
import { fusionarEdicionCompras, cambiosDeCompras, mensajeCambiosCompras } from '../costeo-compras';
import { editorAFilasCosteo, filasSinLink, entradaComparativoDeEstado } from '../costeo-editor';
import { consolidarCostoReal, validarCierre, resumirResultados } from '../costo-real-consolidado';

const base = (o: Partial<FilaParaComparativo> = {}): FilaParaComparativo => ({
  esExtra: false, tieneDatos: true, venta: 1_000_000, costoEstimado: 800_000, cantidad: 10, costoRealUnitario: null, ...o,
});

// ── El bug reportado: un ítem agregado con costo real no movía el comparativo ─────────────────────
test('un gasto extra con costo real SÍ mueve el comparativo real, y no toca venta ni estimado', () => {
  const sin = calcularComparativo(entradaComparativoDeFilas([base({ costoRealUnitario: 80_000 })], null));
  const con = calcularComparativo(entradaComparativoDeFilas([
    base({ costoRealUnitario: 80_000 }),
    base({ esExtra: true, venta: 0, costoEstimado: 0, cantidad: null, costoRealUnitario: 50_000 }), // flete, sin cantidad
  ], null));
  assert.equal(con.ventaNeta, sin.ventaNeta);
  assert.equal(con.costoNetoEstimado, sin.costoNetoEstimado);
  assert.equal(con.gastosAdicionales, 50_000);
  assert.equal(con.costoNetoReal, (sin.costoNetoReal as number) + 50_000);
  assert.equal(con.utilidadReal, (sin.utilidadReal as number) - 50_000);
});

test('un gasto extra sin cantidad cuenta como 1; una fila ofertada sin cantidad NO se inventa', () => {
  assert.equal(costoRealDeFila({ esExtra: true, cantidad: null, costoRealUnitario: 30_000 }), 30_000);
  assert.equal(costoRealDeFila({ esExtra: true, cantidad: 3, costoRealUnitario: 30_000 }), 90_000);
  assert.equal(costoRealDeFila({ esExtra: false, cantidad: null, costoRealUnitario: 30_000 }), null);
  assert.equal(costoRealDeFila({ esExtra: false, cantidad: 2, costoRealUnitario: null }), null);
});

test('el contador de avance solo cuenta filas cuyo costo real se pudo calcular', () => {
  const c = calcularComparativo(entradaComparativoDeFilas([
    base({ cantidad: 10, costoRealUnitario: 80_000 }),
    base({ cantidad: null, costoRealUnitario: 80_000 }),  // costo cargado pero sin cantidad: antes contaba y sumaba $0
    base({ cantidad: 5, costoRealUnitario: null }),
  ], null));
  assert.equal(c.filasConCostoReal, 1);
  assert.equal(c.filasTotales, 3);
  assert.equal(c.realCompleto, false);
});

test('solo gastos (aún sin ítems cargados) ya es costo real; sin nada sigue siendo null', () => {
  const soloGasto = calcularComparativo(entradaComparativoDeFilas([base()], null, 120_000));
  assert.equal(soloGasto.costoNetoReal, 120_000);
  const nada = calcularComparativo(entradaComparativoDeFilas([base()], null));
  assert.equal(nada.costoNetoReal, null);
});

test('una fila vacía no cuenta como "ítem sin costo real"', () => {
  const c = calcularComparativo(entradaComparativoDeFilas([base({ costoRealUnitario: 80_000 }), base({ tieneDatos: false, venta: 0, costoEstimado: 0 })], null));
  assert.equal(c.filasTotales, 1);
  assert.equal(c.realCompleto, true);
});

// ── Alertas de desvío ─────────────────────────────────────────────────────────────────────────────
test('alerta solo con el real completo: >10% sobre lo cotizado o utilidad negativa', () => {
  const ok = calcularComparativo(entradaComparativoDeFilas([base({ costoRealUnitario: 80_000 })], null));
  assert.deepEqual(alertasDeDesvio(ok), []);
  const sobre = calcularComparativo(entradaComparativoDeFilas([base({ costoRealUnitario: 92_000 })], null)); // 920k vs 800k = +15%
  assert.deepEqual(alertasDeDesvio(sobre).map(a => a.codigo), ['costo_sobre_umbral']);
  const perdida = calcularComparativo(entradaComparativoDeFilas([base({ costoRealUnitario: 120_000 })], null)); // 1,2M vs venta 1M
  assert.deepEqual(alertasDeDesvio(perdida).map(a => a.codigo).sort(), ['costo_sobre_umbral', 'utilidad_negativa']);
  const parcial = calcularComparativo(entradaComparativoDeFilas([base({ costoRealUnitario: 120_000 }), base({ costoRealUnitario: null })], null));
  assert.deepEqual(alertasDeDesvio(parcial), [], 'con el real a medio cargar no se alerta');
  assert.equal(UMBRAL_DESVIO_PCT, 10);
});

// ── Regla del servidor: qué entra del cliente ─────────────────────────────────────────────────────
const fila = (id: string, extra: any = {}) => ({
  id, item: 1, lineaReal: 1, detalle: 'TELEVISOR', unidad: 'UN', skuProveedor: '', cantidad: 10,
  valorConIva: 119_000, costoRealUnitario: null, margenVenta: null, link1: '', link2: '', link3: '', ...extra,
});
const guardado = (): any => ({ modalidad: 'suma_alzada', margenVenta: 25, grupos: [{ nombre: 'Costeo', linea: null, ofertamos: true, filas: [fila('a')] }] });

test('gasto extra: cantidad por defecto 1; precio de mercado y margen descartados aunque el cliente los mande', () => {
  const r: any = fusionarEdicionCompras(guardado(), { grupos: [{ filas: [fila('a'), fila('n1', { detalle: 'FLETE', cantidad: null, valorConIva: 5000, margenVenta: 99, costoRealUnitario: 40_000, link1: 'https://flete.cl/x' })] }] });
  assert.equal(r.ok, true);
  const n = r.estado.grupos[0].filas[1];
  assert.equal(n.agregadoPorCompras, true);
  assert.equal(n.cantidad, 1);
  assert.equal(n.valorConIva, null);
  assert.equal(n.margenVenta, null);
  assert.equal(n.costoRealUnitario, 40_000);
});

test('link sin protocolo (como lo acepta la pantalla) se guarda con https://', () => {
  const r: any = fusionarEdicionCompras(guardado(), { grupos: [{ filas: [fila('a', { costoRealUnitario: 100, link1: 'falabella.cl/p/1' })] }] });
  assert.equal(r.ok, true);
  assert.equal(r.estado.grupos[0].filas[0].link1, 'https://falabella.cl/p/1');
  const mal: any = fusionarEdicionCompras(guardado(), { grupos: [{ filas: [fila('a', { costoRealUnitario: 100, link1: 'javascript:alert(1)' })] }] });
  assert.equal(mal.ok, false);
});

test('los gastos extra no entran al Motor Comercial, al Anexo ni a "Productos y cobertura"', () => {
  const r: any = fusionarEdicionCompras(guardado(), { grupos: [{ filas: [fila('a'), fila('n1', { detalle: 'FLETE', costoRealUnitario: 40_000, link1: 'https://flete.cl/x' })] }] });
  const filas = editorAFilasCosteo(r.estado);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].detalle, 'TELEVISOR');
  // y al guardar el admin no se le exige "link de precio" a un gasto extra
  assert.equal(filasSinLink({ ...r.estado, grupos: [{ ...r.estado.grupos[0], filas: [{ ...r.estado.grupos[0].filas[1], valorConIva: 1000 }] }] }).length, 0);
});

test('entradaComparativoDeEstado: hojas apagadas fuera; extras solo como gasto adicional', () => {
  const r: any = fusionarEdicionCompras(guardado(), { grupos: [{ filas: [fila('a', { costoRealUnitario: 90_000, link1: 'https://t.cl/a' }), fila('n1', { detalle: 'HORAS EXTRA', cantidad: 4, costoRealUnitario: 10_000, link1: 'https://t.cl/b' })] }] });
  const e = entradaComparativoDeEstado(r.estado);
  assert.equal(e.filasTotales, 1);
  assert.equal(e.filasConCostoReal, 1);
  assert.equal(e.costoNetoReal, 900_000);
  assert.equal(e.gastosAdicionales, 40_000);
  const apagada = entradaComparativoDeEstado({ ...r.estado, grupos: [{ ...r.estado.grupos[0], ofertamos: false }] });
  assert.equal(apagada.filasTotales, 0);
});

// ── Bitácora ──────────────────────────────────────────────────────────────────────────────────────
test('cambiosDeCompras describe qué hizo Compras; sin cambios no hay evento', () => {
  const antes = guardado();
  const igual: any = fusionarEdicionCompras(antes, { grupos: [{ filas: [fila('a')] }] });
  assert.equal(cambiosDeCompras(antes, igual.estado).hayCambios, false);

  const d: any = fusionarEdicionCompras(antes, { grupos: [{ filas: [fila('a', { costoRealUnitario: 90_000, link1: 'https://t.cl/a' }), fila('n1', { detalle: 'FLETE SANTIAGO', costoRealUnitario: 40_000, link1: 'https://t.cl/b' })] }] });
  const c = cambiosDeCompras(antes, d.estado);
  assert.equal(c.costosCargados, 1);
  assert.deepEqual(c.itemsAgregados, ['FLETE SANTIAGO']);
  assert.match(mensajeCambiosCompras(c), /cargó costo real en 1 ítem.*agregó 1 gasto/);

  const e: any = fusionarEdicionCompras(d.estado, { grupos: [{ filas: [fila('a', { costoRealUnitario: 95_000, link1: 'https://t.cl/a' })] }] });
  const c2 = cambiosDeCompras(d.estado, e.estado);
  assert.equal(c2.costosModificados, 1);
  assert.deepEqual(c2.itemsEliminados, ['FLETE SANTIAGO']);
});

// ── Consolidado ───────────────────────────────────────────────────────────────────────────────────
const costeoCompleto = () => entradaComparativoDeFilas([base({ costoRealUnitario: 80_000 })], null); // real 800k, venta 1M

test('consolidado: suma costeo + gastos extra + gastos registrados + importación, sin duplicar', () => {
  const c = consolidarCostoReal({
    costeo: entradaComparativoDeFilas([base({ costoRealUnitario: 80_000 }), base({ esExtra: true, venta: 0, costoEstimado: 0, cantidad: null, costoRealUnitario: 20_000 })], null),
    gastosRegistrados: 30_000, importacion: 50_000, obuma: null,
  });
  assert.equal(c.lineas.costeoOfertado, 800_000);
  assert.equal(c.lineas.costeoGastosExtra, 20_000);
  assert.equal(c.lineas.total, 900_000);
  assert.equal(c.comparativo.costoNetoReal, 900_000);
  assert.equal(c.comparativo.utilidadReal, 100_000);
  assert.equal(c.comparativo.ventaNeta, 1_000_000);
});

test('contraste Obuma: avisa solo si el costeo está completo y la diferencia pasa el umbral', () => {
  const calza = consolidarCostoReal({ costeo: costeoCompleto(), gastosRegistrados: 0, importacion: 0, obuma: { ocCreadas: 810_000, comprasCruzadas: 0, facturas: 0 } });
  assert.equal(calza.alertas.some(a => a.codigo === 'obuma_difiere'), false);
  const difiere = consolidarCostoReal({ costeo: costeoCompleto(), gastosRegistrados: 0, importacion: 0, obuma: { ocCreadas: 1_000_000, comprasCruzadas: 0, facturas: 0 } });
  assert.equal(difiere.alertas.some(a => a.codigo === 'obuma_difiere'), true);
  assert.equal(Math.round(difiere.obuma!.diferenciaPct as number), 25);
  // real a medio cargar: Obuma "de más" es lo esperado, no alerta
  const parcial = consolidarCostoReal({ costeo: entradaComparativoDeFilas([base({ costoRealUnitario: 80_000 }), base()], null), gastosRegistrados: 0, importacion: 0, obuma: { ocCreadas: 5_000_000, comprasCruzadas: 0, facturas: 0 } });
  assert.equal(parcial.alertas.some(a => a.codigo === 'obuma_difiere'), false);
  // sin OC creadas cae a las compras cruzadas
  const cruz = consolidarCostoReal({ costeo: costeoCompleto(), gastosRegistrados: 0, importacion: 0, obuma: { ocCreadas: 0, comprasCruzadas: 800_000, facturas: 0 } });
  assert.equal(cruz.obuma!.gastado, 800_000);
});

// ── Cierre ────────────────────────────────────────────────────────────────────────────────────────
test('cierre: sin costo real no se cierra; incompleto exige motivo; completo cierra limpio', () => {
  const vacio = calcularComparativo(entradaComparativoDeFilas([base()], null));
  assert.equal(validarCierre(vacio, 'x'.repeat(30)).ok, false);

  const parcial = calcularComparativo(entradaComparativoDeFilas([base({ costoRealUnitario: 80_000 }), base()], null));
  const sinMotivo = validarCierre(parcial, '   ');
  assert.equal(sinMotivo.ok, false);
  assert.match((sinMotivo as any).error, /Faltan 1 de 2/);
  assert.equal(validarCierre(parcial, 'corto').ok, false);
  const conMotivo = validarCierre(parcial, 'El ítem 2 se retiró del contrato');
  assert.deepEqual(conMotivo, { ok: true, incompleto: true });

  const completo = calcularComparativo(entradaComparativoDeFilas([base({ costoRealUnitario: 80_000 })], null));
  assert.deepEqual(validarCierre(completo, null), { ok: true, incompleto: false });
});

// ── Dashboard ─────────────────────────────────────────────────────────────────────────────────────
test('resumen del dashboard: solo negocios con real completo entran a los márgenes; peores desvíos ordenados', () => {
  const mk = (negocioId: number, filas: FilaParaComparativo[], cerrado = false) => {
    const cr = consolidarCostoReal({ costeo: entradaComparativoDeFilas(filas, null), gastosRegistrados: 0, importacion: 0, obuma: null });
    return { negocioId, licitacionCodigo: `L-${negocioId}`, comparativo: cr.comparativo, alertas: cr.alertas, cerrado };
  };
  const r = resumirResultados([
    mk(1, [base({ costoRealUnitario: 80_000 })], true),          // ok: margen real 20%
    mk(2, [base({ costoRealUnitario: 92_000 })]),                // +15%, utilidad 80k
    mk(3, [base({ costoRealUnitario: 120_000 })]),               // pérdida
    mk(4, [base({ costoRealUnitario: 10_000 }), base()]),        // a medio cargar: NO cuenta
    mk(5, [base()]),                                             // sin real
  ]);
  assert.equal(r.negociosConCosteo, 5);
  assert.equal(r.negociosConReal, 4);
  assert.equal(r.negociosRealCompleto, 3);
  assert.equal(r.cerrados, 1);
  assert.equal(r.conUtilidadNegativa, 1);
  assert.equal(r.conDesvio, 2);
  // Σ utilidad real = 200k + 80k − 200k = 80k sobre venta 3M
  assert.equal(r.utilidadRealTotal, 80_000);
  assert.ok(Math.abs((r.margenRealPct as number) - (80_000 / 3_000_000) * 100) < 1e-9);
  assert.ok(Math.abs((r.margenEstimadoPct as number) - 20) < 1e-9);
  assert.deepEqual(r.peoresDesvios.map(d => d.negocioId), [3, 2]);
});

test('resumen del dashboard sin datos no revienta', () => {
  const r = resumirResultados([]);
  assert.equal(r.margenRealPct, null);
  assert.deepEqual(r.peoresDesvios, []);
});
