// Tests del validador post-Fase 2 (Frente A.2). Cada regla se prueba con un caso que DEBE
// dispararla y uno que NO debe dispararla — para evitar lo que pasó hoy con V-04: una regla que
// "grita lobo" en casos correctos es tan mala como no tener la regla. Correr con:
//   npx tsx --test app/lib/__tests__/validador-viabilidad.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarInformeViabilidad } from '../validador-viabilidad';

const base = { adjudicacion: {}, presupuesto: {}, plazos: {}, tarjeta_decision: {}, veredicto: {} };
const halla = (regla: string, hallazgos: any[]) => hallazgos.some(h => h.regla === regla);

test('V-01: suma de ponderaciones que NO da 100% dispara error', () => {
  const inf = { ...base, criterios_evaluacion: { suma_ponderaciones_real: 85, criterios: [{ nombre: 'a', ponderacion_efectiva: 85 }] } };
  const r = validarInformeViabilidad(inf, 50);
  assert.ok(halla('V-01', r.hallazgos));
});

test('V-01: suma en 100% NO dispara', () => {
  const inf = { ...base, criterios_evaluacion: { suma_ponderaciones_real: 100, criterios: [{ nombre: 'a', ponderacion_efectiva: 100 }] } };
  const r = validarInformeViabilidad(inf, 50);
  assert.ok(!halla('V-01', r.hallazgos));
});

test('V-02: tarjeta GANABLE con score bajo dispara error', () => {
  const inf = { ...base, tarjeta_decision: { veredicto: 'GANABLE' } };
  const r = validarInformeViabilidad(inf, 20);
  assert.ok(halla('V-02', r.hallazgos));
});

test('V-02: tarjeta coherente con el score NO dispara', () => {
  const inf = { ...base, tarjeta_decision: { veredicto: 'GANABLE' } };
  const r = validarInformeViabilidad(inf, 60);
  assert.ok(!halla('V-02', r.hallazgos));
});

// Caso real 2295-74-LE26/2446-167-LP26: no marcar POR_TRAMOS con tablas discretas correctas
// como si fuera LEY_DEL_MINIMO/MAXIMO mal clasificado. Regresión de la corrección de hoy.
test('V-04: POR_TRAMOS con tabla discreta correcta NO dispara (regresión del fix de hoy)', () => {
  const inf = {
    ...base,
    criterios_evaluacion: {
      criterios: [
        { nombre: 'Cumplimiento requisitos formales', clase: 'POR_TRAMOS', forma_aplicacion: 'Tabla: 7.00 si cumple todos al cierre; 5.00 si subsana todo; 3.00 si subsana parcial; 1.00 si no subsana.' },
        { nombre: 'Procedencia del Oferente', clase: 'POR_TRAMOS', forma_aplicacion: 'Tabla: Talca 7.00; Provincia Talca 6.00; Región Maule 5.00; fuera región 4.00.' },
      ],
    },
  };
  const r = validarInformeViabilidad(inf, 50);
  assert.ok(!halla('V-04', r.hallazgos));
});

test('V-04: POR_TRAMOS con fórmula continua (confusión real con LEY_DEL_MINIMO) SÍ dispara', () => {
  const inf = {
    ...base,
    criterios_evaluacion: {
      criterios: [{ nombre: 'Oferta Económica', clase: 'POR_TRAMOS', forma_aplicacion: 'Se asigna puntaje según la fórmula: (Menor precio ofertado / Precio de la oferta evaluada) * 7.' }],
    },
  };
  const r = validarInformeViabilidad(inf, 50);
  assert.ok(halla('V-04', r.hallazgos));
});

test('V-07: presupuesto neto que no coincide con bruto/1.19 dispara error', () => {
  const inf = { ...base, presupuesto: { bruto: 27_000_000, neto: 2_270_000 } };
  const r = validarInformeViabilidad(inf, 50);
  assert.ok(halla('V-07', r.hallazgos));
});

test('V-07: presupuesto neto coherente NO dispara', () => {
  const inf = { ...base, presupuesto: { bruto: 27_000_000, neto: Math.round(27_000_000 / 1.19) } };
  const r = validarInformeViabilidad(inf, 50);
  assert.ok(!halla('V-07', r.hallazgos));
});

// Caso real 1057499-37-LE26: GLOBAL con estrategia "atacar/soltar" líneas es contradictorio.
test('V-11: adjudicación GLOBAL con estrategia atacar/soltar y cotizar_100 dispara error', () => {
  const inf = {
    ...base,
    adjudicacion: { como_se_adjudica: 'GLOBAL', cotizar_100_obligatorio: true },
    lineas_a_atacar: { modo: 'POR_LINEAS', lineas: [{ linea: 'L1', decision: 'atacar' }, { linea: 'L4', decision: 'soltar' }] },
  };
  const r = validarInformeViabilidad(inf, 50);
  assert.ok(halla('V-11', r.hallazgos));
});

// Caso real 2295-74-LE26: manifiesto colapsado a 1 ítem/línea (la categoría completa, cantidad 0).
test('V-12: manifiesto colapsado (1 ítem/línea, sin cantidad) en licitación por línea dispara error', () => {
  const items = [
    { linea: 1, cantidad: 0 }, { linea: 2, cantidad: 0 }, { linea: 3, cantidad: 0 }, { linea: 4, cantidad: 0 },
  ];
  const inf = { ...base, adjudicacion: { como_se_adjudica: 'POR_LINEAS' }, productos: { items } };
  const r = validarInformeViabilidad(inf, 50);
  assert.ok(halla('V-12', r.hallazgos));
});

test('V-12: manifiesto real (varios ítems por línea, con cantidad) NO dispara', () => {
  const items = Array.from({ length: 20 }, (_, i) => ({ linea: (i % 4) + 1, cantidad: i + 1 }));
  const inf = { ...base, adjudicacion: { como_se_adjudica: 'POR_LINEAS' }, productos: { items } };
  const r = validarInformeViabilidad(inf, 50);
  assert.ok(!halla('V-12', r.hallazgos));
});

// Caso real 2446-167-LP26: la propia cita dice "Múltiple (Por líneas)" pero quedó GLOBAL.
test('V-13: adjudicación GLOBAL que cita "Múltiple (Por líneas)" dispara error', () => {
  const inf = { ...base, adjudicacion: { como_se_adjudica: 'GLOBAL', fuente: 'pág. 21: "TIPO DE ADJUDICACIÓN Múltiple (Por lineas)"' } };
  const r = validarInformeViabilidad(inf, 50);
  assert.ok(halla('V-13', r.hallazgos));
});

// Caso real 4116-13-LP26/4099-18-LE26/3890-114-L126: enum con espacio en vez de guion bajo.
test('V-14: veredicto mal formado ("PUEDE SER" con espacio) dispara error', () => {
  const inf = { ...base, tarjeta_decision: { veredicto: 'PUEDE SER' } };
  const r = validarInformeViabilidad(inf, 40);
  assert.ok(halla('V-14', r.hallazgos));
});

test('V-14: veredicto bien formado NO dispara', () => {
  const inf = { ...base, tarjeta_decision: { veredicto: 'PUEDE_SER' } };
  const r = validarInformeViabilidad(inf, 40);
  assert.ok(!halla('V-14', r.hallazgos));
});
