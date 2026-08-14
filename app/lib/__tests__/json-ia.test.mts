// Regresión del parseo tolerante de JSON de LLM (json-ia.ts). Correr con:
//   npx tsx --test app/lib/__tests__/json-ia.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonIA, repararJSONTruncado, sanearControlChars } from '../json-ia';

test('sanearControlChars: convierte tab/newline/CR crudos a espacio, descarta el resto', () => {
  assert.equal(sanearControlChars('a\tb\nc\rd'), 'a b c d');
  assert.equal(sanearControlChars('a\x00b\x0Bc'), 'ab c'.replace(' c', 'c')); // 0x00 y 0x0B se descartan sin espacio
});

test('parseJsonIA: JSON válido normal parsea directo', () => {
  assert.deepEqual(parseJsonIA('{"a":1,"b":"x"}'), { a: 1, b: 'x' });
});

test('parseJsonIA: envuelto en ```json fences``` se limpia antes de parsear', () => {
  assert.deepEqual(parseJsonIA('```json\n{"a":1}\n```'), { a: 1 });
});

test('parseJsonIA: texto antes/después del bloque JSON se recorta', () => {
  assert.deepEqual(parseJsonIA('Acá va tu respuesta:\n{"a":1}\nFin.'), { a: 1 });
});

// BUG REAL (14-ago-2026, caso 4563-10-LP26): el modelo (GLM-5.2, finish=length) truncó justo al
// ABRIR la comilla de la clave de un elemento nuevo del manifiesto — sin ":" antes de la comilla
// (no es un string-VALOR sin cerrar) y sin comilla de cierre de la clave (no es una clave colgante
// con ":"). Antes esto NO parseaba nunca, sin importar cuán chico fuera el fragmento perdido, y
// disparaba un reintento completo de la llamada (200s+ en el modelo de respaldo) que no siempre
// alcanzaba a terminar dentro del tope duro de 10 minutos del análisis de viabilidad.
test('repararJSONTruncado: comilla de APERTURA de una clave nueva sin cerrar (caso real 4563-10-LP26)', () => {
  const truncado = `{"manifiesto_productos":[{"linea":"L2","cantidad":25},{"linea":"L1","`;
  const parsed = parseJsonIA(truncado);
  assert.ok(parsed, 'debería parsear tras la reparación');
  assert.deepEqual(parsed.manifiesto_productos[0], { linea: 'L2', cantidad: 25 });
  // El elemento incompleto se descarta hasta donde llegó (mejor un dato parcial que ningún dato) —
  // solo sobrevive lo que alcanzó a escribirse ANTES de la clave que quedó sin abrir del todo.
  assert.deepEqual(parsed.manifiesto_productos[1], { linea: 'L1' });
});

test('repararJSONTruncado: mismo caso dentro de un ARRAY DE STRINGS (sin ":" en absoluto)', () => {
  const truncado = `{"citas":["fuente A","fuente B","`;
  const parsed = parseJsonIA(truncado);
  assert.ok(parsed, 'debería parsear tras la reparación');
  assert.deepEqual(parsed.citas, ['fuente A', 'fuente B']);
});

test('repararJSONTruncado: string-VALOR sin cerrar (con ":" antes) sigue funcionando — regla previa intacta', () => {
  const truncado = `{"a":1,"nombre":"Lidia Valenz`;
  const parsed = parseJsonIA(truncado);
  assert.ok(parsed, 'debería parsear tras la reparación');
  assert.equal(parsed.a, 1);
  assert.equal(parsed.nombre, null); // string sin cerrar → null, no se inventa el resto
});

test('repararJSONTruncado: clave colgante con ":" pero sin valor sigue funcionando — regla previa intacta', () => {
  const truncado = `{"a":1,"b":`;
  const parsed = parseJsonIA(truncado);
  assert.ok(parsed);
  assert.deepEqual(parsed, { a: 1 });
});

test('parseJsonIA: truncado a mitad de un objeto anidado real (score/veredicto sobreviven, solo se pierde la cola)', () => {
  const truncado = `{
    "score_global": 62,
    "veredicto": { "estado": "REVISION_HUMANA" },
    "manifiesto_productos": [
      { "linea": "L1", "descripcion": "Producto A", "cantidad": 10 },
      { "linea": "L2", "`;
  const parsed = parseJsonIA(truncado);
  assert.ok(parsed, 'debería parsear tras la reparación');
  assert.equal(parsed.score_global, 62);
  assert.equal(parsed.veredicto.estado, 'REVISION_HUMANA');
  assert.equal(parsed.manifiesto_productos.length, 2);
  assert.deepEqual(parsed.manifiesto_productos[1], { linea: 'L2' });
});

test('parseJsonIA: entrada vacía o no-objeto no revienta, devuelve null', () => {
  assert.equal(parseJsonIA(''), null);
  assert.equal(parseJsonIA(null), null);
  assert.equal(parseJsonIA(undefined), null);
  assert.equal(parseJsonIA('no hay json acá'), null);
});
