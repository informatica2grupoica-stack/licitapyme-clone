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

// ── 2723-79-LE26 (Buin): el costeo guarda «<producto> - <modelo>» y otra puntuación; sin IA el unitario quedaba vacío.
import { matchPorSimilitud } from '../anexos-precios-ia';
test('matchPorSimilitud: el mismo ítem con «- modelo» del costeo y otra puntuación se resuelve sin IA', () => {
  const items = [
    { descripcion: 'BASURERO MODELO ALAMEDA (OCTAGONAL) CON ESCUDO MUNICIPAL ADOSADO POR AMBOS LADOS EN SCROLL EN FE.MACIZO - Modelo Alameda (Octagonal)', precioUnitario: 275500, unidad: 'unidades', cantidad: 24 },
    { descripcion: 'ESCAÑO ANTIVANDÁLICO DE HORMIGÓN PULIDO GRIS SIMILAR A MODELO ALERCE INCLUSIVO - Similar a modelo Alerce Inclusivo', precioUnitario: 303050, unidad: 'unidades', cantidad: 36 },
  ];
  const r = matchPorSimilitud([
    'Basurero modelo alameda (octagonal) con escudo municipal adosado por ambos lados en scroll en fe. Macizo — Valor Neto Unitario',
    'Escaño antivandálico de hormigón pulido gris similar a modelo alerce inclusivo — Valor Neto Unitario',
  ], items);
  assert.deepEqual(r.matches.map(m => m.precioUnitario), [275500, 303050]);
  assert.equal(r.sinResolver.length, 0);
});

test('matchPorSimilitud: nunca adivina — medida distinta, dos candidatos o un ítem ajeno quedan sin resolver', () => {
  const items = [
    { descripcion: 'ESCAÑO DE HORMIGÓN 180 CM CON RESPALDO - Alerce', precioUnitario: 300000, unidad: 'u', cantidad: 5 },
    { descripcion: 'ESCAÑO DE HORMIGÓN 150 CM CON RESPALDO - Alerce', precioUnitario: 250000, unidad: 'u', cantidad: 5 },
  ];
  // 160 cm no está en ninguno: no se elige el «más parecido».
  assert.equal(matchPorSimilitud(['Escaño de hormigón 160 cm con respaldo — Valor Unitario'], items).matches.length, 0);
  // La medida exacta sí lo resuelve, sin confundirlo con el otro.
  assert.equal(matchPorSimilitud(['Escaño de hormigón 150 cm con respaldo — Valor Unitario'], items).matches[0]?.precioUnitario, 250000);
  // Un ítem que no está en el costeo.
  assert.equal(matchPorSimilitud(['Mesa de comedor de madera maciza — Valor Unitario'], items).matches.length, 0);
  // Dos ítems que calzan igual en el costeo = ambiguo.
  const doble = [items[0], { ...items[0], descripcion: 'ESCAÑO DE HORMIGÓN 180 CM CON RESPALDO - Otro', precioUnitario: 1 }];
  assert.equal(matchPorSimilitud(['Escaño de hormigón 180 cm con respaldo — Valor Unitario'], doble).matches.length, 0);
});
