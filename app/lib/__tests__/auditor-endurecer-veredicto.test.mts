// Regresión del Auditor Técnico contra fichas REALES de 3390-26-LE26 (Biggi, sep-2026).
// Tres defectos que dejaban un veredicto sin sustento:
//   1) el extractor pegaba las celdas de la tabla de dimensiones ("PP15A604410859"),
//   2) la IA dedujo valores del CÓDIGO DEL MODELO ("DJC47377236" → 36 kg) y declaró CUMPLE,
//   3) "205 x 107 x 70 cm" se guardaba como 205 y solo esa cifra se comparaba.
// Correr con: npx tsx --test app/lib/__tests__/auditor-endurecer-veredicto.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unirItemsDePagina } from '../document-extraction';
import {
  endurecerVeredicto, numeroApareceEnTexto, medidaCompuesta, esClausulaDeEquivalencia,
  type VeredictoCaracteristica, type CaracteristicaParaEndurecer,
} from '../auditor-tecnico-core';

// ── 1) Armado del texto de la página ────────────────────────────────────────────────────────
const item = (str: string, x: number, width: number, y = 56.3, height = 7.3125) =>
  ({ str, width, height, transform: [1, 0, 0, 1, x, y] });

test('unirItemsDePagina: celdas de la fila de la tabla quedan separadas (ficha peladora PP15A)', () => {
  const items = [item('PP15A', 150.2, 29.9), item('60', 247.9, 11.3), item('44', 293.5, 11.3), item('108', 332.4, 17), item('59', 372, 11.3)];
  assert.equal(unirItemsDePagina(items), 'PP15A 60 44 108 59');
});

test('unirItemsDePagina: etiqueta y valor de una ficha web ya no se pegan ("Potencia200W")', () => {
  const items = [item('Potencia', 40, 46), item('200W', 200, 25)];
  assert.equal(unirItemsDePagina(items), 'Potencia 200W');
});

test('unirItemsDePagina: una palabra partida por kerning (hueco ≈ 0) NO se separa', () => {
  const items = [item('CARACTE', 45.4, 67.1, 296.3, 10.8), item('RÍSTICAS', 112.5, 63.4, 296.3, 10.8)];
  assert.equal(unirItemsDePagina(items), 'CARACTERÍSTICAS');
});

test('unirItemsDePagina: la viñeta (hueco 0,56 alturas) queda como antes, sin espacio nuevo', () => {
  const items = [item('•', 60.4, 5.2, 273, 6.75), item('Construcción en acero inoxidable.', 69.4, 132.3, 273, 6.75)];
  assert.equal(unirItemsDePagina(items), '•Construcción en acero inoxidable.');
});

test('unirItemsDePagina: si ya hay un espacio propio, no se duplica', () => {
  const items = [item('CALIDAD', 402.7, 42.8, 484.5, 7.3), item(' ', 444.4, 2.3, 484.5, 9), item('SERVICIO', 454.2, 44.6, 484.5, 7.3)];
  assert.equal(unirItemsDePagina(items), 'CALIDAD SERVICIO');
});

test('unirItemsDePagina: cambio de línea sigue siendo salto de línea', () => {
  assert.equal(unirItemsDePagina([item('Largo', 241, 24.7, 86.3), item('(cm)', 246, 14.3, 76.5)]), 'Largo\n(cm)');
});

test('unirItemsDePagina: texto girado no se toca', () => {
  const g = (str: string, x: number) => ({ str, width: 10, height: 8, transform: [0, 1, -1, 0, x, 50] });
  assert.equal(unirItemsDePagina([g('AB', 10), g('CD', 200)]), 'ABCD');
});

// ── 2) Número literal en la ficha ───────────────────────────────────────────────────────────
test('numeroApareceEnTexto: formatos chilenos y palabras', () => {
  const t = 'Consumo 0,75 kW/h - 220 V. Capacidades 9.000 y 18.000 BTU/hr. Peso 1.7 kg. Incluye dos discos. Aprox 1/2 pulgada';
  for (const n of [0.75, 220, 18000, 9000, 1.7, 2, 0.5]) assert.ok(numeroApareceEnTexto(t, n), String(n));
  for (const n of [36, 47, 0.7, 3]) assert.ok(!numeroApareceEnTexto(t, n), String(n));
});

test('numeroApareceEnTexto: un número pegado a un código de modelo NO cuenta como el valor suelto', () => {
  assert.ok(!numeroApareceEnTexto('Modelo Equipo DJC47377236', 36));
  assert.ok(!numeroApareceEnTexto('Modelo Equipo DJC47377236', 47));
  assert.ok(numeroApareceEnTexto('Modelo Equipo DJC 47 37 72 36', 36));
});

// ── 3) endurecerVeredicto ───────────────────────────────────────────────────────────────────
const v = (o: Partial<VeredictoCaracteristica>): VeredictoCaracteristica => ({
  valorOfertadoTexto: null, valorOfertadoNumero: null, unidadOfertadaOriginal: null, valorConvertidoNumero: null,
  veredicto: 'CUMPLE', pendienteConfirmacionProveedor: false, fundamentoDocumento: 'ficha.pdf', fundamentoCita: null, confianza: 95, ...o,
});
const car = (o: Partial<CaracteristicaParaEndurecer>): CaracteristicaParaEndurecer => ({
  descripcion: '', tipo: 'EXACTO', valorRequeridoTexto: null, unidadRequerida: null, ...o,
});

test('CASO REAL dispensador: peso 36 kg deducido del código "DJC47377236" → sin veredicto, no CUMPLE', () => {
  const ficha = 'Modelo Equipo\nLargo\n(cm)\nDJC47377236\nBIGGI.CL';   // texto como lo dejaba el extractor viejo
  const r = endurecerVeredicto(
    car({ descripcion: 'Peso: 36 kg', valorRequeridoTexto: null, unidadRequerida: 'kg' }),
    v({ valorOfertadoTexto: '36', valorOfertadoNumero: 36, unidadOfertadaOriginal: 'kg', fundamentoCita: 'El modelo "DJC47377236" finaliza en 36' }), ficha);
  assert.equal(r.veredicto, null);
  assert.equal(r.pendienteConfirmacionProveedor, true);
  assert.equal(r.valorOfertadoNumero, null);
  assert.match(r.fundamentoCita || '', /no aparece en el texto de la ficha/);
});

test('con el texto bien extraído ("DJC 47 37 72 36") el mismo peso SÍ se acepta', () => {
  const r = endurecerVeredicto(
    car({ descripcion: 'Peso: 36 kg', unidadRequerida: 'kg' }),
    v({ valorOfertadoTexto: '36 kg', valorOfertadoNumero: 36, unidadOfertadaOriginal: 'kg' }), 'Peso (kg)\nDJC 47 37 72 36');
  assert.equal(r.veredicto, 'CUMPLE');
  assert.equal(r.valorOfertadoNumero, 36);
});

test('medidaCompuesta: extrae las componentes y la unidad', () => {
  assert.deepEqual(medidaCompuesta('Dimensiones: 205 x 107 x 70 cm'), { valores: [205, 107, 70], unidad: 'cm' });
  assert.deepEqual(medidaCompuesta('Parrillas de 50x50 cms'), { valores: [50, 50], unidad: 'cms' });
  assert.deepEqual(medidaCompuesta('60 por 40,5 m'), { valores: [60, 40.5], unidad: 'm' });
  assert.equal(medidaCompuesta('Consumo 40 kW/h'), null);
});

test('CASO REAL cocina L1: 205 x 107 x 70 exigido y ofertado, todo en la ficha → CUMPLE con número único anulado', () => {
  const r = endurecerVeredicto(
    car({ descripcion: 'Dimensiones: 205 x 107 x 70 cm', valorRequeridoTexto: '205 x 107 x 70', unidadRequerida: 'cm' }),
    v({ valorOfertadoTexto: '205 x 107 x 70 cm', valorOfertadoNumero: 205, unidadOfertadaOriginal: 'cm' }), 'CG-8C 205 107 70 200');
  assert.equal(r.veredicto, 'CUMPLE');
  assert.equal(r.valorOfertadoNumero, null, 'el 205 suelto no debe volver a decidir por toda la medida');
});

test('FALSO CUMPLE evitado: la ficha dice 205 x 110 x 70 y la IA (mirando solo el 205) dijo CUMPLE → NO_CUMPLE', () => {
  const r = endurecerVeredicto(
    car({ descripcion: 'Dimensiones: 205 x 107 x 70 cm', valorRequeridoTexto: '205 x 107 x 70', unidadRequerida: 'cm' }),
    v({ valorOfertadoTexto: '205 x 110 x 70 cm', valorOfertadoNumero: 205, unidadOfertadaOriginal: 'cm' }), 'CG-8C 205 110 70 200');
  assert.equal(r.veredicto, 'NO_CUMPLE');
});

test('la medida compuesta no depende del orden en que la ficha rotule Largo/Ancho/Alto', () => {
  const r = endurecerVeredicto(
    car({ descripcion: 'Dimensiones: 93 x 82 x 185 cm', unidadRequerida: 'cm' }),
    v({ valorOfertadoTexto: '185 x 93 x 82 cm' }), 'Alto 185 Largo 93 Ancho 82');
  assert.equal(r.veredicto, 'CUMPLE');
});

test('unidades distintas: exigido en cm, ficha en mm rotulada ("Alto: 850mm, Ancho: 1120mm, Fondo: 685mm")', () => {
  const ficha = 'Alto: 850mm, Ancho: 1120mm, Fondo: 685mm';
  const distinto = endurecerVeredicto(
    car({ descripcion: 'Dimensiones: 112 x 68 x 92 cm', unidadRequerida: 'cm' }),
    v({ valorOfertadoTexto: 'Alto: 850mm, Ancho: 1120mm, Fondo: 685mm', veredicto: 'NO_CUMPLE' }), ficha);
  assert.equal(distinto.veredicto, 'NO_CUMPLE');
  const igual = endurecerVeredicto(
    car({ descripcion: 'Dimensiones: 112 x 68.5 x 85 cm', unidadRequerida: 'cm' }),
    v({ valorOfertadoTexto: 'Alto: 850mm, Ancho: 1120mm, Fondo: 685mm', veredicto: 'NO_CUMPLE' }), ficha);
  assert.equal(igual.veredicto, 'CUMPLE');
});

test('medida compuesta cuyos valores la IA no leyó de la ficha → sin veredicto', () => {
  const r = endurecerVeredicto(
    car({ descripcion: 'Dimensiones: 47 x 37 x 72 cm', unidadRequerida: 'cm' }),
    v({ valorOfertadoTexto: '47 x 37 x 72 cm' }), 'Modelo DJC47377236');
  assert.equal(r.veredicto, null);
  assert.equal(r.pendienteConfirmacionProveedor, true);
});

test('CUMPLE sobre una medida compuesta imposible de verificar (sin número ofertado) no se confirma', () => {
  const r = endurecerVeredicto(
    car({ descripcion: 'Dimensiones: 47 x 37 x 72 cm', unidadRequerida: 'cm' }),
    v({ valorOfertadoTexto: 'Compacto', valorOfertadoNumero: null }), 'Compacto');
  assert.equal(r.veredicto, null);
});

test('"tracción 4x4" (sin unidad) no se degrada por error', () => {
  const r = endurecerVeredicto(
    car({ descripcion: 'Tracción 4x4', valorRequeridoTexto: '4x4' }),
    v({ valorOfertadoTexto: '4x4' }), 'Tracción 4x4 con diferencial');
  assert.equal(r.veredicto, 'CUMPLE');
});

test('característica no numérica queda igual (el endurecedor no toca lo cualitativo)', () => {
  const orig = v({ valorOfertadoTexto: 'Compresor sellado.' });
  assert.deepEqual(endurecerVeredicto(car({ descripcion: 'Compresor sellado' }), orig, 'Compresor sellado.'), orig);
});

test('un veredicto null de la IA no se altera', () => {
  const orig = v({ veredicto: null, pendienteConfirmacionProveedor: true });
  assert.deepEqual(endurecerVeredicto(car({ descripcion: 'Peso: 59 kg' }), orig, 'sin datos'), orig);
});

// ── 4) Cláusula de equivalencia ─────────────────────────────────────────────────────────────
test('esClausulaDeEquivalencia: reconoce la cláusula sola y NO una exigencia que la menciona', () => {
  for (const t of ['Similar o equivalente más o menos', 'Similar o equivalente', 'o similar o equivalente más o menos', 'Equivalente o similar.'])
    assert.ok(esClausulaDeEquivalencia(t), t);
  for (const t of ['Samsung QN55Q6FAAGXZS o similar o equivalente más o menos', 'Motor equivalente a 2 HP', 'Diámetro 26"'])
    assert.ok(!esClausulaDeEquivalencia(t), t);
});
