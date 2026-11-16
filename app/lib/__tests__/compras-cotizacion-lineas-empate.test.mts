import { test } from 'node:test';
import assert from 'node:assert/strict';
import { corregirAdicionalesConLineas } from '../compras-cotizacion-lineas';

// 3789-30-LE26, Sociedad Cila #310: el filtro HEPA quedaba al precio del aspirador porque la línea del aspirador también dice «filtro HEPA».
const lineas: any[] = [
  { descripcion: 'ASPIRADOR DE POLVO MODELO LEVENT Velocidad del motor: hasta 4000 rpm. Incluye: 1 filtro HEPA /1 bolsa con 50 filtros desechables.', cantidad: 2, precioUnitario: 151260.5, total: 302521 },
  { descripcion: 'FILTRO HEPA ASPIRADOR DE POLVO', cantidad: 2, precioUnitario: 10084, total: 20168 },
  { descripcion: 'FILTROS DE REPUESTO (PAQUETE DE 50PCS)', cantidad: 10, precioUnitario: 10084, total: 100840 },
];

test('el filtro HEPA toma la línea exacta del filtro, no la del aspirador', () => {
  const { adicionales } = corregirAdicionalesConLineas([{ concepto: 'Filtro HEPA aspirador de polvo', cantidad: 1, precioUnitario: 151261 }], lineas) as any;
  assert.equal(adicionales[0].precioUnitario, 10084);
  assert.equal(adicionales[0].cantidadLinea, 2);
});
test('el aspirador sigue tomando su propia línea', () => {
  const { adicionales } = corregirAdicionalesConLineas([{ concepto: 'Aspirador de polvo modelo Levent', cantidad: 1, precioUnitario: 1 }], lineas) as any;
  assert.equal(adicionales[0].precioUnitario, 151260.5);
});
test('los filtros de repuesto no se confunden con el filtro HEPA', () => {
  const { adicionales } = corregirAdicionalesConLineas([{ concepto: 'Filtros de repuesto (paquete de 50pcs)', cantidad: 5, precioUnitario: 1 }], lineas) as any;
  assert.equal(adicionales[0].cantidadLinea, 10);
  assert.equal(adicionales[0].precioUnitario, 10084);
});
