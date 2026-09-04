// Regresión del respaldo de PRECIOS del Anexo Creator (anexos-precios-ia.ts) — funciones puras,
// sin llamar a la IA. Cubre los dos casos reales documentados en el propio archivo:
//   - normalizarParaMatchExacto: ceros finales en decimales ("0,1" vs "0,10" — MISMO espesor).
//   - compartenPalabra: guard de coherencia que evitó el cruce real "TRAZADO Y NIVELES" ↔ "NIVEL
//     DE ALUMINIO" (1738-18-LE26) solo por compartir la palabra "nivel"/"niveles".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarParaMatchExacto, matchExacto, compartenPalabra, palabrasSignificativas } from '../anexos-precios-ia';
import type { ItemCosteoPrecio } from '../motor-comercial';

test('normalizarParaMatchExacto: mayúsculas, comillas de pulgada y espacios dobles no rompen el match', () => {
  assert.equal(
    normalizarParaMatchExacto('Guantes de Cuero  Reforzado'),
    normalizarParaMatchExacto('guantes de cuero reforzado'),
  );
  assert.equal(normalizarParaMatchExacto(`Perno 3/4´`), normalizarParaMatchExacto(`Perno 3/4'`));
});

test('normalizarParaMatchExacto: un cero final en un decimal no cambia el valor (regresión 1738-18-LE26, e:0,1 vs e:0,10)', () => {
  assert.equal(normalizarParaMatchExacto('HORMIGÓN G-25 e:0,1 METROS'), normalizarParaMatchExacto('HORMIGÓN G-25 e:0,10 METROS'));
  // Un cero que SÍ es la parte significativa (no un simple relleno a la derecha) no se toca.
  assert.notEqual(normalizarParaMatchExacto('e:0,1 METROS'), normalizarParaMatchExacto('e:0,01 METROS'));
});

test('matchExacto: cruza por texto normalizado y separa la etiqueta de "— Precio unitario"', () => {
  const items: ItemCosteoPrecio[] = [
    { descripcion: 'FIERRO Ø 12 ESTRIADO', precioUnitario: 5000, unidad: 'UN', cantidad: 1 },
  ];
  const { matches, sinResolver } = matchExacto(['FIERRO Ø 12 ESTRIADO — Precio unitario', 'MOLDAJE'], items);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].precioUnitario, 5000);
  assert.deepEqual(sinResolver, ['MOLDAJE']);
});

test('matchExacto: sin ningún ítem que calce, todo queda sin resolver (nunca inventa)', () => {
  const items: ItemCosteoPrecio[] = [{ descripcion: 'CASCO DE SEGURIDAD', precioUnitario: 3000, unidad: 'UN', cantidad: 1 }];
  const { matches, sinResolver } = matchExacto(['GUANTES DE LÁTEX'], items);
  assert.equal(matches.length, 0);
  assert.deepEqual(sinResolver, ['GUANTES DE LÁTEX']);
});

test('palabrasSignificativas: descarta conectores y palabras cortas', () => {
  const p = palabrasSignificativas('el TRAZADO y los NIVELES de la obra');
  assert.ok(p.has('trazado'));
  assert.ok(p.has('niveles'));
  assert.ok(!p.has('el'), 'conector "el" no debe quedar');
  assert.ok(!p.has('y'), 'conector "y" no debe quedar');
  assert.ok(!p.has('de'), 'conector "de" no debe quedar');
});

test('compartenPalabra: descarta el cruce real "TRAZADO Y NIVELES" ↔ "NIVEL DE ALUMINIO" (regresión 1738-18-LE26)', () => {
  // "TRAZADO Y NIVELES" (partida de mano de obra, ni siquiera está en el costeo real) no comparte
  // ninguna palabra significativa de ≥3 letras con "NIVEL DE ALUMINIO 48\" GRIS STANLEY" salvo el
  // singular/plural de "nivel" — distinto texto exacto, así que compartenPalabra debe rechazarlo.
  assert.equal(compartenPalabra('TRAZADO Y NIVELES', 'NIVEL DE ALUMINIO 48" GRIS STANLEY'), false);
});

test('compartenPalabra: acepta cuando SÍ hay una palabra real en común (mismo ítem, redactado distinto)', () => {
  assert.equal(compartenPalabra('Casco de seguridad', 'Casco de seguridad industrial Bullard'), true);
});
