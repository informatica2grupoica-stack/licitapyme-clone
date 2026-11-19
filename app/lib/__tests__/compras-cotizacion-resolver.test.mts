import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolverCotizacion, type CotizResolver, type ProductoResolver } from '../compras-cotizacion-resolver';

// El núcleo es puro: la IA entra como función. Estas pruebas fijan lo que «responde la IA» y miden los frenos del código.
// Casos tomados del banco de cotizaciones reales (scripts/banco-cotizaciones), con nombres y precios reales.
const doc = (lineas: Array<[string, number, number, string?]>) =>
  'LÍNEAS DEL DOCUMENTO (leídas y verificadas; el precio unitario ya trae el descuento de la línea):\n'
  + lineas.map(([d, q, pu, u], i) => `${i + 1}. ${d} | cantidad ${q}${u ? ' ' + u : ''} | precio unitario ${pu} | total ${q * pu}`).join('\n') + '\n\nTexto del PDF';
const cotiz = (texto: string, extra: Partial<CotizResolver> = {}): CotizResolver => ({
  proveedor_nombre: 'Proveedor', precio_unitario: null, precio_total: null, moneda: 'CLP', descripcion_libre: texto, tipo_cambio_usado: null,
  notas: null, descuento_pct: null, precio_unitario_clp: null, precio_unitario_bruto: null, flete_monto: null, ...extra,
});
const ia = (items: any[]) => async () => ({ content: JSON.stringify({ items, faltantes: [], puntosCriticos: null }), finishReason: 'stop' });
const correr = (productos: ProductoResolver[], c: CotizResolver, items: any[], preciosPrevios?: Record<number, number>) =>
  resolverCotizacion({ productos, cotiz: c, sobreTotal: false, systemPrompt: 'x', llamarIA: ia(items), preciosPrevios });
const precio = (r: any, id: number) => r.finales.find((f: any) => f.producto.id === id)?.precioClp ?? null;

test('variantes sin especificar: la silla sin talla sirve para la talla 43 y la 45 (4777-25-LE26)', async () => {
  const productos = [{ id: 1, descripcion: 'Silla de ruedas eléctrica estándar talla 43 cm', cantidad: 1 }, { id: 2, descripcion: 'Silla de ruedas eléctrica estándar talla 45 cm', cantidad: 1 }];
  const r = await correr(productos, cotiz(doc([['Silla De Ruedas Eléctrica Plegable Con Joystick Negro', 4, 276462.25]])), [{ producto: 'P1', cumple: 'CUMPLE', precioUnitarioAsignado: 276462.25 }]);
  assert.equal(precio(r, 1), 276462.25);
  assert.equal(precio(r, 2), 276462.25);
});

test('variantes: si la línea SÍ dice la talla, no se copia a la otra', async () => {
  const productos = [{ id: 1, descripcion: 'Silla de ruedas talla 43 cm', cantidad: 1 }, { id: 2, descripcion: 'Silla de ruedas talla 45 cm', cantidad: 1 }];
  const r = await correr(productos, cotiz(doc([['Silla de ruedas talla 43', 1, 200000]])), [{ producto: 'P1', cumple: 'CUMPLE', precioUnitarioAsignado: 200000 }]);
  assert.equal(precio(r, 2), null);
});

test('segunda pasada: la IA olvidó el gabinete y el código lo asigna por nombre, con aviso (387-55-LE26)', async () => {
  const productos = [{ id: 1, descripcion: 'Escritorio recto', cantidad: 1 }, { id: 2, descripcion: 'Gabinete de dos puertas', cantidad: 1 }, { id: 3, descripcion: 'Silla de visita', cantidad: 14 }];
  const r = await correr(productos, cotiz(doc([['Escritorio Space 160x70 Natura/Blanco', 1, 205798], ['Muebles oficina Gabinete Bajo Con Puertas 80x40x75', 1, 117563]])),
    [{ producto: 'P1', cumple: 'CUMPLE', precioUnitarioAsignado: 205798 }]);
  assert.equal(precio(r, 2), 117563);
  assert.match(r.finales.find((f: any) => f.producto.id === 2)!.it.detalle, /Lo asignó el sistema/);
  assert.equal(precio(r, 3), null);   // la silla no se inventa: no hay línea para ella
});

test('conversión con precio de venta: el saco de carbón NO se multiplica por 10; el rollo de nylon SÍ por 68 (2736-44-LE26)', async () => {
  const carbon = [{ id: 1, descripcion: 'Saco carbón vegetal de origen natural,10kilos', cantidad: 50, montoUnitario: 6978 }];
  const r1 = await correr(carbon, cotiz(doc([['Carbón Quebracho Saco de 10 kg', 50, 5500]])),
    [{ producto: 'P1', cumple: 'CUMPLE', precioUnitarioAsignado: null, conversionUnidad: { unidadLinea: 'KG', precioLinea: 5500, cantidadPorUnidad: 10 } }]);
  assert.equal(precio(r1, 1), 5500);
  const nylon = [{ id: 1, descripcion: 'Rollo nylon transparente. Tubular 0,20mm.68mts', cantidad: 2, montoUnitario: 215701 }];
  const r2 = await correr(nylon, cotiz(doc([['FOLIO INCOLORO 2 MTS X 0.20MM', 140, 2000, 'MT']])),
    [{ producto: 'P1', cumple: 'CUMPLE', precioUnitarioAsignado: null, conversionUnidad: { unidadLinea: 'MT', precioLinea: 2000, cantidadPorUnidad: 68 } }]);
  assert.equal(precio(r2, 1), 136000);
});

test('flete: con flete aparte NO va al producto «Transporte»; sin flete aparte, sí (387-55 / 2906-19)', async () => {
  const productos = [{ id: 1, descripcion: 'Silla de visita', cantidad: 1 }, { id: 2, descripcion: 'Transporte', cantidad: 1 }];
  const items = [{ producto: 'P1', cumple: 'CUMPLE', precioUnitarioAsignado: 33957 }, { producto: 'P2', cumple: 'CUMPLE', precioUnitarioAsignado: 12597 }];
  const texto = doc([['Silla Visita Strong', 1, 33957], ['Despacho Envio Rural RM', 1, 12597]]);
  assert.equal(precio(await correr(productos, cotiz(texto, { flete_monto: 12597 }), items), 2), null);
  assert.equal(precio(await correr(productos, cotiz(texto), items), 2), 12597);
});

test('neto que dejó el equipo: si el precio previo es el nuevo ÷ 1,19, se respeta (colchones 2736-44-LE26)', async () => {
  const productos = [{ id: 1, descripcion: 'Colchón de 20cm altura espuma', cantidad: 100 }];
  const r = await correr(productos, cotiz(doc([['Colchon ESPUMA 1p', 100, 40000]])), [{ producto: 'P1', cumple: 'CUMPLE', precioUnitarioAsignado: 40000 }], { 1: 33613 });
  assert.equal(precio(r, 1), 33613);
});

test('otra medida (menos de lo pedido) no se asigna; más de lo pedido sí, con aviso', async () => {
  const productos = [{ id: 1, descripcion: 'Tubería HDPE de 75 mm', cantidad: 1 }, { id: 2, descripcion: 'Plato de lavado 22" inoxidable', cantidad: 1 }];
  const texto = doc([['Tuberia PE100 d= 63 mm', 1, 3222], ['LAVA SUPERFICIE 24" AHNPRO', 1, 450000]]);
  const r = await correr(productos, cotiz(texto), [{ producto: 'P1', cumple: 'CUMPLE', precioUnitarioAsignado: 3222 }, { producto: 'P2', cumple: 'CUMPLE', precioUnitarioAsignado: 450000 }]);
  assert.equal(precio(r, 1), null);
  assert.equal(precio(r, 2), 450000);
  assert.equal(r.finales.find((f: any) => f.producto.id === 2)!.it.cumple, 'INFERIOR_NEGOCIABLE');
});
