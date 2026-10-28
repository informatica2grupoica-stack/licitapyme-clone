// COTIZAR_TOTALIDAD = «ofertar TODAS las líneas». Una frase que pide completar CADA línea que se oferte no
// lo es — caso real 4697-25-LP26 (27-oct-2026), que salía GLOBAL por la regla 2. Frases tomadas de la BD.
// Correr con:
//   npx tsx --test app/lib/__tests__/adjudicacion-totalidad-por-linea.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidirAdjudicacion, hablaDeTotalidad, marcarEvidenciasQueCuentan, totalidadDentroDeLinea, type EvidenciaAdj } from '../viabilidad-v4/adjudicacion';
import * as cv from '../cv/v4/adjudicacion';

const ev = (tipo: any, frase: string): EvidenciaAdj => ({ tipo, origen: 'modelo', cita: { frase, verificada: true, semantica: 'SI' } });

const COMPLETAR_CADA_LINEA = [
  'Las ofertas son por el lote y/o grupo completo, el no ofertar un producto del lote quedara fuera de bases.',
  'SE DEBE OFERTAR POR LA TOTALIDAD DE LOS BIENES INDICADOS EN CADA LÍNEA. SI FALTA ALGÚN PRODUCTO DE LA LÍNEA, LA OFERTA SE DECLARARÁ INADMISIBLE',
  'En caso de participar en una línea, deberán ofertar la totalidad de los productos que la integran',
  'Si el oferente presenta una oferta parcial, es decir no oferta por la totalidad de los productos, en su respectiva línea.',
  'La oferta deberá incluir la totalidad de los ítems de la línea que offerte, de lo contrario quedará fuera de evaluación',
  'SERÁ REQUISITO DE ADMISIBILIDAD LA POSTULACIÓN A LA LÍNEA OFERTADA COMPLETA',
  'Los Oferentes deberán ofertar el 100% de los productos solicitados por línea, en caso de no hacerlo, su oferta será declarada inadmisible.',
  'El o los oferentes podrán ofertar a la totalidad de las líneas requeridas, o bien a cada línea por separado',
  'Debe ser completa, es decir, se debe ofertar y valorizar cada bien requerido, de lo contrario su oferta será declarada inadmisible.',
  'Asimismo, se debe ofertar la familia completa considerando cada uno de sus componentes cuando corresponda.',
  'Debe incluir en su oferta todos los equipos y equipamiento que conforman la familia, de lo contrario la oferta será declarada inadmisible.',
];
const OFERTAR_TODO = [
  'Se debe ofertar la totalidad de las líneas y/o ítems. Las ofertas parciales serán declaradas fuera de bases.',
  'La presente licitación será adjudicada por el todo, correspondiendo al oferente adjudicado proveer la totalidad de los bienes requeridos. En consecuencia, no se aceptarán adjudicaciones parciales ni por líneas.',
  'Ambas líneas se adjudicarán a un solo proveedor, que ofrezca los servicios solicitados',
  'La adjudicación será global, por lo que deben presentar la totalidad de los productos ofertados',
  'LAS OFERTAS DEBEN SER POR EL TOTAL DE LOS PRODUCTOS LICITADOS',
  'Solo se aceptarán ofertas que incluyan el total de los productos requeridos y que adjunten la ficha técnica de cada producto, de lo contrario',
];

test('frases reales que piden completar cada línea → no son «ofertar todas las líneas»', () => {
  for (const f of COMPLETAR_CADA_LINEA) assert.equal(totalidadDentroDeLinea(f), true, f);
});

test('frases reales que obligan a ofertar todo → siguen contando', () => {
  for (const f of OFERTAR_TODO) assert.equal(totalidadDentroDeLinea(f), false, f);
});

test('4697-25-LP26: «Licitación por Línea» + totalidad del lote → POR_LINEAS y requisito de completar cada línea', () => {
  const evs = marcarEvidenciasQueCuentan([
    ev('ADJUDICA_POR_LINEA', 'Licitación por Línea; La presente Licitación Pública tiene por objeto realizar la adquisición de Equipos y Equipamiento'),
    ev('COTIZAR_TOTALIDAD', COMPLETAR_CADA_LINEA[0]),
  ]);
  const d = decidirAdjudicacion(evs, 2);
  assert.equal(d.resultado, 'POR_LINEAS');
  assert.equal(d.cotizar_100, 'POR_LINEA');
  assert.equal(evs[1].cuenta, false);
  assert.equal(evs[1].completar_cada_linea, true);
});

test('la regla 2 de CA se mantiene cuando de verdad obligan a ofertar todas las líneas', () => {
  const d = decidirAdjudicacion(marcarEvidenciasQueCuentan([ev('ADJUDICA_POR_LINEA', 'Se adjudica por línea'), ev('COTIZAR_TOTALIDAD', OFERTAR_TODO[0])]), 3);
  assert.equal(d.resultado, 'GLOBAL');
  assert.equal(d.regla_aplicada, 2);
});

// Frases que la IA etiquetó COTIZAR_TOTALIDAD sin que digan que hay que ofertar todo (28-oct-2026).
const NO_HABLAN_DE_TOTALIDAD = [
  'Cada oferente deberá presentar una oferta seria, única y ajustada a estas Bases, salvo que expresamente se autoricen alternativas.',
  'Ofertar de acuerdo a lo requerido en las presentes Bases de Licitación',
  'Las ofertas deberán corresponder a la sumatoria de los ítems de los presupuestos detallados incluidos impuestos.',
  'Deberá incluir todas las partidas y adicionales que a juicio del OFERENTE sean necesarias para un adecuado cumplimiento',
  'LÍNEAS NOMBRE DE LÍNEAS LICITADAS PLAZO EN DÍAS HÁBILES 1 EQUIPAMIENTO ______ días hábiles 2 EQUIPOS ______ días hábiles',
  'Los oferentes deberán incluir en el Precio Total Final todos los gastos asociados',
  'Los oferentes, deberán presentar sólo una oferta',
];
// Las que siguen contando (además de OFERTAR_TODO): sí dicen que hay que ofertar todo.
const SI_HABLAN_DE_TOTALIDAD = [
  ...OFERTAR_TODO,
  'Los oferentes deberán cotizar la totalidad de los artículos solicitados en Anexo económico adjunto',
  'en caso de no ofertar por alguno de los previamente detallados, quedará automáticamente fuera de la licitación',
  'Los oferentes deben ofertar (cotizar) por el servicio integro solicitado en las presentes Bases de licitación',
  'No se aceptarán ofertas parciales.',
  'Los oferentes deben considerar el total global de los productos requeridos, de lo contrario será declarado inadmisible',
];

test('COTIZAR_TOTALIDAD solo cuenta si la frase habla de ofertar todo', () => {
  for (const f of NO_HABLAN_DE_TOTALIDAD) assert.equal(hablaDeTotalidad(f), false, f);
  for (const f of SI_HABLAN_DE_TOTALIDAD) assert.equal(hablaDeTotalidad(f), true, f);
});

test('2744-38-LE26: «oferta seria, única» + presupuesto por línea → POR_LINEAS', () => {
  const evs = marcarEvidenciasQueCuentan([
    ev('COTIZAR_TOTALIDAD', NO_HABLAN_DE_TOTALIDAD[0]),
    ev('PRESUPUESTO_POR_LINEA', '1 Impedanciómetro 1 $9.000.000.-'),
  ]);
  assert.equal(evs[0].cuenta, false);
  assert.equal(decidirAdjudicacion(evs, 3).resultado, 'POR_LINEAS');
});

test('1057898-103-LP26: familia completa + «un solo oferente por familia» → POR_LINEAS', () => {
  const evs = marcarEvidenciasQueCuentan([
    ev('COTIZAR_TOTALIDAD', COMPLETAR_CADA_LINEA[COMPLETAR_CADA_LINEA.length - 1]),
    ev('ADJUDICA_GLOBAL', 'La adjudicación de la presente licitación será simple, seleccionando a un solo oferente por familia de equipos y/o equipamiento'),
    ev('ADJUDICA_POR_LINEA', 'La oferta que logre puntuación más alta por línea de familia de equipos o equipamiento, será propuesta para adjudicación:'),
    ev('OFERTA_POR_BIEN', 'Puede postular por una o más líneas de familias de equipos y/o equipamiento.'),
  ]);
  assert.equal(evs[1].cuenta, false);
  assert.equal(decidirAdjudicacion(evs, 4).resultado, 'POR_LINEAS');
  // «a un solo oferente» sin «por línea» sigue siendo global.
  assert.equal(marcarEvidenciasQueCuentan([ev('ADJUDICA_GLOBAL', 'Ambas líneas serán adjudicadas a un solo oferente')])[0].cuenta, true);
});

test('1 línea en la API sigue siendo GLOBAL aunque la frase no cuente', () => {
  const evs = marcarEvidenciasQueCuentan([ev('COTIZAR_TOTALIDAD', NO_HABLAN_DE_TOTALIDAD[1])]);
  assert.equal(decidirAdjudicacion(evs, 1).resultado, 'GLOBAL');
});

test('la copia de cv/v4 decide igual', () => {
  for (const f of [...COMPLETAR_CADA_LINEA, ...OFERTAR_TODO]) assert.equal(cv.totalidadDentroDeLinea(f), totalidadDentroDeLinea(f), f);
  for (const f of [...NO_HABLAN_DE_TOTALIDAD, ...SI_HABLAN_DE_TOTALIDAD]) assert.equal(cv.hablaDeTotalidad(f), hablaDeTotalidad(f), f);
});
