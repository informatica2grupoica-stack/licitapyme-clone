// Ficha técnica propia desde el Auditor (27-oct-2026): se arma con la comparación v3 de la opción,
// solo con lo técnico todo cumplido, y nunca inventa el dato ofertado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { motivoFichaNoLista, especificacionesDeOpcion, productoFichaDeOpcion, datoParaPresentar, incluyeDeOpcion, nombreDeCaracteristica, opcionesDeLaLinea } from '../auditor-ficha-propia-core';
import { construirFichaTecnicaHtml, especificacionesSinCompletar } from '../ficha-tecnica';

const fila = (n: number, texto: string, ofertado: string, estadoCelda = 'CUMPLE') =>
  ({ n, requeridoTexto: texto, partes: [{ ofertadoValor: ofertado }], estadoCelda, veredicto: estadoCelda === 'NO_CUMPLE' ? 'NO_CUMPLE' : 'CUMPLE' });

const opcion = (estadoTec: string, filas: any[], extra: Record<string, unknown> = {}): any => ({
  id: 602, filaId: 'h5zoa55i', marca: 'Unox', modelo: 'Bakerlux Shop.Pro Touch', version: null, estado: 'formalizada', respaldos: [],
  tecnico: { estado: estadoTec, resultado: { filas, estado: estadoTec, resumen: { noCumple: filas.filter(f => f.veredicto === 'NO_CUMPLE').length, sinVeredicto: 0 } } },
  ...extra,
});
const linea: any = { filaId: 'h5zoa55i', lineaReal: 7, detalle: 'Horno convector semi industrial - 4 bandejas', cantidad: 4, unidad: 'Unidad' };

test('ficha propia: solo con lo técnico TODO cumplido', () => {
  assert.equal(motivoFichaNoLista(opcion('CUMPLE', [fila(1, 'Capacidad mínima 4 bandejas', '4 bandejas 460x330')])), null);
  assert.match(motivoFichaNoLista(opcion('NO_CUMPLE', [fila(1, 'Potencia', '3 kW', 'NO_CUMPLE')]))!, /Falta cerrar lo técnico: 1 no cumple/);
  assert.match(motivoFichaNoLista(opcion('NO_CORRIDO', [], { tecnico: { estado: 'NO_CORRIDO', resultado: null } }))!, /compara la línea/);
  assert.match(motivoFichaNoLista(opcion('CUMPLE', [fila(1, 'x', 'y')], { estado: 'descartada' }))!, /descartada/);
  assert.match(motivoFichaNoLista(opcion('CUMPLE', [fila(1, 'x', 'y')], { tecnico: { estado: 'CUMPLE', legado: true, resultado: { filas: [fila(1, 'x', 'y')] } } }))!, /antigua/);
});

test('ficha propia: requisito + lo ofertado; sin dato ofertado la casilla queda vacía (no se inventa)', () => {
  const o = opcion('CUMPLE', [fila(1, 'Capacidad mínima 4 bandejas', '4 bandejas 460x330'), fila(2, 'Alimentación 220 V', '')]);
  const esp = especificacionesDeOpcion(o);
  assert.equal(esp[0].descripcion, '', 'sin «Nombre:» el rótulo lo pone la IA al armar el PDF');
  assert.equal(esp[0].valorOfertadoTexto, '4 bandejas 460x330');
  assert.equal(esp[1].valorOfertadoTexto, null);

  const p = productoFichaDeOpcion(o, linea, null);
  assert.equal(p.nombre, 'Horno convector semi industrial');
  assert.equal(p.marca, 'Unox');
  assert.equal(p.cantidad, 4);
  const lineas = [{ linea: 7, titulo: p.nombre, productos: [p] }];
  assert.equal(especificacionesSinCompletar(lineas), 1);

  const html = construirFichaTecnicaHtml({
    licitacionCodigo: '1414396-26-LP26', licitacionNombre: null, organismo: null, lineas, generadoPor: null, fechaTexto: '27 de octubre de 2026',
    empresa: { razonSocial: 'Empresa de prueba', rut: null, giro: null, direccion: null, email: null, telefono: null, representanteNombre: null, representanteRut: null, representanteCargo: null, logoDataUri: null, firmaDataUri: null, timbreDataUri: null },
  });
  assert.ok(!html.includes('Capacidad mínima 4 bandejas') && html.includes('4 bandejas 460x330'), 'la tabla trae lo ofertado, no el requisito');
});

// 2427-98-LE26: el comparador pegó su observación al dato ofertado de la GPU; eso no va en el documento oficial.
test('ficha propia: la nota interna del comparador no se imprime como dato ofertado', () => {
  assert.equal(datoParaPresentar('GPU Intel ARC 140T (integrada); ningún documento acredita rendimiento suficiente para ARBOTOM'), 'GPU Intel ARC 140T (integrada)');
  assert.equal(datoParaPresentar('No se indica en la ficha'), null);
  assert.equal(datoParaPresentar('USB 3.2 Tipo-A; HDMI 2.0'), 'USB 3.2 Tipo-A; HDMI 2.0');
  const o = opcion('CUMPLE', [fila(1, 'x', 'y')], { marca: 'GETAC', modelo: 'B360 G3', version: 'G3' });
  assert.equal(productoFichaDeOpcion(o, linea, null).modelo, 'B360 G3', 'la versión no se repite');
});

// 1414396-26-LP26, horno Unox: los complementos van en «Incluye»; el envío (costo logístico) no.
test('ficha propia: «Incluye» lleva productos e instalación de los complementos, sin el envío', () => {
  const o = opcion('CUMPLE', [fila(1, 'x', 'y')], { complementos: [
    { tipo: 'instalacion', nombre: 'Instalación de Horno convector', cantidadDoc: 1 },
    { tipo: 'producto', nombre: 'Enchufe macho volante 5x16A Trifásico', cantidadDoc: 1 },
    { tipo: 'producto', nombre: 'Bandeja Unox Bake 60x40 cms', cantidadDoc: 4 },
    { tipo: 'envio', nombre: 'Envío', cantidadDoc: null },
  ] });
  assert.deepEqual(incluyeDeOpcion(o), ['Instalación de Horno convector', 'Enchufe macho volante 5x16A Trifásico', '4 × Bandeja Unox Bake 60x40 cms']);
  const html = construirFichaTecnicaHtml({
    licitacionCodigo: 'X', licitacionNombre: null, organismo: null, generadoPor: null, fechaTexto: '',
    lineas: [{ linea: 7, titulo: 'Horno', productos: [productoFichaDeOpcion(o, linea, null)] }],
    empresa: { razonSocial: 'E', rut: null, giro: null, direccion: null, email: null, telefono: null, representanteNombre: null, representanteRut: null, representanteCargo: null, logoDataUri: null, firmaDataUri: null, timbreDataUri: null },
  });
  assert.ok(html.includes('>Incluye<') && html.includes('4 × Bandeja Bake 60x40 cms') && !html.includes('Unox') && !html.includes('Envío'), 'Incluye sin la marca');
});

test('ficha propia: la foto del costeo cuenta como puesta por una persona; la extraída no', () => {
  const o = opcion('CUMPLE', [fila(1, 'x', 'y')]);
  assert.equal(productoFichaDeOpcion(o, linea, { dataUri: 'data:image/png;base64,AA', puestaPorPersona: true }).imagenConfirmada, true);
  assert.equal(productoFichaDeOpcion(o, linea, { dataUri: 'data:image/png;base64,AA', puestaPorPersona: false }).imagenConfirmada, false);
});

// 1414396-26-LP26, «Control de Humedad»: la ficha del proveedor no traía el dato; el asistente lo complementó con una
// nota y el EM lo aceptó. Al documento va el valor de la nota (lo que sigue al «:»), no la nota interna.
test('ficha propia: sin dato del comparador, la casilla toma el valor de la nota del complemento', () => {
  const o = opcion('CUMPLE', [fila(3, 'Control de Humedad: 0%, 20%, 40%, 60%, 80% y 100%', ''), fila(4, 'Alimentación 220 V', '')], {
    tecnico: { estado: 'CUMPLE', respaldosCelda: {
      3: [{ url: 'nota:1', nombre: 'Nota', nota: 'confirmado con proveedor y en el link aparece textual Control de la humedad: 0 - 20 – 40 - 60 - 80 - 100%.' }],
      4: [{ url: 'nota:2', nombre: 'Nota', nota: 'lo confirmó el proveedor por teléfono' }],
    }, resultado: { filas: [fila(3, 'Control de Humedad: 0%, 20%, 40%, 60%, 80% y 100%', ''), fila(4, 'Alimentación 220 V', '')] } },
  });
  const esp = especificacionesDeOpcion(o);
  assert.equal(esp[0].valorOfertadoTexto, '0 - 20 – 40 - 60 - 80 - 100%');
  assert.equal(esp[1].valorOfertadoTexto, null, 'una nota sin «algo: valor» no se imprime');
});

// 27-oct-2026: la ficha declara lo que ofrecemos; el texto de las bases no va. El rótulo es lo que el requisito trae antes de «:».
test('ficha propia: la columna izquierda es el nombre corto, nunca el texto de las bases', () => {
  assert.equal(nombreDeCaracteristica('Control de Humedad: ajustes en los siguientes niveles porcentuales exactos: 0%, 20%'), 'Control de Humedad');
  assert.equal(nombreDeCaracteristica('Peldaños: 24'), 'Peldaños');
  assert.equal(nombreDeCaracteristica('RAM 32 GB mínimo.'), null, 'sin «:» lo nombra la IA');
  assert.equal(nombreDeCaracteristica('Compatibilidad El oferente deberá acreditar compatibilidad con software lectura de tomografía 2-D/3-D y Mechanics Graphics Module, según corresponda, mediante ficha: x'), null, 'un «:» lejano no es rótulo');
  const p = productoFichaDeOpcion(opcion('CUMPLE', [fila(1, 'Rango de Temperatura: desde los 30 °C hasta un máximo de 260 °C.', '30 °C – 260 °C'), fila(2, 'RAM 32 GB mínimo.', '32 GB RAM')]), linea, null);
  const html = construirFichaTecnicaHtml({
    licitacionCodigo: 'X', licitacionNombre: null, organismo: null, lineas: [{ linea: 7, titulo: p.nombre, productos: [p] }], generadoPor: null, fechaTexto: '',
    empresa: { razonSocial: 'E', rut: null, giro: null, direccion: null, email: null, telefono: null, representanteNombre: null, representanteRut: null, representanteCargo: null, logoDataUri: null, firmaDataUri: null, timbreDataUri: null },
  });
  assert.ok(html.includes('<th>Rango de Temperatura</th>'));
  assert.ok(!html.includes('hasta un máximo') && !html.includes('mínimo.'), 'el texto de las bases no se imprime');
  assert.ok(html.includes('<td colspan="2" class="">32 GB RAM</td>'), 'sin rótulo, el dato a todo el ancho');
});

// 2446-240-LE26 L1 trae 3 ítems: la ficha se arma por LÍNEA, en un PDF (antes cada ítem pisaba al anterior: mismo nombre …_L1.pdf).
test('ficha propia por línea: el botón de un ítem arma todos los ítems de su línea; los que no están listos se avisan', () => {
  const lista = (id: number, extra: Record<string, unknown> = {}) => opcion('CUMPLE', [fila(1, 'x', 'y')], { id, ...extra });
  const it = (item: number, lineaReal: number | null, opciones: any[], extra: Record<string, unknown> = {}) =>
    ({ filaId: `f${lineaReal}-${item}`, item, lineaReal, detalle: `Producto ${item} - x`, cantidad: 1, unidad: 'Unidad', opciones, opcionDefinitivaId: null, noOfertada: false, ...extra });
  const panel: any = { lineas: [
    it(1, 1, [lista(11)]),
    it(2, 1, [lista(21), lista(22)], { opcionDefinitivaId: 22 }),
    it(3, 1, [opcion('NO_CUMPLE', [fila(1, 'x', 'y', 'NO_CUMPLE')], { id: 31 })]),
    it(1, 2, [lista(41)]),
  ] };
  const r = opcionesDeLaLinea(panel, 11);
  assert.deepEqual(r.ids, [11, 22], 'el ítem pulsado, y del 2 la firmada; nada de la línea 2');
  assert.equal(r.faltan.length, 1);
  assert.match(r.faltan[0], /Línea 1 · ítem 3/);
  assert.deepEqual(opcionesDeLaLinea(panel, 41).ids, [41], 'una línea de un solo ítem: solo ese');
});
