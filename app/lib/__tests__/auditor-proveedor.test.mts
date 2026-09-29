// Tests del mensaje único por proveedor y del mapeo a formato OBUMA del AUDITOR (puro, sin red ni IA).
// Correr con: npx tsx --test app/lib/__tests__/auditor-proveedor.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rutValido, mensajesUnificadosPorProveedor, proveedorOBUMA, productoOBUMA, preguntasDeOpcion, aCSV } from '../auditor-proveedor';
import { verificarOpcion, type ProductoNormalizado } from '../auditor-opciones-core';
import type { LineaCosteo } from '../auditor-compras-core';
import type { OpcionDTO, LineaAuditorDTO } from '../auditor-opciones';

const lineaC = (o: Partial<LineaCosteo> = {}): LineaCosteo => ({
  id: 'f5', item: 5, lineaReal: 5, grupo: 'Costeo', detalle: 'PROYECTOR - Proyector XGA 3400 lumenes', unidad: 'Unidad', sku: '',
  cantidad: 17, valorConIva: 478_990, costoRealUnitario: null, links: [], esGastoExtra: false, ofertamos: true,
  costoEstimadoNeto: 402_513, costoRegistradoNeto: 402_513, precioVentaUnitario: 520_000, ...o,
});
const prod = (o: Partial<ProductoNormalizado> = {}): ProductoNormalizado => ({
  idx: 0, nombre: 'Proyector Benq MX560C', tipo: 'Proyector', marca: 'Benq', modelo: 'MX560C', version: '', sku: '1756051',
  precio: 346_546, preciosMultiples: [], precioAmbiguo: false, moneda: 'CLP', iva: 'no_declarado', ivaTexto: 'I.V.A 19%',
  unidadPrecio: '', contenidoEmpaque: '', unidadesPorEmpaque: null, cantidadCotizada: null, moq: null,
  stock: '', plazoTexto: '', plazoDias: null, tipoDias: 'no_declarado', despacho: '', incoterm: '', costosAdicionales: [], garantia: '', condiciones: [], esCargo: false, ...o,
});
const opcion = (id: number, p: ProductoNormalizado, extra: Partial<OpcionDTO> = {}, doc: any = { formalidad: 'formal', fecha_emision: '22 de Septiembre de 2026', vigencia: '24 de Septiembre de 2026 12:52', legibilidad: 'completa' }): OpcionDTO => {
  const l = lineaC();
  return {
    id, filaId: 'f5', marca: p.marca, modelo: p.modelo, version: null, sku: p.sku, proveedorRazonSocial: 'PERSONAL COMPUTER FACTORY S.A.', proveedorRut: '78.885.550-8',
    via: 'completa', estado: 'formalizada', motivoDescarte: null, firmadaPorNombre: null, firmadaAt: null, creadoAt: '',
    respaldos: [{ id: 1, tipo: 'cotizacion_formal', documentoUrl: 'https://x/c.pdf', documentoNombre: 'c.pdf', url: null, precioDeclarado: p.precio, precioIva: p.iva, vigente: true, sostieneCosto: true, cargadoAt: '', cargadoPorNombre: null, extraccionId: 1, productoIdx: 0 }],
    producto: p,
    verificacion: verificarOpcion({ linea: l, lineasProyecto: [l], producto: p, documento: doc, proveedor: {}, opcion: { marca: p.marca, modelo: p.modelo }, hoyISO: '2026-09-29' }),
    proveedorDatos: { razon_social: { valor: 'PERSONAL COMPUTER FACTORY S.A.' }, rut: { valor: '78.885.550-8' }, vendedor: { valor: 'Alvaro Peña P.' }, email: { valor: 'apena@pcfactory.cl' }, condiciones_pago: { valor: 'Deposito' } },
    documentoInfo: { numero: '100.084.222', fechaEmision: '22 de Septiembre de 2026', tipo: 'cotizacion_formal' },
    capturas: [], estadoLink: null,
    tecnico: { estado: 'NO_CORRIDO', corridoAt: null, error: null, segundaPasadaAt: null, requisitosTotal: 0, resultado: null },
    ...extra,
  };
};
const linea = (opciones: OpcionDTO[]): LineaAuditorDTO => ({ filaId: 'f5', item: 5, lineaReal: 5, detalle: 'PROYECTOR - Proyector XGA 3400 lumenes', unidad: 'Unidad', cantidad: 17, costeadoNeto: 402_513, precioVentaUnitario: 520_000, links: [], opciones, opcionDefinitivaId: null, noOfertada: false, motivoNoOfertada: null, exigeViaCompleta: false });

test('rutValido: dígito verificador módulo 11', () => {
  assert.equal(rutValido('78.885.550-8'), true);
  assert.equal(rutValido('76.895.668-5'), true);
  assert.equal(rutValido('77.085.964-6'), true);
  assert.equal(rutValido('76.895.668-4'), false);
  assert.equal(rutValido('12345'), false);
  assert.equal(rutValido(''), false);
  assert.equal(rutValido('11.111.111-1'), true);
});

test('mensaje: pregunta lo que bloquea primero (IVA, mínimo), luego alertas, y al final los datos del proveedor', () => {
  const [m] = mensajesUnificadosPorProveedor([linea([opcion(1, prod())])]);
  assert.ok(m, 'debe generar un mensaje');
  assert.equal(m.bloquea, true);
  const iBloq = m.texto.indexOf('neto o incluye IVA'), iAlerta = m.texto.indexOf('revalidar'), iDatos = m.texto.indexOf('registrarlos como proveedor');
  assert.ok(iBloq > 0 && iAlerta > iBloq && iDatos > iAlerta, `orden incorrecto: ${iBloq} ${iAlerta} ${iDatos}`);
  assert.match(m.texto, /^Hola Alvaro/);
  assert.match(m.texto, /N° 100\.084\.222/);
  assert.match(m.texto, /Benq MX560C/);
  assert.match(m.texto, /giro|dirección|cuenta bancaria/);   // faltantes del proveedor
  assert.equal(m.email, 'apena@pcfactory.cl');
});

test('mensaje: UN solo mensaje por proveedor aunque tenga varias opciones', () => {
  const o1 = opcion(1, prod());
  const o2 = opcion(2, prod({ idx: 1, nombre: 'Webcam Kensington W2000', marca: 'Kensington', modelo: 'W2000', tipo: 'Webcam', precio: 53_101 }), { filaId: 'f5' });
  const ms = mensajesUnificadosPorProveedor([linea([o1, o2])]);
  assert.equal(ms.length, 1);
  assert.deepEqual(ms[0].opcionIds, [1, 2]);
  assert.match(ms[0].texto, /Benq MX560C/);
  assert.match(ms[0].texto, /Kensington W2000/);
});

test('mensaje: no incluye opciones descartadas ni proveedores sin nada que preguntar', () => {
  const descartada = opcion(1, prod(), { estado: 'descartada' });
  assert.equal(mensajesUnificadosPorProveedor([linea([descartada])]).length, 0);
});

test('preguntas: cotizar menos unidades que las pedidas y vigencia vencida', () => {
  const o = opcion(1, prod({ iva: 'neto', ivaTexto: '+ IVA', cantidadCotizada: 10 }));
  const t = preguntasDeOpcion(o, linea([o])).map(q => q.texto).join('\n');
  assert.match(t, /10 unidades y necesitamos 17/);
  assert.match(t, /venció|ya venció/);
});

test('OBUMA proveedor: RUT válido, catálogo va como pendiente (no se adivina el ID) y observación con bodega y licitación', () => {
  const o = opcion(1, prod(), { proveedorDatos: { razon_social: { valor: 'PCF' }, rut: { valor: '78.885.550-8' }, comuna: { valor: 'Santiago' }, region: { valor: 'RM' }, condiciones_pago: { valor: 'Crédito 30 días' }, direccion_bodega: { valor: 'Av. X 123' }, transferencia: { banco: 'Banco Estado', numero_cuenta: '999', tipo_cuenta: 'Cuenta Corriente' } } });
  const f = proveedorOBUMA(o, '759-21-LE26', '2026-09-29');
  assert.equal(f.columnas.proveedor_rut, '78.885.550-8');
  assert.equal(f.columnas.proveedor_comuna, '');
  assert.equal(f.columnas.proveedor_banco_cuenta, '');
  assert.equal(f.columnas.proveedor_nro_cuenta, '999');
  assert.equal(f.columnas.proveedor_diasdepago, '30');
  assert.equal(f.columnas.proveedor_pais, 'Chile');
  assert.equal(f.columnas.proveedor_extranjero, 0);
  assert.match(String(f.columnas.proveedor_observacion), /Bodega\/retiro: Av\. X 123 · Licitación 759-21-LE26 · 2026-09-29/);
  assert.ok(f.pendientes_catalogo.some(x => x.includes('Santiago')) && f.pendientes_catalogo.some(x => x.includes('Banco Estado')));
  assert.equal(f.avisos.length, 0);
});

test('OBUMA proveedor: RUT con dígito verificador inválido genera aviso', () => {
  const f = proveedorOBUMA(opcion(1, prod(), { proveedorRut: '78.885.550-1' }), 'X', '2026-09-29');
  assert.ok(f.avisos.some(a => a.includes('dígito verificador')));
});

test('OBUMA producto: costo neto verificado y rel_proveedor_id vacío (se resuelve después)', () => {
  const o = opcion(1, prod({ iva: 'neto', ivaTexto: '+ IVA', unidadesPorEmpaque: 10 }));
  const f = productoOBUMA(o, linea([o]));
  assert.equal(f.columnas.producto_fabricante, 'Benq');
  assert.equal(f.columnas.producto_modelo, 'MX560C');
  assert.equal(f.columnas.producto_costo_clp_neto, o.verificacion!.costoNetoUnitario as number);
  assert.equal(f.columnas.producto_unidad_medida_factor_conversion, 10);
  assert.equal(f.columnas.rel_proveedor_id, '');
});

test('OBUMA producto: sin costo verificado avisa y deja la columna vacía', () => {
  const f = productoOBUMA(opcion(1, prod()), linea([]));
  assert.equal(f.columnas.producto_costo_clp_neto, '');
  assert.ok(f.avisos.length > 0);
});

test('aCSV: separador ; y comillas escapadas', () => {
  assert.equal(aCSV([{ a: 'x;y', b: 'dice "hola"', c: 3 }]), 'a;b;c\n"x;y";"dice ""hola""";3');
  assert.equal(aCSV([]), '');
});

test('mensaje: el plazo de entrega se pregunta UNA vez por proveedor, nombrando los productos', () => {
  const sinPlazo = (id: number, nombre: string, modelo: string) => opcion(id, prod({ nombre, modelo, marca: 'X', iva: 'neto', ivaTexto: '+ IVA', plazoTexto: '', cantidadCotizada: 17 }), {}, { formalidad: 'formal', fecha_emision: '2026-09-28', vigencia: '30 días', legibilidad: 'completa' });
  const ms = mensajesUnificadosPorProveedor([linea([sinPlazo(1, 'Proyector A', 'A1'), sinPlazo(2, 'Proyector B', 'B2')])]);
  assert.equal(ms.length, 1);
  assert.equal((ms[0].texto.match(/plazo de entrega/g) || []).length, 1);
  assert.match(ms[0].texto, /X A1; X B2/);
});
