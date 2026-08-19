// Criterios que viven en un ANEXO (criterios-en-anexo.ts). Cada caso sale de un documento real:
// el 2981-214-LE26 de la PDI, que disparó todo esto, y los de control que NO deben dispararlo —
// esos importan más, porque un falso positivo BORRA criterios bien extraídos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analizarRemisionACriterios, hayTablaDeCriterios,
  criteriosNoConfiables, motivoCriteriosNoConfiables,
} from '../criterios-en-anexo';

// Texto REAL de las bases de 2981-214-LE26 (PDI), tal como quedó tras el OCR: el cuerpo remite al
// anexo y la tabla nunca aparece porque estaba en las páginas 47-48 de un PDF de 68.
const BASES_QUE_REMITEN = `
Art. 40. Evaluación de las ofertas: La Comisión Evaluadora efectuará una revisión y examen de
admisibilidad de las ofertas y evaluará sólo aquéllas que resulten admisibles.
LA SEÑALADA EVALUACIÓN SE EFECTUARÁ CONFORME A LOS CRITERIOS Y PONDERACIONES SEÑALADOS EN EL
ANEXO "TABLA DE PONDERACIÓN Y CRITERIOS DE EVALUACIÓN DE OFERTAS" DE ESTAS BASES.
Art. 41. Criterios para desempate: En caso de empate en la evaluación entre dos o más oferentes,
la adjudicación se efectuará a aquél que tenga una mejor evaluación de acuerdo al orden de
prelación entre los criterios de evaluación señalados en el Anexo.
`;

// La MISMA licitación, si el OCR hubiera llegado hasta la página 48: el anexo con su tabla.
const BASES_CON_EL_ANEXO = BASES_QUE_REMITEN + `
ANEXO "TABLA DE PONDERACIÓN Y CRITERIOS DE EVALUACIÓN DE OFERTAS"
TABLA GENERAL
2 PROPUESTA ECONÓMICA   PE = (((Menor precio entre Oferentes)*100)*0.60)   60%
3 PLAZO DE ENTREGA      PE = (((Menor plazo entre Oferentes)*100)*0.20)    20%
4 GARANTIA DEL PRODUCTO PG = (((Plazo garantía oferente evaluado)*100)*0.10) 10%
5 INCLUSIÓN CON ENFOQUE DE GÉNERO   Total criterio= Puntaje*0.05             5%
5 CUMPLIMIENTO DEL PROGRAMA DE INTEGRIDAD  Total Criterio = Puntaje * 0.05   5%
PORCENTAJE FINAL   Pfi= ΣXi   100%
`;

test('detecta la remisión a un anexo cuando el cuerpo no trae la tabla', () => {
  const r = analizarRemisionACriterios(BASES_QUE_REMITEN);
  assert.equal(r.remite, true);
  assert.equal(r.tablaPresente, false);
  assert.ok(r.frase && /ANEXO/i.test(r.frase), 'debe citar la frase que lo prueba');
  assert.equal(criteriosNoConfiables(r), true);
});

test('con el anexo presente, NO desconfía aunque el cuerpo remita', () => {
  const r = analizarRemisionACriterios(BASES_CON_EL_ANEXO);
  assert.equal(r.remite, true);
  assert.equal(r.tablaPresente, true, 'la tabla está en el mismo texto');
  assert.equal(criteriosNoConfiables(r), false);
});

test('unas bases con la tabla en el cuerpo no disparan nada', () => {
  const texto = `
    9.6 Criterios de evaluación. La evaluación considerará los siguientes factores:
    9.6.1.1 Plazo de entrega ......... 35%
    9.6.1.2 Experiencia del oferente . 15%
    9.6.1.3 Requisitos formales ...... 5%
    9.6.1.4 Precio ................... 30%
    9.6.1.5 Sustentabilidad ambiental  5%
    9.6.1.6 Programa de integridad ... 10%
  `;
  const r = analizarRemisionACriterios(texto);
  assert.equal(criteriosNoConfiables(r), false);
});

// REGRESIÓN (813-71-LR26): al convertir un PDF a texto, el nombre del criterio y su porcentaje
// caen en LÍNEAS distintas. La primera versión del detector exigía que estuvieran en la misma
// línea, no veía ninguna tabla, y habría borrado siete criterios correctamente extraídos.
test('reconoce la tabla aunque el % caiga varias líneas debajo del nombre', () => {
  const texto = `
    Criterios de evaluación y ponderaciones indicadas en el Anexo A numeral 7:
    Plazo de entrega
    (Evaluable)
    Anexo B
    35%
    Experiencia del oferente
    Anexo B
    15%
    Precio
    Anexo A
    30%
    Sustentabilidad
    20%
  `;
  assert.equal(hayTablaDeCriterios(texto), true);
  assert.equal(criteriosNoConfiables(analizarRemisionACriterios(texto)), false);
});

test('reconoce la tabla escrita como fórmulas ponderadas, sin columna de porcentajes', () => {
  // Es como la escribe la PDI, y es justo lo que el OCR SÍ leyó bien cuando la columna de "%"
  // salió ilegible ("0%" donde decía "60%").
  const texto = `
    PROPUESTA ECONÓMICA  PE = (((Menor precio entre Oferentes)*100)*0.60)
    PLAZO DE ENTREGA     PE = (((Menor plazo entre Oferentes)*100)*0.20)
    GARANTIA             PG = (((Plazo garantía)*100)*0.10)
    GÉNERO               Total criterio = Puntaje*0.05
    COMPLIANCE           Total Criterio = Puntaje * 0.05
  `;
  assert.equal(hayTablaDeCriterios(texto), true);
});

test('una mención suelta a "anexo" no cuenta como remisión de criterios', () => {
  const texto = `
    El oferente deberá presentar el Anexo N°3 debidamente firmado, y adjuntar el Anexo N°5
    con la declaración jurada. Los anexos se descargan del portal.
  `;
  assert.equal(analizarRemisionACriterios(texto).remite, false);
});

test('el motivo nombra el problema y qué hacer, y menciona el corte del OCR si lo hubo', () => {
  const sinCorte = motivoCriteriosNoConfiables(analizarRemisionACriterios(BASES_QUE_REMITEN));
  assert.match(sinCorte, /remiten a un anexo/i);
  assert.match(sinCorte, /a mano/i);

  const conCorte = motivoCriteriosNoConfiables(analizarRemisionACriterios(
    BASES_QUE_REMITEN + '\n[NOTA: documento de 68 págs — OCR local aplicado solo a las primeras 40. FALTA EL TEXTO DE LAS PÁGINAS 41 A 68.]',
  ));
  assert.match(conCorte, /incompleto/i);
});

test('texto vacío o sin criterios no rompe ni dispara', () => {
  for (const t of ['', '   ', 'Certificado de disponibilidad presupuestaria N° 505.']) {
    const r = analizarRemisionACriterios(t);
    assert.equal(r.remite, false);
    assert.equal(criteriosNoConfiables(r), false);
  }
});
