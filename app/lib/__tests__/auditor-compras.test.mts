// Tests del núcleo determinista del AUDITOR DE COMPRAS (PROMPT 5). Sin red ni IA: prueban que lo que
// el modelo devuelva no puede saltarse las reglas del prompt (citas, IVA, margen R1/R2, bloqueos, mercado).
// Correr con: npx tsx --test app/lib/__tests__/auditor-compras.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  numerosDelTexto, precioEnTexto, precioNetoUnitario, costoRutaB, dispersion, mediana, margenProyecto, mismoProductoPorTokens,
  tokensDeProducto, aplicarGuardarrailes, calcularSistemaLinea, derivarLinea, calcularPosicionPrecio, cambiosEntreAuditorias,
  mensajesPorProveedor, lineasDelCosteo, PARAMS,
  type LineaCosteo, type LineaGuardada, type SalidaModelo, type ContextoLinea,
} from '../auditor-compras-core';
import * as P from '../auditor-compras-prompts';

const linea = (o: Partial<LineaCosteo> = {}): LineaCosteo => ({
  id: 'f1', item: 1, lineaReal: 1, grupo: 'Costeo', detalle: 'Hidrolavadora Karcher HDS 8/18-4 C', unidad: 'UN', sku: 'HDS 8/18-4 C',
  cantidad: 1, valorConIva: 4_939_000, costoRealUnitario: 4_150_000, links: ['https://tienda.cl/p/1'], esGastoExtra: false, ofertamos: true,
  costoEstimadoNeto: 4_150_000, costoRegistradoNeto: 4_150_000, precioVentaUnitario: 5_250_000, ...o,
});
const ok = (extra: Partial<SalidaModelo> = {}): SalidaModelo => ({
  linea: 1, ruta: 'A',
  respaldos: [{ id: 'R1', tipo: 'LINK_WEB', archivo_o_url: 'https://tienda.cl/p/1', estado_link: 'activo', legibilidad: 'completa', sostiene_costo: true, emisor: { razon_social: 'Tienda SpA' } }],
  origen_dato: 'RESPALDO_FORMAL',
  verificaciones: {
    V1_identidad: { estado: 'OK' }, V2_unidad: { estado: 'OK', factor_unidades: 1 }, V3_iva_moneda: { estado: 'OK', iva_respaldo: 'neto', moneda: 'CLP' },
    V4_precio: { precio_extraido: 4_150_000 }, V5_costos_ocultos: [], V6_stock: { estado: 'disponible' }, V7_vigencia: { estado: 'NO_APLICA_LINK' },
    V8_plazo: { tipo_dias: 'corridos', plazo_proveedor_dias: 3 }, V10_referencias: { referencias: [], sin_referencias: true },
    V10c_comparador: [{ opcion: 'Link 1', origen: 'asistente', id_respaldo: 'R1', precio: 4_150_000, iva: 'neto', moneda: 'CLP', factor_unidades: 1 }],
    V11_datos_oc: { faltantes: [] },
  },
  ...extra,
});
const DOLAR = { observado: 950, usado: 960, fecha: '2026-09-25', fuente: 'test' };
const guardada = (l: LineaCosteo, s: SalidaModelo, ext: Partial<Parameters<typeof calcularSistemaLinea>[2]> = {}): LineaGuardada => ({
  fila: { id: l.id, item: l.item, lineaReal: l.lineaReal, detalle: l.detalle, unidad: l.unidad, sku: l.sku, cantidad: l.cantidad, grupo: l.grupo },
  auditadoAt: '2026-09-25 10:00:00', modeloIA: 'test', pasada: 'linea', modelo: s, capturas: [],
  sistema: calcularSistemaLinea(l, s, { dolar: DOLAR, guardarrailes: [], precioNoVerificado: false, diasDisponibles: null, precioMercadoPublico: null, hoyISO: '2026-09-25', ...ext }),
});
const ctx = (o: Partial<ContextoLinea> = {}): ContextoLinea => ({ margen: null, justificacionAhorro: null, habilitacion: null, hoyISO: '2026-09-25', esGastoExtra: false, ...o });

// ── números y citas ───────────────────────────────────────────────────────────────────────────────
test('numerosDelTexto entiende los formatos chilenos', () => {
  const n = numerosDelTexto('Precio $4.390.000 c/IVA, antes 4390990. USD 1.234,56 y 12,5 kg y 4,390.00');
  assert.ok(n.includes(4_390_000)); assert.ok(n.includes(4_390_990)); assert.ok(n.includes(1234.56)); assert.ok(n.includes(12.5));
});
test('precioEnTexto: el precio tiene que estar literalmente en el respaldo', () => {
  assert.equal(precioEnTexto('Valor final $4.150.000 + IVA', 4_150_000), true);
  assert.equal(precioEnTexto('Valor final $4.150.000 + IVA', 4_390_000), false);
  assert.equal(precioEnTexto('sin números', 100), false);
});

// ── normalización de precios ──────────────────────────────────────────────────────────────────────
test('precio: IVA incluido se divide, IVA no declarado NO se supone, otra moneda no se convierte', () => {
  assert.equal(precioNetoUnitario({ precio: 119_000, iva: 'incluido', moneda: 'CLP', factor_unidades: 1 }).neto, 100_000);
  assert.equal(precioNetoUnitario({ precio: 100_000, iva: 'neto', factor_unidades: 10 }).neto, 10_000);
  assert.equal(precioNetoUnitario({ precio: 100_000, iva: 'no_declarado' }).neto, null);
  assert.equal(precioNetoUnitario({ precio: 100, iva: 'neto', moneda: 'USD' }).neto, null);
});
test('Ruta B: FOB × (dólar+10) × 1,06 × 1,3 × 1,19, y el neto se saca del resultado con IVA', () => {
  const c = costoRutaB(1000, 960);
  assert.equal(c.conIva, Math.round(1000 * 960 * 1.06 * 1.3 * 1.19));
  assert.equal(c.neto, Math.round(c.conIva / 1.19));
});

// ── dispersión ────────────────────────────────────────────────────────────────────────────────────
test('dispersión: $100 vs $10 activa la triangulación; precios parejos no', () => {
  assert.equal(dispersion([100, 105, 98, 10]).activa, true);
  assert.deepEqual(dispersion([100, 105, 98, 10]).discordantes, [3]);
  assert.equal(dispersion([100, 105, 98]).activa, false);
  assert.equal(mediana([1, 2, 3, 4]), 2.5);
});

// ── margen R1 / R2 ────────────────────────────────────────────────────────────────────────────────
const dosLineas = (): LineaCosteo[] => [
  linea({ id: 'a', costoEstimadoNeto: 700, costoRegistradoNeto: 700, precioVentaUnitario: 1000, cantidad: 10 }),
  linea({ id: 'b', costoEstimadoNeto: 1000, costoRegistradoNeto: 1000, precioVentaUnitario: 1400, cantidad: 10 }),
];
test('margen del proyecto: base 28,3% y una alza chica no activa nada', () => {
  const m = margenProyecto(dosLineas(), { a: 710 });
  assert.equal(m.margenBase, 29.2); // (24000 − 17000) / 24000
  assert.equal(m.r1, false); assert.equal(m.r2, false);
});
test('R1: el margen total cae 2 puntos o más', () => {
  const m = margenProyecto(dosLineas(), { b: 1120 });
  assert.equal(m.r1, true);
});
test('R2: cruza el piso del 20% aunque baje menos de 2 puntos', () => {
  const ls = [linea({ id: 'a', costoEstimadoNeto: 795, costoRegistradoNeto: 795, precioVentaUnitario: 1000, cantidad: 1 })]; // 20,5%
  const m = margenProyecto(ls, { a: 805 }); // 19,5%
  assert.equal(m.margenBase, 20.5); assert.equal(m.margenFinal, 19.5);
  assert.equal(m.r1, false); assert.equal(m.r2, true);
});
test('las alzas se ACUMULAN: diez alzas chicas que en total bajan 2 puntos también cuentan', () => {
  const ls = Array.from({ length: 10 }, (_, i) => linea({ id: `x${i}`, costoEstimadoNeto: 700, costoRegistradoNeto: 700, precioVentaUnitario: 1000, cantidad: 1 }));
  const v: Record<string, number> = {}; ls.forEach(l => { v[l.id] = 727; }); // +3,86% cada una
  assert.equal(margenProyecto(ls, v).r1, true);
});

// ── guardarraíles ─────────────────────────────────────────────────────────────────────────────────
test('guardarraíl: un precio que no está en el respaldo no se da por verificado', () => {
  const s = ok(); s.verificaciones!.V4_precio!.precio_extraido = 3_999_000;
  const g = aplicarGuardarrailes(s, { texto: 'Karcher HDS 8/18-4 C $4.150.000', porRespaldo: {} }, { tokensProducto: ['hds'], candidatasBusqueda: [] });
  assert.equal(g.precioNoVerificado, true);
});
test('guardarraíl: V1 "OK" sin el modelo a la vista se degrada a NO_VERIFICABLE', () => {
  const s = ok();
  const g = aplicarGuardarrailes(s, { texto: 'Hidrolavadora industrial 18 bar', porRespaldo: {} }, { tokensProducto: tokensDeProducto('HDS 8/18-4 C'), candidatasBusqueda: [] });
  assert.equal(g.salida.verificaciones!.V1_identidad!.estado, 'NO_VERIFICABLE');
});
test('guardarraíl: referencias inventadas o de otro modelo se descartan; el precio lo pone el sistema', () => {
  const s = ok(); s.verificaciones!.V10_referencias = { referencias: [
    { url: 'https://a.cl/1', precio: 1, mismo_producto: true }, { url: 'https://b.cl/2', precio: 1, mismo_producto: true }, { url: 'https://inventada.cl', precio: 1, mismo_producto: true },
  ] };
  const g = aplicarGuardarrailes(s, { texto: 'HDS 8/18-4 C', porRespaldo: {} }, { tokensProducto: ['hds', '184'], candidatasBusqueda: [
    { url: 'https://a.cl/1', nombre: 'Karcher HDS 8/18-4 C hidrolavadora', precio: 3_900_000, tienda: 'A' },
    { url: 'https://b.cl/2', nombre: 'Karcher HD 5/11 similar', precio: 1_000_000, tienda: 'B' },
  ] });
  const r = g.salida.verificaciones!.V10_referencias!;
  assert.equal(r.referencias!.length, 1); assert.equal(r.referencias![0].precio, 3_900_000);
  assert.equal(r.descartadas_no_mismo_producto!.length, 2);
});
test('mismoProductoPorTokens: sin token de modelo no se puede afirmar', () => {
  assert.equal(mismoProductoPorTokens('Taladro percutor 800W', []), false);
  assert.equal(mismoProductoPorTokens('Karcher HDS-8/18-4C', ['hds8184c']), true);
});

// ── veredicto y bloqueos ──────────────────────────────────────────────────────────────────────────
test('línea limpia con respaldo formal = VERIFICADO', () => {
  const l = linea(); const d = derivarLinea(l, guardada(l, ok()), ctx());
  assert.equal(d.veredicto, 'VERIFICADO'); assert.equal(d.pasaAnexosOk, true);
});
test('sin respaldo legible = SIN_RESPALDO y bloquea; el link caído no cuenta', () => {
  const l = linea(); const s = ok({ respaldos: [{ id: 'R1', tipo: 'LINK_WEB', estado_link: 'caido', legibilidad: 'nula' }] });
  const d = derivarLinea(l, guardada(l, s), ctx());
  assert.equal(d.veredicto, 'SIN_RESPALDO'); assert.equal(d.pasaAnexosOk, false);
});
test('V4: alza SIN impacto en el margen solo informa; con R1/R2 bloquea', () => {
  const l = linea(); const s = ok(); s.verificaciones!.V10c_comparador![0].precio = 4_390_000; s.verificaciones!.V4_precio!.precio_extraido = 4_390_000;
  const g = guardada(l, s);
  assert.equal(g.sistema.direccion, 'MAS_CARO'); assert.equal(g.sistema.diffPct, 5.8);
  const suave = derivarLinea(l, g, ctx({ margen: { ventaNeta: 1, costoBase: 1, costoFinal: 1, margenBase: 30, margenFinal: 29, caidaPuntos: 1, r1: false, r2: false } }));
  assert.equal(suave.bloqueos.length, 0); assert.ok(suave.alertas.some(a => a.codigo === 'V4_ALZA'));
  const duro = derivarLinea(l, g, ctx({ margen: { ventaNeta: 1, costoBase: 1, costoFinal: 1, margenBase: 21.4, margenFinal: 19.6, caidaPuntos: 1.8, r1: false, r2: true } }));
  assert.ok(duro.bloqueos.some(b => b.codigo === 'V4_ALZA_IMPORTANTE')); assert.equal(duro.veredicto, 'NO_VERIFICADO');
});
test('V4: un costo real MÁS BARATO solo informa', () => {
  const l = linea(); const s = ok(); s.verificaciones!.V10c_comparador![0].precio = 3_900_000; s.verificaciones!.V4_precio!.precio_extraido = 3_900_000;
  const d = derivarLinea(l, guardada(l, s), ctx());
  assert.equal(d.bloqueos.length, 0); assert.ok(d.alertas.some(a => a.codigo === 'V4_BAJA'));
});
test('V3: doble IVA y moneda no convertida bloquean; IVA no declarado solo alerta', () => {
  const l = linea();
  const s1 = ok(); s1.verificaciones!.V3_iva_moneda = { estado: 'DOBLE_IVA' };
  assert.ok(derivarLinea(l, guardada(l, s1), ctx()).bloqueos.some(b => b.codigo === 'V3_DOBLE_IVA'));
  const s2 = ok(); s2.verificaciones!.V3_iva_moneda = { estado: 'IVA_NO_DECLARADO' };
  const d2 = derivarLinea(l, guardada(l, s2), ctx());
  assert.equal(d2.bloqueos.length, 0); assert.ok(d2.alertas.some(a => a.codigo === 'V3_IVA_NO_DECLARADO'));
});
test('V6 sin stock: rojo pero NUNCA bloquea', () => {
  const l = linea(); const s = ok(); s.verificaciones!.V6_stock = { estado: 'agotado' };
  const d = derivarLinea(l, guardada(l, s), ctx());
  assert.equal(d.bloqueos.length, 0); assert.equal(d.alertas.find(a => a.codigo === 'V6_SIN_STOCK')!.nivel, 'rojo'); assert.equal(d.pasaAnexosOk, true);
});
test('V10: referencia ≥5% más barata bloquea hasta justificar; <5% solo informa', () => {
  const l = linea(); const s = ok(); s.verificaciones!.V10_referencias = { referencias: [{ proveedor: 'X', url: 'u', precio: 4_628_100, iva: 'incluido', factor_unidades: 1, mismo_producto: true }] }; // 3.889.160 neto
  const g = guardada(l, s);
  assert.equal(g.sistema.refMasBaratas.length, 1);
  assert.ok(derivarLinea(l, g, ctx()).bloqueos.some(b => b.codigo === 'V10_AHORRO'));
  assert.equal(derivarLinea(l, g, ctx({ justificacionAhorro: 'El proveedor X no entrega factura a tiempo.' })).bloqueos.length, 0);
  const s2 = ok(); s2.verificaciones!.V10_referencias = { referencias: [{ proveedor: 'Y', url: 'u', precio: 4_800_000, iva: 'incluido', factor_unidades: 1, mismo_producto: true }] }; // 4.033.613 neto = −2,8%
  assert.equal(derivarLinea(l, guardada(l, s2), ctx()).bloqueos.length, 0);
});
test('comparador: normaliza a costo puesto en bodega y ordena de menor a mayor', () => {
  const l = linea(); const s = ok();
  s.verificaciones!.V10c_comparador![0] = { opcion: 'Link 1', origen: 'asistente', id_respaldo: 'R1', precio: 4_390_000, iva: 'neto', factor_unidades: 1, despacho_monto_neto_clp_total: 45_000 };
  s.verificaciones!.V10_referencias = { referencias: [{ proveedor: 'X', url: 'u', precio: 4_628_100, iva: 'incluido', factor_unidades: 1, mismo_producto: true }] };
  const c = guardada(l, s).sistema.comparador;
  assert.equal(c[0].opcion, 'X'); assert.equal(c[1].costo_bodega, 4_435_000);
});
test('respaldo informal o histórico = REQUIERE_HABILITACION, y el EM lo habilita', () => {
  const l = linea(); const s = ok({ origen_dato: 'RESPALDO_INFORMAL' });
  const d = derivarLinea(l, guardada(l, s), ctx());
  assert.equal(d.veredicto, 'REQUIERE_HABILITACION'); assert.equal(d.pasaAnexosOk, false);
  const h = derivarLinea(l, guardada(l, s), ctx({ habilitacion: { nivel: 'EM', porNombre: 'Ana', motivo: 'Cotización por WhatsApp del proveedor habitual', at: 'x' } }));
  assert.equal(h.pasaAnexosOk, true);
});
test('CA tiene potestad total: habilita incluso una línea con bloqueo', () => {
  const l = linea(); const s = ok(); s.verificaciones!.V3_iva_moneda = { estado: 'DOBLE_IVA' };
  const d = derivarLinea(l, guardada(l, s), ctx({ habilitacion: { nivel: 'CA', porNombre: 'Jefe', motivo: 'Lo vi con el proveedor, precio ok', at: 'x' } }));
  assert.equal(d.veredicto, 'NO_VERIFICADO'); assert.equal(d.pasaAnexosOk, true);
});
test('Ruta B: Incoterm distinto de FOB bloquea; FOB en USD se calcula con el dólar del día + $10', () => {
  const l = linea(); const s = ok({ ruta: 'B', ruta_b: { precio_unitario: 1000, moneda: 'USD', incoterm: 'CIF' } });
  assert.ok(derivarLinea(l, guardada(l, s), ctx()).bloqueos.some(b => b.codigo === 'RUTA_B_INCOTERM'));
  const s2 = ok({ ruta: 'B', ruta_b: { precio_unitario: 1000, moneda: 'USD', incoterm: 'FOB' } });
  assert.equal(guardada(l, s2).sistema.rutaB!.costoNeto, costoRutaB(1000, 960).neto);
});
test('plazo que no cabe: alerta fuerte, no bloquea (nota V8)', () => {
  const l = linea(); const s = ok(); s.verificaciones!.V8_plazo = { tipo_dias: 'habiles', plazo_proveedor_dias: 10 };
  const g = guardada(l, s, { diasDisponibles: 8 });
  const d = derivarLinea(l, g, ctx());
  assert.equal(d.bloqueos.length, 0); assert.equal(d.alertas.find(a => a.codigo === 'V8_PLAZO')!.nivel, 'rojo');
});

// ── posición de precio ────────────────────────────────────────────────────────────────────────────
test('posición de precio: orden sano y espacio de maniobra', () => {
  const l = linea({ cantidad: 10, costoRegistradoNeto: 960_400, costoEstimadoNeto: 960_400, precioVentaUnitario: 1_210_000 });
  const s = ok(); s.verificaciones!.V10c_comparador![0].precio = 960_400; s.verificaciones!.V10_referencias = { referencias: [{ proveedor: 'X', url: 'u', precio: 1_166_000, iva: 'incluido', factor_unidades: 1, mismo_producto: true }] };
  const g = guardada(l, s, { precioMercadoPublico: { neto: 1_100_000, n: 7, desde: '2024-01-01', hasta: '2026-08-01', calidad: 'mismo_producto', ocs: [] } });
  const p = calcularPosicionPrecio([l], { f1: g }, { neto: 12_740_000, nivel: 'proyecto', fuente: 'bases' });
  assert.equal(p.orden_sano, true); assert.equal(p.espacio_maniobra.monto, 12_740_000 - 9_604_000);
  assert.equal(p.mercado_publico.n_datos, 7); assert.equal(p.alertas.length, 0);
});
test('posición de precio: alertas de costo sobre mercado, presupuesto bajo el costo y sin datos de mercado público', () => {
  const l = linea({ cantidad: 1, costoRegistradoNeto: 5_000_000, costoEstimadoNeto: 5_000_000, precioVentaUnitario: 5_200_000 });
  const s = ok(); s.verificaciones!.V10c_comparador![0].precio = 5_000_000;
  s.verificaciones!.V10_referencias = { referencias: [{ proveedor: 'X', url: 'u', precio: 4_760_000, iva: 'incluido', factor_unidades: 1, mismo_producto: true }] };
  const p = calcularPosicionPrecio([l], { f1: guardada(l, s) }, { neto: 4_500_000, nivel: 'proyecto', fuente: 'bases' });
  const tipos = p.alertas.map(a => a.tipo);
  assert.ok(tipos.includes('costo_sobre_mercado')); assert.ok(tipos.includes('presupuesto_bajo_costo')); assert.ok(tipos.includes('sin_datos_mp')); assert.ok(tipos.includes('bajo_margen_minimo'));
});
test('posición de precio: con menos de 3 OC el dato de mercado público es "débil"', () => {
  const l = linea({ cantidad: 1 }); const g = guardada(l, ok(), { precioMercadoPublico: { neto: 5_000_000, n: 2, desde: '2026-01-01', hasta: '2026-02-01', calidad: 'mismo_producto', ocs: [] } });
  assert.ok(calcularPosicionPrecio([l], { f1: g }, { neto: 6_000_000, nivel: 'proyecto', fuente: 'x' }).alertas.some(a => a.tipo === 'mp_dato_debil'));
});

// ── pasada final y mensajes ───────────────────────────────────────────────────────────────────────
test('pasada final: detecta que el precio subió y que el link cayó', () => {
  const l = linea(); const antes = guardada(l, ok());
  const s2 = ok({ respaldos: [{ id: 'R1', tipo: 'LINK_WEB', archivo_o_url: 'https://tienda.cl/p/1', estado_link: 'caido', legibilidad: 'nula' }] });
  s2.verificaciones!.V10c_comparador![0].precio = 4_390_000;
  const c = cambiosEntreAuditorias(antes, guardada(l, s2));
  assert.ok(c.some(x => x.includes('SUBIÓ'))); assert.ok(c.some(x => x.includes('ya no está activo')));
});
test('mensajes agrupados: UN mensaje por proveedor con todos los puntos', () => {
  const l1 = linea({ id: 'a', item: 1 }), l2 = linea({ id: 'b', item: 2 });
  const mk = (l: LineaCosteo) => { const s = ok({ origen_dato: 'RESPALDO_INFORMAL', ayuda: { pregunta_proveedor: `¿Precio neto de ${l.item}?` } }); const g = guardada(l, s); return { linea: g, derivada: derivarLinea(l, g, ctx()) }; };
  const m = mensajesPorProveedor([mk(l1), mk(l2)]);
  assert.equal(m.length, 1); assert.deepEqual(m[0].lineas, [1, 2]); assert.ok(m[0].mensaje.includes('¿Precio neto de 2?'));
});

// ── el prompt viene del .md sin retocar ───────────────────────────────────────────────────────────
test('los prompts generados coinciden con docs/PROMPT_5_AUDITOR_COMPRAS_COTIZACIONES.md', () => {
  const md = readFileSync('docs/PROMPT_5_AUDITOR_COMPRAS_COTIZACIONES.md', 'utf8').replace(/\r\n/g, '\n');
  for (const frag of [P.PARTE_I.split('\n')[0], 'PROHIBIDO inventar un precio', 'V10-b · PRECIOS DISCORDANTES', 'Costo = FOB unitario (USD)']) {
    assert.ok(md.includes(frag), `el .md no contiene: ${frag}`);
    assert.ok([P.PARTE_I, P.PARTE_IV, P.PARTE_V].some(p => p.includes(frag)), `el prompt generado no contiene: ${frag}`);
  }
  assert.ok(P.PARTE_VIII.includes('Bloquean') && P.PARTE_IX.includes('PRESUPUESTO  ≥  PRECIO MERCADO PÚBLICO'));
  assert.equal(PARAMS.margenMinimo, 20);
});
test('lineasDelCosteo: el costo registrado es el REAL de Compras y el gasto extra no se vende', () => {
  const ls = lineasDelCosteo({ modalidad: 'suma_alzada', margenVenta: 27, grupos: [{ nombre: 'Costeo', linea: null, ofertamos: true, filas: [
    { id: 'a', item: 1, lineaReal: 1, detalle: 'X modelo 123', unidad: 'UN', skuProveedor: '', cantidad: 2, valorConIva: 119_000, costoRealUnitario: 90_000, link1: 'a.cl/x', link2: '', link3: '' },
    { id: 'b', item: 2, lineaReal: null, detalle: 'Flete', unidad: 'UN', skuProveedor: '', cantidad: 1, valorConIva: null, costoRealUnitario: 30_000, link1: 'a.cl/f', link2: '', link3: '', agregadoPorCompras: true },
  ] }] } as any);
  assert.equal(ls[0].costoEstimadoNeto, 100_000); assert.equal(ls[0].costoRegistradoNeto, 90_000);
  assert.equal(ls[1].esGastoExtra, true); assert.equal(ls[1].precioVentaUnitario, null);
});

// ── preparación, acción y cita de cada bloqueo ────────────────────────────────────────────────────
import { diagnosticarPreparacion } from '../auditor-compras-core';
test('preparación: dice qué falta y cómo se arregla (moneda sin tipo de cambio, RUT propio, sin producto, sin plazo)', () => {
  const l = linea({ links: [] });
  const p = diagnosticarPreparacion(
    [{ linea: l, tecnico: { estado: 'no_existe', marca: '', modelo: '' }, cotizaciones: [
      { id: 30, proveedor: 'PanTai', rut: null, rutEsPropio: true, moneda: 'USD', tipoCambio: null, plazoDias: null, fleteMonto: null, incluyeFlete: null, vigencia: null, tieneTexto: true, asignadaAProductos: 1 },
    ] }],
    [{ id: 31, proveedor: 'Otro' }], { presupuestoNeto: null, relojDefinido: false, dolarDisponible: true });
  const textos = p.items.map(i => i.texto).join(' | ');
  assert.equal(p.lista, false);
  assert.ok(textos.includes('sin tipo de cambio') || textos.includes('no tiene tipo de cambio'));
  assert.ok(textos.includes('RUT del proveedor es el de TU empresa'));
  assert.ok(textos.includes('no está asignada a ningún producto'));
  assert.ok(p.items.every(i => i.nivel === 'ok' || i.comoSolucionar.length > 5));
});
test('preparación: una línea completa y una cotización buena = lista', () => {
  const p = diagnosticarPreparacion(
    [{ linea: linea(), tecnico: { estado: 'aprobado', marca: 'Karcher', modelo: 'HDS' }, cotizaciones: [
      { id: 1, proveedor: 'X', rut: '76.000.000-0', rutEsPropio: false, moneda: 'CLP', tipoCambio: null, plazoDias: 3, fleteMonto: 1000, incluyeFlete: false, vigencia: '2026-12-01', tieneTexto: true, asignadaAProductos: 1 },
    ] }], [], { presupuestoNeto: 1_000_000, relojDefinido: true, dolarDisponible: true });
  assert.equal(p.lista, true); assert.equal(p.resumen.faltas, 0);
});
test('cada bloqueo trae quién debe actuar y la cita del documento', () => {
  const l = linea(); const s = ok(); s.verificaciones!.V3_iva_moneda = { estado: 'DOBLE_IVA', cita: 'Valor neto $4.150.000 + IVA' };
  const d = derivarLinea(l, guardada(l, s), ctx());
  const b = d.bloqueos.find(x => x.codigo === 'V3_DOBLE_IVA')!;
  assert.equal(b.accion, 'corregir_costeo'); assert.equal(b.cita, 'Valor neto $4.150.000 + IVA');
  const sinResp = derivarLinea(l, guardada(l, ok({ respaldos: [] })), ctx());
  assert.equal(sinResp.bloqueos.find(x => x.codigo === 'SIN_RESPALDO')!.accion, 'subir');
});
