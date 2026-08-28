// Tests de la limpieza del valor ofertado antes de imprimirlo en un documento formal.
// Los casos "reales" salen de 611669-17-LE26 (LUMINANCÍMETROS, ficha del LS-150).
// Correr con:
//   npx tsx --test app/lib/__tests__/valor-ofertado-normalizar.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarValorParaDocumento, normalizarNumeroIngles, huboCambios } from '../valor-ofertado-normalizar';

// ─── CASOS REALES ─────────────────────────────────────────────────────────────────────────────
test('caso real: "Obediente B" (de "Class B compliant") queda legible', () => {
  assert.equal(
    normalizarValorParaDocumento('DIN 5032-Clase 7 Obediente B'),
    'DIN 5032-Clase 7 conforme B',
  );
});

test('caso real: el rango en formato inglés queda en formato chileno', () => {
  assert.equal(
    normalizarValorParaDocumento('0.001 to 999,900 cd/m2'),
    '0,001 a 999.900 cd/m2',
  );
});

// ─── SEPARADOR DE MILES ───────────────────────────────────────────────────────────────────────
// "999,900" leído a la chilena es novecientos coma nueve: un orden de magnitud de diferencia en un
// número que el organismo está evaluando.
test('la coma de miles inglesa pasa a punto', () => {
  assert.equal(normalizarNumeroIngles('999,900'), '999.900');
  assert.equal(normalizarNumeroIngles('1,234.56'), '1.234,56');
  assert.equal(normalizarValorParaDocumento('Memoria: 1,000 datos'), 'Memoria: 1.000 datos');
});

// ─── LO QUE NO SE DEBE TOCAR ──────────────────────────────────────────────────────────────────
// Acá está el riesgo real: "corregir" el punto de una norma o una versión altera el dato técnico.
test('las normas y versiones NO se tocan', () => {
  assert.equal(normalizarValorParaDocumento('USB 2.0'), 'USB 2.0');
  assert.equal(normalizarValorParaDocumento('Norma DIN 5032-Parte 7, Clase B'), 'Norma DIN 5032-Parte 7, Clase B');
  assert.equal(normalizarValorParaDocumento('Modelo LS-150'), 'Modelo LS-150');
  assert.equal(normalizarValorParaDocumento('Clase 2.5 según IEC 61010'), 'Clase 2.5 según IEC 61010');
});

// "1.234" es ambiguo: mil doscientos treinta y cuatro en Chile, uno coma dos tres cuatro en inglés.
// Sin evidencia clara NO se toca — un valor mal corregido es peor que uno feo pero fiel.
//
// CORREGIDO EL 27-ago-2026 (caso real 2446-240-LE26): este test AFIRMABA que "1.234" se convertía
// a "1,234", contradiciendo su propio comentario. Con datos reales el daño quedó a la vista: las
// RPM del motor, guardadas como "3.600" (tres mil seiscientos), salían impresas "3,600" en la
// ficha que se presenta al organismo — que en Chile se lee 3,6. Un punto seguido de exactamente
// 3 dígitos es AMBIGUO y ahora se respeta tal cual.
test('un punto seguido de 3 dígitos es ambiguo (miles en Chile) y se deja como está', () => {
  assert.equal(normalizarValorParaDocumento('1.234'), '1.234');
  assert.equal(normalizarValorParaDocumento('3.600'), '3.600', 'RPM: no puede pasar a 3,600');
  assert.equal(normalizarValorParaDocumento('Rango 1.234.567'), 'Rango 1.234.567'); // miles CL: intacto
});

// Un decimal inglés de verdad SÍ se corrige: con parte entera 0 no puede ser separador de miles,
// y con otra cantidad de decimales tampoco se confunde con la forma chilena de escribir miles.
test('un decimal inglés inequívoco sí se pasa a coma', () => {
  assert.equal(normalizarValorParaDocumento('0.001'), '0,001');
  assert.equal(normalizarValorParaDocumento('2.5'), '2,5');
  assert.equal(normalizarValorParaDocumento('12.75'), '12,75');
});

test('un texto ya en castellano no cambia', () => {
  const t = 'Capacidad: 20 litros, tapa con pedal';
  assert.equal(normalizarValorParaDocumento(t), t);
  assert.equal(huboCambios(t), false);
});

test('la tolerancia con ± se conserva tal cual', () => {
  const t = '+/-2% +/- 2 dígitos';
  assert.equal(normalizarValorParaDocumento(t), t);
});

test('vacío y nulo no revientan', () => {
  assert.equal(normalizarValorParaDocumento(null), '');
  assert.equal(normalizarValorParaDocumento(undefined), '');
  assert.equal(normalizarValorParaDocumento('   '), '');
  assert.equal(huboCambios(null), false);
});

test('huboCambios avisa cuando el texto se corrigió', () => {
  assert.equal(huboCambios('0.001 to 999,900 cd/m2'), true);
  assert.equal(huboCambios('Baterias AA (x2)'), false);
});

// El original SIEMPRE queda intacto en la base: esto es solo para imprimir. Si alguien discute un
// veredicto, la evidencia es lo que decía la ficha, no lo que nosotros mostramos.
test('la función es pura: no muta la entrada', () => {
  const original = '0.001 to 999,900 cd/m2';
  normalizarValorParaDocumento(original);
  assert.equal(original, '0.001 to 999,900 cd/m2');
});
