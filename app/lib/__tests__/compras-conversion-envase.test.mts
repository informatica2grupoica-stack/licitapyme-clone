import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conversionDesdeTexto, precioPorUnidadDeProducto, corregirAdicionalesConLineas } from '../compras-cotizacion-lineas';

// 727202-72-LP26 (INGAP 176408): líneas por METRO («Rollo 100 metros», cantidad 300 = 3 rollos); productos por rollo. El modelo de respaldo no devolvía la conversión.
const texto = `LÍNEAS DEL DOCUMENTO (leídas y verificadas)
1. Tuberia (Rollo 100 metros) PE100 PN16 d= 20 mm Coextruido | cantidad 300 | precio unitario 516 | total 154800
2. Tuberia (Rollo 50 metros) PE100 PN10 d= 110mm Coextruida | cantidad 100 | precio unitario 8838 | total 883800
3. Tuberia (Rollo 100 metros) PE100 PN10 d= 63 mm Coextruida | cantidad 400 | precio unitario 3222 | total 1288800

Item Cant | Descripción ‖ Total | Entrega
1 | 300 Tuberia (Rollo 100 metros) PE100 PN16 d= 20 mm | $ | 516. | $ | 154.800 | 3x100mts
2 | 100 Tuberia (Rollo 50 metros) PE100 PN10 d= 110mm | $ | 8.838. | $ | 883.800 | 2x50mts
3 | 400 Tuberia (Rollo 100 metros) PE100 PN10 d= 63 mm | $ | 3.222. | $ | 1.288.800 | 2x100mts`;
const precio = (precioLinea: number, prod: string) => precioPorUnidadDeProducto(conversionDesdeTexto(precioLinea, prod, texto), prod, texto)?.precio ?? null;

test('línea por metro, producto «(R/100)», «(50 m)» o «unidades de 100m» = precio × metros del rollo', () => {
  assert.equal(precio(3222, 'Tubería HDPE de 63 mm, PE100, PN10 (R/100).'), 322200);
  assert.equal(precio(8838, 'Tubería HDPE de 110 mm,PN10(50 m).'), 441900);
  assert.equal(precio(516, 'Tubería HDPE de 1/2",unidades de 100m.'), 51600);
});
test('un largo del aparato («Pozómetro de 100 m con carrete») NO se toma como rollo', () => {
  const t = `1. Pozómetro de 100 m con carrete | cantidad 1 | precio unitario 450000 | total 450000\n1 | Pozómetro de 100 m con carrete | 450.000 MT`;
  assert.equal(conversionDesdeTexto(450000, 'Pozómetro de 100 m con carrete', t), null);
});

// Vorwerk: «INCLUYE: Set reducciones + Mordaza + Adaptador de bridas» no son líneas con precio propio.
test('un componente que solo está en el «INCLUYE:» de una línea más larga se descarta (no toma el precio de esa línea)', () => {
  const lineas: any[] = [
    { descripcion: 'Soldadora de termofusión PT160 INCLUYE: Soldadora de termofusión PT160 + Set reducciones + Adaptador de bridas Marca Tecnodue Procedencia Italiana', cantidad: 1, precioUnitario: 7267.57, total: 7267.57 },
    { descripcion: 'Soldadora de termofusión PL160 INCLUYE: Soldadora de termofusión PL160 + Set reducciones para fitting + Mordaza principal + Adaptador de bridas Marca Tecnodue', cantidad: 1, precioUnitario: 5295.83, total: 5295.83 },
  ];
  const { adicionales } = corregirAdicionalesConLineas([{ concepto: 'Set reducciones para fitting', cantidad: 1, precioUnitario: 5295 }, { concepto: 'Adaptador de bridas', cantidad: 1, precioUnitario: 7267 }], lineas) as any;
  assert.equal(adicionales.length, 0);
});
test('un accesorio con su propia línea sigue tomando su precio (sin «incluye»)', () => {
  const lineas: any[] = [{ descripcion: '18 bandejas de aluminio para carro de 18 x 60 x 40', cantidad: 1, precioUnitario: 152000, total: 152000 }];
  const { adicionales } = corregirAdicionalesConLineas([{ concepto: 'Bandejas', cantidad: 1, precioUnitario: 1 }], lineas) as any;
  assert.equal(adicionales[0].precioUnitario, 152000);
});

import { productoQueCubreLaLinea } from '../compras-cotizacion-lineas';
test('Makita: la batería con IVA ($64.990) no se explica como «conversión × 2» del esmeril sin IVA ($129.403)', () => {
  const l: any = { descripcion: '632G12-3 - Bateria (Bl1830B) 18V 3,0Ah Li-Ion Sin Caja Makita', cantidad: 2, precioUnitario: 64990, total: 129980 };
  const r = productoQueCubreLaLinea(l, [{ id: 1, descripcion: 'Esmeril inalámbrico Makita de 4 1/2”, 18 V, con 2 baterías de 3,0 Ah y cargador', precioBase: 129403 }]);
  assert.notEqual(r?.como, 'conversion');
});
test('AD21P no está «cubierto» por el geófono PQ128C: otro modelo; PQ128C sí', () => {
  const prods = [{ id: 1, descripcion: 'Geófono detector de fugas por ultrasonido PQ128C-PQWT.', precioBase: null }];
  const ad: any = { descripcion: 'AD21P - HIKMicro Detector de Fugas por Ultrasonido Visualización Gráfica de Señal para interiores', cantidad: 1, precioUnitario: 949900, total: 949900 };
  const pq: any = { descripcion: 'PQ128C - PQWT Detector de Fugas por Ultrasonido Visualización Gráfica de Señal para interiores y exteriores', cantidad: 1, precioUnitario: 1799900, total: 1799900 };
  assert.equal(productoQueCubreLaLinea(ad, prods), null);
  assert.equal(productoQueCubreLaLinea(pq, prods)?.productoId, 1);
});

import { lineasSinAsignar } from '../compras-cotizacion-lineas';
test('lineasSinAsignar: la línea AD21P no queda «tapada» por el nombre del geófono PQ128C', () => {
  const ad: any = { descripcion: 'AD21P - HIKMicro Detector de Fugas por Ultrasonido Visualización Gráfica de Señal', cantidad: 1, precioUnitario: 949900, total: 949900 };
  const pq: any = { descripcion: 'PQ128C - PQWT Detector de Fugas por Ultrasonido Visualización Gráfica de Señal', cantidad: 1, precioUnitario: 1799900, total: 1799900 };
  const asignados = ['Geófono detector de fugas por ultrasonido PQ128C-PQWT.'];
  assert.equal(lineasSinAsignar([ad], asignados).length, 1);
  assert.equal(lineasSinAsignar([pq], asignados).length, 0);
});

import { lineasAlternativas } from '../compras-cotizacion-lineas';
test('Improtek: el producto genérico toma el precio de una línea; las otras opciones parecidas (AD21P) son alternativas sin usar', () => {
  const mk = (descripcion: string, precioUnitario: number): any => ({ descripcion, cantidad: 1, precioUnitario, total: precioUnitario });
  const l2000 = mk('L2000 - PQWT Detector de Fugas por Ultrasonido para exteriores', 1699900);
  const ad21 = mk('AD21P - HIKMicro Detector de Fugas por Ultrasonido para interiores', 949900);
  const prods = [{ id: 1, descripcion: 'Geófono para detección de fugas.', precioBase: 1699900 }];
  const alt = lineasAlternativas([l2000, ad21], prods);
  assert.deepEqual(alt, [ad21]);
  assert.deepEqual(lineasAlternativas([l2000], prods), []);
});

import { asignacionRespaldadaPorDocumento } from '../compras-cotizacion-lineas';
test('limpieza de asignaciones viejas: se conserva la que el documento respalda y se quita la que ya no', () => {
  const mk = (descripcion: string, precioUnitario: number): any => ({ descripcion, cantidad: 1, precioUnitario, total: precioUnitario });
  const lineas = [mk('ELECTROB. POZO PEDROLLO 4SR12M-9 + PD 3HP 220V', 802435), mk('Tuberia (Rollo 100 metros) PE100 PN10 d= 63 mm Coextruida', 3222)];
  const f = [1 / 1.19];
  // Pedrollo: el precio neto de la línea con IVA, mismo modelo y misma potencia → respaldada
  assert.equal(asignacionRespaldadaPorDocumento('Electrobomba sumergible Pedrollo 4SR 12M-9+PD,3HP,220V.', 674315, lineas, { factoresPrecio: f }), true);
  // la tubería de 75 mm con el precio por rollo de la de 63 mm → choca en medida: NO respaldada
  assert.equal(asignacionRespaldadaPorDocumento('Tubería HDPE de 75mm,unidad de 100m.', 322200, lineas, { factoresPrecio: f }), false);
  // un precio que no está en ninguna línea → NO respaldada
  assert.equal(asignacionRespaldadaPorDocumento('Bomba de pozo Franklin 30 HP', 999999, lineas, { factoresPrecio: f }), false);
});

import { conversionCoherenteConLinea } from '../compras-cotizacion-lineas';
test('conversión × N solo si la línea se cobra por la medida: rollos sí, basurero de 1.100 litros no', () => {
  const ln = (cantidad: number, unidad: string | null = null): any => ({ descripcion: 'x', cantidad, unidad, precioUnitario: 1, total: cantidad });
  assert.equal(conversionCoherenteConLinea(ln(300), 100), true);    // 300 m = 3 rollos de 100 m
  assert.equal(conversionCoherenteConLinea(ln(140, 'MT'), 68), true); // se cobra por metro
  assert.equal(conversionCoherenteConLinea(ln(10), 1100), false);   // 10 basureros de 1.100 litros
  assert.equal(conversionCoherenteConLinea(ln(250), 20), false);    // 250 termos de 20 L (12,5 no es exacto)
  assert.equal(conversionCoherenteConLinea(ln(1), 2500), false);    // 1 transpaleta de 2.500 kg
});

test('limpieza: el precio de una electrofusión Connect160 asignado a una termofusión HST 300 NO se conserva (nombre no se parece)', () => {
  const l: any = { descripcion: 'Máquina de Electrofusión Connect160 20-160 mm Marca Foxfitting Procedencia Polaca', cantidad: 1, precioUnitario: 1187.5, total: 1187.5 };
  assert.equal(asignacionRespaldadaPorDocumento('Máquina de fusión HDPE Hürner HST 300 Smart, 20-160 mm.', 1185790, [l], { factoresPrecio: [998.56] }), false);
});
