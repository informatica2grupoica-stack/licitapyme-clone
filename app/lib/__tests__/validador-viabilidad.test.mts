// Tests del validador post-Fase 2 (Frente A.2). Cada regla se prueba con un caso que DEBE
// dispararla y uno que NO debe dispararla — para evitar lo que pasó hoy con V-04: una regla que
// "grita lobo" en casos correctos es tan mala como no tener la regla. Correr con:
//   npx tsx --test app/lib/__tests__/validador-viabilidad.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarInformeViabilidad, autocorregirHallazgos, escalarARevisionHumana } from '../validador-viabilidad';

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

// ── V-15: regla anti-invento — las fuentes documentales deben concordar ───────────────────
// Caso real 1414396-21-LP26: Anexo Económico 29 ítems vs. Resolución Exenta 34 (5 filas coladas
// de la tabla de distribución de entrega). Se elige la fuente autoritativa, pero la discrepancia
// se levanta igual: que dos documentos no calcen amerita que alguien lo mire.
test('V-15: fuentes que no coinciden en el listado de productos disparan aviso', () => {
  const inf = {
    ...base,
    _fuentes_manifiesto: {
      elegida: 'Anexo_Económico.xlsx',
      candidatos: [
        { fuenteDoc: 'Anexo_Económico.xlsx', autoridad: 0, items: 29, elegido: true },
        { fuenteDoc: 'Rex._N°1897_de_2026_C.pdf', autoridad: 2, items: 34, elegido: false },
      ],
      discrepancias: ['"Rex._N°1897_de_2026_C.pdf" lista 34 ítems y la fuente elegida "Anexo_Económico.xlsx" lista 29'],
    },
  };
  const r = validarInformeViabilidad(inf, 50);
  assert.ok(halla('V-15', r.hallazgos), 'debe avisar que las fuentes no calzan');
  assert.match(r.hallazgos.find(h => h.regla === 'V-15')!.mensaje, /Anexo_Económico\.xlsx/,
    'el aviso debe nombrar la fuente elegida para que se pueda contrastar');
});

test('V-15: fuentes que concuerdan NO disparan', () => {
  const inf = {
    ...base,
    _fuentes_manifiesto: {
      elegida: 'Anexo_Económico.xlsx',
      candidatos: [{ fuenteDoc: 'Anexo_Económico.xlsx', autoridad: 0, items: 29, elegido: true }],
      discrepancias: [],
    },
  };
  assert.ok(!halla('V-15', validarInformeViabilidad(inf, 50).hallazgos));
});

test('V-15: sin traza de fuentes (informes viejos) NO dispara', () => {
  assert.ok(!halla('V-15', validarInformeViabilidad({ ...base }, 50).hallazgos));
});

// ─── Frente A.2 (28-jul-2026): circuito FAIL → auto-corrección / re-análisis / revisión humana ───
// OJO: `base` tiene objetos anidados (veredicto, tarjeta_decision, etc.) que un spread {...base}
// NO clona (siguen siendo la MISMA referencia). Como estos tests SÍ mutan `inf` (a diferencia de
// los de arriba, que solo leen), cada uno arma sus propios objetos anidados frescos — si
// reusaran los de `base` contaminarían los tests siguientes.
const infFresco = (extra: Record<string, any>): any => ({
  adjudicacion: {}, presupuesto: {}, plazos: {}, tarjeta_decision: {}, veredicto: {}, ...extra,
});

test('autocorregirHallazgos V-02: corrige el veredicto al valor que implica el score', () => {
  const inf = infFresco({ tarjeta_decision: { veredicto: 'GANABLE' } });
  const r = validarInformeViabilidad(inf, 20);
  const aplicadas = autocorregirHallazgos(inf, r.hallazgos, 20);
  assert.ok(aplicadas.some(a => a.regla === 'V-02'));
  assert.equal(inf.tarjeta_decision.veredicto, 'NO_VAMOS');
  assert.ok(!halla('V-02', validarInformeViabilidad(inf, 20).hallazgos), 'tras corregir, re-validar ya no debe disparar V-02');
});

test('autocorregirHallazgos V-05: fuerza cadena="larga" cuando exige fiel cumplimiento', () => {
  const inf = infFresco({ requisitos_admisibilidad: { fiel_cumplimiento: { exige: true } }, plazos: { cadena: 'corta' } });
  const r = validarInformeViabilidad(inf, 50);
  const aplicadas = autocorregirHallazgos(inf, r.hallazgos, 50);
  assert.ok(aplicadas.some(a => a.regla === 'V-05'));
  assert.equal(inf.plazos.cadena, 'larga');
});

test('autocorregirHallazgos V-06: fuerza NO_VAMOS/DESCARTE con gate duro activo', () => {
  const inf = infFresco({ exclusion: { excluido: true }, tarjeta_decision: { veredicto: 'GANABLE' }, veredicto: { nivel: 'MUY_VIABLE' } });
  const r = validarInformeViabilidad(inf, 19);
  const aplicadas = autocorregirHallazgos(inf, r.hallazgos, 19);
  assert.ok(aplicadas.some(a => a.regla === 'V-06'));
  assert.equal(inf.tarjeta_decision.veredicto, 'NO_VAMOS');
  assert.equal(inf.veredicto.nivel, 'DESCARTE');
});

test('autocorregirHallazgos V-07: recalcula presupuesto.neto = bruto/1.19', () => {
  const inf = infFresco({ presupuesto: { bruto: 27_000_000, neto: 2_270_000 } });
  const r = validarInformeViabilidad(inf, 50);
  const aplicadas = autocorregirHallazgos(inf, r.hallazgos, 50);
  assert.ok(aplicadas.some(a => a.regla === 'V-07'));
  assert.equal(inf.presupuesto.neto, Math.round(27_000_000 / 1.19));
});

test('autocorregirHallazgos V-13: corrige como_se_adjudica a POR_LINEAS usando la evidencia ya citada', () => {
  const inf = infFresco({ adjudicacion: { como_se_adjudica: 'GLOBAL', fuente: 'pág. 21: "TIPO DE ADJUDICACIÓN Múltiple (Por lineas)"' } });
  const r = validarInformeViabilidad(inf, 50);
  const aplicadas = autocorregirHallazgos(inf, r.hallazgos, 50);
  assert.ok(aplicadas.some(a => a.regla === 'V-13'));
  assert.equal(inf.adjudicacion.como_se_adjudica, 'POR_LINEAS');
  assert.equal(inf.adjudicacion.estado, 'DETERMINADA');
});

// Usa veredicto.nivel (no tarjeta_decision.veredicto): ese campo NO lo chequea V-02, así que se
// aísla la corrección de V-14 sin que V-02 también dispare y se adjudique el fix primero.
test('autocorregirHallazgos V-14: normaliza "MUY VIABLE" a "MUY_VIABLE"', () => {
  const inf = infFresco({ veredicto: { nivel: 'MUY VIABLE' } });
  const r = validarInformeViabilidad(inf, 40);
  const aplicadas = autocorregirHallazgos(inf, r.hallazgos, 40);
  assert.ok(aplicadas.some(a => a.regla === 'V-14'));
  assert.equal(inf.veredicto.nivel, 'MUY_VIABLE');
});

test('escalarARevisionHumana: V-01 (suma ponderaciones mal) marca REVISION_HUMANA citando la regla', () => {
  const inf = infFresco({ criterios_evaluacion: { suma_ponderaciones_real: 85, criterios: [{ nombre: 'a', ponderacion_efectiva: 85 }] } });
  const r = validarInformeViabilidad(inf, 50);
  const disparadas = escalarARevisionHumana(inf, r.hallazgos);
  assert.ok(disparadas.includes('V-01'));
  assert.equal(inf.veredicto.estado_veredicto, 'REVISION_HUMANA');
  assert.ok(inf.veredicto.motivos_revision.some((m: string) => m.startsWith('V-01:')));
});

test('escalarARevisionHumana: V-08 (aviso, nunca error) igual dispara la escalada', () => {
  const inf = infFresco({ adjudicacion: { como_se_adjudica: 'POR_LINEAS', estado: 'REVISION_HUMANA' } });
  const r = validarInformeViabilidad(inf, 50);
  assert.ok(halla('V-08', r.hallazgos));
  const disparadas = escalarARevisionHumana(inf, r.hallazgos);
  assert.ok(disparadas.includes('V-08'));
  assert.equal(inf.veredicto.estado_veredicto, 'REVISION_HUMANA');
});

test('escalarARevisionHumana: V-15 (fuentes contradictorias) manda a revisión humana', () => {
  const inf = infFresco({
    _fuentes_manifiesto: {
      elegida: 'Anexo_Económico.xlsx',
      candidatos: [{ fuenteDoc: 'Anexo_Económico.xlsx', autoridad: 0, items: 29, elegido: true }],
      discrepancias: ['"Rex.pdf" lista 34 ítems y la fuente elegida "Anexo_Económico.xlsx" lista 29'],
    },
  });
  const r = validarInformeViabilidad(inf, 50);
  const disparadas = escalarARevisionHumana(inf, r.hallazgos);
  assert.ok(disparadas.includes('V-15'), 'contradicción entre documentos = la mira una persona');
  assert.equal(inf.veredicto.estado_veredicto, 'REVISION_HUMANA');
  assert.ok(inf.veredicto.motivos_revision.some((m: string) => m.startsWith('V-15:')),
    'el motivo debe citar la regla para que se sepa qué revisar');
});

test('escalarARevisionHumana: sin hallazgos de las 5 reglas, no toca el informe', () => {
  const inf = infFresco({ tarjeta_decision: { veredicto: 'GANABLE' } });
  const r = validarInformeViabilidad(inf, 60);
  const disparadas = escalarARevisionHumana(inf, r.hallazgos);
  assert.deepEqual(disparadas, []);
  assert.equal(inf.veredicto.estado_veredicto, undefined);
});
