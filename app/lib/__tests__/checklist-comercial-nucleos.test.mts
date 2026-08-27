// Tests de nucleoDeTitulo/nucleosCoinciden — el corazón del dedupe del checklist comercial.
// Correr con:
//   npx tsx --test app/lib/__tests__/checklist-comercial-nucleos.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nucleoDeTitulo, nucleosCoinciden, numeroDeFormatoEn } from '../checklist-comercial';

// ─── TOLERANCIA A UN TYPO (26-ago-2026, auditoría técnica) ────────────────────────────────
// Caso real, negocio 453: dos análisis del MISMO documento un día de diferencia, y el segundo
// corrige un typo del primero — "Póiza" → "Póliza". Antes del fix quedaban como dos ítems
// distintos en el checklist porque nucleosCoinciden compara por substring exacto, y un carácter
// de diferencia en una palabra rompe tanto el prefijo como el includes.
test('un typo de una letra en la palabra clave no impide reconocer el mismo documento (regresión negocio 453)', () => {
  const a = nucleoDeTitulo('Garantía de fiel cumplimiento (Póiza)');
  const b = nucleoDeTitulo('Garantía de fiel cumplimiento (Póliza/Instrumento Financiero)');
  assert.ok(nucleosCoinciden(a, b), `"${a}" y "${b}" deberían reconocerse como el mismo documento`);
});

// El reverso exacto (por si algún día se invierte el orden de argumentos) — nucleosCoinciden debe
// ser simétrica.
test('la tolerancia a typo es simétrica (no depende de cuál título se pasa primero)', () => {
  const a = nucleoDeTitulo('Garantía de fiel cumplimiento (Póiza)');
  const b = nucleoDeTitulo('Garantía de fiel cumplimiento (Póliza/Instrumento Financiero)');
  assert.equal(nucleosCoinciden(a, b), nucleosCoinciden(b, a));
});

// ─── LAS GUARDAS QUE YA EXISTÍAN SIGUEN FIRMES — la tolerancia no debe aflojarlas ──────────
// (caso real 2905-36-LR26, el que motivó las guardas de largo/cobertura originales.)
test('palabras genéricas compartidas NO fusionan garantías distintas (regresión 2905-36-LR26)', () => {
  const formulario = nucleoDeTitulo('Formulario N°4: Garantía');
  const seriedad = nucleoDeTitulo('Garantía de seriedad de la oferta');
  const fielCumplimiento = nucleoDeTitulo('Garantía de fiel cumplimiento');
  assert.ok(!nucleosCoinciden(formulario, seriedad), 'una palabra sola no debe fundir dos garantías distintas');
  assert.ok(!nucleosCoinciden(seriedad, fielCumplimiento), 'seriedad de oferta y fiel cumplimiento son instrumentos distintos');
});

// Dos palabras completamente distintas (no un typo de 1 letra) tampoco deben tolerarse: la
// distancia de edición ≤1 exige que sea CASI la misma palabra, no una prima cercana.
test('dos palabras genuinamente distintas no se toleran como si fueran un typo', () => {
  const a = nucleoDeTitulo('Garantía de fiel cumplimiento (Boleta)');
  const b = nucleoDeTitulo('Garantía de fiel cumplimiento (Póliza)');
  // "boleta" vs "poliza": distancia de edición muy superior a 1 — son instrumentos DE VERDAD
  // distintos (una boleta de garantía y una póliza de seguro no son el mismo documento), y esta
  // guarda es la que evita que el fix nuevo los confunda.
  assert.ok(!nucleosCoinciden(a, b), 'boleta y póliza son instrumentos distintos, no un typo el uno del otro');
});

// El caso real que ya motivó la guarda de "prefijo con cobertura menor" sigue funcionando —
// contrato de que el fix nuevo no reemplazó ni rompió el camino existente.
test('el caso de prefijo con cobertura menor sigue funcionando (regresión 2724-35-LP26)', () => {
  const corto = nucleoDeTitulo('Garantía de fiel cumplimiento');
  const largo = nucleoDeTitulo('Garantía de fiel cumplimiento de contrato (Póliza/Certificado de fianza)');
  assert.ok(nucleosCoinciden(corto, largo));
});

// Palabras muy cortas (≤5 chars totales en la comparación) no deben tolerar distancia de edición:
// "iva" a distancia 1 de "iga" no dice nada, palabras cortas necesitan calzar exacto.
test('palabras cortas exigen calce exacto, no toleran distancia de edición', () => {
  // "de"→"la" (ambas de 2 letras, distancia 2, ninguna de 6+) no debe activar la tolerancia;
  // se prueba indirectamente: dos núcleos que solo comparten palabras cortas no deben coincidir.
  const a = nucleoDeTitulo('Anexo de la empresa');
  const b = nucleoDeTitulo('Certificado de mi asociación');
  assert.ok(!nucleosCoinciden(a, b));
});

// ─── numeroDeFormatoEn sigue siendo el VETO — ni con typo se salta esa regla ───────────────
// Un identificador EXPLÍCITO distinto siempre gana, incluso si el resto del texto es casi
// idéntico letra por letra: eso lo decide coincidenEntradas() en generarItemsDesdeViabilidad, no
// nucleosCoinciden — este test solo fija que numeroDeFormatoEn detecta el identificador con y sin
// el typo, para que ese veto siga funcionando aguas arriba.
test('numeroDeFormatoEn detecta el identificador con normalidad, el typo no lo afecta', () => {
  assert.equal(numeroDeFormatoEn('Anexo N°6.1: Ficha técnica'), 'anexo:61');
  assert.equal(numeroDeFormatoEn('Anexo N°6.2: Ficha técnica'), 'anexo:62');
  assert.notEqual(numeroDeFormatoEn('Anexo N°6.1: Ficha técnica'), numeroDeFormatoEn('Anexo N°6.2: Ficha técnica'));
});
