// Módulo de Compras, Fase 1 — pruebas de la aritmética de fechas "de pared" (sin BD ni IA): el SLA
// de asignación (3h hábiles) y los plazos de tareas (días hábiles/corridos) dependen enteramente de
// esto, así que un error acá se propaga silenciosamente a cada negocio que entra al módulo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sumarHorasHabiles, sumarDiasHabiles, sumarDiasCorridos, parsearCamposCatalogo, leerPlazosDelInforme, ocDifiereDeLoAdjudicado } from '../compras';

// Los Date de estas pruebas son "flotantes": Date.UTC(y, m, d, h, mi) representa la hora de pared
// de Chile directamente, sin ninguna conversión de zona — mismo truco que usa compras.ts.
const fecha = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(Date.UTC(y, m - 1, d, h, mi));
const fmt = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;

test('sumarHorasHabiles: dentro de la misma jornada no cruza de día', () => {
  // Martes 10:00 + 3h → Martes 13:00.
  const r = sumarHorasHabiles(fecha(2026, 9, 8, 10, 0), 3);
  assert.equal(fmt(r), '2026-09-08 13:00');
});

test('sumarHorasHabiles: cruza al día hábil siguiente cuando no alcanza la jornada', () => {
  // Martes 17:00 + 3h: quedan 1h de jornada (hasta 18:00), las 2h restantes empiezan el miércoles 09:00 → 11:00.
  const r = sumarHorasHabiles(fecha(2026, 9, 8, 17, 0), 3);
  assert.equal(fmt(r), '2026-09-09 11:00');
});

test('sumarHorasHabiles: viernes tarde salta el fin de semana hasta el lunes', () => {
  // Viernes 4-sep-2026 17:30 + 3h: 30 min hasta las 18:00, 2.5h restantes desde el lunes 09:00 → 11:30.
  const r = sumarHorasHabiles(fecha(2026, 9, 4, 17, 30), 3);
  assert.equal(fmt(r), '2026-09-07 11:30');
});

test('sumarHorasHabiles: iniciado fuera de horario (noche) arranca en el próximo inicio de jornada', () => {
  // Martes 22:00 + 1h → miércoles 09:00 + 1h = 10:00.
  const r = sumarHorasHabiles(fecha(2026, 9, 8, 22, 0), 1);
  assert.equal(fmt(r), '2026-09-09 10:00');
});

test('sumarHorasHabiles: iniciado en fin de semana salta al lunes', () => {
  // Sábado → arranca el lunes 09:00, + 2h = 11:00.
  const r = sumarHorasHabiles(fecha(2026, 9, 5, 12, 0), 2);
  assert.equal(fmt(r), '2026-09-07 11:00');
});

test('sumarDiasHabiles: cuenta solo Lunes-Viernes', () => {
  // Jueves 3-sep-2026 + 3 días hábiles → vie(1) sáb/dom se saltan, lun(2), mar(3) → martes 8-sep.
  const r = sumarDiasHabiles(fecha(2026, 9, 3, 9, 0), 3);
  assert.equal(fmt(r), '2026-09-08 09:00');
});

test('sumarDiasCorridos: suma calendario plano, cruza fin de semana sin saltarlo', () => {
  const r = sumarDiasCorridos(fecha(2026, 9, 3, 9, 0), 5);
  assert.equal(fmt(r), '2026-09-08 09:00');
});

// ─── Formulario de registro de la tarea (§5.3/§5.4 + §1.3.5) ────────────────────────────────────
// El cuestionario de cada tarea NO vive en el código: viene de compras_tarea_catalogo.campos_json,
// para que agregarle una pregunta sea un UPDATE y no un deploy. El precio de esa decisión es que el
// contenido lo escribe una persona en la base — así que el parser tiene que aguantar cualquier cosa
// sin voltear la pantalla de Compras entera.
test('parsearCamposCatalogo: lee el formulario que declara el catálogo', () => {
  const campos = parsearCamposCatalogo(JSON.stringify({ campos: [
    { clave: 'proveedor', etiqueta: 'Proveedor de respaldo', tipo: 'texto', placeholder: 'Razón social' },
    { clave: 'stock', etiqueta: '¿Hay stock?', tipo: 'si_no' },
    { clave: 'observaciones', etiqueta: 'Observaciones', tipo: 'parrafo' },
  ] }));
  assert.equal(campos.length, 3);
  assert.deepEqual(campos[0], { clave: 'proveedor', etiqueta: 'Proveedor de respaldo', tipo: 'texto', placeholder: 'Razón social' });
  assert.equal(campos[1].tipo, 'si_no');
  assert.equal(campos[2].tipo, 'parrafo');
});

test('parsearCamposCatalogo: acepta el array pelado, sin el envoltorio {campos:[...]}', () => {
  const campos = parsearCamposCatalogo(JSON.stringify([{ clave: 'a', etiqueta: 'A' }]));
  assert.equal(campos.length, 1);
  assert.equal(campos[0].tipo, 'texto');   // sin tipo declarado = campo de texto
});

test('parsearCamposCatalogo: un catálogo mal escrito deja la tarea SIN formulario, no rompe', () => {
  for (const basura of [null, '', '{', 'no soy json', '{"campos":"texto suelto"}', '{"otra":"cosa"}']) {
    assert.deepEqual(parsearCamposCatalogo(basura), [], `"${basura}" debería dar formulario vacío`);
  }
});

test('parsearCamposCatalogo: descarta los campos sin clave o sin etiqueta', () => {
  const campos = parsearCamposCatalogo(JSON.stringify({ campos: [
    { clave: 'ok', etiqueta: 'Sirve' },
    { clave: 'sin_etiqueta' },
    { etiqueta: 'Sin clave' },
    null,
    'texto suelto',
  ] }));
  assert.deepEqual(campos.map(c => c.clave), ['ok']);
});

test('parsearCamposCatalogo: un tipo desconocido cae a texto en vez de romper el render', () => {
  const campos = parsearCamposCatalogo(JSON.stringify({ campos: [{ clave: 'x', etiqueta: 'X', tipo: 'calendario_lunar' }] }));
  assert.equal(campos[0].tipo, 'texto');
});

// ─── Plazos del informe de viabilidad (§4.2 campos 5, 6 y 10) ───────────────────────────────────
// Contrastado contra el informe REAL de 1114-12-LE26 (negocio 717): ese es el que destapó el bug.
// El código miraba `linea_tiempo` y el informe —como todos los del prompt v3— trae `plazos`, así
// que el Resumen Ejecutivo salía sin plazo de entrega, sin hito de inicio, y con el plazo de
// aceptación de OC genérico cuando las bases decían 2 días hábiles.
const INFORME_1114 = {
  _informe_ia_v3: {
    plazos: {
      frontera: {
        descripcion: 'Desde la notificación de la orden de compra (24h después de la adjudicación)',
        base_computo: 'emision_oc',
        fuente: 'Bases_administrativas_y_tecnicas.pdf · numeral XVII.B · pág. 18',
      },
      aceptacion_oc: { duracion: 2, unidad: 'días hábiles', inferido: false, duracion_corridos: 2 },
      plazo_entrega_ofertable: { valor: '50 días corridos', fuente: 'Bases · numeral XVII' },
      hitos: [{ hito: 'Adjudicación', duracion: 0 }],
    },
  },
};

test('leerPlazosDelInforme: lee el esquema v3 (`plazos`) — el caso de 1114-12-LE26', () => {
  const p = leerPlazosDelInforme(INFORME_1114);
  assert.equal(p.plazoEntregaTexto, '50 días corridos');
  assert.equal(p.plazoEntregaDias, 50);
  assert.equal(p.hitoInicioPlazo, 'Desde la notificación de la orden de compra (24h después de la adjudicación) — emision_oc');
  assert.equal(p.plazoAceptacionOC, '2 días hábiles');   // no el genérico "tope legal 5 días"
});

test('leerPlazosDelInforme: sigue leyendo el esquema viejo (`linea_tiempo`)', () => {
  const p = leerPlazosDelInforme({ _informe_ia: { linea_tiempo: {
    frontera_inicio_computo: { descripcion: 'Desde la firma del contrato', base_computo: 'firma_contrato' },
    hitos: [{ hito: 'Entrega de bienes', duracion_dias: 30, tipo_dias: 'corridos' }],
  } } });
  assert.equal(p.plazoEntregaDias, 30);
  assert.equal(p.plazoEntregaTexto, '30 corridos — Entrega de bienes');
  assert.equal(p.hitoInicioPlazo, 'Desde la firma del contrato — firma_contrato');
});

test('leerPlazosDelInforme: un informe sin plazos no rompe nada, devuelve todo en null', () => {
  for (const informe of [null, undefined, {}, 'texto suelto', { _informe_ia_v3: {} }, { plazos: null }]) {
    const p = leerPlazosDelInforme(informe);
    assert.deepEqual(p, { plazoEntregaTexto: null, plazoEntregaDias: null, hitoInicioPlazo: null, plazoAceptacionOC: null });
  }
});

test('leerPlazosDelInforme: marca el plazo inferido, para no darlo por declarado', () => {
  const p = leerPlazosDelInforme({ plazos: { aceptacion_oc: { duracion: 5, unidad: 'días corridos', inferido: true } } });
  assert.equal(p.plazoAceptacionOC, '5 días corridos (inferido de las bases)');
});

test('leerPlazosDelInforme: el plazo de entrega en días sueltos también se entiende', () => {
  const p = leerPlazosDelInforme({ plazos: { plazo_entrega_ofertable: { duracion: 45, unidad: 'días corridos' } } });
  assert.equal(p.plazoEntregaDias, 45);
  assert.equal(p.plazoEntregaTexto, '45 días corridos');
});

// ─── ¿La orden de compra difiere de lo adjudicado? (§3.6) ───────────────────────────────────────
// Caso real: 1114-12-LE26 se adjudicó en $40.378.376 netos y la orden 1114-21-SE26 llegó por
// exactamente eso — total con IVA $48.050.267. Comparar el total CON IVA contra el neto marcaba un
// 19% de diferencia en TODAS las órdenes: la alerta se habría vuelto ruido el primer día.
test('ocDifiereDeLoAdjudicado: la orden que calza no dispara la alerta', () => {
  assert.equal(ocDifiereDeLoAdjudicado(40378376, 40378376), false);
  assert.equal(ocDifiereDeLoAdjudicado(40378376 + 5000, 40378376), false);  // redondeos del portal
});

test('ocDifiereDeLoAdjudicado: el caso que la spec quiere atrapar — la OC trae menos líneas', () => {
  // "Se ofertan 10 productos y el presupuesto alcanza para 5": la OC llega por la mitad.
  assert.equal(ocDifiereDeLoAdjudicado(20189188, 40378376), true);
  assert.equal(ocDifiereDeLoAdjudicado(44000000, 40378376), true);   // también si viene por más
});

test('ocDifiereDeLoAdjudicado: sin alguno de los dos datos no se afirma nada', () => {
  assert.equal(ocDifiereDeLoAdjudicado(null, 40378376), false);
  assert.equal(ocDifiereDeLoAdjudicado(40378376, null), false);
  assert.equal(ocDifiereDeLoAdjudicado(0, 40378376), false);
  assert.equal(ocDifiereDeLoAdjudicado(40378376, 0), false);
});
