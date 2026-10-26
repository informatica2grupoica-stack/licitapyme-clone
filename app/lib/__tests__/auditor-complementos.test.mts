import test from 'node:test';
import assert from 'node:assert/strict';
import { sugerenciasDeComplementos, plegarComplementos, sumaPorUnidad, esPropiaEmpresa, limpiarProveedorPropio, instalacionDe, envioDe } from '../auditor-complementos-core';

// Extracción real (recortada) de «Cotizacion_783881756 ultima con bandeja.pdf» — 1414396-26-LP26, línea 7 (horno Unox), 26-oct-2026.
const salida: any = {
  proveedor: { razon_social: { valor: 'Comercial Mp Spa', cita: 'encabezado' }, rut: { valor: '78.388.175-6', cita: 'encabezado' }, comuna: { valor: 'Talagante', cita: '' } },
  productos: [
    { producto: { tipo: 'Horno convector', marca: 'Unox', modelo: 'Bakerlux Shop.Pro Touch Rossella - Wifi' }, comercial: { iva: 'no_declarado', precios: [
      { valor: '$3.142.840', condicion: 'actual' }, { valor: '$91.142', condicion: 'otro', detalle_condicion: 'instalación' }, { valor: '$3.233.982', condicion: 'otro', detalle_condicion: 'precio total del ítem (cantidad 1, incluye instalación)' }],
      condiciones_generales: [{ texto: 'cantidad cotizada: 1' }] } },
    { producto: { tipo: 'Sistema de osmosis inversa', modelo: 'para modelo Bakerlux shop pro' }, comercial: { iva: 'no_declarado', precios: [
      { valor: '$320.000', condicion: 'actual' }, { valor: '$9.280', condicion: 'otro', detalle_condicion: 'instalación' }], condiciones_generales: [{ texto: 'cantidad cotizada: 1' }] } },
    { producto: { tipo: 'Enchufe', modelo: 'macho volante 5x16A Trifásico' }, comercial: { iva: 'no_declarado', precios: [{ valor: '$12.500', condicion: 'actual' }], condiciones_generales: [{ texto: 'cantidad cotizada: 1' }] } },
    { producto: { tipo: 'Bandeja', marca: 'Unox', modelo: 'Bake 60x40 cms' }, comercial: { iva: 'no_declarado', precios: [
      { valor: '$41.742', condicion: 'actual' }, { valor: '$166.968', condicion: 'otro', detalle_condicion: 'precio total del ítem (cantidad 4)' }], condiciones_generales: [{ texto: 'cantidad cotizada: 4' }] } },
  ],
  observaciones: ['Envío cobrado como línea aparte: $210.745 (cita: línea \'Envío\' bajo la tabla de ítems). No se indica a qué ítem corresponde.'],
};
const data = { salida, texto: '' };

test('instalación y envío se leen de donde los deja el Lector', () => {
  assert.equal(instalacionDe(salida, 0), 91_142);
  assert.equal(instalacionDe(salida, 1), 9_280);
  assert.equal(instalacionDe(salida, 2), null);
  assert.equal(envioDe(salida), 210_745);
});

test('sugerencias para el horno: su instalación, los otros productos (con su instalación y cantidad) y el envío', () => {
  const s = sugerenciasDeComplementos(data, 0);
  const por = Object.fromEntries(s.map(x => [x.clave, x.porUnidad]));
  assert.deepEqual(por, { 'i:0': 91_142, 'p:1': 329_280, 'p:2': 12_500, 'p:3': 166_968, 'e:envio': 210_745 });
  // Todo junto + el horno = el subtotal neto del documento.
  assert.equal(3_142_840 + Object.values(por).reduce((a, b) => a + b, 0), 3_953_475);
});

test('lo ya sumado no se vuelve a ofrecer', () => {
  assert.deepEqual(sugerenciasDeComplementos(data, 0, new Set(['p:1', 'e:envio'])).map(x => x.clave), ['i:0', 'p:2', 'p:3']);
});

test('con varias unidades del principal en la cotización, lo demás se reparte entre ellas', () => {
  const dos = JSON.parse(JSON.stringify(salida));
  dos.productos[0].comercial.condiciones_generales = [{ texto: 'cantidad cotizada: 2' }];
  const por = Object.fromEntries(sugerenciasDeComplementos({ salida: dos, texto: '' }, 0).map(x => [x.clave, x.porUnidad]));
  assert.equal(por['p:3'], 83_484);      // 4 bandejas para 2 hornos = 2 por horno
  assert.equal(por['e:envio'], 105_373); // envío repartido
});

test('plegar eventos: poner, reemplazar y quitar; la suma por unidad', () => {
  const cs = plegarComplementos([
    { accion: 'poner', clave: 'p:1', porUnidad: 329_280 }, { accion: 'poner', clave: 'p:3', porUnidad: 166_968 },
    { accion: 'quitar', clave: 'p:1' }, { accion: 'poner', clave: 'e:envio', porUnidad: 210_745 },
  ] as any);
  assert.deepEqual(cs.map(c => c.clave), ['p:3', 'e:envio']);
  assert.equal(sumaPorUnidad(cs), 377_713);
});

test('la propia empresa como «proveedor» se reconoce por RUT o razón social, y se limpia', () => {
  const propias = [{ rut: '78.388.175-6', razon_social: 'Comercial MP SpA' }, { rut: '76.902.659-2', razon_social: 'Inversiones Claro ARZ SPA' }];
  assert.equal(esPropiaEmpresa({ rut: '783881756', razon: null }, propias), true);
  assert.equal(esPropiaEmpresa({ rut: null, razon: 'COMERCIAL MP S.p.A.' }, propias), true);
  assert.equal(esPropiaEmpresa({ rut: '76.123.456-7', razon: 'Omnitec Ltda' }, propias), false);
  const s = JSON.parse(JSON.stringify(salida));
  assert.equal(limpiarProveedorPropio(s, propias), true);
  assert.equal(s.proveedor.razon_social.valor, '');
  assert.equal(s.proveedor.rut.valor, '');
  assert.match(s.proveedor.otra_empresa_en_documento.rol, /nuestra propia empresa/);
  assert.match(s.observaciones.at(-1), /Revisa quién cotiza/);
  assert.equal(limpiarProveedorPropio(s, propias), false, 'ya limpio: no cambia de nuevo');
});
