// REGLA DEL PROYECTO (19-ago-2026, explícita del usuario): "el OCR tiene que leer al 100% los
// documentos escaneados SIEMPRE, sean 100 páginas o más, y si deja huecos que los reponga".
//
// Estos tests fijan las dos mitades de esa regla sobre las piezas PURAS del pipeline (las que no
// necesitan levantar Tesseract): que un hueco quede SIEMPRE detectable y reponible venga del motor
// que venga, y que una página en blanco verificada NO se confunda con un hueco — si se confundiera,
// cada análisis re-OCR-earía el documento entero para siempre persiguiendo una página que nunca va
// a dar texto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ocrTieneHuecos, paginasConHueco, rellenarHuecos } from '../zai-ocr';
import { analizarRemisionACriterios } from '../criterios-en-anexo';

// El formato EXACTO que emiten hoy los tres caminos de OCR (GLM, Tesseract completo y bloques).
const hueco = (a: number, b = a, motivo = 'motivo') =>
  `[[PÁGINA ${a === b ? a : `${a}-${b}`}]]\n[OCR_NO_DISPONIBLE: ${motivo} — se repondrá]`;
const sinTexto = (p: number) =>
  `[[PÁGINA ${p}]]\n[PÁGINA SIN TEXTO: leída con OCR local, no contiene texto legible]`;

test('un hueco de UNA página se detecta y se puede reponer', () => {
  const texto = `[[PÁGINA 1]]\nBases administrativas\n\n${hueco(2)}\n\n[[PÁGINA 3]]\nArt. 3`;
  assert.equal(ocrTieneHuecos(texto), true);
  assert.deepEqual(paginasConHueco(texto), [2]);

  const reparado = rellenarHuecos(texto, new Map([[2, 'CRITERIOS DE EVALUACIÓN: Precio 60%']]));
  assert.equal(ocrTieneHuecos(reparado), false, 'repuesto el hueco, el texto queda completo');
  assert.match(reparado, /Precio 60%/);
});

// El caso del cortacircuito: un rango entero de páginas que nunca se llegó a leer.
test('un hueco de RANGO expande todas sus páginas y se repone una por una', () => {
  const texto = `[[PÁGINA 1]]\nInicio\n\n${hueco(41, 68, 'documento de 68 págs, cortacircuito en 40')}`;
  assert.equal(ocrTieneHuecos(texto), true);
  const faltantes = paginasConHueco(texto);
  assert.equal(faltantes.length, 28);
  assert.equal(faltantes[0], 41);
  assert.equal(faltantes[faltantes.length - 1], 68);

  // Se repone solo lo que se pudo recuperar; lo demás sigue visible como hueco, no se da por leído.
  const reparado = rellenarHuecos(texto, new Map([[47, 'TABLA GENERAL — PROPUESTA ECONÓMICA 60%']]));
  assert.match(reparado, /TABLA GENERAL/);
  assert.equal(ocrTieneHuecos(reparado), true, 'las otras 27 páginas siguen pendientes');
});

test('una página en blanco VERIFICADA no es un hueco (si no, se re-OCR-earía para siempre)', () => {
  const texto = `[[PÁGINA 1]]\nContenido\n\n${sinTexto(2)}\n\n[[PÁGINA 3]]\nMás contenido`;
  assert.equal(ocrTieneHuecos(texto), false);
  assert.deepEqual(paginasConHueco(texto), []);
});

test('un documento con huecos se reconoce como texto incompleto al juzgar los criterios', () => {
  const bases = `
    LA EVALUACIÓN SE EFECTUARÁ CONFORME A LOS CRITERIOS Y PONDERACIONES SEÑALADOS EN EL
    ANEXO "TABLA DE PONDERACIÓN Y CRITERIOS DE EVALUACIÓN DE OFERTAS" DE ESTAS BASES.
    ${hueco(41, 68, 'cortacircuito')}
  `;
  const r = analizarRemisionACriterios(bases);
  assert.equal(r.remite, true);
  assert.equal(r.tablaPresente, false);
  assert.equal(r.textoTruncado, true, 'el hueco debe delatar que el documento está incompleto');
});

test('todas las páginas quedan representadas: ninguna desaparece en silencio', () => {
  // Un documento de 5 páginas donde la 2 falló técnicamente y la 4 está en blanco de verdad.
  const texto = [
    '[[PÁGINA 1]]\nuno',
    hueco(2, 2, 'Tesseract falló en esta página'),
    '[[PÁGINA 3]]\ntres',
    sinTexto(4),
    '[[PÁGINA 5]]\ncinco',
  ].join('\n\n');
  const paginas = [...texto.matchAll(/\[\[PÁGINA (\d+)(?:-(\d+))?\]\]/g)].map(m => Number(m[1]));
  assert.deepEqual(paginas, [1, 2, 3, 4, 5]);
  assert.deepEqual(paginasConHueco(texto), [2], 'solo la fallida se reintenta; la blanca no');
});
