// Ficha técnica propia desde el Auditor (27-oct-2026): se arma con la comparación v3 de la opción,
// solo con lo técnico todo cumplido, y nunca inventa el dato ofertado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { motivoFichaNoLista, especificacionesDeOpcion, productoFichaDeOpcion, datoParaPresentar } from '../auditor-ficha-propia-core';
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
  assert.equal(esp[0].descripcion, 'Capacidad mínima 4 bandejas');
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
  assert.ok(html.includes('Capacidad mínima 4 bandejas') && html.includes('4 bandejas 460x330'), 'la tabla trae el requisito y lo ofertado');
});

// 2427-98-LE26: el comparador pegó su observación al dato ofertado de la GPU; eso no va en el documento oficial.
test('ficha propia: la nota interna del comparador no se imprime como dato ofertado', () => {
  assert.equal(datoParaPresentar('GPU Intel ARC 140T (integrada); ningún documento acredita rendimiento suficiente para ARBOTOM'), 'GPU Intel ARC 140T (integrada)');
  assert.equal(datoParaPresentar('No se indica en la ficha'), null);
  assert.equal(datoParaPresentar('USB 3.2 Tipo-A; HDMI 2.0'), 'USB 3.2 Tipo-A; HDMI 2.0');
  const o = opcion('CUMPLE', [fila(1, 'x', 'y')], { marca: 'GETAC', modelo: 'B360 G3', version: 'G3' });
  assert.equal(productoFichaDeOpcion(o, linea, null).modelo, 'B360 G3', 'la versión no se repite');
});

test('ficha propia: la foto del costeo cuenta como puesta por una persona; la extraída no', () => {
  const o = opcion('CUMPLE', [fila(1, 'x', 'y')]);
  assert.equal(productoFichaDeOpcion(o, linea, { dataUri: 'data:image/png;base64,AA', puestaPorPersona: true }).imagenConfirmada, true);
  assert.equal(productoFichaDeOpcion(o, linea, { dataUri: 'data:image/png;base64,AA', puestaPorPersona: false }).imagenConfirmada, false);
});
