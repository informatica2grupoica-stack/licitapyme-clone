import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { esRechazoPorFiltro } from '../auditor-lector';

// Caso real 26-oct-2026 (2427-98-LE26): la ficha técnica de un notebook rugerizado (Getac B360) volvió de los CUATRO modelos GLM con este 400.
const REAL = 'glm-4.7: 400 System detected potentially unsafe or sensitive content in input or generation. Please avoid using prompts that may generate sensitive content.';

test('el rechazo del filtro de contenido de Z.AI se reconoce (para leer el documento con Kimi)', () => {
  assert.equal(esRechazoPorFiltro(REAL), true);
  assert.equal(esRechazoPorFiltro('{"error":{"code":"1301","message":"..."}}'), true);
});

test('otros errores NO se confunden con el filtro (no cambian de proveedor)', () => {
  for (const m of ['Request timed out', '429 Too Many Requests', '402 Insufficient Balance', 'fetch failed', '1113 saldo insuficiente', 'Error 13010 de red'])
    assert.equal(esRechazoPorFiltro(m), false, m);
});

test('el Lector lee con Kimi, cae a GLM si Kimi falla y guarda el motor que leyó (guardia sobre el código)', () => {
  const fuente = readFileSync(fileURLToPath(new URL('../auditor-lector.ts', import.meta.url)), 'utf8');
  assert.match(fuente, /const MOTOR_LECTOR = 'kimi'/);
  assert.match(fuente, /proveedorPreferido: MOTOR_LECTOR/);
  assert.match(fuente, /modeloPreferido: MODELO_RESPALDO_GLM, soloGlm: true/);
  assert.match(fuente, /esRechazoPorFiltro\(msgGlm\)/, 'el rechazo del filtro de GLM (respaldo) se explica claro');
  assert.doesNotMatch(fuente, /JSON\.stringify\(guardada\), MOTOR_LECTOR/, 'el motor guardado debe ser el que realmente leyó');
});

// Caso real 26-oct-2026: con response_format json_object Kimi K3 devolvía claves rotas ({": ":{...}}) en 3 de cada 4 lecturas.
test('a Kimi nunca se le manda response_format (guardia sobre gemini.ts)', () => {
  const fuente = readFileSync(fileURLToPath(new URL('../gemini.ts', import.meta.url)), 'utf8');
  const bloque = fuente.slice(fuente.indexOf('if (cfg.reasoningEffort) {'), fuente.indexOf('if (cfg.reasoningEffort) {') + 900);
  assert.match(bloque, /delete body\.response_format/);
  assert.match(fuente, /const \{ _esfuerzoKimi, \.\.\.resto \} = params/, '_esfuerzoKimi nunca le llega a otro proveedor');
});
