// Saneo de lo que devuelve el modelo + catálogo acotado de "Personal idóneo" (1057448-45-LP26, 5-oct-2026).
//   npx tsx --test app/lib/__tests__/viabilidad-saneo.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esCero, trozosDeFrase, problemasCalidadGrupo } from '../viabilidad-v4/saneo';
import { LocalizadorCitas } from '../viabilidad-v4/citas';
import { calcularNivel } from '../score-viabilidad';
import { CONFIG_V4_DEFAULT, calzaCatalogo } from '../viabilidad-v4/config';

const cfg = CONFIG_V4_DEFAULT;
const CITA_OK = { documento: 'Bases.pdf', numeral: '1', frase: 'frase de prueba', verificada: true };

test('esCero: "0", "0 puntos", "0%" son vacío disfrazado; 60 y "70 puntos" no', () => {
  for (const v of ['0', ' 0 ', '0 puntos', '0%', '0,0', '00']) assert.equal(esCero(v), true, v);
  for (const v of ['', '60', '70 puntos', 'No aplica', null, undefined]) assert.equal(esCero(v), false, String(v));
});

test('trozosDeFrase: separa por "...", "…" y "[...]"; exige trozos de 3+ palabras', () => {
  assert.deepEqual(trozosDeFrase('se estima necesario encomendar dicha labor... con un gasto estimado de'), ['se estima necesario encomendar dicha labor', 'con un gasto estimado de']);
  assert.equal(trozosDeFrase('aceptar la Orden de Compra [...] dentro del plazo máximo').length, 2);
  assert.equal(trozosDeFrase('una frase normal sin puntos suspensivos').length, 0);
  assert.equal(trozosDeFrase('hola... mundo entero aquí').length, 0, 'un trozo de 1 palabra no sirve');
});

test('Localizador: frase unida con "..." se verifica si CADA trozo está en el MISMO documento', () => {
  const relleno = Array.from({ length: 60 }, (_, i) => `palabra${i}`).join(' ');
  const doc = { nombre: 'Bases.pdf', texto: `Capítulo 7. Dado que se estima necesario encomendar dicha labor a terceros, ${relleno} la entidad fijó un gasto estimado de $241.630.000 impuestos incluidos para todo el contrato.` };
  const loc = new LocalizadorCitas([doc, { nombre: 'Otro.pdf', texto: 'otro documento con texto distinto sobre un tema que no tiene relación alguna' }]);
  const c: any = { documento: 'Bases.pdf', frase: 'se estima necesario encomendar dicha labor a terceros... la entidad fijó un gasto estimado de $241.630.000 impuestos incluidos' };
  loc.localizar(c);
  assert.equal(c.verificada, true);
  assert.equal(c.metodo, 'segmentada');
});

test('Localizador: trozos en documentos DISTINTOS no se aceptan (no se mezclan lugares)', () => {
  const loc = new LocalizadorCitas([
    { nombre: 'A.pdf', texto: 'el contratista deberá presentar la garantía de fiel cumplimiento del contrato dentro del plazo' },
    { nombre: 'B.pdf', texto: 'las multas se aplicarán por cada día corrido de atraso en la entrega de los bienes licitados' },
  ]);
  const c: any = { frase: 'deberá presentar la garantía de fiel cumplimiento... por cada día corrido de atraso en la entrega' };
  loc.localizar(c);
  assert.equal(c.verificada, false);
});

test('problemasCalidadGrupo: 3 puntajes en 0 + JSON reparado se detectan; un grupo sano no', () => {
  const malo = { criterios_evaluacion: { puntaje_minimo_total: { valor: '0' }, criterios: [{ puntaje_minimo: { valor: '0' } }, { puntaje_minimo: { valor: '0 puntos' } }] } };
  const p = problemasCalidadGrupo('admisibilidad_criterios', malo, true);
  assert.ok(p.some(x => /puntajes mínimos/.test(x)));
  assert.ok(p.some(x => /reparó/.test(x)));
  const sano = { criterios_evaluacion: { puntaje_minimo_total: { valor: '' }, criterios: [{ puntaje_minimo: { valor: '' } }, { puntaje_minimo: { valor: '60' } }] } };
  assert.deepEqual(problemasCalidadGrupo('admisibilidad_criterios', sano, false), []);
});

test('problemasCalidadGrupo: carácter de presupuesto sin cita; citas con "…" ya NO cuentan (el localizador las acepta)', () => {
  const g = { presupuesto: { caracter: 'REFERENCIAL', cita: { frase: '' } }, plazos: { hitos: [{ cita: { frase: 'a b c ... d e f' } }, { cita: { frase: 'g h i … j k l' } }] } };
  const p = problemasCalidadGrupo('decisiones', g, false);
  assert.deepEqual(p, ['carácter del presupuesto sin cita']);
});

// ─── "Personal idóneo": el técnico certificado subcontratado NO deja fuera ──────────────────
const SUBCONTRATADO = 'No contar con personal de servicio técnico propio o subcontratado. Para que la oferta sea admisible, deberá acreditarse, al menos, un técnico con certificado de capacitación vigente otorgado por el fabricante y contrato vigente con el proveedor.';
const PROPIO = 'Deberá contar con un técnico certificado en servicio técnico, parte de la dotación permanente del oferente, con título profesional.';
const itemsDe = (n: number) => Array.from({ length: n }, (_, i) => ({ linea: 'L1', nombre: `Producto ${i + 1}`, familia: 'LABORATORIO' }));
const nivel = (requisito: string) => calcularNivel({
  adjudicacion: { resultado: 'GLOBAL' }, presupuesto: { neto: 72_000_000, cita: CITA_OK },
  productos: { items: itemsDe(1) }, criterios_evaluacion: { criterios: [] },
  requisitos_admisibilidad: { requisitos: [{ que: 'Personal técnico certificado', consecuencia: 'inadmisible', cita: { ...CITA_OK, frase: requisito } }] },
} as any, cfg, { codigo: '1057448-45-LP26', utm: 72_151, ahora: new Date('2026-10-05T12:00:00Z') });

test('Personal idóneo: "propio o subcontratado" con contrato con el proveedor → no excluye (resta como certificado de marca)', () => {
  assert.equal(calzaCatalogo(SUBCONTRATADO, cfg.admisibilidad_imposible[1]), null);
  const s = nivel(SUBCONTRATADO);
  assert.notEqual(s.nivel, 'EXCLUIDO');
  assert.ok(s.pasos.some(p => /certificado de servicio técnico de marca/i.test(p.regla)), 'resta el escalón de certificado de marca');
});

test('Personal idóneo: personal permanente con título profesional SÍ sigue excluyendo (F4)', () => {
  const s = nivel(PROPIO);
  assert.equal(s.nivel, 'EXCLUIDO');
  assert.equal(s.motivo_exclusion?.filtro, 'F4');
  assert.equal(s.accion_asistente, 'REVISAR_SALIDA');
});

test('Carácter del presupuesto corregido: el score lo avisa en pantalla', () => {
  const s = calcularNivel({
    adjudicacion: { resultado: 'GLOBAL' }, presupuesto: { neto: 72_000_000, cita: CITA_OK, caracter: 'NO_DECLARADO', caracter_corregido: { antes: 'REFERENCIAL', motivo: 'x' } },
    productos: { items: itemsDe(1) }, criterios_evaluacion: { criterios: [] }, requisitos_admisibilidad: { requisitos: [] },
  } as any, cfg, { codigo: '1057448-45-LP26', utm: 72_151, ahora: new Date('2026-10-05T12:00:00Z') });
  assert.ok(s.avisos.some(a => /carácter del presupuesto/i.test(a)));
});
