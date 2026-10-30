// Tests del núcleo determinista del AUDITOR unificado (opciones + vía liviana por código). Sin red ni IA:
// prueban la normalización de lo que copia el Lector, el emparejamiento cotización↔línea y las reglas de
// bloqueo (V1, V2, V3, V4 con R1/R2, V6, V7). Correr con: npx tsx --test app/lib/__tests__/auditor-opciones.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { factorSegunLinea, parsearMonto, fechaISO, normalizarProductos, emparejarProductos, puntuar, verificarOpcion, faltantesProveedor, coincidenciaIdentidad, modelosParecidos, emparejarProductoReleido, separarPrecioPegadoACantidad, ivaPorTotalesDelDocumento, margenProyectoConOpciones, margenConAsociados, evaluarAvance, type ProductoNormalizado } from '../auditor-opciones-core';
import type { LineaCosteo } from '../auditor-compras-core';
import type { SalidaLector } from '../auditor-lector';

const linea = (o: Partial<LineaCosteo> = {}): LineaCosteo => ({
  id: 'f1', item: 1, lineaReal: 1, grupo: 'Costeo', detalle: 'TELEVISOR 55" - Televisor led Smart TV 55" resolución 4K HDR', unidad: 'Unidad', sku: '',
  cantidad: 19, valorConIva: 479_990, costoRealUnitario: null, links: ['https://tienda.cl/tv55'], esGastoExtra: false, ofertamos: true,
  costoEstimadoNeto: 403_353, costoRegistradoNeto: 403_353, precioVentaUnitario: 540_000, ...o,
});
const prod = (o: Partial<ProductoNormalizado> = {}): ProductoNormalizado => ({
  idx: 0, nombre: 'Televisor LED Samsung UN55', tipo: 'Televisor LED', marca: 'Samsung', modelo: 'UN55DU7000', version: '', sku: 'UN55DU7000',
  precio: 400_000, preciosMultiples: [], precioAmbiguo: false, moneda: 'CLP', iva: 'neto', ivaTexto: 'precios + IVA',
  unidadPrecio: 'unidad', contenidoEmpaque: '', unidadesPorEmpaque: null, cantidadCotizada: 19, moq: null,
  stock: 'Disponible', plazoTexto: '10 días hábiles', plazoDias: 10, tipoDias: 'habiles', despacho: '', costosAdicionales: [], garantia: '', condiciones: [], esCargo: false, incoterm: '', ...o,
});
const entrada = (p: ProductoNormalizado | null, extra: any = {}) => ({
  linea: linea(), lineasProyecto: [linea()], producto: p,
  documento: { formalidad: 'formal' as const, fecha_emision: '2026-09-20', vigencia: '15 días', legibilidad: 'completa' as const },
  proveedor: {}, opcion: { marca: null, modelo: null }, hoyISO: '2026-09-29', ...extra,
});
const codigos = (xs: Array<{ codigo: string }>) => xs.map(x => x.codigo);

test('parsearMonto: formatos chilenos y ambiguos', () => {
  assert.equal(parsearMonto('$1.234.567'), 1234567);
  assert.equal(parsearMonto('1.234,56'), 1234.56);
  assert.equal(parsearMonto('12,5'), 12.5);
  assert.equal(parsearMonto('479.990'), 479990);
  assert.equal(parsearMonto('US$ 1,400'), 1400);
  assert.equal(parsearMonto('sin precio'), null);
  assert.equal(parsearMonto(''), null);
  assert.equal(parsearMonto(undefined), null);
  assert.equal(parsearMonto(15), 15);
});

test('normalizarProductos: elige el precio vigente, ignora tachado y arma la cantidad cotizada', () => {
  const salida: SalidaLector = { productos: [{
    comercial: { precios: [{ valor: '$599.990', condicion: 'tachado' }, { valor: '$479.990', condicion: 'actual' }], moneda: 'CLP', iva: 'incluido', iva_texto_literal: 'Precio IVA incluido',
      condiciones_generales: [{ texto: 'cantidad cotizada: 19' }], plazo_entrega: '15 días hábiles' },
    producto: { tipo: 'Televisor', marca: 'LG', modelo: '55UR8750' },
  }] };
  const [p] = normalizarProductos(salida);
  assert.equal(p.precio, 479990);
  assert.equal(p.iva, 'incluido');
  assert.equal(p.cantidadCotizada, 19);
  assert.equal(p.plazoDias, 15);
  assert.ok(p.preciosMultiples.some(x => x.startsWith('tachado')));
  assert.equal(p.nombre, 'Televisor LG 55UR8750');
});

test('normalizarProductos: sin IVA declarado queda no_declarado (no se supone)', () => {
  const [p] = normalizarProductos({ productos: [{ comercial: { precios: [{ valor: '100.000', condicion: 'actual' }] } }] });
  assert.equal(p.iva, 'no_declarado');
});

test('IVA: "incluido" sin frase que lo diga (caso PC Factory: pie "I.V.A 19%") queda no_declarado', () => {
  const salida = (iva: any, frase: string): SalidaLector => ({ productos: [{ comercial: { precios: [{ valor: '346.546', condicion: 'actual' }], iva, iva_texto_literal: frase } }] });
  assert.equal(normalizarProductos(salida('incluido', 'I.V.A 19%'))[0].iva, 'no_declarado');
  assert.equal(normalizarProductos(salida('incluido', 'Valores con IVA incluido'))[0].iva, 'incluido');
  assert.equal(normalizarProductos(salida('neto', 'Precios + IVA'))[0].iva, 'neto');
  assert.equal(normalizarProductos(salida('neto', 'AFECTO'))[0].iva, 'neto');
  assert.equal(normalizarProductos(salida('neto', ''))[0].iva, 'no_declarado');
  assert.equal(normalizarProductos(salida('no_declarado', 'I.V.A 19%'))[0].iva, 'no_declarado');
});

test('otros precios: el total de la línea (precio × cantidad) no cuenta como precio distinto (caso Audioterra)', () => {
  const salida: SalidaLector = { productos: [{
    comercial: { precios: [{ valor: '789.900', condicion: 'actual' }, { valor: '13.428.300', condicion: 'otro' }, { valor: '699.000', condicion: 'internet' }], iva: 'neto', iva_texto_literal: '+ IVA', condiciones_generales: [{ texto: 'cantidad cotizada: 17' }] },
    producto: { tipo: 'Proyector', marca: 'EPSON', modelo: '119W' },
  }] };
  const [p] = normalizarProductos(salida);
  assert.equal(p.precio, 789900);
  assert.deepEqual(p.preciosMultiples, ['internet: 699.000']);
});

test('fechaISO: entiende fechas escritas en español y numéricas', () => {
  assert.equal(fechaISO('22 de Septiembre de 2026'), '2026-09-22');
  assert.equal(fechaISO('24 de Septiembre de 2026 12:52'), '2026-09-24');
  assert.equal(fechaISO('04 de octubre de 2026'), '2026-10-04');
  assert.equal(fechaISO('24-9-2026'), '2026-09-24');
  assert.equal(fechaISO('2026-09-20'), '2026-09-20');
  assert.equal(fechaISO('sin fecha'), null);
});

test('V7: vigencia en español ("24 de Septiembre de 2026") vencida se detecta (caso PC Factory)', () => {
  const r = verificarOpcion(entrada(prod(), { documento: { formalidad: 'formal', fecha_emision: '22 de Septiembre de 2026', vigencia: '24 de Septiembre de 2026 12:52' } }));
  assert.ok(r.alertas.some(a => a.codigo === 'V7' && a.mensaje.includes('venció el 2026-09-24')));
});

test('cargo aparte: "Despacho a Domicilio" no es un producto ni se empareja', () => {
  const salida: SalidaLector = { productos: [
    { producto: { tipo: 'Despacho a Domicilio', marca: 'PCF OEM', sku_proveedor: '120' }, comercial: { precios: [{ valor: '34.021', condicion: 'actual' }] } },
    { producto: { tipo: 'Proyector', marca: 'Benq', modelo: 'MX560C' }, comercial: { precios: [{ valor: '346.546', condicion: 'actual' }] } },
  ] };
  const ps = normalizarProductos(salida);
  assert.equal(ps[0].esCargo, true);
  assert.equal(ps[1].esCargo, false);
  const proyector = linea({ id: 'proy', detalle: 'PROYECTOR - Proyector XGA 3400 lumenes, resolución 1024x768, aspecto 4:3', cantidad: 17, costoEstimadoNeto: 402_513 });
  const { asignaciones, sinEmparejar } = emparejarProductos(ps, [proyector]);
  assert.equal(asignaciones.length, 1);
  assert.equal(asignaciones[0].productoIdx, 1);
  assert.deepEqual(sinEmparejar, []);
});

test('emparejar: la categoría de la línea ayuda ("PROYECTOR -") pero una webcam no cae en un kit de conferencia', () => {
  const kit = linea({ id: 'kit', detalle: 'KIT CONFERENCIA - Sistema con cámara full HD 1080p video, altavoz de alta calidad y microfono', cantidad: 16, costoEstimadoNeto: 922_156 });
  const web = prod({ idx: 0, nombre: 'Webcam Kensington W2000 1080P', tipo: 'Webcam', marca: 'Kensington', modelo: 'W2000', version: '1080P', sku: '', precio: 53_101, iva: 'neto', cantidadCotizada: null });
  assert.equal(emparejarProductos([web], [kit]).asignaciones.length, 0);
});

test('emparejar: televisor 55 y 70 no se cruzan aunque compartan palabras', () => {
  const l55 = linea({ id: 'tv55', detalle: 'TELEVISOR 55" - Televisor led Smart TV 55" resolución 4K HDR', cantidad: 19, costoEstimadoNeto: 403_353 });
  const l70 = linea({ id: 'tv70', detalle: 'TELEVISOR 70" - Televisor led Smart TV 70" resolución 4K HDR', cantidad: 3, costoEstimadoNeto: 505_000 });
  const p55 = prod({ idx: 0, nombre: 'Televisor LED 55 pulgadas', tipo: 'Televisor LED', marca: '', modelo: '55 pulgadas', precio: 400_000, cantidadCotizada: 19 });
  const p70 = prod({ idx: 1, nombre: 'Televisor LED 70 pulgadas', tipo: 'Televisor LED', marca: '', modelo: '70 pulgadas', precio: 500_000, cantidadCotizada: 3 });
  const { asignaciones } = emparejarProductos([p55, p70], [l55, l70]);
  assert.equal(asignaciones.find(a => a.productoIdx === 0)?.filaId, 'tv55');
  assert.equal(asignaciones.find(a => a.productoIdx === 1)?.filaId, 'tv70');
});

test('emparejar: un producto que no se parece a nada queda sin emparejar', () => {
  const { asignaciones, sinEmparejar } = emparejarProductos([prod({ idx: 0, nombre: 'Cable HDMI 2m', tipo: 'Cable HDMI', marca: 'Belkin', modelo: '2m', sku: 'F8V3311', cantidadCotizada: 5, precio: 9_000 })], [linea()]);
  assert.equal(asignaciones.length, 0);
  assert.deepEqual(sinEmparejar, [0]);
});

test('emparejar: una línea se usa una sola vez por documento (gana la mejor coincidencia)', () => {
  const { asignaciones } = emparejarProductos([
    prod({ idx: 0, nombre: 'Televisor LED 55 pulgadas', tipo: 'Televisor LED', marca: '', modelo: '55 pulgadas', cantidadCotizada: 19 }),
    prod({ idx: 1, nombre: 'Televisor 55', tipo: 'Televisor', marca: '', modelo: '55', cantidadCotizada: 2, precio: 150_000 }),
  ], [linea()]);
  assert.equal(asignaciones.length, 1);
  assert.equal(asignaciones[0].productoIdx, 0);
});

test('puntuar: penaliza un precio fuera de orden de magnitud', () => {
  const normal = puntuar(prod({ precio: 400_000 }), linea()).puntaje;
  const absurdo = puntuar(prod({ precio: 4_000 }), linea()).puntaje;
  assert.ok(absurdo < normal);
});

test('V3: IVA no declarado bloquea y dice cómo salir', () => {
  const r = verificarOpcion(entrada(prod({ iva: 'no_declarado' })));
  assert.equal(r.veredicto, 'NO_VERIFICADO');
  const b = r.bloqueos.find(x => x.codigo === 'V3');
  assert.ok(b && b.salida.length > 10 && b.accion === 'pedir_proveedor');
});

test('V3: moneda que no es CLP bloquea', () => {
  const r = verificarOpcion(entrada(prod({ moneda: 'USD' })));
  assert.ok(codigos(r.bloqueos).includes('V3'));
});

test('V1: sin marca, modelo ni SKU bloquea', () => {
  const r = verificarOpcion(entrada(prod({ marca: '', modelo: '', sku: '' })));
  assert.ok(codigos(r.bloqueos).includes('V1'));
});

test('V1: el respaldo es de otro modelo que el de la opción → bloquea', () => {
  const r = verificarOpcion(entrada(prod({ marca: 'LG', modelo: '55UR8750' }), { opcion: { marca: 'Samsung', modelo: 'UN55DU7000' } }));
  assert.ok(codigos(r.bloqueos).includes('V1'));
});

test('sin precio → SIN_RESPALDO', () => {
  assert.equal(verificarOpcion(entrada(null)).veredicto, 'SIN_RESPALDO');
  assert.equal(verificarOpcion(entrada(prod({ precio: null }))).veredicto, 'SIN_RESPALDO');
});

test('V4: precio igual o menor que lo costeado → verificado (sin bloqueo)', () => {
  const r = verificarOpcion(entrada(prod({ precio: 400_000 })));
  assert.equal(r.bloqueos.length, 0);
  assert.equal(r.costoNetoUnitario, 400_000);
  assert.equal(r.direccion, 'MAS_BARATO');
  assert.ok(['VERIFICADO', 'VERIFICADO_CON_ALERTAS'].includes(r.veredicto));
});

test('V4: IVA incluido se divide por 1,19 antes de comparar', () => {
  const r = verificarOpcion(entrada(prod({ precio: 479_990, iva: 'incluido' })));
  assert.equal(r.costoNetoUnitario, 403_353);
  assert.equal(r.direccion, 'IGUAL');
});

test('V4-R2: alza que deja el margen del proyecto bajo el 20% bloquea', () => {
  // venta 540.000, costo base 403.353 (margen ~25,3%); con costo neto 440.000 el margen cae a ~18,5% (< 20%).
  const r = verificarOpcion(entrada(prod({ precio: 440_000 })));
  assert.equal(r.direccion, 'MAS_CARO');
  assert.ok(codigos(r.bloqueos).includes('V4'));
  assert.equal(r.veredicto, 'NO_VERIFICADO');
});

test('V4: alza chica que NO toca el margen solo informa', () => {
  const grande = linea({ id: 'f1', cantidad: 1, precioVentaUnitario: 700_000, costoEstimadoNeto: 400_000, costoRegistradoNeto: 400_000 });
  const r = verificarOpcion({ ...entrada(prod({ precio: 404_000 })), linea: grande, lineasProyecto: [grande] });
  assert.equal(r.direccion, 'MAS_CARO');
  assert.ok(!codigos(r.bloqueos).includes('V4'));
  assert.ok(r.alertas.some(a => a.codigo === 'V4'));
});

test('V2: mínimo de compra mayor que la cantidad pedida bloquea; cotizar menos unidades alerta', () => {
  assert.ok(codigos(verificarOpcion(entrada(prod({ moq: 50 }))).bloqueos).includes('V2'));
  const r = verificarOpcion(entrada(prod({ cantidadCotizada: 10 })));
  assert.ok(r.alertas.some(a => a.codigo === 'V2' && a.nivel === 'rojo'));
});

test('V6: sin stock alerta en rojo pero NO bloquea', () => {
  const r = verificarOpcion(entrada(prod({ stock: 'Sin stock' })));
  assert.ok(r.alertas.some(a => a.codigo === 'V6' && a.nivel === 'rojo'));
  assert.ok(!codigos(r.bloqueos).includes('V6'));
});

test('V7: cotización vencida alerta REVALIDAR; sin vigencia y antigua también', () => {
  const vencida = verificarOpcion(entrada(prod(), { documento: { formalidad: 'formal', fecha_emision: '2026-08-01', vigencia: '15 días' } }));
  assert.ok(vencida.alertas.some(a => a.codigo === 'V7' && a.mensaje.includes('REVALIDAR')));
  const antigua = verificarOpcion(entrada(prod(), { documento: { formalidad: 'formal', fecha_emision: '2026-01-10', vigencia: '' } }));
  assert.ok(antigua.alertas.some(a => a.codigo === 'V7'));
  const vigente = verificarOpcion(entrada(prod()));
  assert.ok(!vigente.alertas.some(a => a.codigo === 'V7' && a.nivel !== 'info'));
});

test('respaldo informal → REQUIERE_HABILITACION (si no hay bloqueos)', () => {
  const r = verificarOpcion(entrada(prod(), { documento: { formalidad: 'informal', fecha_emision: '2026-09-20', vigencia: '15 días' } }));
  assert.equal(r.veredicto, 'REQUIERE_HABILITACION');
  assert.equal(r.requiereHabilitacion, true);
});

test('V11: datos del proveedor faltantes solo alertan (info) y se listan', () => {
  const r = verificarOpcion(entrada(prod()));
  assert.ok(r.faltantesProveedor.includes('RUT') && r.faltantesProveedor.includes('cuenta bancaria'));
  assert.ok(!codigos(r.bloqueos).includes('V11'));
  const completo = faltantesProveedor({ razon_social: { valor: 'X SpA' }, rut: { valor: '76.1-1' }, giro: { valor: 'g' }, direccion: { valor: 'd' }, comuna: { valor: 'c' }, region: { valor: 'r' }, vendedor: { valor: 'v' }, telefono: { valor: 't' }, email: { valor: 'e' }, condiciones_pago: { valor: '30 días' }, transferencia: { numero_cuenta: '123' } });
  assert.deepEqual(completo, []);
});

test('V5: costos que el documento cobra aparte se avisan', () => {
  const r = verificarOpcion(entrada(prod({ costosAdicionales: [{ detalle: 'Flete a Rancagua', monto: 45_000, texto: '$45.000' }] })));
  assert.ok(r.alertas.some(a => a.codigo === 'V5' && a.mensaje.includes('Flete')));
});

test('margenProyectoConOpciones: reemplaza el costo de la línea con definitiva', () => {
  const l = linea({ cantidad: 1, precioVentaUnitario: 1000, costoEstimadoNeto: 700, costoRegistradoNeto: 700 });
  const base = margenProyectoConOpciones([l], []);
  const con = margenProyectoConOpciones([l], [{ filaId: 'f1', neto: 800 }]);
  assert.equal(base.margenFinal, 30);
  assert.equal(con.margenFinal, 20);
});

test('costos asociados: bajan el margen real sin llevar margen y pueden activar R2 (piso del 20%)', () => {
  const l = linea({ cantidad: 1, precioVentaUnitario: 1000, costoEstimadoNeto: 750, costoRegistradoNeto: 750 });
  const sin = margenProyectoConOpciones([l], []);
  const con = margenProyectoConOpciones([l], [], 60);              // 750 + 60 = 810 → margen 19%
  assert.equal(sin.margenFinal, 25);
  assert.equal(con.margenFinal, 19);
  assert.equal(con.r2, true);
  assert.equal(con.r1, false);                                     // afectan base y final por igual: R1 no cambia
  assert.equal(margenConAsociados(sin, 0), sin);
});

test('V4 con costos asociados: un alza que sola no baja del 20% sí bloquea cuando ya hay costos asociados', () => {
  const l = linea({ cantidad: 1, precioVentaUnitario: 1000, costoEstimadoNeto: 700, costoRegistradoNeto: 700 });
  const sinAsoc = verificarOpcion({ ...entrada(prod({ precio: 710 })), linea: l, lineasProyecto: [l] });
  assert.ok(!codigos(sinAsoc.bloqueos).includes('V4'));
  const conAsoc = verificarOpcion({ ...entrada(prod({ precio: 710 })), linea: l, lineasProyecto: [l], costosAsociadosNeto: 110 });
  assert.ok(codigos(conAsoc.bloqueos).includes('V4'));
});

test('link caído, que redirige o pide login: no es respaldo (SIN RESPALDO con ruta de salida)', () => {
  for (const estadoLink of ['caido', 'redirige', 'login'] as const) {
    const r = verificarOpcion(entrada(prod(), { estadoLink }));
    assert.equal(r.veredicto, 'SIN_RESPALDO');
    assert.ok(r.bloqueos[0].salida.length > 10);
  }
});

test('link activo: no se evalúa vigencia (vale a la fecha de captura) y el precio variable por región alerta', () => {
  const r = verificarOpcion(entrada(prod({ iva: 'incluido', ivaTexto: 'IVA incluido' }), {
    documento: { tipo: 'link_web', formalidad: 'formal', legibilidad: 'completa' }, estadoLink: 'precio_variable_region', capturadoAt: '2026-09-29T16:11:00',
  }));
  assert.ok(r.alertas.some(a => a.codigo === 'V7' && a.nivel === 'info' && a.mensaje.includes('fecha de la captura')));
  assert.ok(r.alertas.some(a => a.codigo === 'V5' && a.mensaje.includes('región')));
  assert.ok(!r.alertas.some(a => a.codigo === 'V7' && a.nivel !== 'info'));
});

test('avance parcial: se puede dejar líneas fuera, salvo licitación GLOBAL', () => {
  const lineas = [
    { filaId: 'a', item: 1, noOfertada: false, tieneAprobada: true },
    { filaId: 'b', item: 2, noOfertada: true, tieneAprobada: false },
  ];
  const porLinea = evaluarAvance({ modalidad: 'por_linea', lineas });
  assert.equal(porLinea.puede, true);
  assert.match(porLinea.mensaje, /no ofertada: 2/);
  const global = evaluarAvance({ modalidad: 'suma_alzada', lineas });
  assert.equal(global.puede, false);
  assert.match(global.mensaje, /exige ofertar todas las líneas/);
});

test('avance: una línea ofertada sin opción aprobada bloquea y dice cuál', () => {
  const r = evaluarAvance({ modalidad: 'por_linea', lineas: [
    { filaId: 'a', item: 1, noOfertada: false, tieneAprobada: true }, { filaId: 'b', item: 2, noOfertada: false, tieneAprobada: false } ] });
  assert.equal(r.puede, false);
  assert.deepEqual(r.sinResolver, [2]);
  assert.equal(evaluarAvance({ modalidad: 'por_linea', lineas: [{ filaId: 'a', item: 1, noOfertada: true, tieneAprobada: false }] }).puede, false);
});

test('Ruta B: proforma en USD FOB → costo = FOB × (dólar + $10) × 1,06 × 1,3, en neto (lo calcula el sistema)', () => {
  const l = linea({ cantidad: 1, precioVentaUnitario: 6_000_000, costoEstimadoNeto: 4_000_000, costoRegistradoNeto: 4_000_000 });
  const r = verificarOpcion({ ...entrada(prod({ precio: 2_000, moneda: 'USD', iva: 'no_declarado', incoterm: 'FOB' }),
    { documento: { tipo: 'proforma_importacion', formalidad: 'formal', fecha_emision: '2026-09-25', vigencia: '30 días', legibilidad: 'completa' }, dolar: { usado: 967.5, fecha: '2026-09-29' } }), linea: l, lineasProyecto: [l] });
  // 2000 × 967,5 × 1,06 × 1,3 = 2.666.430 neto
  assert.equal(r.costoNetoUnitario, 2_666_430);
  assert.ok(!codigos(r.bloqueos).includes('V3'));
  assert.ok(r.alertas.some(a => a.mensaje.includes('Ruta B')));
});

test('Ruta B: Incoterm distinto de FOB o sin dólar del día bloquea con su ruta de salida', () => {
  const doc = { tipo: 'proforma_importacion', formalidad: 'formal' as const, fecha_emision: '2026-09-25', vigencia: '30 días', legibilidad: 'completa' as const };
  const exw = verificarOpcion(entrada(prod({ precio: 2_000, moneda: 'USD', incoterm: 'EXW' }), { documento: doc, dolar: { usado: 967.5, fecha: 'hoy' } }));
  assert.ok(exw.bloqueos.some(b => b.codigo === 'V3' && b.mensaje.includes('EXW')));
  const sinDolar = verificarOpcion(entrada(prod({ precio: 2_000, moneda: 'USD', incoterm: 'FOB' }), { documento: doc, dolar: null }));
  assert.ok(sinDolar.bloqueos.some(b => b.mensaje.includes('dólar')));
  // USD sin ser proforma de importación: sigue bloqueando (moneda no convertida)
  const suelta = verificarOpcion(entrada(prod({ precio: 2_000, moneda: 'USD' })));
  assert.ok(suelta.bloqueos.some(b => b.mensaje.includes('USD')));
});

test('coincidenciaIdentidad: ficha del mismo modelo, de otro modelo y sin datos', () => {
  assert.equal(coincidenciaIdentidad({ marca: 'Konica Minolta', modelo: 'LS-150' }, { marca: 'Konica Minolta', modelo: 'LS150' }), 'coincide');
  assert.equal(coincidenciaIdentidad({ marca: 'Canon', modelo: 'EOS Rebel T7' }, { marca: 'Canon', modelo: 'Canon EOS Rebel T7 Kit' }), 'coincide');
  assert.equal(coincidenciaIdentidad({ marca: 'Konica Minolta', modelo: 'LS-150' }, { marca: 'Konica Minolta', modelo: 'LS-160' }), 'distinto');
  assert.equal(coincidenciaIdentidad({ marca: 'Epson', modelo: 'E24' }, { marca: 'BenQ', modelo: 'E24' }), 'distinto');
  assert.equal(coincidenciaIdentidad({ marca: 'Canon', modelo: 'T7' }, { marca: '', modelo: '', sku: '' }), 'sin_dato');
  assert.equal(coincidenciaIdentidad({}, { marca: 'Canon', modelo: 'T7' }), 'sin_dato');
  assert.equal(coincidenciaIdentidad({ marca: 'Canon' }, { marca: 'Canon' }), 'sin_dato');
  assert.equal(coincidenciaIdentidad({ modelo: 'X1', sku: 'ABC-1' }, { modelo: '', sku: 'abc1' }), 'coincide');
});

test('precio ambiguo: bloquea y NO entra al costo ni al margen (caso Epson E24 leído a $840 millones)', () => {
  const r = verificarOpcion(entrada(prod({ precio: 840_336_134, precioAmbiguo: true })));
  assert.equal(r.costoNetoUnitario, null);
  assert.equal(r.diffPct, null);
  assert.equal(r.margen, null);
  assert.ok(codigos(r.bloqueos).includes('LECTURA'));
  assert.ok(!codigos(r.bloqueos).includes('V4'));
  assert.equal(r.veredicto, 'NO_VERIFICADO');
});

test('re-análisis: el producto viejo se reconoce en la lectura nueva por nombre o por modelo, y si no hay equivalente queda sin emparejar', () => {
  const p = (idx: number, nombre: string, marca = '', modelo = '', sku = '') => ({ idx, nombre, marca, modelo, sku });
  const nuevos = [p(0, 'Equipo Split Muro Eco Flow Inverter R32 9.000 BTUH'), p(1, 'Equipo Split Muro Eco Flow Inverter R32 12.000 BTUH'), p(2, 'Proyector Epson E24', 'Epson', 'E24')];
  assert.equal(emparejarProductoReleido(p(1, 'Equipo Split Muro Eco Flow Inverter R32 9.000 BTUH'), nuevos), 0);
  assert.equal(emparejarProductoReleido(p(4, 'equipo split muro ECO FLOW inverter r32 12.000 btuh'), nuevos), 1);
  assert.equal(emparejarProductoReleido(p(3, 'Proyector de tiro estándar Epson PowerLite E24', 'Epson', 'PowerLite E24'), nuevos), 2);
  assert.equal(emparejarProductoReleido(p(3, 'Proyector Epson PowerLite E28', 'Epson', 'PowerLite E28'), nuevos), null);
  assert.equal(emparejarProductoReleido(p(3, 'Proyector Epson', 'Epson', 'E24'), nuevos), 2);
  assert.equal(emparejarProductoReleido(p(9, 'Equipo Split Muro Eco Flow Inverter R32 36.000 BTUH'), nuevos), null);
});

test('emparejar: «12.000» es UN número; un producto de 12.000 BTUH no se cuela en el proyector que dice «12,000 horas» (caso Eco Flow)', () => {
  const proyector = linea({ id: 'proy', item: 5, detalle: 'PROYECTOR - Proyector XGA 3400 lumenes, resolución 1024x768, aspecto 4:3, lámpara vida útil 12,000 horas, conectividad HDMI y USB', costoEstimadoNeto: 402_513, costoRegistradoNeto: 402_513, cantidad: 17 });
  const aire = linea({ id: 'aire', item: 13, detalle: 'EQUIPO CLIMATIZACIÓN - Aire acondicionado split inverter 9000 BTU, sistema purificación de aire, incluye unidad interior y exterior', costoEstimadoNeto: 352_857, costoRegistradoNeto: 352_857, cantidad: 2 });
  const p9 = prod({ idx: 0, nombre: 'Equipo Split Muro Eco Flow 9.000 BTUH Inverter R32', tipo: 'Equipo Split Muro', marca: 'Eco Flow', modelo: '9.000 BTUH Inverter R32', sku: '', precio: 426_990, iva: 'incluido', cantidadCotizada: null });
  const p12 = prod({ idx: 1, nombre: 'Equipo Split Muro Eco Flow 12.000 BTUH Inverter R32', tipo: 'Equipo Split Muro', marca: 'Eco Flow', modelo: '12.000 BTUH Inverter R32', sku: '', precio: 439_990, iva: 'incluido', cantidadCotizada: null });
  const r = emparejarProductos([p9, p12], [proyector, aire]);
  assert.deepEqual(r.asignaciones.map(a => [a.productoIdx, a.filaId]), [[0, 'aire']]);
  assert.deepEqual(r.sinEmparejar, [1]);
});

test('re-análisis: el nombre se compara como conjunto de palabras (la lectura nueva cambia el orden)', () => {
  const p = (idx: number, nombre: string) => ({ idx, nombre, marca: '', modelo: '', sku: '' });
  assert.equal(emparejarProductoReleido(p(1, 'Equipo Split Muro Eco Flow Inverter R32 12.000 BTUH'), [p(0, 'Equipo Split Muro Eco Flow 9.000 BTUH Inverter R32'), p(1, 'Equipo Split Muro Eco Flow 12.000 BTUH Inverter R32')]), 1);
});

const TEXTO_MAVE = `Proyector Epson PowerLite E24 3600 Lúm. XGA 3LCD HDMI USB Altavoz.
17374.000$           
 $              6.358.000 
6.358.000$          
1.208.020$          
TOTAL7.566.020$          `;

test('precio pegado a la cantidad: «17374.000» es 17 × $374.000 porque el total del documento lo confirma (caso MAVE / Epson E24)', () => {
  assert.deepEqual(separarPrecioPegadoACantidad(TEXTO_MAVE, 17_374_000), { cantidad: 17, precioUnitario: 374_000, total: 6_358_000 });
});

test('precio pegado: sin un total que lo confirme, o con un precio que no está en el documento, NO se toca', () => {
  assert.equal(separarPrecioPegadoACantidad('Proyector Epson E24 17374.000$ sin más datos', 17_374_000), null);
  assert.equal(separarPrecioPegadoACantidad(TEXTO_MAVE, 17_000_000), null);
  assert.equal(separarPrecioPegadoACantidad('Notebook 1.204.990 total 1.204.990', 1_204_990), null);
  assert.equal(separarPrecioPegadoACantidad(TEXTO_MAVE, 900), null);
});

test('normalizarProductos con el texto del documento corrige el precio pegado y lo avisa; sin texto queda como lo leyó el Lector', () => {
  const salida: SalidaLector = { productos: [{ producto: { marca: 'Epson', modelo: 'PowerLite E24' }, comercial: { precios: [{ valor: '17.374.000', condicion: 'actual' }], iva: 'neto', iva_texto_literal: '+ IVA' } }] } as any;
  const con = normalizarProductos(salida, TEXTO_MAVE)[0];
  assert.equal(con.precio, 374_000);
  assert.equal(con.cantidadCotizada, 17);
  assert.match(con.correccion || '', /17 unidades × \$374\.000/);
  assert.equal(normalizarProductos(salida)[0].precio, 17_374_000);
  const l = linea({ cantidad: 17, costoRegistradoNeto: 402_513, costoEstimadoNeto: 402_513 });
  const v = verificarOpcion(entrada({ ...con, iva: 'neto' }, { linea: l, lineasProyecto: [l] }));
  assert.equal(v.costoNetoUnitario, 374_000);
  assert.ok(v.alertas.some(a => a.codigo === 'LECTURA' && /pegado a la cantidad/.test(a.mensaje)));
});

test('IVA sin declarar: en un LINK se asume incluido y se saca; en una cotización NO se supone', () => {
  const salida: SalidaLector = { productos: [{ comercial: { precios: [{ valor: '$569.990', condicion: 'actual' }], moneda: 'CLP', iva: 'no_declarado' }, producto: { marca: 'Aiwa', modelo: '70' } }] };
  const web = normalizarProductos(salida, '', true)[0];
  assert.equal(web.iva, 'incluido'); assert.equal(web.ivaSupuesto, true);
  const cot = normalizarProductos(salida, '', false)[0];
  assert.equal(cot.iva, 'no_declarado'); assert.equal(cot.ivaSupuesto, false);
  const neto = normalizarProductos({ productos: [{ comercial: { precios: [{ valor: '$100.000' }], iva: 'neto', iva_texto_literal: '+ IVA' } }] }, '', true)[0];
  assert.equal(neto.iva, 'neto'); assert.equal(neto.ivaSupuesto, false);
});

test('precio pegado a la cantidad: si la cuenta cuadra con el total del documento, deja de ser ambiguo aunque el Lector lo marcara así', () => {
  const salida: SalidaLector = { productos: [{ producto: { marca: 'Epson', modelo: 'PowerLite E24' }, comercial: { precios: [{ valor: '17.374.000', condicion: 'actual', numero_ambiguo: true }], iva: 'neto', iva_texto_literal: '+ IVA' } }] } as any;
  const p = normalizarProductos(salida, TEXTO_MAVE)[0];
  assert.equal(p.precio, 374_000); assert.equal(p.precioAmbiguo, false); assert.equal(p.cantidadCotizada, 17);
  assert.equal(normalizarProductos(salida)[0].precioAmbiguo, true);   // sin el texto del documento no hay cómo comprobarlo
});

test('precio de relleno ($999.999.999 de producto agotado): bloquea con mensaje propio y NO entra como costo; con el precio corregido a mano sí', () => {
  const l: any = { id: 'f', item: 5, lineaReal: 5, detalle: 'PROYECTOR', cantidad: 17, costoEstimadoNeto: 402_513, margen: 20 };
  const prod = (precio: number, extra: any = {}): any => ({ idx: 0, nombre: 'Epson E24', tipo: '', marca: 'Epson', modelo: 'E24', version: '', sku: '', precio, preciosMultiples: [], precioAmbiguo: true, moneda: 'CLP', iva: 'incluido', ivaTexto: 'IVA incluido', unidadPrecio: '', contenidoEmpaque: '', unidadesPorEmpaque: null, cantidadCotizada: null, moq: null, stock: '', plazoTexto: '', plazoDias: null, tipoDias: 'no_declarado', despacho: '', incoterm: '', costosAdicionales: [], garantia: '', condiciones: [], esCargo: false, ...extra });
  const malo = verificarOpcion({ linea: l, lineasProyecto: [l], producto: prod(999_999_999), documento: { tipo: 'link_web' } as any, proveedor: {}, opcion: { marca: 'Epson', modelo: 'E24' }, hoyISO: '2026-09-30' });
  assert.equal(malo.costoNetoUnitario, null);
  assert.match(malo.bloqueos.find(b => b.codigo === 'LECTURA')!.mensaje, /relleno/);
  // corrección manual: el producto llega con el precio fijado y sin ambigüedad (así lo arma armarPanelAuditor)
  const bueno = verificarOpcion({ linea: l, lineasProyecto: [l], producto: prod(449_990, { precioAmbiguo: false }), documento: { tipo: 'link_web' } as any, proveedor: {}, opcion: { marca: 'Epson', modelo: 'E24' }, hoyISO: '2026-09-30' });
  assert.ok(bueno.costoNetoUnitario != null && bueno.costoNetoUnitario > 300_000);
});

test('modelosParecidos: una letra de diferencia con la misma marca (WM-2802V/W) es casi seguro el mismo producto; modelos realmente distintos no', () => {
  assert.equal(modelosParecidos({ marca: 'Baretone', modelo: 'WM-2802V' }, { marca: 'BARETONE', modelo: 'WM-2802W' }), true);
  assert.equal(modelosParecidos({ marca: 'Baretone', modelo: 'WM-2802V' }, { marca: 'Baretone', modelo: 'WM-2802V' }), false);   // iguales: no es «parecido», es lo mismo
  assert.equal(modelosParecidos({ marca: 'Epson', modelo: 'E24' }, { marca: 'Epson', modelo: 'E25' }), false);                    // modelo demasiado corto: puede ser otro
  assert.equal(modelosParecidos({ marca: 'Baretone', modelo: 'WM-2802V' }, { marca: 'Sony', modelo: 'WM-2802W' }), false);       // otra marca
  assert.equal(modelosParecidos({ marca: 'Benq', modelo: 'MX560C' }, { marca: 'Benq', modelo: 'MX631ST' }), false);
});

test('link de tienda: «$119.000 +IVA» NO se parte en 11 × $9.000 aunque otro producto de la página valga $99.000 (donlocker, compra 415)', () => {
  const texto = 'Storage 2 Puertas Metálico\n$119.000 +IVA\nProductos relacionados\nRopero 2 Puertas Metálico\n$99.000 +IVA';
  const salida = { productos: [{ comercial: { precios: [{ valor: '$119.000', condicion: 'actual', cita: 'x' }], iva: 'neto', iva_texto_literal: '+IVA' }, producto: { modelo: 'Storage 2 Puertas' } }] } as unknown as SalidaLector;
  assert.equal(normalizarProductos(salida, texto, true)[0].precio, 119_000);
  assert.equal(normalizarProductos(salida, texto, true)[0].cantidadCotizada, null);
});

// Regla 3b del IVA (27-oct-2026, horno Unox de 1414396-26-LP26): el pie «Subtotal + IVA 19% = Total» prueba que los precios son netos.
test('IVA 3b: Subtotal + IVA 19% = Total → precios netos; si no cuadra, sigue sin definir', () => {
  const pie = 'TG405 | Bandeja Unox Bake 60x40 cms | $41.742 | 0% | $41.742 | 4 | $166.968\nEnvío ‖ $210.745\nSubtotal | $3.953.475\nIVA | $751.160\nTotal | $4.704.635\nComentario: …';
  assert.match(ivaPorTotalesDelDocumento(pie)!, /Subtotal \$3\.953\.475 \+ IVA 19% \$751\.160 = Total \$4\.704\.635/);
  assert.match(ivaPorTotalesDelDocumento('Total neto: $100.000\nI.V.A. (19%): $19.000\nTotal a pagar: $119.000')!, /netos/);
  assert.equal(ivaPorTotalesDelDocumento('Subtotal | $3.953.475\nIVA | $700.000\nTotal | $4.653.475'), null, 'el IVA no es el 19%');
  assert.equal(ivaPorTotalesDelDocumento('Subtotal | $100.000\nTotal | $119.000'), null, 'sin línea de IVA no se decide');
  assert.equal(ivaPorTotalesDelDocumento('Precio $119.000 IVA incluido'), null);

  const salida: any = { productos: [{ producto: { tipo: 'Horno' }, comercial: { precios: [{ valor: '$3.142.840' }], iva: 'no_declarado' } }] };
  const [p] = normalizarProductos(salida, pie);
  assert.equal(p.iva, 'neto');
  assert.match(p.ivaTexto, /Subtotal/);
  assert.equal(normalizarProductos(salida, pie, true)[0].iva, 'incluido', 'una página web sigue con su propia regla');
});

test('un set de 14 brocas es UNA unidad: sus piezas no dividen el precio (Makita D-71956, 2446-307-LE26)', () => {
  const salida = (empaque: string, unidades: string, tipo = 'Set brocas SDS-Plus') => ({
    documento: { tipo: 'pagina_web' },
    productos: [{ es_producto_principal: true, producto: { tipo, marca: 'MAKITA', modelo: 'D-71956' },
      comercial: { precios: [{ valor: '$17.990', condicion: 'actual', seleccionada: true }], moneda: 'CLP', iva: 'incluido', iva_texto_literal: '$17.990 IVA incluido', contenido_empaque: empaque, unidades_por_empaque: unidades } }],
  }) as unknown as SalidaLector;
  const set = normalizarProductos(salida('Set de 14 brocas SDS-Plus TCT', '14'), '', true)[0];
  assert.equal(set.unidadesPorEmpaque, null);
  const lin = linea({ detalle: 'Set de brocas SDS Plus, makita o equivalente, 14 piezas', cantidad: 2, costoEstimadoNeto: 15_118 });
  const v = verificarOpcion(entrada({ ...set, precio: 17_990, iva: 'incluido', ivaSupuesto: false } as ProductoNormalizado, { linea: lin, opcion: { marca: 'MAKITA', modelo: 'D-71956' } }));
  assert.equal(v.costoNetoUnitario, 15_118);
  // una caja de 10 unidades sueltas SÍ divide; una caja de 6 sets también
  assert.equal(normalizarProductos(salida('Caja de 10 unidades', '10', 'Guante'), '', true)[0].unidadesPorEmpaque, 10);
  assert.equal(normalizarProductos(salida('Caja de 6 sets de brocas', '6'), '', true)[0].unidadesPorEmpaque, 6);
  assert.equal(normalizarProductos(salida('Unidades por caja: 12 unidades. Juego de sábanas', '12'), '', true)[0].unidadesPorEmpaque, 12);
});

test('si la línea pide el empaque entero no se divide (2446-307-LE26 L31 «Caja de 100 un» salía $87)', () => {
  assert.equal(factorSegunLinea(100, 'Caja de 100 un de tornillo autoperforante cabeza hexagonal 2"'), null);
  assert.equal(factorSegunLinea(10, 'Pack 10 unidades de disco de lija con velcro 125 mm g 120'), null);
  assert.equal(factorSegunLinea(14, 'Set de brocas SDS Plus, 14 piezas'), null);
  assert.equal(factorSegunLinea(10, 'Guante de seguridad talla L'), 10, 'línea de unidad suelta: sí divide');
  assert.equal(factorSegunLinea(12, 'Tornillo 2" (se compran 120 en total)'), 12, '120 no es 12');
});

test('cotización: la cantidad de la fila no es «unidades por empaque» (PC Factory ext 472: 5 × $909.655 salía $181.931)', () => {
  const salida = { documento: { tipo: 'cotizacion' }, productos: [{ es_producto_principal: true, producto: { tipo: 'Asus All in One', sku_proveedor: '55153' },
    comercial: { precios: [{ valor: '909.655', condicion: 'actual', cita: 'p.1' }], moneda: 'CLP', unidad_precio: 'unid.', unidades_por_empaque: '5', iva: 'no_declarado' } }] } as unknown as SalidaLector;
  assert.equal(normalizarProductos(salida, '')[0].unidadesPorEmpaque, null);
});

test('cotización: un código de producto no es precio y el unitario es el que divide el total de la línea (Locker Plus ext 473)', () => {
  const precios = [{ valor: '10304040004', condicion: 'neto' }, { valor: '52.990', condicion: 'neto' }, { valor: '49.281', condicion: 'con descuento', detalle_condicion: '7 %' }, { valor: '4.928.100', condicion: 'total neto' }];
  const salida = { documento: { tipo: 'cotizacion' }, productos: [{ es_producto_principal: true, producto: { tipo: 'Barrera recta', sku_proveedor: 'DEF-61A', ean: '10304040004' },
    comercial: { precios, moneda: 'CLP', unidades_por_empaque: '100', iva: 'no_declarado' } }] } as unknown as SalidaLector;
  const [p] = normalizarProductos(salida, '');
  assert.equal(p.precio, 49_281);
  assert.equal(p.unidadesPorEmpaque, null);
});

test('IVA 3b: el pie se encuentra aunque haya un «Total Neto» de encabezado, un «Total» sin salto de línea o separadores ‖', () => {
  assert.match(ivaPorTotalesDelDocumento('Cant | Total Neto 100 | x\nSubtotal | 6.899.340\nIVA | 1.310.875\nTotal | 8.210.215') ?? '', /netos/);
  assert.match(ivaPorTotalesDelDocumento('Subtotal | $4.474.904 Garantia 1 año\nIva | $850.232 PRECIO NO INCLUYE TRASLADO | Total | $5.325.136') ?? '', /netos/);
  assert.match(ivaPorTotalesDelDocumento('neto ‖ $ 11.614.113 IVA 19% ‖ $ 2.206.681 Total ‖ $ 13.820.794') ?? '', /netos/);
  assert.equal(ivaPorTotalesDelDocumento('Subtotal 1.000.000\nIVA 190.000\nTotal 1.300.000'), null, 'si no cuadra no se supone');
});
