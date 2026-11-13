// TOTAL_O_PARCIAL tiene que decir que se puede adjudicar UNA PARTE, y un formulario de total único sin ninguna
// señal por línea es GLOBAL (regla 8). Caso real 1024-61-LP26 (13-nov-2026). Frases tomadas de la BD.
// Correr con:
//   npx tsx --test app/lib/__tests__/adjudicacion-total-o-parcial.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidirAdjudicacion, hablaDeAdjudicarParte, marcarEvidenciasQueCuentan, type EvidenciaAdj } from '../viabilidad-v4/adjudicacion';
import * as cv from '../cv/v4/adjudicacion';

const ev = (tipo: any, frase: string, origen: EvidenciaAdj['origen'] = 'modelo'): EvidenciaAdj => ({ tipo, origen, cita: { frase, verificada: true, semantica: 'SI' } });

const SI_ADJUDICA_PARTE = [
  'pudiendo adjudicar total o parcialmente los productos a proveer',
  'SE PUEDE POSTULAR A UNA, A MÁS DE UNA, O A TODAS LAS LÍNEAS INDICADAS',
  'se reserva el derecho de adjudicar total o parcialmente los bienes requeridos en la presente Licitación',
  'La adjudicación será a través de una evaluación por línea, pudiendo adjudicarse a más de un proveedor.',
  'En ese sentido, se entenderá que la presente licitación podrá ser de múltiple adjudicación.',
  'Licitación Pública de adjudicación multiple',
  'ADJUDICACIÓN PARCIAL X Sí',
  'se reserva el derecho a adjudicar una o más ofertas presentadas, y el total o parte de ellas',
  'se reserva el derecho a aceptar o rechazar alguna o todas las coberturas',
  'pudiendo adjudicarse un proveedor más de una categoría',
  'El Servicio de Salud Aysén se reserva el derecho de aceptar, total o parcialmente, cualquiera de las ofertas presentadas o rechazarlas todas',
  'se reserva el derecho de rechazar una o más ofertas con los fundamentos de cada caso y/o el derecho de declarar desierto determinados ítems',
];
const NO_DICE_PARTE = [
  'Se adjudicará a la o las propuestas más ventajosas, considerando los criterios de evaluación',
  'La Entidad Licitante adjudicará una o más ofertas mediante acto administrativo debidamente notificado al o a los adjudicatarios',
  'El Departamento de Salud Municipal de Angol se reserva el derecho de aceptar cualquiera de las ofertas presentadas, o rechazarlas todas. Asimismo, podrá declarar desierta la propuesta.',
  'La Municipalidad se reserva el derecho de declarar desierta la licitación o adjudicar a cualquiera de las ofertas',
  'La Municipalidad de Carahue, Departamento de Salud, tendrá un plazo de 5 días hábiles a contar de la recepción de los descargos para rechazarlos o acogerlos total o parcialmente.',
  'Al respecto, el rechazo total o parcial de los descargos del respectivo proveedor deberá formalizarse a través de la dictación de una resolución fundada',
  'rechazarlos o acogerlos, total o parcialmente, lo que determinara mediante resolución o acto administrativo.',
  'En caso de incumplimiento total, parcial o cumplimiento tardío de las obligaciones que el contrato impone al proveedor',
  'Se podrá declarar inadmisible, total o parcialmente, una o más ofertas cuando se determine que constituyen propuestas riesgosas o temerarias.',
];

test('frases reales que permiten adjudicar una parte → cuentan', () => {
  for (const f of SI_ADJUDICA_PARTE) { assert.equal(hablaDeAdjudicarParte(f), true, f); assert.equal(cv.hablaDeAdjudicarParte(f), true, f); }
});

test('frases tipo, de descargos o de inadmisibilidad → no cuentan como TOTAL_O_PARCIAL', () => {
  for (const f of NO_DICE_PARTE) {
    assert.equal(hablaDeAdjudicarParte(f), false, f);
    const [e] = marcarEvidenciasQueCuentan([ev('TOTAL_O_PARCIAL', f)]);
    assert.equal(e.cuenta, false, f);
  }
});

test('1024-61-LP26: total único del Anexo 2 + frase tipo «la o las propuestas» → GLOBAL (regla 8)', () => {
  const evs = () => marcarEvidenciasQueCuentan([
    ev('FORMULARIO_TOTAL', 'VALOR TOTAL OFERTA NETO VALOR TOTAL OFERTA CON IVA'),
    ev('TOTAL_O_PARCIAL', 'Se adjudicará a la o las propuestas más ventajosas, considerando los criterios de evaluación'),
  ]);
  const d = decidirAdjudicacion(evs(), 2);
  assert.equal(d.resultado, 'GLOBAL');
  assert.equal(d.regla_aplicada, 8);
  assert.equal(d.cotizar_100, 'SI');
  assert.equal(cv.decidirAdjudicacion(cv.marcarEvidenciasQueCuentan(evs() as any), 2).resultado, 'GLOBAL');
});

test('regla 8 no decide si hay cualquier señal por línea, ni con el total que solo ve el detector', () => {
  const conLinea = marcarEvidenciasQueCuentan([
    ev('FORMULARIO_TOTAL', 'TOTAL NETO IVA TOTAL'),
    ev('EVALUACION_POR_ITEM', 'se realizará una evaluación porcentual por Línea de producto.'),
  ]);
  assert.equal(decidirAdjudicacion(conLinea, 5).resultado, 'NO_CLARO');
  const soloDetector = marcarEvidenciasQueCuentan([{ tipo: 'FORMULARIO_TOTAL', origen: 'detector', cita: { documento: '', numeral: '', frase: '' } }]);
  assert.equal(decidirAdjudicacion(soloDetector, 10).resultado, 'NO_CLARO');
});

test('reglas anteriores intactas: una decisiva por línea sigue ganando al total único', () => {
  const evs = marcarEvidenciasQueCuentan([
    ev('FORMULARIO_TOTAL', 'VALOR TOTAL OFERTA NETO'),
    ev('TOTAL_O_PARCIAL', 'se reserva el derecho de adjudicar total o parcialmente los bienes requeridos'),
  ]);
  assert.equal(decidirAdjudicacion(evs, 3).resultado, 'POR_LINEAS');
});
