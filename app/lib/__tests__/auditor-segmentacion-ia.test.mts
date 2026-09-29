// Tests de la parte pura de auditor-segmentacion-ia.ts (sin IA).
// Correr con: npx tsx --test app/lib/__tests__/auditor-segmentacion-ia.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paginasDelTexto, bloquesDeAgrupacion } from '../auditor-segmentacion-ia';

const texto = '[[PÁGINA 1]]\nSamsung TV\n\n[[PÁGINA 2]]\nMás TV\n\n[[PÁGINA 3]]\nProyector Epson';

test('parte el texto en páginas por los marcadores del extractor', () => {
  const p = paginasDelTexto(texto);
  assert.deepEqual(p.map(x => x.n), [1, 2, 3]);
  assert.equal(p[2].texto, 'Proyector Epson');
  assert.deepEqual(paginasDelTexto('sin marcadores'), []);
});

test('agrupa páginas, ignora páginas inexistentes o repetidas y no asigna dos productos a una línea', () => {
  const p = paginasDelTexto(texto);
  const r = bloquesDeAgrupacion(p, [
    { nombre: 'Samsung', paginas: [1, 2, 9], linea: 1 },
    { nombre: 'Epson', paginas: [3, 1], linea: 1 },      // línea 1 ya tiene dueño; la página 1 ya se usó
    { nombre: 'Fantasma', paginas: [9], linea: 2 },        // sin páginas válidas → se descarta
    { nombre: 'Otro', paginas: [], linea: 3 },
  ], new Set([1, 2, 3]));
  assert.equal(r.bloques.length, 2);
  assert.equal(r.porLinea.get(1)?.titulo, 'Samsung');
  assert.equal(r.bloques[1].texto.includes('Proyector Epson'), true);
  assert.equal(r.bloques[1].texto.includes('Samsung TV'), false);
  assert.equal(r.porLinea.size, 1);
});
