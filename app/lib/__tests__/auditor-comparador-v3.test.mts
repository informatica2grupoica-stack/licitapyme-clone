// Tests del comparador técnico v3.0 (puro): estados, guardarraíles, preguntas (máx. 3, solo técnicas), confirmaciones y resumen de la licitación.
// Correr con: npx tsx --test app/lib/__tests__/auditor-comparador-v3.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estadoCeldaDe, numeroSospechoso, parsearSalidaV3, construirResultadoTecnico, estadoDeProducto, preguntaSinFicha,
  type SalidaV3, type RequisitoV3, type OpcionParaV3, type GuardadaV3,
} from '../auditor-comparador-v3-core';
import { resumenLicitacion } from '../auditor-resumen-licitacion';

const REQ: RequisitoV3[] = [
  { n: 1, texto: 'Proyector XGA 3400 lumenes', fuente: 'Bases', criticidad: 'INADMISIBLE' },
  { n: 2, texto: 'resolución 1024x768', fuente: 'Bases', criticidad: 'INADMISIBLE' },
  { n: 3, texto: 'conectividad HDMI y USB', fuente: 'Bases', criticidad: 'PUNTAJE' },
  { n: 4, texto: 'altavoz integrado de alta calidad', fuente: 'Bases', criticidad: 'COMPROMISO' },
];
const FICHA = 'Brillo 4.000 lúmenes ANSI. Resolución XGA 1024x768. Entradas: HDMI x2, USB Tipo A. Altavoz integrado 5 W.';
const op = (id: number, extra: Partial<OpcionParaV3> = {}): OpcionParaV3 => ({ opcionId: id, marca: 'BenQ', modelo: 'MX560C', proveedor: 'PC Factory', proveedorRut: '78.885.550-8', docs: [{ texto: FICHA, tipo: 'ficha_tecnica' }], ...extra });
const salida = (celdas: any[], extra: any = {}): SalidaV3 => ({ lineas: [{ linea: 5, productos: [{ producto_id: 'P1', celdas, notas: [], ...extra }] }] });
const celda = (n: number, estado: string) => ({ n, estado: estado as any, datoOfertado: '', cita: '', citaNoVerificada: false, revisar: false, origen: null });

test('estadoCeldaDe: acepta texto y emojis; lo raro es FALTA_DATO (sin evidencia no hay cumplimiento)', () => {
  assert.equal(estadoCeldaDe('CUMPLE'), 'CUMPLE'); assert.equal(estadoCeldaDe('✅'), 'CUMPLE');
  assert.equal(estadoCeldaDe('SOBRECUMPLE'), 'SOBRECUMPLE'); assert.equal(estadoCeldaDe('🟩'), 'SOBRECUMPLE');
  assert.equal(estadoCeldaDe('NO CUMPLE'), 'NO_CUMPLE'); assert.equal(estadoCeldaDe('no_cumple'), 'NO_CUMPLE'); assert.equal(estadoCeldaDe('❌'), 'NO_CUMPLE');
  assert.equal(estadoCeldaDe('FALTA DATO'), 'FALTA_DATO'); assert.equal(estadoCeldaDe('❓'), 'FALTA_DATO');
  assert.equal(estadoCeldaDe('quizás'), 'FALTA_DATO'); assert.equal(estadoCeldaDe(undefined), 'FALTA_DATO');
});

test('parsear: un estado por requisito; los requisitos que el modelo no devolvió quedan FALTA_DATO', () => {
  const r = parsearSalidaV3(salida([
    { n: 1, estado: 'SOBRECUMPLE', dato_ofertado: '4.000 lm', cita: 'Brillo 4.000 lúmenes ANSI' },
    { n: 2, estado: 'CUMPLE', dato_ofertado: '', cita: 'Resolución XGA 1024x768' },
    { n: 3, estado: '✅', cita: 'Entradas: HDMI x2, USB Tipo A' },
  ]), REQ, [op(1)]).get(1)!;
  assert.deepEqual(r.celdas.map(c => c.estado), ['SOBRECUMPLE', 'CUMPLE', 'CUMPLE', 'FALTA_DATO']);
  assert.equal(r.celdas[0].datoOfertado, '4.000 lm');
  assert.equal(r.celdas[0].origen, 'FICHA');
});

test('guardarraíl: una cita que NO está en los documentos se marca (queda guardada), pero no cambia el estado', () => {
  const r = parsearSalidaV3(salida([{ n: 1, estado: 'CUMPLE', cita: 'Brillo 9.999 lúmenes en modo turbo' }, { n: 2, estado: 'CUMPLE', cita: 'Resolución XGA 1024x768' }]), REQ, [op(1)]).get(1)!;
  assert.equal(r.celdas[0].citaNoVerificada, true); assert.equal(r.celdas[0].estado, 'CUMPLE');
  assert.equal(r.celdas[1].citaNoVerificada, false);
});

test('origen del dato: la cita que está en una página web es FICHA_WEB; en un PDF de ficha, FICHA', () => {
  const o = op(1, { docs: [{ texto: 'Tienda XYZ: HDMI x2 y USB Tipo A incluidos', tipo: 'link_web' }, { texto: FICHA, tipo: 'ficha_tecnica' }] });
  const r = parsearSalidaV3(salida([{ n: 3, estado: 'CUMPLE', cita: 'HDMI x2 y USB Tipo A incluidos' }, { n: 2, estado: 'CUMPLE', cita: 'Resolución XGA 1024x768' }]), REQ, [o]).get(1)!;
  assert.equal(r.celdas.find(c => c.n === 3)!.origen, 'FICHA_WEB');
  assert.equal(r.celdas.find(c => c.n === 2)!.origen, 'FICHA');
});

test('control del prompt: un número pelado frente a una unidad exigida ("4" lúmenes) se marca para revisión', () => {
  assert.equal(numeroSospechoso('4', 'Proyector XGA 3400 lumenes'), true);
  assert.equal(numeroSospechoso('4.000 lm', 'Proyector XGA 3400 lumenes'), false);
  assert.equal(numeroSospechoso('4', 'Cámara full HD'), false);
  const r = parsearSalidaV3(salida([{ n: 1, estado: 'SOBRECUMPLE', dato_ofertado: '4', cita: '' }]), REQ, [op(1)]).get(1)!;
  assert.equal(r.celdas[0].revisar, true);
});

test('estado del producto: CUMPLE si todo ✅/🟩 · NO CUMPLE si hay un ❌ · FALTA DATO si no hay ❌ y hay un ❓; confirmar un ❓ lo cierra y un ❌ solo se cierra corregido a mano', () => {
  const celdas = (estados: string[]) => estados.map((e, i) => celda(i + 1, e));
  assert.equal(estadoDeProducto(celdas(['CUMPLE', 'SOBRECUMPLE', 'CUMPLE', 'CUMPLE']), new Map()), 'CUMPLE');
  assert.equal(estadoDeProducto(celdas(['CUMPLE', 'NO_CUMPLE', 'FALTA_DATO', 'CUMPLE']), new Map()), 'NO_CUMPLE');
  assert.equal(estadoDeProducto(celdas(['CUMPLE', 'FALTA_DATO', 'CUMPLE', 'CUMPLE']), new Map()), 'FALTA_DATO');
  assert.equal(estadoDeProducto(celdas(['CUMPLE', 'FALTA_DATO', 'CUMPLE', 'CUMPLE']), new Map([[2, { por: 'Ana', at: '2026-09-30 10:00:00' }]])), 'CUMPLE');
  assert.equal(estadoDeProducto(celdas(['NO_CUMPLE', 'CUMPLE', 'CUMPLE', 'CUMPLE']), new Map([[1, { por: 'Ana', at: '', motivo: 'confirmado por el proveedor' }]])), 'CUMPLE');
});

test('adaptador: NO CUMPLE y FALTA DATO bloquean la firma; ✅/🟩 no; lo confirmado destraba; sin segunda pasada los rojos quedan reverificados', () => {
  const g: GuardadaV3 = { version: 'v3.0', requisitos: REQ, motor: 't', opcion: { opcionId: 1, notas: ['hay precio con tarjeta $1'], preguntas: ['¿Tiene puerto USB?'], sinFicha: false, asignacion: 'segura',
    celdas: [
      { n: 1, estado: 'SOBRECUMPLE', datoOfertado: '4.000 lm', cita: 'x', citaNoVerificada: false, revisar: false, origen: 'FICHA' },
      { n: 2, estado: 'NO_CUMPLE', datoOfertado: 'WXGA 1280x800', cita: '', citaNoVerificada: false, revisar: false, origen: 'FICHA' },
      { n: 3, estado: 'FALTA_DATO', datoOfertado: '', cita: '', citaNoVerificada: false, revisar: false, origen: null },
      { n: 4, estado: 'CUMPLE', datoOfertado: '', cita: '', citaNoVerificada: false, revisar: false, origen: 'FICHA' },
    ] } };
  const r = construirResultadoTecnico(g);
  assert.equal(r.estado, 'NO_CUMPLE');
  assert.deepEqual(r.bloqueos.map(b => `${b.codigo}:${b.item}`), ['NO_CUMPLE:2', 'FALTA_DATO:3']);
  assert.equal(r.filas[0].veredicto, 'CUMPLE'); assert.equal(r.filas[0].sobrecumple, true); assert.equal(r.filas[0].valorCorto, '4.000 lm');
  assert.equal(r.filas[1].valorCorto, 'WXGA 1280x800');
  assert.ok(r.filas.every(f => f.reverificado));
  assert.deepEqual(r.notas, ['hay precio con tarjeta $1']);
  assert.equal(r.preguntas[0].texto, '¿Tiene puerto USB?');
  const c = construirResultadoTecnico({ ...g, opcion: { ...g.opcion, celdas: g.opcion.celdas.map(x => x.n === 2 ? { ...x, estado: 'CUMPLE' as const } : x) } }, new Map([[3, { por: 'Ana', at: '2026-09-30 10:00:00' }]]));
  assert.equal(c.estado, 'CUMPLE'); assert.equal(c.bloqueos.length, 0);
  assert.equal(c.filas[2].confirmada?.por, 'Ana');
});

test('preguntas: máximo 3 por proveedor, solo técnicas (nada de IVA, vigencia, stock ni datos de la empresa)', () => {
  const r = parsearSalidaV3({ ...salida([{ n: 1, estado: 'CUMPLE', cita: 'Brillo 4.000 lúmenes ANSI' }, { n: 3, estado: 'FALTA_DATO' }]), mensajes_proveedor: [{ proveedor: 'PC Factory', mensaje:
    'Hola, necesitamos:\n1. ¿Tiene puerto USB?\n2. ¿El precio incluye IVA?\n3. ¿Cuál es la vigencia de la cotización?\n4. ¿Tiene salida HDMI?\n5. ¿Trae control remoto?\n6. ¿Tiene altavoz?\n7. ¿Tiene zoom digital?\n8. ¿Cuál es su RUT?' }] }, REQ, [op(1)]).get(1)!;
  assert.equal(r.preguntas.length, 3);
  assert.ok(r.preguntas.every(q => !/iva|vigencia|rut/i.test(q)));
});

test('producto sin ficha técnica: UNA sola pregunta, pedir la ficha (las otras del modelo sobre ese producto se descartan)', () => {
  const r = parsearSalidaV3({ ...salida([], {}), mensajes_proveedor: [{ proveedor: 'PC Factory', mensaje: '1. ¿Tiene HDMI?\n2. ¿Tiene USB?' }] }, REQ, [op(1, { docs: [{ texto: 'Proyector Benq MX560C $346.546 + IVA', tipo: 'cotizacion_formal' }] })]).get(1)!;
  assert.equal(r.sinFicha, true);
  assert.deepEqual(r.preguntas, [preguntaSinFicha('BenQ', 'MX560C')]);
  assert.ok(r.notas.some(n => /sin ficha/i.test(n)));
});

test('preguntas: dos opciones del mismo proveedor (Spa/SpA) → las preguntas van UNA vez, en la primera opción', () => {
  const o1 = op(1, { proveedor: 'Audiofans Spa', proveedorRut: '76.773.918-4' }), o2 = op(2, { modelo: 'X2', proveedor: 'Audiofans SpA', proveedorRut: null });
  const s: SalidaV3 = { lineas: [{ productos: [{ producto_id: 'P1', celdas: [{ n: 3, estado: 'FALTA_DATO' }] }, { producto_id: 'P2', celdas: [{ n: 3, estado: 'FALTA_DATO' }] }] }], mensajes_proveedor: [{ proveedor: 'Audiofans', mensaje: '1. ¿Tiene USB en el modelo X2?' }] };
  const m = parsearSalidaV3(s, REQ, [o1, o2]);
  assert.ok(m.get(1)!.preguntas.length > 0); assert.equal(m.get(2)!.preguntas.length, 0);
});

test('resumen: la más barata que CUMPLE gana; sin CUMPLE, la más barata con FALTA DATO (marcada); NO CUMPLE no compite; alerta contra el presupuesto', () => {
  const o = (id: number, estado: any, costo: number | null) => ({ opcionId: id, etiqueta: `o${id}`, estado, costoUnitNeto: costo });
  const lineas = [
    { filaId: 'a', item: 1, nombre: 'TV 55', cantidad: 19, noOfertada: false, opciones: [o(1, 'NO_CUMPLE', 100_000), o(2, 'CUMPLE', 400_000), o(3, 'CUMPLE', 350_000), o(4, 'FALTA_DATO', 300_000)] },
    { filaId: 'b', item: 2, nombre: 'Kit', cantidad: 16, noOfertada: false, opciones: [o(5, 'FALTA_DATO', 900_000), o(6, 'FALTA_DATO', 850_000), o(7, 'NO_CUMPLE', 1)] },
    { filaId: 'c', item: 3, nombre: 'Cámara', cantidad: 6, noOfertada: false, opciones: [o(8, 'NO_CUMPLE', 1)] },
    { filaId: 'd', item: 4, nombre: 'No se oferta', cantidad: 1, noOfertada: true, opciones: [o(9, 'CUMPLE', 5_000_000)] },
  ];
  const r = resumenLicitacion(lineas, 30_000_000);
  assert.equal(r.filas.length, 3);
  assert.equal(r.filas[0].mejor!.opcionId, 3); assert.equal(r.filas[0].totalNeto, 350_000 * 19); assert.equal(r.filas[0].faltaDato, false);
  assert.equal(r.filas[1].mejor!.opcionId, 6); assert.equal(r.filas[1].faltaDato, true); assert.equal(r.filas[1].totalNeto, 850_000 * 16);
  assert.equal(r.filas[2].mejor, null); assert.equal(r.lineasSinOpcion, 1);
  assert.equal(r.costoTotal, 6_650_000 + 13_600_000);
  assert.equal(r.queda, 30_000_000 - 20_250_000); assert.equal(r.quedaPct, 32.5);
  assert.equal(r.alerta, 'verde');
  assert.equal(resumenLicitacion(lineas, 20_000_000).alerta, 'rojo');
  assert.equal(resumenLicitacion(lineas, 24_000_000).alerta, 'amarillo');
  assert.equal(resumenLicitacion(lineas, null).alerta, 'sin_presupuesto');
});

test('preguntas: un párrafo con saludo se separa en sus frases «¿…?»; y si el modelo dice "sin ficha técnica" la única pregunta es pedir la ficha', () => {
  const r = parsearSalidaV3({ ...salida([{ n: 1, estado: 'CUMPLE', cita: 'Brillo 4.000 lúmenes ANSI' }, { n: 3, estado: 'FALTA_DATO' }, { n: 4, estado: 'FALTA_DATO' }], {}), mensajes_proveedor: [{ proveedor: 'PC Factory',
    mensaje: 'Hola, respecto a la cotización 100.084.222: ¿tiene puerto USB el proyector BenQ MX560C? Además, ¿trae altavoz integrado? Gracias.' }] }, REQ, [op(1)]).get(1)!;
  assert.deepEqual(r.preguntas, ['¿Tiene puerto USB el proyector BenQ MX560C?', '¿Trae altavoz integrado?']);
  const sf = parsearSalidaV3({ ...salida([{ n: 1, estado: 'SOBRECUMPLE', dato_ofertado: '4.000 lúmenes', cita: '' }, { n: 2, estado: 'FALTA_DATO' }], { notas: ['sin ficha técnica: la cotización solo indica 4.000 lúmenes'] }),
    mensajes_proveedor: [{ proveedor: 'PC Factory', mensaje: '¿Tiene USB? ¿Tiene HDMI?' }] }, REQ, [op(1, { docs: [{ texto: 'Proyector BenQ MX560C 4.000 lúmenes', tipo: 'cotizacion_formal' }] })]).get(1)!;
  assert.equal(sf.sinFicha, true);
  assert.deepEqual(sf.preguntas, [preguntaSinFicha('BenQ', 'MX560C')]);
});

test('un ❌ corregido a mano (con motivo) se da por cumplido y recuerda el motivo; sin corregir sigue bloqueando', () => {
  const celdas = [{ n: 1, estado: 'NO_CUMPLE', datoOfertado: 'solo FM', cita: '', citaNoVerificada: false, revisar: false, origen: null }, { n: 2, estado: 'CUMPLE', datoOfertado: 'x', cita: '', citaNoVerificada: false, revisar: false, origen: null }] as any;
  assert.equal(estadoDeProducto(celdas, new Map()), 'NO_CUMPLE');
  assert.equal(estadoDeProducto(celdas, new Map([[1, { por: 'Ana', at: '', motivo: 'el proveedor confirmó que trae AM' }]])), 'CUMPLE');
});
