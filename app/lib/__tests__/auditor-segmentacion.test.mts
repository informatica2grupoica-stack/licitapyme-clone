// Tests de app/lib/auditor-segmentacion.ts — la parte SIN IA y SIN BD del Auditor Técnico:
// partir un documento en bloques por producto y mapear cada bloque a su línea del checklist.
//
// Cada caso viene de un formato real visto en 3489-29-LP26 (88 líneas): la ficha del asistente
// puede llegar como tabla aplanada por el PDF, como lista rotulada "ÍTEM N:", o como HTML del OCR.
// El motor tiene que aguantar los tres sin que nadie lo configure.
// Correr con: npx tsx --test app/lib/__tests__/auditor-segmentacion.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarNombre, parecido, segmentarPorItems, mapearBloquesALineas, caracteristicasDeBloque,
  UMBRAL_PARECIDO,
} from '../auditor-segmentacion';

// ─── parecido ───────────────────────────────────────────────────────────────────────────────

test('parecido: el mismo producto escrito distinto en cada documento supera el umbral', () => {
  // Tildes, abreviaturas y mayúsculas cambian entre las bases, la ficha y el catálogo.
  assert.ok(parecido('BALANZA ADULTO CON TALLIMETRO', 'Balanza adulto con tallímetro') >= UMBRAL_PARECIDO);
  assert.ok(parecido('CAMILLA GINECOLOGICA BASICA', 'Camilla ginecológica básica') >= UMBRAL_PARECIDO);
});

test('parecido: dos productos distintos que comparten palabras vacías NO se cruzan', () => {
  // Sin filtrar "de", "SILLA DE RUEDAS" y "MESA DE PASTEUR" comparten un tercio de sus palabras.
  assert.ok(parecido('SILLA DE RUEDAS', 'MESA DE PASTEUR') < UMBRAL_PARECIDO);
  assert.ok(parecido('CAJONERA 3 CAJONES', 'CARRO DE CURACIONES') < UMBRAL_PARECIDO);
});

test('normalizarNombre: quita tildes, puntuación y colapsa espacios', () => {
  assert.equal(normalizarNombre('  Camilla   Ginecológica, básica.  '), 'camilla ginecologica basica');
});

// ─── segmentarPorItems ──────────────────────────────────────────────────────────────────────

test('segmentarPorItems: tabla del proveedor aplanada por el PDF (número + NOMBRE + descripción en el mismo renglón)', () => {
  // Formato real de la ficha de 3489-29-LP26: el PDF junta nombre y descripción en una línea.
  const texto = [
    '4 BALANZA ADULTO Balanza mecánica de pie con tallímetro, capacidad 180 kg.',
    'Precisión de 100 g.',
    '5 BOMBA ASPIRACION Bomba de aspiración portátil de sobremesa, 15 lpm.',
    '6 CAMILLA GINECOLOGICA Camilla de examen con respaldo reclinable.',
  ].join('\n');
  const bloques = segmentarPorItems(texto);
  assert.equal(bloques.length, 3);
  assert.deepEqual(bloques.map(b => b.numero), [4, 5, 6]);
  assert.equal(bloques[0].titulo, 'BALANZA ADULTO');
  // El bloque se lleva TODAS sus líneas, no solo el encabezado.
  assert.ok(bloques[0].texto.includes('Precisión de 100 g.'));
  assert.ok(!bloques[1].texto.includes('Precisión de 100 g.'));
});

test('segmentarPorItems: título partido en dos filas de celda se vuelve a unir', () => {
  const texto = [
    '1 BALANZA ADULTO CON',
    'TALLIMETRO',
    'Capacidad 180 kg.',
    '2 SILLA DE RUEDAS',
    'Plegable, aluminio.',
  ].join('\n');
  const bloques = segmentarPorItems(texto);
  assert.equal(bloques.length, 2);
  assert.equal(bloques[0].titulo, 'BALANZA ADULTO CON TALLIMETRO');
});

test('segmentarPorItems: encabezados rotulados "ÍTEM N:" ganan sobre la heurística de mayúsculas', () => {
  // Dentro de un ítem rotulado hay filas numeradas que también parecen encabezados. Mezclarlas
  // partiría el documento de más y cada trozo quedaría sin sus especificaciones.
  const texto = [
    '## ITEM 7: COMPUTADOR Cantidad: 10 unidades',
    '1 USB Type C de 10 Gb de transferencia',
    '2 HDMI 2.1 con salida 4K',
    '## ITEM 8: IMPRESORA LASER',
    'Monocromática, 30 ppm.',
  ].join('\n');
  const bloques = segmentarPorItems(texto);
  assert.equal(bloques.length, 2);
  // limpiarTitulo saca el "Cantidad: 10 unidades" que el OCR pegó en el mismo renglón: con eso
  // adentro, el parecido contra la línea "COMPUTADOR" caía por debajo del umbral.
  assert.equal(bloques[0].titulo, 'COMPUTADOR');
  assert.equal(bloques[1].titulo, 'IMPRESORA LASER');
  assert.ok(bloques[0].texto.includes('HDMI 2.1'));
});

test('segmentarPorItems: filas numeradas fuera de orden no crean ítems falsos', () => {
  // La subsecuencia creciente descarta sola la fila "1 CABLE..." que va dentro del ítem 3.
  const texto = [
    '1 MESA CLINICA Mesa de acero inoxidable.',
    '2 CARRO CURACIONES Carro de dos bandejas.',
    '3 MONITOR SIGNOS VITALES Monitor multiparámetro.',
    '1 CABLE ECG DE REPUESTO incluido en el monitor',
    '4 OXIMETRO PULSO Oxímetro de dedo.',
  ].join('\n');
  const bloques = segmentarPorItems(texto);
  assert.deepEqual(bloques.map(b => b.numero), [1, 2, 3, 4]);
  // El cable quedó DENTRO del monitor, que es donde corresponde.
  assert.ok(bloques[2].texto.includes('CABLE ECG'));
});

test('segmentarPorItems: sin estructura creíble devuelve [] (el motor cae al documento completo)', () => {
  // Prefiere no segmentar a inventar cortes: un corte malo cruza productos entre sí.
  assert.deepEqual(segmentarPorItems('Documento en prosa, sin numeración ni encabezados de producto.'), []);
  assert.deepEqual(segmentarPorItems(''), []);
});

// ─── mapearBloquesALineas ───────────────────────────────────────────────────────────────────

test('mapearBloquesALineas: mapea por NOMBRE aunque la numeración del documento no calce', () => {
  // En 3489-29-LP26 las bases vienen en dos PDF, cada uno numerado desde 1, y la ficha los mezcla
  // en orden alfabético: el "ítem 1" de un documento no es la "línea 1" del checklist.
  const lineas = [{ linea: 30, nombre: 'SILLA DE RUEDAS' }, { linea: 7, nombre: 'MESA CLINICA' }];
  const bloques = [
    { numero: 1, titulo: 'MESA CLÍNICA', texto: 'Mesa de acero.' },
    { numero: 2, titulo: 'SILLA DE RUEDAS', texto: 'Silla plegable.' },
  ];
  const { porLinea, sobrantes } = mapearBloquesALineas(lineas, bloques);
  assert.equal(porLinea.get(30)?.titulo, 'SILLA DE RUEDAS');
  assert.equal(porLinea.get(7)?.titulo, 'MESA CLÍNICA');
  assert.equal(sobrantes.length, 0);
});

test('mapearBloquesALineas: el más parecido gana — la variante no se roba el bloque del genérico', () => {
  const lineas = [{ linea: 1, nombre: 'SILLA DE RUEDAS' }, { linea: 2, nombre: 'SILLA DE RUEDAS BARIATRICA' }];
  const bloques = [
    { numero: 1, titulo: 'SILLA DE RUEDAS', texto: 'Estándar.' },
    { numero: 2, titulo: 'SILLA DE RUEDAS BARIATRICA', texto: 'Reforzada 250 kg.' },
  ];
  const { porLinea } = mapearBloquesALineas(lineas, bloques);
  assert.equal(porLinea.get(1)?.texto, 'Estándar.');
  assert.equal(porLinea.get(2)?.texto, 'Reforzada 250 kg.');
});

test('mapearBloquesALineas: un bloque se usa UNA sola vez', () => {
  // Si dos líneas se llevaran el mismo bloque, la segunda se auditaría contra el producto ajeno.
  const lineas = [{ linea: 1, nombre: 'MESA CLINICA' }, { linea: 2, nombre: 'MESA CLINICA' }];
  const bloques = [{ numero: 1, titulo: 'MESA CLÍNICA', texto: 'Mesa de acero.' }];
  const { porLinea } = mapearBloquesALineas(lineas, bloques);
  assert.equal(porLinea.size, 1);
});

test('mapearBloquesALineas: sin candidato por sobre el umbral la línea queda SIN bloque', () => {
  // Dejarla sin bloque la manda al documento completo; cruzarla con otro producto la haría
  // aprobar o rechazar con las especificaciones equivocadas.
  const lineas = [{ linea: 1, nombre: 'CAJONERA 3 CAJONES' }];
  const bloques = [{ numero: 1, titulo: 'MONITOR DE SIGNOS VITALES', texto: 'Multiparámetro.' }];
  const { porLinea, sobrantes } = mapearBloquesALineas(lineas, bloques);
  assert.equal(porLinea.size, 0);
  assert.equal(sobrantes.length, 1);
});

// ─── caracteristicasDeBloque ────────────────────────────────────────────────────────────────

test('caracteristicasDeBloque: tabla HTML — toma la celda de especificación, no el N° ni el puntaje', () => {
  const bloque = {
    numero: 1, titulo: 'BALANZA',
    texto: `ÍTEM 1: BALANZA
<table>
<tr><td>N°</td><td>Especificación</td><td>Condición</td></tr>
<tr><td>1</td><td>Capacidad de carga mayor o igual a 180 kg</td><td>OBLIGATORIA</td></tr>
<tr><td>2</td><td>Precisión de lectura de 100 gramos o mejor</td><td>OBLIGATORIA</td></tr>
</table>`,
  };
  const cars = caracteristicasDeBloque(bloque);
  assert.deepEqual(cars, [
    'Capacidad de carga mayor o igual a 180 kg',
    'Precisión de lectura de 100 gramos o mejor',
  ]);
});

test('caracteristicasDeBloque: OCR degradado a texto plano — una fila por renglón, sin el título', () => {
  const bloque = {
    numero: 1, titulo: 'BALANZA',
    texto: [
      '1 BALANZA ADULTO',
      '1. Capacidad de carga mayor o igual a 180 kg',
      '2. Precisión de lectura de 100 gramos',
      'N°',
      'OBLIGATORIA',
      'Garantía mínima de 12 meses',
    ].join('\n'),
  };
  const cars = caracteristicasDeBloque(bloque);
  assert.deepEqual(cars, [
    'Capacidad de carga mayor o igual a 180 kg',
    'Precisión de lectura de 100 gramos',
    'Garantía mínima de 12 meses',
  ]);
});

test('caracteristicasDeBloque: deduplica los encabezados que el OCR repite entre páginas', () => {
  const bloque = {
    numero: 1, titulo: 'MESA',
    texto: [
      '1 MESA CLINICA',
      'Estructura de acero inoxidable AISI 304',
      'Estructura de acero inoxidable AISI 304',
      'Cuatro ruedas con freno en dos de ellas',
    ].join('\n'),
  };
  assert.deepEqual(caracteristicasDeBloque(bloque), [
    'Estructura de acero inoxidable AISI 304',
    'Cuatro ruedas con freno en dos de ellas',
  ]);
});

test('caracteristicasDeBloque: descarta basura de OCR y fragmentos demasiado cortos', () => {
  const bloque = {
    numero: 1, titulo: 'MESA',
    texto: ['1 MESA CLINICA', 'E NANA MAT', 'x', '12', 'Página 3', 'Cuatro ruedas con freno'].join('\n'),
  };
  assert.deepEqual(caracteristicasDeBloque(bloque), ['Cuatro ruedas con freno']);
});
