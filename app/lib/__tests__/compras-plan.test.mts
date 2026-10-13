// Planificación del Gantt de Compras: el plazo de entrega corre desde el hito que dicen las bases,
// con días hábiles que saltan fines de semana y feriados de Chile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularHitosGantt, planificarTarea, inicioPlazoDeBases, desfaseDeBases, sumarDias, type EntradaAnclas } from '../compras-plan';

const base: EntradaAnclas = {
  ganadoAt: '2026-10-01 10:00:00', ocEmitidaAt: null, ocAceptadaAt: null,
  hitoInicioPlazo: 'Desde la aceptación de la orden de compra', plazoEntregaDias: 15,
  plazoAceptacionOCDias: 2, entregaOficialAt: null,
};

// Licitación 387-55-LE26 (negocio 1191): OC llegó el viernes 9-oct-2026; las bases dan 2 días hábiles
// para aceptarla, el plazo parte «aceptación de la OC (+1 día hábil siguiente)» y dura 1 día corrido.
// El lunes 12-oct es feriado: se acepta a más tardar el miércoles 14 y se entrega el jueves 15.
const caso1191: EntradaAnclas = {
  ganadoAt: '2026-10-08 16:03:39', ocEmitidaAt: '2026-10-09', ocAceptadaAt: null,
  hitoInicioPlazo: 'aceptación de la orden de compra (+1 día hábil siguiente)', plazoEntregaDias: 1, plazoEntregaTipo: 'CORRIDOS',
  plazoAceptacionOCDias: 2, plazoAceptacionTipo: 'HABILES', entregaOficialAt: null,
};

test('inicioPlazoDeBases / desfaseDeBases: leen de dónde corre el plazo', () => {
  assert.equal(inicioPlazoDeBases('Desde la aceptación de la OC'), 'OC_ACEPTADA');
  assert.equal(inicioPlazoDeBases('Desde la notificación de la orden de compra (24h después de la adjudicación)'), 'OC_EMITIDA');
  assert.equal(inicioPlazoDeBases('Desde la adjudicación'), 'ADJUDICACION');
  assert.equal(inicioPlazoDeBases('Desde la firma del contrato'), null);
  assert.equal(inicioPlazoDeBases(null), null);
  assert.deepEqual(desfaseDeBases('aceptación de la orden de compra (+1 día hábil siguiente)'), { n: 1, tipo: 'HABILES' });
  assert.equal(desfaseDeBases('Desde la aceptación de la OC'), null);
});

test('sumarDias hábiles salta fines de semana y feriados de Chile', () => {
  // Viernes 9-oct + 2 hábiles: lunes 12 es feriado → martes 13 y miércoles 14.
  assert.equal(sumarDias('2026-10-09 00:00:00', 2, 'HABILES'), '2026-10-14 00:00:00');
  assert.equal(sumarDias('2026-10-09 00:00:00', 2, 'CORRIDOS'), '2026-10-11 00:00:00');
});

test('caso 1191: OC llegó, falta aceptarla → se acepta el miércoles 14 y se entrega el jueves 15', () => {
  const h = calcularHitosGantt(caso1191);
  assert.equal(h.ocLimite, '2026-10-14 23:59:00');
  assert.equal(h.ocAceptadaProyectada, h.ocLimite);
  assert.equal(h.inicioProyectado, true);
  assert.equal(h.inicioPlazo, '2026-10-15 00:00:00');
  assert.equal(h.entrega, '2026-10-15 23:59:00');
});

test('caso 1191: si se acepta antes, la entrega se corre sola', () => {
  const h = calcularHitosGantt({ ...caso1191, ocAceptadaAt: '2026-10-13' });
  assert.equal(h.inicioProyectado, false);
  assert.equal(h.inicioPlazo, '2026-10-14 00:00:00');
  assert.equal(h.entrega, '2026-10-14 23:59:00');
});

test('sin OC y plazo desde la aceptación: no hay inicio ni fecha de entrega', () => {
  const h = calcularHitosGantt(base);
  assert.equal(h.inicioPlazo, null);
  assert.equal(h.entrega, null);
  assert.equal(h.ocLimite, '2026-10-03 23:59:00');
});

test('con OC aceptada el plazo parte de la aceptación', () => {
  const h = calcularHitosGantt({ ...base, ocEmitidaAt: '2026-10-02', ocAceptadaAt: '2026-10-05' });
  assert.equal(h.inicioPlazo, '2026-10-05 00:00:00');
  assert.equal(h.entrega, '2026-10-20 23:59:00');
});

test('plazo desde la llegada de la OC usa la emisión, no la aceptación', () => {
  const h = calcularHitosGantt({ ...base, hitoInicioPlazo: 'Desde la notificación de la orden de compra', ocEmitidaAt: '2026-10-02', ocAceptadaAt: '2026-10-05' });
  assert.equal(h.entrega, '2026-10-17 23:59:00');
  assert.equal(h.inicioProyectado, false);
});

test('bases que no aclaran el inicio: por validar, salvo Reloj de Entrega fijado', () => {
  const sinHito = calcularHitosGantt({ ...base, hitoInicioPlazo: null, ocEmitidaAt: '2026-10-02' });
  assert.equal(sinHito.inicioPlazoTipo, null);
  assert.equal(sinHito.entrega, null);
  const conReloj = calcularHitosGantt({ ...base, hitoInicioPlazo: null, ocEmitidaAt: '2026-10-02', entregaOficialAt: '2026-10-30' });
  assert.equal(conReloj.entrega, '2026-10-30 23:59:00');
  assert.equal(conReloj.entregaOficial, true);
});

test('tarea anclada a la adjudicación usa su plazo guardado', () => {
  const h = calcularHitosGantt(base);
  const p = planificarTarea({ ancla: 'ADJUDICACION', desfaseHoras: 0, duracionHoras: null, plazoAt: '2026-10-02 10:00:00' }, h);
  assert.deepEqual(p, { inicio: '2026-10-01 10:00:00', fin: '2026-10-02 10:00:00' });
});

test('aceptar la OC va desde que llega hasta el último día permitido', () => {
  const h = calcularHitosGantt(caso1191);
  assert.deepEqual(planificarTarea({ ancla: 'LIMITE_OC', desfaseHoras: 0, duracionHoras: null, plazoAt: null }, h),
    { inicio: '2026-10-09 00:00:00', fin: '2026-10-14 23:59:00' });
});

test('tarea anclada a la OC no tiene fechas mientras la OC no llegue', () => {
  const h = calcularHitosGantt(base);
  assert.deepEqual(planificarTarea({ ancla: 'OC', desfaseHoras: 24, duracionHoras: 48, plazoAt: null }, h), { inicio: null, fin: null });
});

test('tarea anclada a la OC parte desfasada en horas', () => {
  const h = calcularHitosGantt({ ...base, ocEmitidaAt: '2026-10-02' });
  assert.deepEqual(planificarTarea({ ancla: 'OC', desfaseHoras: 24, duracionHoras: 48, plazoAt: null }, h), { inicio: '2026-10-03 00:00:00', fin: '2026-10-05 00:00:00' });
});

test('tareas de entrega se encogen dentro de un plazo corto y no se salen de él', () => {
  const h = calcularHitosGantt(caso1191);   // plazo: jueves 15, 00:00 → 23:59
  const rec = planificarTarea({ ancla: 'FIN_PLAZO', desfaseHoras: -168, duracionHoras: 72, plazoAt: null }, h);
  const ent = planificarTarea({ ancla: 'FIN_PLAZO', desfaseHoras: -24, duracionHoras: 24, plazoAt: null }, h);
  assert.equal(rec.inicio, '2026-10-15 00:00:00');
  assert.ok(rec.fin! <= h.entrega!);
  assert.ok(ent.inicio! > rec.inicio! && ent.fin! <= h.entrega!);
});

test('tareas de entrega con plazo largo no parten antes de que corra el plazo', () => {
  const h = calcularHitosGantt({ ...base, ocEmitidaAt: '2026-10-02', ocAceptadaAt: '2026-10-05' });   // 05-oct → 20-oct (15 d)
  const p = planificarTarea({ ancla: 'FIN_PLAZO', desfaseHoras: -168, duracionHoras: 72, plazoAt: null }, h);
  assert.equal(p.inicio, '2026-10-13 23:59:00');
});
