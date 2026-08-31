// BUG REAL (31-ago-2026, 1042-9-LE26, F4 "Declaración Jurada Simple"): "…del 20___" — el año
// partido en dos ("20" impreso + "26" en el blanco) quedaba "del 20 26" porque rellenarRunPorIndice
// antepone un espacio siempre que el carácter previo es un dígito (para no pegar "ETIQUETA30").
// Esa regla es correcta en general (ver el otro test de este archivo) pero incorrecta acá: el "20"
// y el "26" tienen que quedar pegados para formar "2026". `pegadoALaIzquierda` es la excepción.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rellenarRunPorIndice, listarParrafos } from '../anexos-docx';

const parrafo = (texto: string) =>
  `<w:p w14:paraId="00000001"><w:r><w:t xml:space="preserve">${texto}</w:t></w:r></w:p>`;
// "del 20____, don" — "del 20" mide 6 caracteres, así que el blanco de 4 rayas empieza en el 6.
const POS_BLANCO = 'del 20'.length;

test('sin pegadoALaIzquierda: un dígito antes del blanco SÍ lleva espacio (comportamiento de siempre)', () => {
  const xml = parrafo('del 20____, don');
  const out = rellenarRunPorIndice(xml, 0, [{ pos: POS_BLANCO, largo: 4, valor: '26' }]);
  const [p] = listarParrafos(out);
  assert.equal(p.texto, 'del 20 26, don');
});

test('con pegadoALaIzquierda: el año partido queda pegado al "20" ya impreso — "del 2026", no "del 20 26"', () => {
  const xml = parrafo('del 20____, don');
  const out = rellenarRunPorIndice(xml, 0, [{ pos: POS_BLANCO, largo: 4, valor: '26', pegadoALaIzquierda: true }]);
  const [p] = listarParrafos(out);
  assert.equal(p.texto, 'del 2026, don');
});

test('pegadoALaIzquierda no afecta el espacio del lado DERECHO — sigue separando de la palabra siguiente', () => {
  // Caso real distinto (1057480-41-LP26): un valor pegado a la palabra que sigue igual necesita su
  // espacio a la derecha; pegadoALaIzquierda solo habla del lado izquierdo.
  const xml = parrafo('del 20____don');
  const out = rellenarRunPorIndice(xml, 0, [{ pos: POS_BLANCO, largo: 4, valor: '26', pegadoALaIzquierda: true }]);
  const [p] = listarParrafos(out);
  assert.equal(p.texto, 'del 2026 don');
});

// BUG REAL (31-ago-2026, 1042-9-LE26, Anexo Impacto Ambiental): "don (doña)____" — el paréntesis de
// género queda pegado a la palabra (ver la regla de REGLAS_PREVIAS del mismo caso, anexos-
// determinista.ts) y ")" no estaba en el set de caracteres que fuerzan el espacio, así que el
// nombre salía "doña)Santiago Osvaldo López Palavecino" pegado al cierre del paréntesis.
test('un paréntesis de cierre justo antes del blanco también fuerza el espacio', () => {
  const xml = parrafo('don (doña)____, "____"');
  const out = rellenarRunPorIndice(xml, 0, [{ pos: 'don (doña)'.length, largo: 4, valor: 'Santiago' }]);
  const [p] = listarParrafos(out);
  assert.equal(p.texto, 'don (doña) Santiago, "____"');
});
