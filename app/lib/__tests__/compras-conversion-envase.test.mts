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
