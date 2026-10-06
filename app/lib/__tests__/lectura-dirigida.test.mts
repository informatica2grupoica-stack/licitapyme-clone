// Lectura dirigida de multas y hitos del plazo previo. Caso fuente: 1057536-136-LE26 (06-oct-2026):
// el modelo dijo "sin multas" teniendo la tabla del punto 21.1, y en otra corrida citó "15 días
// hábiles" y "48 horas" pero dejó los hitos "no indicados" (plazo previo 0 días).
//   npx tsx --test app/lib/__tests__/lectura-dirigida.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extraerPasajesPlazosMultas, aplicarLecturaDirigida, necesitaLecturaDirigida, plazoEnFrase } from '../viabilidad-v4/lectura-dirigida';
import { calcularPlazoPrevio, normalizarHitos } from '../viabilidad-v4/plazo-previo';

const BASES = `${'Texto de relleno de las bases.\n'.repeat(40)}
21.1 Multas
Se aplicarán multas por incumplimiento en los plazos de entrega.
a) De 01 a 5 días corridos de atraso, de acuerdo al plazo ofertado
Falta menos grave
0,3% diario
b) De 6 días hasta 11 días corridos de atraso
Falta grave 0,5% diario
El tope máximo para la aplicación de la multa será de un 10% del precio del equipo.
${'Más relleno.\n'.repeat(60)}
20.2 Suscripción del Contrato
El respectivo contrato deberá suscribirse dentro de los 15 días hábiles siguientes a la notificación de la resolución de adjudicación.
En caso que la Orden de compra formalice la adquisición, esta deberá ser aceptada por el adjudicatario dentro de un plazo de 48 horas, una vez enviada.
${'Cierre.\n'.repeat(30)}`;

const ident = (c: any) => ({ ...c, verificada: true });

test('los pasajes incluyen la multa y los plazos, y dejan afuera la planilla de costeo', () => {
  const p = extraerPasajesPlazosMultas([
    { nombre: 'RESOLUCION.pdf', categoria: 'BASES_ADMINISTRATIVAS', texto: BASES },
    { nombre: 'COSTEO_X.xlsx', categoria: 'DOCUMENTOS_PROPIOS', texto: 'multa 5% diario atraso' },
  ]);
  const todo = p.map(x => x.texto).join('\n');
  assert.ok(p.every(x => x.doc === 'RESOLUCION.pdf'));
  assert.match(todo, /0,3% diario/);
  assert.match(todo, /15 días hábiles/);
  assert.match(todo, /48 horas/);
});

test('plazoEnFrase lee número, palabra y unidad', () => {
  assert.deepEqual(plazoEnFrase('Dentro de los 15 días hábiles administrativos posteriores'), { plazo: 15, unidad: 'días hábiles' });
  assert.deepEqual(plazoEnFrase('aceptada dentro de un plazo de 48 horas'), { plazo: 48, unidad: 'horas' });
  assert.deepEqual(plazoEnFrase('quince (15) días corridos'), { plazo: 15, unidad: 'días corridos' });
  assert.equal(plazoEnFrase('sin plazo alguno'), null);
});

test('hitos "no indicados" con el plazo en la frase citada se reparan sin IA', () => {
  const hitos: any[] = normalizarHitos([
    { hito: 'FIRMA_CONTRATO_PROVEEDOR', estado: 'NO_INDICADO', plazo: null, cita: { frase: 'Plazo para Firma de Contrato Dentro de los 15 días hábiles administrativos posteriores a la adjudicación', verificada: true } },
    { hito: 'ACEPTACION_OC', estado: 'NO_INDICADO', plazo: null, cita: { frase: 'la Orden de compra deberá ser aceptada por el adjudicatario dentro de un plazo de 48 horas', verificada: true } },
  ]);
  const r = aplicarLecturaDirigida({}, hitos, null, ident);
  assert.equal(r.reparados.length, 2);
  const calc = calcularPlazoPrevio(hitos, null, new Date('2026-10-07'), 'test', new Set());
  assert.ok(calc.total_dias_corridos > 0);
  assert.equal(calc.desglose.find(d => d.hito === 'FIRMA_CONTRATO_PROVEEDOR')?.estado, 'EXISTE');
});

test('multa "no existe" + pasada dirigida con frase verificada → se corrige; frase no verificada → no', () => {
  const salida = { multa_atraso: { existe: true, valor: '0,3% diario', unidad: 'PORCENTAJE', periodo: 'DIA_CORRIDO', tope: { valor: '10%', unidad: 'PORCENTAJE' }, cita: { documento: 'R.pdf', numeral: '21.1', frase: '0,3% diario' } }, hitos: [] };
  const a: any = { multas: { atraso: { existe: false } } };
  aplicarLecturaDirigida(a, normalizarHitos([]), salida, ident);
  assert.equal(a.multas.atraso.existe, true);
  assert.equal(a.multas.atraso.valor, '0,3% diario');
  const b: any = { multas: { atraso: { existe: false } } };
  const r = aplicarLecturaDirigida(b, normalizarHitos([]), salida, (c: any) => ({ ...c, verificada: false }));
  assert.equal(b.multas.atraso.existe, false);
  assert.equal(r.avisos.length, 1);
});

test('la VIGENCIA de la garantía no cuenta como plazo previo; la garantía va junto con la firma del contrato', () => {
  const hitos: any[] = normalizarHitos([
    { hito: 'GARANTIA_FIEL_CUMPLIMIENTO', estado: 'EXISTE', plazo: 90, unidad_original: 'días corridos', cita: { frase: 'Vigencia (90) Noventa días corridos adicionales a contar de la fecha de término de la garantía técnica', verificada: true } },
    { hito: 'FIRMA_CONTRATO_PROVEEDOR', estado: 'EXISTE', plazo: 15, unidad_original: 'días hábiles', cita: { frase: '15 días hábiles', verificada: true } },
  ]);
  assert.ok(necesitaLecturaDirigida({ multas: { atraso: { existe: true, valor: 'x' } } }, hitos).some(m => /vigencia/.test(m)));
  const salida = { hitos: [{ hito: 'GARANTIA_FIEL_CUMPLIMIENTO', estado: 'EXISTE', plazo: null, simultaneo_con: 'FIRMA_CONTRATO_PROVEEDOR', desde: 'notificación', cita: { frase: 'debe acompañar la garantía de fiel cumplimiento' } }] };
  const r = aplicarLecturaDirigida({}, hitos, salida, ident);
  assert.equal(r.reparados.length, 1);
  const calc = calcularPlazoPrevio(hitos, null, new Date('2026-10-07'), 'test', new Set());
  // 15 días hábiles ≈ 21 corridos; antes sumaba 90 + 21 = 111
  assert.ok(calc.total_dias_corridos >= 19 && calc.total_dias_corridos <= 23, `total ${calc.total_dias_corridos}`);
  assert.equal(calc.desglose[0].simultaneo_con, 'FIRMA_CONTRATO_PROVEEDOR');
});

test('si la primera pasada trae OTRO valor, manda la lectura dirigida (frase literal) y queda el valor anterior', () => {
  const p3: any = { multas: { atraso: { existe: true, valor: '5% diario' } } };
  const salida = { multa_atraso: { existe: true, valor: '0,3% diario', cita: { frase: '0,3% diario' } },
    hitos: [{ hito: 'FIRMA_CONTRATO_PROVEEDOR', estado: 'EXISTE', plazo: 15, unidad_original: 'días hábiles', cita: { frase: '15 días hábiles' } }] };
  const hitos: any[] = normalizarHitos([{ hito: 'FIRMA_CONTRATO_PROVEEDOR', estado: 'EXISTE', plazo: 15, unidad_original: 'días corridos', cita: { frase: 'x', verificada: true } }]);
  const r = aplicarLecturaDirigida(p3, hitos, salida, ident);
  assert.equal(p3.multas.atraso.valor, '0,3% diario');
  assert.match(p3.multas.atraso.corregido_por_lectura_dirigida, /5% diario/);
  assert.equal(hitos[1].unidad_original, 'días hábiles');
  assert.equal(r.reparados.length, 2);
});

test('mismo valor en ambas pasadas → no se toca; "junto con" con estado NO_INDICADO igual cuenta como existente', () => {
  const p3: any = { multas: { atraso: { existe: true, valor: '0,3% diario del día 1 al 5; 0,5% del 6 al 11' } } };
  const salida = { multa_atraso: { existe: true, valor: '0,3% diario', cita: { frase: '0,3% diario' } },
    hitos: [{ hito: 'GARANTIA_FIEL_CUMPLIMIENTO', estado: 'NO_INDICADO', simultaneo_con: 'FIRMA_CONTRATO_PROVEEDOR', cita: { frase: 'deberá acompañar la garantía' } }] };
  const hitos: any[] = normalizarHitos([]);
  aplicarLecturaDirigida(p3, hitos, salida, ident);
  assert.equal(p3.multas.atraso.corregido_por_lectura_dirigida, undefined);
  assert.equal(hitos[0].estado, 'EXISTE');
  assert.equal(hitos[0].simultaneo_con, 'FIRMA_CONTRATO_PROVEEDOR');
});
