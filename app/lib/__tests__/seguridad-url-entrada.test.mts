// Regresión de url-propia.ts (anti-SSRF) y validar-entrada.ts. Correr con:
//   npx tsx --test app/lib/__tests__/seguridad-url-entrada.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esUrlR2Propia } from '../url-propia';
import { codigoLicitacionSeguro } from '../validar-entrada';

test('esUrlR2Propia: URLs legítimas de R2 se aceptan', () => {
  assert.equal(esUrlR2Propia('https://pub-abc123.r2.dev/1079650-12-LE26/1_bases.pdf'), true);
  assert.equal(esUrlR2Propia('https://acc.r2.cloudflarestorage.com/bucket/x.pdf'), true);
});

test('esUrlR2Propia: el truco ".r2.dev" en query/path ya no pasa (SSRF)', () => {
  assert.equal(esUrlR2Propia('http://169.254.169.254/latest/meta-data?x=.r2.dev'), false);
  assert.equal(esUrlR2Propia('http://localhost:3000/api/x#.r2.dev'), false);
  assert.equal(esUrlR2Propia('https://evil.com/.r2.dev/a.pdf'), false);
  assert.equal(esUrlR2Propia('https://r2.dev.evil.com/a.pdf'), false);
});

test('esUrlR2Propia: basura y protocolos raros se rechazan', () => {
  assert.equal(esUrlR2Propia('no es url'), false);
  assert.equal(esUrlR2Propia('file:///etc/passwd'), false);
  assert.equal(esUrlR2Propia(''), false);
});

test('codigoLicitacionSeguro: códigos reales sí; traversal y separadores no', () => {
  assert.equal(codigoLicitacionSeguro('1079650-12-LE26'), true);
  assert.equal(codigoLicitacionSeguro('2585-5-L126'), true);
  assert.equal(codigoLicitacionSeguro('../otra'), false);
  assert.equal(codigoLicitacionSeguro('a/b'), false);
  assert.equal(codigoLicitacionSeguro('a\b'), false);
  assert.equal(codigoLicitacionSeguro(''), false);
  assert.equal(codigoLicitacionSeguro(undefined), false);
  assert.equal(codigoLicitacionSeguro('x'.repeat(65)), false);
});
