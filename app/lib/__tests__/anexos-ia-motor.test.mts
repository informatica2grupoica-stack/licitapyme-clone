// Regresión del motor 100% IA (anexos-ia-motor.ts, reemplazo del diccionario, 3-ago-2026).
// Solo cubre la lógica que NO depende de la red (guardarraíl anti-invención, atajos que evitan
// llamar a la IA sin necesidad) — el criterio de la IA en sí se mide contra documentos reales con
// scripts/anexos-banco.mts y scripts/anexos-golden.mts, no acá.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  valorExisteEnFicha, resolverAlertasInadmisibilidad, resolverAnexoConIA, esOpcionExcluyenteDeIntegridad,
  type EmpresaCampos,
} from '../anexos-ia-motor';

const empresaVacia: EmpresaCampos = {
  razon_social: null, rut: null, direccion: null, region: null, giro: null, tipo_persona_juridica: null,
  fecha_sociedad: null, fecha_escritura: null, notaria: null, numero_repertorio: null, fojas_numero_anio: null,
  representante_nombre: null, representante_rut: null, representante_cargo: null,
  email1: null, telefono1: null, banco_tipo_cuenta: null, banco_numero: null, banco_nombre: null,
  banco_email: null, banco_titular_nombre: null, banco_titular_rut: null, firma_url: null, timbre_url: null,
};

test('valorExisteEnFicha: un valor vacío o solo puntuación nunca "existe"', () => {
  assert.equal(valorExisteEnFicha('', { ...empresaVacia, rut: '76.902.659-2' }), false);
  assert.equal(valorExisteEnFicha('   ', { ...empresaVacia, rut: '76.902.659-2' }), false);
  assert.equal(valorExisteEnFicha('...', { ...empresaVacia, rut: '76.902.659-2' }), false);
});

test('valorExisteEnFicha: normaliza tildes/mayúsculas/puntuación antes de comparar', () => {
  const empresa: EmpresaCampos = { ...empresaVacia, region: 'Región del Bío Bío' };
  assert.equal(valorExisteEnFicha('region del bio bio', empresa), true);
  assert.equal(valorExisteEnFicha('REGIÓN DEL BÍO BÍO', empresa), true);
  assert.equal(valorExisteEnFicha('Región Metropolitana', empresa), false);
});

test('resolverAlertasInadmisibilidad: sin texto de bases, no llama a la IA y devuelve vacío', async () => {
  // Si esto intentara llamar a crearChatIA con basesTexto vacío, fallaría por falta de
  // credenciales/red en el entorno de test — que la promesa resuelva instantáneo confirma el
  // atajo (`if (!basesTexto...) return []`) sin tocar la red.
  const alertas = await resolverAlertasInadmisibilidad('', ['ANEXO N°1']);
  assert.deepEqual(alertas, []);
});

// BUG REAL (8-sep-2026, tabla "PROGRAMA(S) DE INTEGRIDAD Y COMPLIANCE", reportado por el usuario
// con captura: "me marca sí y sí, solo tiene que marcar el que dice cuenta con programa de
// integridad"): el prompt de la IA le dice que la pregunta de integridad siempre se responde "SÍ",
// pero cuando el organismo la presenta como DOS opciones excluyentes (checkbox SI/NO pelado, o una
// fila en prosa "Cuenta con…" / "No cuenta con…"), cada opción es su propio candidato y el modelo
// las marcaba las DOS. Este guardarraíl corre DESPUÉS de la respuesta de la IA, sin red — mismo
// patrón que ya prueba anexos-determinista.test.mts para el motor determinista.
test('esOpcionExcluyenteDeIntegridad: detecta la OPCIÓN (checkbox pelado o fila en prosa), nunca la pregunta', () => {
  assert.equal(esOpcionExcluyenteDeIntegridad('SI'), true);
  assert.equal(esOpcionExcluyenteDeIntegridad('NO'), true);
  assert.equal(esOpcionExcluyenteDeIntegridad('Cuenta con programa (s) de integridad y compliance que sean conocidos por el personal'), true);
  assert.equal(esOpcionExcluyenteDeIntegridad('No cuenta con programa (s) de integridad y compliance que sean conocidos por el personal'), true);
  assert.equal(esOpcionExcluyenteDeIntegridad('¿Cuenta con Programa de Integridad?'), false);
  assert.equal(esOpcionExcluyenteDeIntegridad('¿La empresa cuenta con un Programa de Integridad?'), false);
});

test('resolverAnexoConIA: sin candidatos y sin datos de ficha, no llama a la IA y devuelve todo vacío', async () => {
  const resultado = await resolverAnexoConIA({
    candidatos: [], blancosInline: [], parrafos: [], empresa: empresaVacia,
  });
  assert.equal(resultado.celda.size, 0);
  assert.equal(resultado.inline.size, 0);
  assert.deepEqual(resultado.alertasInadmisibilidad, []);
  assert.deepEqual(resultado.checklistPendientes, []);
});
