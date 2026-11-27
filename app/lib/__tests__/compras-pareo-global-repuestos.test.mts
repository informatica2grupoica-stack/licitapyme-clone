import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../compras-pareo-global-core';
import type { CotizacionPareo, ProductoPareo } from '../compras-pareo-global-core';

// Casos reales de 2378-117-LP26 (negocio 1385, 27-11-2026): productos «máquina + REPUESTOS». La IA se simula con una respuesta fija.
const doc = (lineas: Array<[string, number, number]>) =>
  'LÍNEAS DEL DOCUMENTO (leídas y verificadas; el precio unitario ya trae el descuento de la línea):\n'
  + lineas.map(([d, q, pu], i) => `${i + 1}. ${d} | cantidad ${q} | precio unitario ${pu} | total ${q * pu}`).join('\n') + '\n\nTexto del PDF';
const cot = (id: number, lineas: Array<[string, number, number]>, extra: Partial<CotizacionPareo> = {}): CotizacionPareo => ({
  id, proveedor_nombre: `Proveedor ${id}`, moneda: 'CLP', tipo_cambio_usado: null, notas: null, descuento_pct: null,
  precio_total: null, flete_monto: null, descripcion_libre: doc(lineas), ...extra,
});
const ia = (r: any) => async () => ({ content: JSON.stringify(r), finishReason: 'stop' });
const P = (id: number, descripcion: string, cantidad: number): ProductoPareo => ({ id, descripcion, cantidad, unidad: 'un' });

const MS172 = P(911, 'MOTOSIERRA TIPO STIHL MODELO MS 172 EQUIVALENTE O SUPERIOR + REPUESTOS - STIHL MS 172', 5);
const HL94 = P(908, 'CORTASETO DE ALTURA DEL TIPO STIHL MODELO HL94 EQUIVALENTE O SUPERIOR + REPUESTOS - STIHL HL94', 1);

test('un repuesto que nombra el modelo NO le gana a la máquina, aunque sea más barato', async () => {
  const c = cot(498, [['MOTOSIERRA MS 172', 5, 210080], ['FILTRO DE MEZCLA MS-172', 10, 3592.9]]);
  const r = await core.parearNegocio({ productos: [MS172], cotizaciones: [c], llamarIA: ia({
    asignaciones: [{ producto: 'P1', linea: 'L1', cantidad: 5, confianza: 'alta' }], alternativas: [{ producto: 'P1', linea: 'L2', motivo: 'repuesto' }] }) });
  assert.deepEqual(r.asignaciones.map(a => a.precioUnitarioClp), [210080]);
  assert.deepEqual(r.alternativas, []);
});

test('si la IA solo propone el repuesto como precio de la máquina, no se asigna (y no sirve de motivo para borrar lo guardado)', async () => {
  const c = cot(419, [['FILTRO COMBUSTIBLE BT-120 HS-80 HL-94', 1, 3866]]);
  const r = await core.parearNegocio({ productos: [HL94], cotizaciones: [c], llamarIA: ia({ asignaciones: [{ producto: 'P1', linea: 'L1', cantidad: 1, confianza: 'alta' }] }) });
  assert.equal(r.asignaciones.length, 0);
  assert.match(r.descartes[0].motivo, /repuesto/);
  assert.doesNotMatch(r.descartes[0].motivo, /medida|familia|modelo/);
});

test('qué es un repuesto de un producto (líneas reales de las cotizaciones del 1385)', () => {
  const soplador = 'SOPLADOR INALÁMBRICO 40V CON 1 BATERÍA Y CARGADOR';
  const si: Array<[string, string]> = [
    [HL94.descripcion, 'FILTRO COMBUSTIBLE BT-120 HS-80 HL-94'], [HL94.descripcion, 'JUEGO CABEZAL ASPIRACION COMB.HL-94'],
    [MS172.descripcion, 'STIHL FILTRO DE AIRE MS 162-172'], [MS172.descripcion, 'Espada STIHL 14" 35 cm Paso 3/8"P'],
    [MS172.descripcion, 'PIÑON DE CADENA 3/8P 6D MS172'], [MS172.descripcion, 'Repuesto Motosierra Cadena Motosierra vB 12"'],
    [MS172.descripcion, 'STIHL CARBURADOR 1148/00 MS 162-172'],
    [soplador, 'CARGADOR BATERIA LI ION DC40RAXGT MAKITA'], [soplador, 'Bateria BL4040F (40V 4Ah) MAKITA'],
  ];
  for (const [p, l] of si) assert.equal(core.esRepuestoDelProducto(p, l), true, `${l} es repuesto de ${p}`);
  const no: Array<[string, string]> = [
    [HL94.descripcion, 'CORTASETO ALTURA HL 94'], [MS172.descripcion, 'Motosierra STIHL MS 172 con Espada de 14 Pulg.'],
    [MS172.descripcion, 'MS 172 STIHL+2 BUJIA , 2 FILTRO AIRE,2 CARBURADOR'], [MS172.descripcion, 'MOTOSIERRA TIPO STIHL MODELO MS172+'],
    // la máquina con sus repuestos incluidos, escritos sin «+» ni «con» (Agro #428)
    [MS172.descripcion, 'MS 250 STIHL 2 BUJIA , 2 FILTRO AIRE,2 CARBURADOR 2 ESPADA DE 18" Y 2 CADENAS'],
    [HL94.descripcion, 'HT 105 STIHL 2 BUJIA , 2 FILTRO AIRE,2 CARBURADOR'],
    [soplador, 'Soplador -Aspirador 40V Max XGT / Sin batería ni cargador MAKITA'], [soplador, 'SOPLADOR BGA-60 SET BATERIA'],
    ['BUJÍA BPM6Y PARA DESBROZADORA MARCA MARUYAMA', 'BUJIA NGK BPM6Y 261200'], ['FILTRO DE BENCINA PARA DESBROZADORA', 'Repuestos Maquina de Jardineria Filtro de Bencina'],
    ['CABEZAL DE CORTE 5.5" PARA DESBROZADORA', 'CABEZAL DE CORTE RAPID-LOADER 35 ECHO'], ['CUCHILLO SIERRA CALADORA - 10 PIEZAS', 'Repuesto cuchillo sierra caladora'],
    ['KIT DE REPUESTOS PARA BOMBA', 'Sello mecánico bomba'], ['Taladro percutor eléctrico', 'Taladro Bosch batería 18V'],
    ['Bomba de agua', 'Bomba de aceite'], ['Cargador frontal', 'CARGADOR FRONTAL 1,8 m3'],
  ];
  for (const [p, l] of no) assert.equal(core.esRepuestoDelProducto(p, l), false, `${l} NO es repuesto de ${p}`);
});

test('descuento sobre el total: el pareo guarda el precio de LISTA (el % lo aplica una sola vez el recálculo)', async () => {
  const c = cot(419, [['CORTASETO ALTURA HL 94', 1, 942017]], { descuento_pct: 15 });
  const resultado = await core.parearNegocio({ productos: [HL94], cotizaciones: [c], llamarIA: ia({ asignaciones: [{ producto: 'P1', linea: 'L1', cantidad: 1, confianza: 'alta' }] }) });
  const base = { resultado, respaldado: () => true, productos: [{ id: 908, subestado: 'COTIZANDO' }], cotizacionesDeUnaPersona: new Set<number>(), descuentoSobreTotal: new Map([[419, 15]]) };
  assert.equal(core.planificarEscrituraPareo({ ...base, itemsGuardados: [] }).escribir[0].precio, 942017);
  // ya guardado a precio de lista: es el mismo precio, no se reescribe
  assert.equal(core.planificarEscrituraPareo({ ...base, itemsGuardados: [{ cotizacionId: 419, productoId: 908, precioBase: 942017 }] }).escribir.length, 0);
  // cotización antigua (precios ya descontados pieza por pieza): se guarda con el descuento, como antes
  assert.equal(core.planificarEscrituraPareo({ ...base, itemsGuardados: [], descuentoSobreTotal: new Map() }).escribir[0].precio, 800714.45);
});

test('precio de lista a partir del neto con descuento: devuelve el impreso', () => {
  for (const [lista, d] of [[3866, 15], [468067, 15], [52597, 7], [5454, 5], [587395, 8], [1000, 42]]) {
    const neto = Math.round(lista * (100 - d)) / 100;
    assert.equal(core.precioBaseAGuardar(neto, d), lista);
  }
  assert.equal(core.precioBaseAGuardar(1234.5, null), 1234.5);
});
