// COTIZAR_TOTALIDAD = «ofertar TODAS las líneas». Una frase que pide completar CADA línea que se oferte no
// lo es — caso real 4697-25-LP26 (27-oct-2026), que salía GLOBAL por la regla 2. Frases tomadas de la BD.
// Correr con:
//   npx tsx --test app/lib/__tests__/adjudicacion-totalidad-por-linea.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidirAdjudicacion, marcarEvidenciasQueCuentan, totalidadDentroDeLinea, type EvidenciaAdj } from '../viabilidad-v4/adjudicacion';
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
];
const OFERTAR_TODO = [
  'Se debe ofertar la totalidad de las líneas y/o ítems. Las ofertas parciales serán declaradas fuera de bases.',
  'La presente licitación será adjudicada por el todo, correspondiendo al oferente adjudicado proveer la totalidad de los bienes requeridos. En consecuencia, no se aceptarán adjudicaciones parciales ni por líneas.',
  'Ambas líneas se adjudicarán a un solo proveedor, que ofrezca los servicios solicitados',
  'La adjudicación será global, por lo que deben presentar la totalidad de los productos ofertados',
  'LAS OFERTAS DEBEN SER POR EL TOTAL DE LOS PRODUCTOS LICITADOS',
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

test('la copia de cv/v4 decide igual', () => {
  for (const f of [...COMPLETAR_CADA_LINEA, ...OFERTAR_TODO]) assert.equal(cv.totalidadDentroDeLinea(f), totalidadDentroDeLinea(f), f);
});
