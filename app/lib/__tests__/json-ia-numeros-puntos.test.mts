// 1057448-45-LP26: el modelo escribió `"presupuesto_neto": 202.880.664,` (puntos de miles) y todo el JSON se
// rechazó. Npx tsx --test app/lib/__tests__/json-ia-numeros-puntos.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonIAConTraza, normalizarNumerosConPuntos } from '../json-ia';

test('números con puntos de miles como valor se leen bien y no cuentan como reparación', () => {
  const raw = '{\n "atractivo": {\n  "presupuesto_neto": 202.880.664,\n  "presupuesto_mostrar": "$241.630.000 IVA incl."\n },\n "x": [1.500, 2]\n}';
  const { valor, reparado } = parseJsonIAConTraza<any>(raw);
  assert.equal(valor.atractivo.presupuesto_neto, 202880664);
  assert.equal(valor.atractivo.presupuesto_mostrar, '$241.630.000 IVA incl.');
  assert.equal(reparado, false);
});

test('no toca números dentro de textos ni decimales normales', () => {
  const t = '{"a": "hasta 1.000, luego 2.500.000", "b": 3.14, "c": 12}';
  assert.equal(normalizarNumerosConPuntos(t), t);
  assert.deepEqual(parseJsonIAConTraza<any>(t).valor, { a: 'hasta 1.000, luego 2.500.000', b: 3.14, c: 12 });
});
