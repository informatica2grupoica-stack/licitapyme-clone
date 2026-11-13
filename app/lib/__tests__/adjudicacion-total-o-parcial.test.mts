// Caso real 1024-61-LP26 (13-nov-2026): qué frases cuentan como evidencia de adjudicación por línea, el pie de
// total «VALOR TOTAL OFERTA NETO / CON IVA» y la confirmación del equipo que sobrevive al re-análisis.
// Frases tomadas de la BD. Correr con:
//   npx tsx --test app/lib/__tests__/adjudicacion-total-o-parcial.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conservarConfirmacionAdjudicacion, decidirAdjudicacion, hablaDeAdjudicarParte, marcarEvidenciasQueCuentan, nombraUnidadDeAdjudicacion, type EvidenciaAdj } from '../viabilidad-v4/adjudicacion';
import * as cv from '../cv/v4/adjudicacion';
import { detectarOfertaTotalUnico } from '../planilla-costeo-parser';

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

test('TOTAL_O_PARCIAL: frases reales que permiten adjudicar una parte → cuentan', () => {
  for (const f of SI_ADJUDICA_PARTE) { assert.equal(hablaDeAdjudicarParte(f), true, f); assert.equal(cv.hablaDeAdjudicarParte(f), true, f); }
});

test('TOTAL_O_PARCIAL: frases tipo, de descargos o de inadmisibilidad → no cuentan', () => {
  for (const f of NO_DICE_PARTE) {
    assert.equal(hablaDeAdjudicarParte(f), false, f);
    const [e] = marcarEvidenciasQueCuentan([ev('TOTAL_O_PARCIAL', f)]);
    assert.equal(e.cuenta, false, f);
  }
});

test('ADJUDICA_POR_LINEA: tiene que nombrar qué se adjudica aparte', () => {
  const acopio = 'Rol Camino Unidad KM de ACOPIO CANTIDAD A-65 UNIDAD 12,6 333 un Barreras de hormigón A-760 UNIDAD 0.1 133 un Barreras de hormigón';
  assert.equal(nombraUnidadDeAdjudicacion(acopio), false);
  assert.equal(marcarEvidenciasQueCuentan([ev('ADJUDICA_POR_LINEA', acopio)])[0].cuenta, false);
  for (const f of ['SERA POR LINEA', 'por ítem o rubro licitado, según corresponda', 'Se adjudicará por ítem.',
    'Para tal efecto se identificará en acta de evaluación las opciones adjudicadas, es decir, el proveedor con Opción 1, el proveedor con Opción 2, etc.',
    'Esta licitación se podrá adjudicar a más de un proveedor', 'La licitación se encuentra dividida en dos (2) líneas de adquisición independientes']) {
    assert.equal(nombraUnidadDeAdjudicacion(f), true, f);
  }
  // Las frases de los detectores ya salen de patrones curados: no pasan por el filtro.
  assert.equal(marcarEvidenciasQueCuentan([ev('ADJUDICA_POR_LINEA', 'adjudicar a un oferente distinto', 'detector')])[0].cuenta, true);
});

test('1024-61-LP26: frase tipo + tabla de acopio ya no dan POR_LINEAS (queda NO_CLARO para confirmar)', () => {
  const evs = marcarEvidenciasQueCuentan([
    ev('TOTAL_O_PARCIAL', 'Se adjudicará a la o las propuestas más ventajosas, considerando los criterios de evaluación'),
    ev('ADJUDICA_POR_LINEA', 'Rol Camino Unidad KM de ACOPIO CANTIDAD A-65 UNIDAD 12,6 333 un Barreras de hormigón'),
    ev('FORMULARIO_TOTAL', 'VALOR TOTAL OFERTA NETO VALOR TOTAL OFERTA CON IVA'),
  ]);
  assert.equal(decidirAdjudicacion(evs, 2).resultado, 'NO_CLARO');
});

test('total al pie solo NO decide GLOBAL (3328-82-LE26: un NETO/IVA/TOTAL y 4 OC a proveedores distintos)', () => {
  const evs = marcarEvidenciasQueCuentan([ev('FORMULARIO_TOTAL', 'NETO $ IVA $ TOTAL $')]);
  assert.equal(decidirAdjudicacion(evs, 10).resultado, 'NO_CLARO');
});

test('detector: «VALOR TOTAL OFERTA NETO / CON IVA» al pie es total único; los encabezados de columna no', () => {
  const anexo2 = 'ANEXO N° 02 ID 1024-61-LP26 OFERTA ECONÓMICA 3. VALOR TOTAL DE SU OFERTA: ____ (Monto Neto) Ítem Descripción Und. Cantidad Precio Unitario Precio Total 1 BARRERA PREFABRICADA DE HORMIGÓN TIPO F (810mm) UN 466 2 CAPTAFAROS. (OJOS DE GATOS). UN 466 VALOR TOTAL OFERTA NETO VALOR TOTAL OFERTA CON IVA';
  assert.equal(detectarOfertaTotalUnico([{ texto: anexo2 }]), true);
  const columnas = 'OFERTA ECONÓMICA N° LINEA Cant. Bien o Servicio Requerido Precio Unitario Total Neto Total con IVA N° LINEA N°1 PASTO SINTÉTICO 1 M2 980';
  assert.equal(detectarOfertaTotalUnico([{ texto: columnas }]), false);
});

test('la confirmación del equipo sobrevive al re-análisis; lo de la IA queda en segun_ia', () => {
  const anterior = {
    adjudicacion: { resultado: 'POR_LINEAS', regla_aplicada: 'CONFIRMADA', motivo: 'Confirmado por Alexis Tobar en el visor.', resultado_original: 'NO_CLARO' },
    score_confirmaciones: [{ clave: 'adjudicacion', valor: 'POR_LINEAS', usuario: 'Alexis Tobar' }, { clave: 'presupuesto', valor: null }],
  };
  const nuevo: any = { adjudicacion: { resultado: 'NO_CLARO', regla_aplicada: 7, motivo: 'Solo hay señales débiles', pregunta_foro: 'pregunta' }, modalidad: { tipo: 'suma_alzada', estado: 'REVISION_HUMANA' } };
  assert.equal(conservarConfirmacionAdjudicacion(nuevo, anterior), true);
  assert.equal(nuevo.adjudicacion.resultado, 'POR_LINEAS');
  assert.equal(nuevo.adjudicacion.regla_aplicada, 'CONFIRMADA');
  assert.equal(nuevo.adjudicacion.segun_ia.resultado, 'NO_CLARO');
  assert.equal(nuevo.adjudicacion.pregunta_foro, null);
  assert.equal(nuevo.modalidad.tipo, 'por_linea');
  assert.equal(nuevo.modalidad.estado, undefined);
  assert.deepEqual(nuevo.score_confirmaciones.map((c: any) => c.clave), ['adjudicacion']);
  // Sin confirmación previa no toca nada.
  const otro: any = { adjudicacion: { resultado: 'GLOBAL', regla_aplicada: 1 } };
  assert.equal(conservarConfirmacionAdjudicacion(otro, { adjudicacion: { resultado: 'POR_LINEAS', regla_aplicada: 3 } }), false);
  assert.equal(otro.adjudicacion.resultado, 'GLOBAL');
  assert.equal(cv.conservarConfirmacionAdjudicacion({ adjudicacion: {} }, anterior), true);
});

test('reglas anteriores intactas: una decisiva por línea sigue ganando al total único', () => {
  const evs = marcarEvidenciasQueCuentan([
    ev('FORMULARIO_TOTAL', 'VALOR TOTAL OFERTA NETO'),
    ev('TOTAL_O_PARCIAL', 'se reserva el derecho de adjudicar total o parcialmente los bienes requeridos'),
  ]);
  assert.equal(decidirAdjudicacion(evs, 3).resultado, 'POR_LINEAS');
});
