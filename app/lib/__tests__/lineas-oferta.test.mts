// Tests del SELECTOR DE LÍNEAS A OFERTAR (migración 78) y del fix de numeración del lado
// comercial que lo hace posible.
// Correr con:
//   npx tsx --test app/lib/__tests__/lineas-oferta.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lineasDelInforme, generarItemsDesdeViabilidad, filtrarPorLineasOfertadas, resumirChecklist,
  estadoDeBloque, esAlertaDeCumplimiento, type ItemGenerado,
} from '../checklist-comercial';
import { lineasTecnicasDelInforme } from '../auditor-tecnico-core';

// Manifiesto con la forma REAL que guarda viabilidad: `linea` es texto con prefijo ("L7"), y una
// misma línea puede traer varios productos (línea-paquete). Caso 986278-14-LE26 en miniatura:
// 3 líneas reales (5, 7, 9) repartidas en 6 productos.
const INFORME_POR_LINEA = {
  modalidad: { tipo: 'por_linea', estado: 'OK' },
  manifiesto_productos: [
    { linea: 'L5', descripcion: 'Escalera telescópica', cantidad: 2, unidad_medida: 'un',
      presupuesto_linea: 500000, caracteristicas: ['Altura 3,8 m'] },
    { linea: 'L7', descripcion: 'Esmeril angular', cantidad: 1, unidad_medida: 'un',
      presupuesto_linea: 900000, caracteristicas: ['Potencia 1.200 W o superior'] },
    { linea: 'L7', descripcion: 'Taladro percutor', cantidad: 1, unidad_medida: 'un',
      presupuesto_linea: 900000, caracteristicas: ['Mandril 13 mm'] },
    { linea: 'L7', descripcion: 'Careta de soldar', cantidad: 1, unidad_medida: 'un',
      presupuesto_linea: 900000, caracteristicas: ['Fotosensible'] },
    { linea: 'L9', descripcion: 'Carro de herramientas', cantidad: 1, unidad_medida: 'un',
      presupuesto_linea: 300000, caracteristicas: ['162 piezas'] },
    { linea: 'L9', descripcion: 'Foco LED trípode', cantidad: 4, unidad_medida: 'un',
      presupuesto_linea: 300000, caracteristicas: ['Inalámbrico'] },
  ],
};

// ─── NUMERACIÓN: el lado comercial tenía el MISMO bug que el técnico ──────────────────────────
// `Number("L7")` da NaN y `NaN || i+1` caía SIEMPRE al índice del array, así que 6 productos de
// 3 líneas generaban 6 precios numerados 1..6 por POSICIÓN. Sin esto el selector filtraría bien
// el bloque técnico y mal el comercial, que es peor que no filtrar: el asistente vería
// desaparecer el precio de una línea a la que SÍ se postula.
test('lineasDelInforme lee el número REAL de la línea, no la posición en el array', () => {
  assert.deepEqual(lineasDelInforme(INFORME_POR_LINEA).map(l => l.linea), [5, 7, 9]);
});

test('los dos lados (comercial y técnico) numeran IGUAL — el selector filtra por ese número', () => {
  const comercial = lineasDelInforme(INFORME_POR_LINEA).map(l => l.linea);
  const tecnico = lineasTecnicasDelInforme(INFORME_POR_LINEA).map(l => l.linea);
  assert.deepEqual(comercial, tecnico);
});

test('una línea-paquete deja UN solo precio (se cotiza una vez) pero conserva su presupuesto', () => {
  const l7 = lineasDelInforme(INFORME_POR_LINEA).find(l => l.linea === 7)!;
  assert.equal(l7.presupuestoLinea, 900000);
  assert.equal(lineasDelInforme(INFORME_POR_LINEA).filter(l => l.linea === 7).length, 1);
});

test('sin número de línea reconocible se cae a la posición (no se inventa un número)', () => {
  const sinLinea = { modalidad: { tipo: 'por_linea' }, manifiesto_productos: [{ descripcion: 'A' }, { descripcion: 'B' }] };
  assert.deepEqual(lineasDelInforme(sinLinea).map(l => l.linea), [1, 2]);
});

// ─── FILTRO POR LÍNEAS OFERTADAS ──────────────────────────────────────────────────────────────
const item = (over: Partial<ItemGenerado>): ItemGenerado => ({
  bloque: 'TECNICO', tipo: 'linea_tecnica', titulo: 'x', descripcion: null,
  criticidad: 'PUNTAJE_CONDICIONANTE', ponderacion: null, fuenteCita: null, origen: 'viabilidad',
  claveOrigen: 'x', generable: false, lineaNumero: null, orden: 0, ...over,
});

test('sin decisión guardada (null) se genera TODO, igual que antes de la migración 78', () => {
  const items = [item({ lineaNumero: 1 }), item({ lineaNumero: 2 })];
  assert.equal(filtrarPorLineasOfertadas(items, null).length, 2);
  assert.equal(filtrarPorLineasOfertadas(items, undefined).length, 2);
});

// Fail-open deliberado: una lista vacía solo puede venir de un bug o de datos corruptos, y ahí
// preferimos generar de más antes que dejar el checklist en blanco sin que nadie lo pidiera.
test('una lista VACÍA no borra el checklist: se trata como "sin decisión"', () => {
  const items = [item({ lineaNumero: 1 }), item({ lineaNumero: 2 })];
  assert.equal(filtrarPorLineasOfertadas(items, []).length, 2);
});

test('con decisión, solo sobreviven las líneas ofertadas', () => {
  const items = [item({ lineaNumero: 5 }), item({ lineaNumero: 7 }), item({ lineaNumero: 9 })];
  assert.deepEqual(filtrarPorLineasOfertadas(items, [7]).map(i => i.lineaNumero), [7]);
});

test('los ítems SIN línea (anexos, plazo, precio total) nunca se filtran', () => {
  const items = [
    item({ lineaNumero: null, bloque: 'ADMINISTRATIVO', tipo: 'documento', claveOrigen: 'anexo:a' }),
    item({ lineaNumero: 2 }),
  ];
  const out = filtrarPorLineasOfertadas(items, [7]);
  assert.equal(out.length, 1);
  assert.equal(out[0].claveOrigen, 'anexo:a');
});

// ─── INTEGRACIÓN: el caso real que motivó todo ────────────────────────────────────────────────
// Se postula solo a la línea 7. Antes salían las 3 líneas técnicas y los 3 precios.
test('generarItemsDesdeViabilidad con [7]: solo la línea 7 genera trabajo técnico y comercial', () => {
  const items = generarItemsDesdeViabilidad(INFORME_POR_LINEA, [7]);
  const tecnicas = items.filter(i => i.tipo === 'linea_tecnica');
  const precios = items.filter(i => i.tipo === 'precio');
  assert.deepEqual(tecnicas.map(i => i.lineaNumero), [7]);
  assert.deepEqual(precios.map(i => i.lineaNumero), [7]);
});

test('el mismo informe SIN decisión sigue generando las 3 líneas (no hay regresión)', () => {
  const items = generarItemsDesdeViabilidad(INFORME_POR_LINEA);
  assert.deepEqual(items.filter(i => i.tipo === 'linea_tecnica').map(i => i.lineaNumero), [5, 7, 9]);
  assert.deepEqual(items.filter(i => i.tipo === 'precio').map(i => i.lineaNumero), [5, 7, 9]);
});

test('los anexos administrativos se generan igual, se oferte la línea que se oferte', () => {
  const conAnexos = {
    ...INFORME_POR_LINEA,
    requisitos_admisibilidad: { orden_anexos_propios: [{ que_crear: 'Anexo N°1 - Identificación del oferente' }] },
  };
  const soloUna = generarItemsDesdeViabilidad(conAnexos, [7]).filter(i => i.bloque === 'ADMINISTRATIVO');
  const todas = generarItemsDesdeViabilidad(conAnexos).filter(i => i.bloque === 'ADMINISTRATIVO');
  assert.equal(soloUna.length, todas.length);
  assert.ok(soloUna.length > 0);
});

// ─── AVANCE: una línea descartada no es una tarea pendiente ───────────────────────────────────
// resumirChecklist miraba solo `tipo === 'precio'` porque `ofertamos` nacía en el costeo. Con el
// selector la marca llega también a las `linea_tecnica`, y sin generalizar la regla una línea
// descartada quedaba contada como pendiente para siempre — el avance nunca llegaba a 100%.
test('una línea técnica fuera de la oferta no cuenta como pendiente', () => {
  const resumen = resumirChecklist([
    { estado: 'APROBADO', criticidad: 'ADMISIBILIDAD_DURA', tipo: 'linea_tecnica', ofertamos: true },
    { estado: 'PENDIENTE', criticidad: 'ADMISIBILIDAD_DURA', tipo: 'linea_tecnica', ofertamos: false },
  ]);
  assert.equal(resumen.pendientes, 0);
  assert.equal(resumen.bloqueantesPendientes, 0);
});

test('una línea técnica SIN marca (negocio sin decisión) sí cuenta como pendiente', () => {
  const resumen = resumirChecklist([
    { estado: 'PENDIENTE', criticidad: 'ADMISIBILIDAD_DURA', tipo: 'linea_tecnica', ofertamos: null },
  ]);
  assert.equal(resumen.pendientes, 1);
  assert.equal(resumen.bloqueantesPendientes, 1);
});

test('el comportamiento viejo se mantiene: un precio no ofertado tampoco cuenta', () => {
  const resumen = resumirChecklist([
    { estado: 'PENDIENTE', criticidad: 'ADMISIBILIDAD_DURA', tipo: 'precio', ofertamos: false },
  ]);
  assert.equal(resumen.pendientes, 0);
});

// ─── ESTADO DEL BLOQUE: mismo criterio que el avance ──────────────────────────────────────────
// estadoDeBloque tenía la misma comprobación estrecha (`tipo === 'precio'`) que resumirChecklist.
// Sin generalizarla, el bloque TÉCNICO quedaba "pendiente" para siempre por una línea a la que ni
// siquiera nos presentamos, y el asesor no podía cerrarlo nunca.
test('estadoDeBloque ignora una línea técnica fuera de la oferta', () => {
  assert.equal(estadoDeBloque([
    { estado: 'APROBADO', tipo: 'linea_tecnica', ofertamos: true, clave_origen: 'tecnico:linea:7' },
    { estado: 'PENDIENTE', tipo: 'linea_tecnica', ofertamos: false, clave_origen: 'tecnico:linea:2' },
  ]), 'APROBADO');
});

test('estadoDeBloque SÍ cuenta una línea técnica sin marca (negocio sin decisión)', () => {
  assert.equal(estadoDeBloque([
    { estado: 'APROBADO', tipo: 'linea_tecnica', ofertamos: true, clave_origen: 'tecnico:linea:7' },
    { estado: 'PENDIENTE', tipo: 'linea_tecnica', ofertamos: null, clave_origen: 'tecnico:linea:2' },
  ]), 'PENDIENTE');
});

// ─── ALERTAS DE CUMPLIMIENTO: qué entra al acuse de lectura ───────────────────────────────────
// Fija el alcance de la acción ACUSAR: el route la rechaza en cualquier fila que NO sea alerta,
// para que nadie pueda saltarse la doble firma de un anexo real marcándolo "visto".
test('las condiciones sin entregable son alertas (van al acuse del asistente)', () => {
  assert.ok(esAlertaDeCumplimiento({ tipo: 'dato', clave_origen: 'bloqueante:cotizar_100' }));
});

test('un anexo, un precio y una línea técnica NO son alertas: siguen con doble firma', () => {
  assert.ok(!esAlertaDeCumplimiento({ tipo: 'documento', clave_origen: 'anexo:n1' }));
  assert.ok(!esAlertaDeCumplimiento({ tipo: 'precio', clave_origen: 'precio:linea:7' }));
  assert.ok(!esAlertaDeCumplimiento({ tipo: 'linea_tecnica', clave_origen: 'tecnico:linea:7' }));
});

test('el plazo es tipo dato pero NO es alerta: se compromete y se visa como el precio', () => {
  assert.ok(!esAlertaDeCumplimiento({ tipo: 'dato', clave_origen: 'comercial:plazo_entrega' }));
});
