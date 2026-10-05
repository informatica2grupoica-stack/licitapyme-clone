// 1057448-45-LP26: criterios_evaluacion.alertas llegó como objetos {tipo, descripcion} y la pestaña Viabilidad no cargaba.
//   npx tsx --test app/lib/__tests__/textos-informe.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarTextosInforme, aTexto } from '../viabilidad-v4/textos';

test('alertas como objetos pasan a texto y las que ya eran texto no se tocan', () => {
  const inf: any = {
    criterios_evaluacion: { alertas: [{ tipo: 'RIESGO_DE_INADMISIBILIDAD', descripcion: 'Falta el Anexo 9.' }, 'ya es texto', { descripcion: 'sin tipo' }] },
    plazos: { alertas: ['ok'] },
    estrategia: { donde_se_decide: { criterios_diferenciadores: [{ texto: 'garantía' }] } },
  };
  normalizarTextosInforme(inf);
  assert.deepEqual(inf.criterios_evaluacion.alertas, ['Riesgo de inadmisibilidad: Falta el Anexo 9.', 'ya es texto', 'sin tipo']);
  assert.deepEqual(inf.plazos.alertas, ['ok']);
  assert.deepEqual(inf.estrategia.donde_se_decide.criterios_diferenciadores, ['garantía']);
});

test('informes sin esos campos o vacíos no revientan', () => {
  assert.equal(normalizarTextosInforme(null), null);
  assert.deepEqual(normalizarTextosInforme({}), {});
  assert.equal(aTexto({ a: 1 }), '{"a":1}');
});
