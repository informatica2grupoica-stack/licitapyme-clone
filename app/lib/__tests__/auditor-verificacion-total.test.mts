// Guardarraíl del anexo económico: no subir un anexo cuyo total no calce con el costeo aprobado.
//   npx tsx --test app/lib/__tests__/auditor-verificacion-total.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verificarTotalEconomico, montoDesdeTexto } from '../auditor-verificacion-total';

// Cifras reales de 2296-48-LE26: costeo neto $21.589.995, con IVA $25.692.094.
const NETO = 21589995;

test('calza con el NETO del costeo', () => {
  const v = verificarTotalEconomico({ totalEnAnexo: NETO, totalCosteoNeto: NETO });
  assert.equal(v.calza, true);
  assert.equal(v.referencia, 'neto');
});

// Hay organismos que piden la oferta CON IVA en el formulario; el costeo siempre guarda el neto.
// Bloquear una oferta correcta por eso sería peor que el error que se busca evitar.
test('calza con el BRUTO cuando el formulario pide IVA incluido', () => {
  const v = verificarTotalEconomico({ totalEnAnexo: Math.round(NETO * 1.19), totalCosteoNeto: NETO });
  assert.equal(v.calza, true);
  assert.equal(v.referencia, 'con_iva');
});

test('NO calza: bloquea y dice cuánto difiere', () => {
  const v = verificarTotalEconomico({ totalEnAnexo: NETO - 500000, totalCosteoNeto: NETO });
  assert.equal(v.calza, false);
  assert.equal(v.diferencia, 500000);
  assert.match(v.mensaje, /NO coincide/);
});

// Un formulario de oferta sin oferta es inadmisible de plano: es el peor resultado posible y el
// que más fácil pasa desapercibido, porque el archivo "se generó bien".
test('anexo económico sin ningún precio escrito: bloquea', () => {
  for (const vacio of [null, 0]) {
    const v = verificarTotalEconomico({ totalEnAnexo: vacio, totalCosteoNeto: NETO });
    assert.equal(v.calza, false, `total ${vacio}`);
    assert.match(v.mensaje, /sin ning[úu]n precio/i);
  }
});

// La holgura es en PESOS y por línea, no un porcentaje: el costeo trae una columna sin decimales
// justamente para que el total sea exacto.
test('tolera el peso de redondeo por línea, pero no más', () => {
  const doceLineas = { totalCosteoNeto: NETO, lineas: 12 };
  assert.equal(verificarTotalEconomico({ totalEnAnexo: NETO + 12, ...doceLineas }).calza, true);
  assert.equal(verificarTotalEconomico({ totalEnAnexo: NETO + 13, ...doceLineas }).calza, false);
  // Con una sola línea la holgura es mínima.
  assert.equal(verificarTotalEconomico({ totalEnAnexo: NETO + 1, totalCosteoNeto: NETO, lineas: 1 }).calza, true);
  assert.equal(verificarTotalEconomico({ totalEnAnexo: NETO + 2, totalCosteoNeto: NETO, lineas: 1 }).calza, false);
});

// Sin costeo no hay contra qué comparar. No se bloquea acá: ese chequeo vive en auditor-generacion.
test('sin costeo no bloquea, pero lo dice', () => {
  const v = verificarTotalEconomico({ totalEnAnexo: NETO, totalCosteoNeto: null });
  assert.equal(v.calza, true);
  assert.equal(v.referencia, 'ninguna');
});

// Cuando no calza, el mensaje apunta a la referencia MÁS CERCANA: si se acerca al bruto, revela
// que el formulario pedía IVA y falta o sobra una línea.
test('informa la referencia más cercana para orientar el diagnóstico', () => {
  const casiConIva = Math.round(NETO * 1.19) - 300000;
  const v = verificarTotalEconomico({ totalEnAnexo: casiConIva, totalCosteoNeto: NETO });
  assert.equal(v.calza, false);
  assert.equal(v.referencia, 'con_iva');
  assert.match(v.mensaje, /con IVA/);
});

// El parser de montos es donde un error silencioso es más caro: si devuelve 0 por no entender el
// formato, el guardarraíl lo lee como "anexo sin precio" y BLOQUEA una oferta correcta. El sufijo
// ".-" es la forma más común de escribir un monto en Chile y era justo el que fallaba.
test('montoDesdeTexto: entiende los formatos reales de un documento chileno', () => {
  const casos: [string, number][] = [
    ['21.589.995', 21589995],
    ['$21.589.995', 21589995],
    ['$ 21.589.995.-', 21589995],   // el que rompía
    ['21589995', 21589995],
    ['$25.692.094,05', 25692094.05],
    ['1.000.-', 1000],
    ['$ 4.102.099 IVA incl.', 4102099],
  ];
  for (const [texto, esperado] of casos) {
    assert.equal(montoDesdeTexto(texto), esperado, texto);
  }
  // Sin número no inventa uno.
  assert.equal(montoDesdeTexto(''), 0);
  assert.equal(montoDesdeTexto('—'), 0);
});
