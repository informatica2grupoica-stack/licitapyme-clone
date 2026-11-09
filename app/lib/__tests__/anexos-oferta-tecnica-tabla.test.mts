// Regresión de la tabla «PRODUCTO | ESPECIFICACIÓN | CANTIDAD» en blanco (anexos-oferta-tecnica-tabla.ts).
//
// Caso real 4022-19-LE26 (Municipalidad de Putre), Anexo 3 «Oferta técnica»: 14 filas vacías y el
// costeo con 7 productos. Antes la tabla salía vacía; ahora el producto i del costeo va en la fila i.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolverTablaProductosEnBlanco, nombreDeProductoParaAnexo, fichaDeProducto, textoEspecificacionDeFicha } from '../anexos-oferta-tecnica-tabla';
import type { FichaLineaAuditor } from '../anexos-auditor-fuente';
import type { TablaCruda, CeldaTablaCruda } from '../anexos-detectar';
import type { ItemCosteoPrecio } from '../motor-comercial';

let n = 0;
const celda = (texto = ''): CeldaTablaCruda => {
  const k = ++n;
  return { texto, indiceGlobal: texto ? null : k, anchoPct: 1000, ultimoParaId: `P${k}`, indicesParrafos: [k] };
};
const fila = (...t: string[]) => ({ celdas: t.map(x => celda(x)) });
const tabla = (header: string[], filas: number, rellenar?: (i: number) => string[]): TablaCruda => ({
  indicePrimero: 0,
  filas: [fila(...header), ...Array.from({ length: filas }, (_, i) => fila(...(rellenar ? rellenar(i) : header.map(() => ''))))],
});

const item = (descripcion: string, cantidad: number | null, precioUnitario = 1000): ItemCosteoPrecio => ({ descripcion, precioUnitario, unidad: 'unidades', cantidad });
const ITEMS_REALES = [
  item('Batería Litio NiMac 12.8v 100ah Ciclo Profundo Energía Solar - NiMac 12.8v 100ah', 15),
  item('Panel Solar Enertik Policristalino 120W - Enertik Policristalino 120W', 8),
  item('TUBO 4" X 3MM X 6 METROS GALVANIZADO', 10),
];
const COLS = ['PRODUCTO', 'ESPECIFICACIÓN', 'CANTIDAD'];

test('escribe producto y cantidad del costeo fila a fila y deja la especificación sin tocar', () => {
  const t = tabla(COLS, 14);
  const r = resolverTablaProductosEnBlanco([t], ITEMS_REALES);
  assert.deepEqual(r.map(x => [x.etiqueta, x.valor]), [
    ['PRODUCTO', 'Batería Litio NiMac 12.8v 100ah Ciclo Profundo Energía Solar'], ['CANTIDAD', '15'],
    ['PRODUCTO', 'Panel Solar Enertik Policristalino 120W'], ['CANTIDAD', '8'],
    ['PRODUCTO', 'TUBO 4" X 3MM X 6 METROS GALVANIZADO'], ['CANTIDAD', '10'],
  ]);
  // Cada valor cae en la celda de su columna y de su fila (el producto 2 en la fila 2).
  assert.equal(r[2].indiceGlobal, t.filas[2].celdas[0].indiceGlobal);
  assert.equal(r[3].indiceGlobal, t.filas[2].celdas[2].indiceGlobal);
  assert.ok(!r.some(x => x.indiceGlobal === t.filas[1].celdas[1].indiceGlobal), 'la especificación no se escribe');
});

test('un ítem sin cantidad escribe el producto pero no inventa la cantidad', () => {
  const r = resolverTablaProductosEnBlanco([tabla(COLS, 3)], [item('FLETE', null)]);
  assert.deepEqual(r.map(x => x.etiqueta), ['PRODUCTO']);
});

test('con más productos que filas no escribe nada (una oferta a medias que parece completa)', () => {
  assert.deepEqual(resolverTablaProductosEnBlanco([tabla(COLS, 2)], ITEMS_REALES), []);
});

test('una tabla con texto en sus filas de datos no se toca (cada fila ya nombra su producto)', () => {
  const t = tabla(COLS, 3, i => (i === 0 ? ['Batería', '', ''] : ['', '', '']));
  assert.deepEqual(resolverTablaProductosEnBlanco([t], ITEMS_REALES), []);
});

test('sin columna de especificación, o con columna de precio, no es el anexo técnico', () => {
  assert.deepEqual(resolverTablaProductosEnBlanco([tabla(['PRODUCTO', 'CANTIDAD'], 5)], ITEMS_REALES), []);
  assert.deepEqual(resolverTablaProductosEnBlanco([tabla(['PRODUCTO', 'ESPECIFICACIÓN', 'CANTIDAD', 'PRECIO UNITARIO'], 5)], ITEMS_REALES), []);
});

test('sin costeo no escribe nada', () => {
  assert.deepEqual(resolverTablaProductosEnBlanco([tabla(COLS, 5)], []), []);
});

test('nombreDeProductoParaAnexo quita el «- Modelo» repetido sin tocar los « - » propios del nombre', () => {
  assert.equal(nombreDeProductoParaAnexo('SmartSolar MPPT 100/50 | Victron - Victron SmartSolar MPPT 100/50'), 'SmartSolar MPPT 100/50 Victron');
  assert.equal(nombreDeProductoParaAnexo('Escalera Telescópica Fibra de Vidrio 24 peldaños - 7.2m - Fibra de Vidrio 24 peldaños - 7.2m'), 'Escalera Telescópica Fibra de Vidrio 24 peldaños - 7.2m');
  assert.equal(nombreDeProductoParaAnexo('Cinturón electricista profesional respaldo suela'), 'Cinturón electricista profesional respaldo suela');
});

// 4022-19-LE26, Anexo 3 «Oferta técnica»: con las 7 líneas aprobadas en el Auditor la columna
// ESPECIFICACIÓN salía vacía (las filas en blanco no nombraban el producto para cruzar la ficha).
const ficha = (producto: string, conOpcion = true): FichaLineaAuditor => ({
  lineaNumero: 1, producto, motivo: null,
  opcion: conOpcion ? { marca: 'NiMac', modelo: 'LFP-100', fabricante: 'NiMac Ltd', pais: 'China', anio: null, documento: 'ficha.pdf' } : null,
  requisitos: [
    { texto: 'Capacidad mínima 100 Ah.', estado: 'CUMPLE', ofertado: '100 Ah', cita: '' },
    { texto: 'Tensión 12 V', estado: 'CUMPLE', ofertado: '12,8 V', cita: '' },
    { texto: 'Peso máximo 12 kg', estado: 'FALTA_DATO', ofertado: '', cita: '' },
    { texto: 'Garantía', estado: 'NO_CUMPLE', ofertado: '6 meses', cita: '' },
  ],
});

test('la especificación lleva SOLO lo que ofertamos (columna derecha), sin el texto de la exigencia ni marca ni modelo', () => {
  const t = tabla(COLS, 3);
  const r = resolverTablaProductosEnBlanco([t], ITEMS_REALES, [ficha('Batería Litio NiMac 12.8v 100ah')]);
  const espec = r.filter(x => x.etiqueta === 'ESPECIFICACIÓN');
  assert.equal(espec.length, 1);
  assert.equal(espec[0].valor, '100 Ah. 12,8 V.', 'ni «Capacidad mínima…», ni «Marca», ni «Modelo»');
  assert.equal(espec[0].indiceGlobal, t.filas[1].celdas[1].indiceGlobal, 'en la fila de su producto');
});

test('si el dato ofertado nombra la marca o el modelo, se quitan (nuestra ficha no los nombra)', () => {
  const f = ficha('x');
  f.requisitos = [{ texto: 'Tipo', estado: 'CUMPLE', ofertado: 'Batería NiMac LFP-100 de litio, 100 Ah', cita: '' }];
  assert.equal(textoEspecificacionDeFicha(f), 'Batería de litio, 100 Ah.');
});

test('un requisito ❌ o ❓ sin cerrar no se escribe; confirmado a mano entra con el valor que escribió el asistente', () => {
  const f = ficha('x');
  // El ❓ y el ❌ de la ficha de prueba tienen estado FALTA_DATO/NO_CUMPLE: no salen aunque traigan un dato leído.
  assert.equal(textoEspecificacionDeFicha(f), '100 Ah. 12,8 V.');
  // Confirmado a mano: el panel lo entrega como CUMPLE con lo que escribió el asistente.
  f.requisitos[2] = { texto: 'Peso máximo 12 kg', estado: 'CUMPLE', ofertado: 'Peso 9,5 kg', cita: '' };
  assert.equal(textoEspecificacionDeFicha(f), '100 Ah. 12,8 V. Peso 9,5 kg.');
});

test('sin opción aprobada, o sin parecido claro con el producto, la especificación queda en blanco', () => {
  assert.equal(resolverTablaProductosEnBlanco([tabla(COLS, 3)], ITEMS_REALES, [ficha('Batería Litio NiMac 12.8v 100ah', false)]).filter(x => x.etiqueta === 'ESPECIFICACIÓN').length, 0);
  assert.equal(fichaDeProducto('Panel Solar Enertik Policristalino 120W', [ficha('Escalera telescópica fibra de vidrio')]), null);
  assert.equal(textoEspecificacionDeFicha(ficha('x', false)), null);
});

test('al quitar marca y modelo no queda el rótulo «marca,» suelto', () => {
  const f = ficha('x');
  f.opcion!.marca = 'Victron'; f.opcion!.modelo = 'SmartSolar MPPT 100/50';
  f.requisitos = [{ texto: 'Controlador', estado: 'CUMPLE', ofertado: 'SmartSolar MPPT 100/50, marca Victron, 100V 50A', cita: '' }];
  assert.equal(textoEspecificacionDeFicha(f), '100V 50A.');
});
