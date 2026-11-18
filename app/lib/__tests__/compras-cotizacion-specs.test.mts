import test from 'node:test';
import assert from 'node:assert/strict';
import { pareceTenerEspecificaciones, especificacionesDe, productoTraeEspecificaciones, productosConEspecificaciones, destinoDeProducto, proveedorUtilizable } from '../compras-cotizacion-specs-core';

// ── Cotizaciones CON especificaciones, en los formatos reales en que llegan ─────────────────────────
const CON_SPECS: Record<string, string> = {
  lista_nombre_valor: `COTIZACION 2026-118 Hogar Total SpA RUT 76.111.222-3
Señores: Comercial MP SpA
Item 1  Horno convector 10 bandejas   Cant 2   P.Unit $1.890.000   Total $3.780.000
Características:
Potencia: 12 kW
Voltaje: 380 V trifásico
Capacidad: 10 bandejas GN 1/1
Material: acero inoxidable AISI 304
Dimensiones: 90 x 80 x 110 cm
Peso: 120 kg
Neto $3.780.000  IVA $718.200  Total $4.498.200`,
  tabla_barras_excel: `Producto | Marca | Modelo | Cant | Neto
Colchón resortes 1 plaza | Ortho | OR-100 | 25 | 62.000
Especificación | Valor
Densidad | 30 kg/m3
Altura | 20 cm
Resortes | 300 por plaza
Tejido | Jacquard 180 g/m2
Garantía del fabricante | 5 años`,
  prosa_parka: `Cotizamos parka impermeable alta visibilidad marca Safetex modelo ST-90: tela poliéster 300D con laminado PU, costuras selladas, cintas reflectantes 5 cm, color amarillo, tallas S a XXL, certificación EN ISO 20471 clase 3, peso 850 gr. Precio unitario $38.900 + IVA. Despacho 7 días.`,
  ingles: `Quotation No. 55
Product: Electric kettle 2.5 L
Specifications:
Power: 1500 W
Voltage: 220 V 50 Hz
Capacity: 2.5 liters
Material: stainless steel 304
Weight: 1.2 kg
Unit price USD 12.40`,
  whatsapp_texto: `Hola, te cotizo la silla de ruedas modelo Intco Active:
- Ancho de asiento 42 cm
- Peso máximo usuario 120 kg
- Peso de la silla 14 kg
- Material aluminio liviano
- Ruedas traseras 24 pulgadas
Valor $289.000 neto`,
  mueble_melamina: `Cotización escritorio recto
Medidas: 140 x 60 x 75 cm
Material: melamina 18 mm
Color: haya
Canto: PVC 2 mm
Acabado: texturado
Precio $54.900 c/u`,
};

// ── Cotizaciones SIN especificaciones: solo precio y descripción ────────────────────────────────────
const SIN_SPECS: Record<string, string> = {
  solo_precio: `COTIZACION 77 Distribuidora Biobío SpA
Item Descripción Cant P.Unit Total
1 Frazada polar 150x200 300 $4.990 $1.497.000
Neto $1.497.000 IVA $284.430 Total $1.781.430
Validez 15 días. Pago 30 días.`,
  whatsapp_precio: `Hola! Las frazadas te salen $4.990 + IVA cada una, entrega en 10 días hábiles`,
  corto: `Cotización 1 total $10.000`,
  condiciones_comerciales: `Condiciones comerciales de la oferta
Forma de pago: transferencia a 30 días
Validez de la oferta: 15 días corridos
Plazo de entrega: 10 días hábiles
Despacho incluido en Santiago
Lugar de entrega: bodega del cliente
Garantía: 6 meses
Precios netos, no incluyen IVA. Banco Estado cuenta corriente 123456`,
  vacio: '',
};

test('detecta especificaciones en cada formato de cotización', () => {
  for (const [k, t] of Object.entries(CON_SPECS)) assert.equal(pareceTenerEspecificaciones(t), true, `debía detectar specs en «${k}»`);
});

test('no gasta lectura en cotizaciones que solo traen precio y condiciones', () => {
  for (const [k, t] of Object.entries(SIN_SPECS)) assert.equal(pareceTenerEspecificaciones(t), false, `no debía detectar specs en «${k}»`);
});

test('texto nulo o indefinido no revienta', () => {
  assert.equal(pareceTenerEspecificaciones(null), false);
  assert.equal(pareceTenerEspecificaciones(undefined), false);
});

// ── Lo que el Lector devuelve por producto ──────────────────────────────────────────────────────────
const car = (...pares: Array<[string, string, string?]>) => pares.map(([nombre, valor, unidad]) => ({ nombre, valor, unidad }));

test('un producto con 3+ características técnicas vale como ficha', () => {
  const p = { caracteristicas: car(['Potencia', '12', 'kW'], ['Voltaje', '380', 'V'], ['Material', 'acero inoxidable']) };
  assert.equal(productoTraeEspecificaciones(p), true);
  assert.equal(destinoDeProducto(p).destino, 'ficha');
  assert.equal(especificacionesDe(p).length, 3);
});

test('con 2 o menos características NO es ficha (solo descripción)', () => {
  assert.equal(productoTraeEspecificaciones({ caracteristicas: car(['Color', 'gris'], ['Talla', 'M']) }), false);
  assert.equal(destinoDeProducto({ caracteristicas: [] }).destino, 'solo_precio');
  assert.equal(productoTraeEspecificaciones(undefined), false);
});

test('las condiciones comerciales leídas como «característica» no cuentan', () => {
  const p = { caracteristicas: car(['Precio', '12.000'], ['Plazo de entrega', '10 días'], ['Garantía', '6 meses'], ['Validez', '15 días'], ['Forma de pago', '30 días'], ['Material', 'acero']) };
  assert.equal(especificacionesDe(p).length, 1);
  assert.equal(productoTraeEspecificaciones(p), false);
});

test('características repetidas o vacías no inflan el conteo', () => {
  const p = { caracteristicas: car(['Peso', '5', 'kg'], ['peso', '5 kg'], ['Largo', ''], ['Ancho', '  '], ['Color', 'rojo']) };
  assert.equal(especificacionesDe(p).length, 2);
  assert.equal(productoTraeEspecificaciones(p), false);
});

test('dimensiones, peso y normas del bloque producto suman como datos técnicos', () => {
  const p: any = { caracteristicas: car(['Material', 'acero']), producto: { largo: '90', ancho: '80', alto: '110', peso: '120', normas: [{ norma: 'EN 20471' }] } };
  assert.equal(productoTraeEspecificaciones(p), true);
});

test('solo los productos con specs de un documento mixto pasan a fichas', () => {
  const salida: any = { productos: [
    { caracteristicas: car(['Potencia', '12', 'kW'], ['Voltaje', '380', 'V'], ['Peso', '120', 'kg']) },
    { caracteristicas: car(['Color', 'azul']) },
    { caracteristicas: [] },
    { caracteristicas: car(['Largo', '140', 'cm'], ['Ancho', '60', 'cm'], ['Material', 'melamina'], ['Canto', 'PVC']) },
  ] };
  assert.deepEqual(productosConEspecificaciones(salida), [0, 3]);
  assert.deepEqual(productosConEspecificaciones(null), []);
  assert.deepEqual(productosConEspecificaciones({}), []);
});

test('valores gigantes (un párrafo entero) no se toman como característica', () => {
  assert.equal(especificacionesDe({ caracteristicas: car(['Texto', 'x'.repeat(500)]) }).length, 0);
});

test('proveedor provisorio no se usa para elegir proveedor de la ficha', () => {
  assert.equal(proveedorUtilizable('(por completar) Q01_facil'), null);
  assert.equal(proveedorUtilizable('(proveedor del catálogo)'), null);
  assert.equal(proveedorUtilizable(''), null);
  assert.equal(proveedorUtilizable(null), null);
  assert.equal(proveedorUtilizable('  Textiles del Sur SpA '), 'Textiles del Sur SpA');
});

test('prosa sin marca ni listas (frazada del banco C06) también se detecta', () => {
  assert.equal(pareceTenerEspecificaciones('Estimados, les cotizamos la frazada polar: tela 100% poliéster polar de 300 g/m2, medidas 150 x 200 cm, color azul marino, costuras reforzadas y ribete en los bordes, apta para lavado a máquina. Cantidad 300 unidades a $5.450 + IVA cada una. Despacho a Los Ángeles incluido, entrega en 10 días hábiles.'), true);
});
