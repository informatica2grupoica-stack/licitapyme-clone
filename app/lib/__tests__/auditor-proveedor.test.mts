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
    capturas: [], estadoLink: null, mercado: null, costoIA: null, correccionCosto: null,
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

// Comparador técnico v3.0: el mensaje lleva SOLO preguntas técnicas (máx. 3 por proveedor), nunca IVA, vigencia, stock, plazo ni datos de la empresa.
const conPreguntas = (o: OpcionDTO, textos: string[]): OpcionDTO => ({ ...o, tecnico: { ...o.tecnico, estado: 'CON_PENDIENTES', resultado: { preguntas: textos.map(t => ({ n: 0, texto: t, bloquea: true })) } as any } });

test('mensaje: solo las preguntas técnicas del comparador, sin IVA ni vigencia ni datos de la empresa', () => {
  const o = conPreguntas(opcion(1, prod()), ['¿Nos pueden enviar la ficha técnica del fabricante del Benq MX560C?']);
  const [m] = mensajesUnificadosPorProveedor([linea([o])]);
  assert.ok(m, 'debe generar un mensaje');
  assert.equal(m.bloquea, true);
  assert.match(m.texto, /^Hola Alvaro/);
  assert.match(m.texto, /N° 100\.084\.222/);
  assert.match(m.texto, /ficha técnica del fabricante del Benq MX560C/);
  assert.doesNotMatch(m.texto, /IVA|revalidar|vigencia|stock|plazo|registrarlos como proveedor|cuenta bancaria|giro/i);
  assert.equal(m.email, 'apena@pcfactory.cl');
  assert.equal(m.preguntas, 1);
});

test('mensaje: UN solo mensaje por proveedor aunque tenga varias opciones, con las preguntas de todas', () => {
  const o1 = conPreguntas(opcion(1, prod()), ['¿Nos pueden enviar la ficha técnica del fabricante del Benq MX560C?']);
  const o2 = conPreguntas(opcion(2, prod({ idx: 1, nombre: 'Webcam Kensington W2000', marca: 'Kensington', modelo: 'W2000', tipo: 'Webcam', precio: 53_101 }), { filaId: 'f5' }), ['¿La webcam Kensington W2000 tiene zoom digital?']);
  const ms = mensajesUnificadosPorProveedor([linea([o1, o2])]);
  assert.equal(ms.length, 1);
  assert.deepEqual(ms[0].opcionIds, [1, 2]);
  assert.match(ms[0].texto, /Benq MX560C/);
  assert.match(ms[0].texto, /Kensington W2000/);
});

test('mensaje: máximo 3 preguntas por proveedor, y las que piden ficha van primero', () => {
  const o = conPreguntas(opcion(1, prod()), ['¿Tiene puerto USB?', '¿Tiene HDMI?', '¿Trae control remoto?', '¿Nos pueden enviar la ficha técnica del fabricante del Benq MX560C?', '¿Tiene altavoz?']);
  const [m] = mensajesUnificadosPorProveedor([linea([o])]);
  assert.equal(m.preguntas, 3);
  assert.match(m.texto, /1\. ¿Nos pueden enviar la ficha técnica/);
  assert.doesNotMatch(m.texto, /\n4\. /);
});

test('mensaje: no incluye opciones descartadas ni proveedores sin nada que preguntar', () => {
  const descartada = conPreguntas(opcion(1, prod(), { estado: 'descartada' }), ['¿Tiene HDMI?']);
  assert.equal(mensajesUnificadosPorProveedor([linea([descartada])]).length, 0);
  assert.equal(mensajesUnificadosPorProveedor([linea([opcion(2, prod())])]).length, 0);   // sin preguntas técnicas no hay mensaje (ni por IVA ni por vigencia)
});

test('preguntas de una opción: son exactamente las técnicas del comparador', () => {
  const o = conPreguntas(opcion(1, prod({ cantidadCotizada: 10 })), ['¿Tiene HDMI?']);
  assert.deepEqual(preguntasDeOpcion(o, linea([o])).map(q => q.texto), ['¿Tiene HDMI?']);
  assert.deepEqual(preguntasDeOpcion(opcion(2, prod()), linea([])), []);
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

test('mensaje: la misma empresa con distinto nombre (Spa/SpA, tienda/razón social) recibe UN solo mensaje', () => {
  const cot = opcion(1, prod(), { proveedorRazonSocial: 'Sociedad de Inversiones Audiofans Spa', proveedorRut: '76.773.918-4' });
  const link = opcion(2, prod({ idx: 1, nombre: 'SKP UHF 600 PRO', marca: 'SKP', modelo: 'UHF 600 PRO', precio: 138_990 }), { proveedorRazonSocial: 'Sociedad de Inversiones Audiofans SpA', proveedorRut: null });
  const foto = opcion(3, prod({ idx: 2 }), { proveedorRazonSocial: 'HorizontalFoto', proveedorRut: null });
  const horizontal = opcion(4, prod({ idx: 3 }), { proveedorRazonSocial: 'HORIZONTAL SPA', proveedorRut: '76.895.668-5' });
  const otra = opcion(5, prod({ idx: 4 }), { proveedorRazonSocial: 'Dinon Tecnología', proveedorRut: null });
  const q = (o: OpcionDTO) => conPreguntas(o, ['¿Nos pueden enviar la ficha técnica del fabricante?']);
  const ms = mensajesUnificadosPorProveedor([linea([q(cot), q(link), q(foto), q(horizontal), q(otra)])]);
  assert.equal(ms.length, 3);
  assert.deepEqual(ms.map(m => m.opcionIds.sort()).sort(), [[1, 2], [3, 4], [5]]);
});

test('mensaje: dos proveedores con RUT distinto no se juntan aunque el nombre se parezca', () => {
  const a = opcion(1, prod(), { proveedorRazonSocial: 'Tecnología Norte Ltda', proveedorRut: '76.111.111-1' });
  const b = opcion(2, prod({ idx: 1 }), { proveedorRazonSocial: 'Tecnología Norte SpA', proveedorRut: '77.222.222-2' });
  const q = (o: OpcionDTO) => conPreguntas(o, ['¿Tiene HDMI?']);
  assert.equal(mensajesUnificadosPorProveedor([linea([q(a), q(b)])]).length, 2);
});
