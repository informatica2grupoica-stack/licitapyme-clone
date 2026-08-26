// Tests de las señales deterministas de modalidad (Frente A.1). Cada una nació de un caso real
// que se documenta en el comentario de su función en planilla-costeo-parser.ts; aquí se fija ese
// caso como regresión permanente. Correr con:
//   npx tsx --test app/lib/__tests__/planilla-costeo-parser.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectarFormulariosEconomicosPorArchivo, detectarTipoAdjudicacionMultiple, extraerSeccionesLineaProducto,
  detectarLenguajePorLinea, detectarParticipacionParcialPorLinea, detectarPresupuestoPorLinea,
  detectarOfertaSubconjuntoItems, extraerPresupuestoPorLineaTabla,
  parsearPlanillaCosteo, extraerTablaProductoCantidad,
} from '../planilla-costeo-parser';

const doc = (texto: string) => [{ nombre: 'bases.pdf', categoria: 'BASES_ADMINISTRATIVAS', texto, metodo: 'pdf-text' }];

// ── Tabla canónica "Producto | Cantidad" de las bases técnicas ────────────────────────────
// (17-ago-2026, caso real 2345-128-LP26.) Extraída de un PDF, la tabla no es markdown ni CSV:
// las columnas se aplastan en una línea con el número al final. Sin este extractor, el listado
// autoritativo de qué se compra quedaba 100% a merced del LLM.
test('tabla canónica: extrae producto + cantidad de una tabla de bases en PDF (regresión 2345-128-LP26)', () => {
  const items = extraerTablaProductoCantidad(doc(`
B.1. ALCANCE Y DESCRIPCIÓN GENERAL
El objetivo del presente proceso es contratar la adquisición de equipamiento.
Producto Cantidad
Chaleco Balístico con funda con logo institucional. 155
Funda Chaleco Balístico con logo institucional 150
Cascos balísticos   300
Bastón Retráctil. 250
Linterna con funda. 260

B.2. ESPECIFICACIONES TÉCNICAS
A) Chaleco balístico con funda y logo institucional
El presente requerimiento técnico tiene por objeto establecer 3 especificaciones mínimas 40
`));
  assert.equal(items.length, 5, 'debe cortar en B.2 y no comerse la prosa de abajo');
  assert.equal(items[0].descripcion, 'Chaleco Balístico con funda con logo institucional');
  assert.equal(items[0].cantidad, 155);
  assert.equal(items[2].descripcion, 'Cascos balísticos');
  assert.equal(items[2].cantidad, 300);
  assert.equal(items[4].cantidad, 260);
});

test('tabla canónica: la tabla de CRITERIOS ("Ítem | Puntaje") nunca se confunde con productos', () => {
  const items = extraerTablaProductoCantidad(doc(`
RESUMEN DE EVALUACIÓN
Ítem Puntaje
Oferta Administrativa 4
Oferta Técnica 26
Oferta económica 70
`));
  assert.equal(items.length, 0, 'el encabezado dice Puntaje, no Cantidad → no es tabla de productos');
});

test('tabla canónica: prosa con números al final no se confunde con una tabla', () => {
  const items = extraerTablaProductoCantidad(doc(`
El plazo de entrega no podrá superar los 60
La garantía deberá extenderse por 12
`));
  assert.equal(items.length, 0, 'sin encabezado Producto|Cantidad no se extrae nada');
});

test('tabla canónica: menos de 3 filas no cuenta como tabla', () => {
  const items = extraerTablaProductoCantidad(doc(`
Producto Cantidad
Chaleco balístico 155
Cascos balísticos 300
`));
  assert.equal(items.length, 0, 'dos filas pueden ser coincidencia, no una tabla');
});

test('tabla canónica: acepta variantes del encabezado (Descripción/Bien/Artículo)', () => {
  for (const encabezado of ['Descripción Cantidad', 'Bienes Cantidad', 'Artículo Cant.']) {
    const items = extraerTablaProductoCantidad(doc(`${encabezado}\nMartillo de acero 10\nDestornillador plano 25\nLlave inglesa 12\n`));
    assert.equal(items.length, 3, `debe reconocer el encabezado "${encabezado}"`);
  }
});

// Caso real 3220-18-LE26 (12-ago-2026): "DETALLE_MATERIALES_ELECTRICOS..pdf" pierde todo espacio
// entre columnas al pasar por pdf-text — la fila queda "3" + "5.500" + "MTS" + "CABLE RVK…" pegada
// sin separador ("N°CANT.UNIDADDESCRIPCION" como header). El patrón de fila plana existente exige
// espacios y un precio "$ monto" final (es una solicitud de cotización, sin precios) → el documento
// entero quedaba sin ítems y el manifiesto lo terminaba armando el LLM, que leyó "5.500" (formato
// chileno de miles) como 5 en vez de 5500.
test('parsearPlanillaCosteo: fila plana con columnas PEGADAS sin espacio ni "$" (regresión 3220-18-LE26)', () => {
  const texto = [
    'N°CANT.UNIDADDESCRIPCION',
    '1700NRTUBO PVC CONDUIT 32MMX3MT C-4322 FUERTE',
    '2700NRTUBO PVC CONDUIT 20MMX3MT C-4322 FUERTE',
    '35.500MTSCABLE RVK 0.6/1KV 3X2.5MM NEGRO ASCABLE',
    '4120NRCAJA ESTANCA TOSUN 85X85X50MM C/7 CONOS',
    '5500NRTARUGO NYLON M-6 X 30MM',
    '6500NRTORNILLO CRS H/GRUESO 6X1 NEGRO',
    '74NRADHESIVO PVC TRADICIONAL 240CC C/PINCEL VINILIT',
    '8120NRSALIDA CAJA CONDUIT 32MM',
    '9120NRSALIDA CAJA CONDUIT 20MM',
    '10120NRCURVA CONDUIT 32MM',
    '11120NRCURVA CONDUIT 20MM',
    '122NRBARRA TOMA TIERRA 5/8 15.8MM X 1MT NORMALIZADA',
    '132NRCONECTOR BRONCE P/BARRA TOMATIERRA 5/8 NORMALIZADA',
  ].join('\n');
  const resultado = parsearPlanillaCosteo([{ nombre: 'DETALLE_MATERIALES_ELECTRICOS..pdf', texto }]);
  assert.ok(resultado, 'debe parsear la planilla en vez de devolver null');
  const cable = resultado!.items.find(i => i.descripcion.includes('CABLE RVK'));
  assert.ok(cable, 'debe encontrar el ítem CABLE RVK');
  assert.equal(cable!.cantidad, 5500, 'la cantidad "5.500" (miles con punto chileno) debe leerse como 5500, no 5');
  assert.equal(cable!.unidad, 'MTS');
  assert.equal(cable!.numero, 3);
  // Ítem 12 usa 2 dígitos de correlativo ("122NRBARRA…" = ítem 12, cant 2): sin anclar al
  // correlativo esperado, el dígito mínimo lazy lo leería como ítem 1, cantidad 22.
  const barra = resultado!.items.find(i => i.descripcion.includes('BARRA TOMA TIERRA'));
  assert.ok(barra, 'debe encontrar el ítem de 2 dígitos de correlativo');
  assert.equal(barra!.numero, 12);
  assert.equal(barra!.cantidad, 2);
});

// CAUSA RAÍZ REAL del bug de 3220-18-LE26: no era la fila pegada de arriba (esa era una vía
// alterna que ni se llegaba a usar), sino que "Bases_de_Licitacion....pdf" trae la MISMA tabla
// vía GLM-OCR como HTML ("<tr><td>3</td><td>5.500</td><td>MTS</td><td>CABLE RVK…</td></tr>") y
// esa gana el score sobre la fila pegada (empatan en items.length, pero el doc de Bases va primero
// alfabéticamente). parsearTablasHtml() cortaba la celda "CANT" en el primer no-dígito: "5.500"
// → capturaba solo "5" y tiraba ".500" a la unidad (que igual se pisaba con la columna UNIDAD real).
test('parsearPlanillaCosteo: tabla HTML (GLM-OCR) con cantidad de miles chilena "5.500" (causa raíz 3220-18-LE26)', () => {
  const filas = [
    ['N°', 'CANT.', 'UNIDAD', 'DESCRIPCION'],
    ['1', '700', 'NR', 'TUBO PVC CONDUIT 32MMX3MT C-4322 FUERTE'],
    ['2', '700', 'NR', 'TUBO PVC CONDUIT 20MMX3MT C-4322 FUERTE'],
    ['3', '5.500', 'MTS', 'CABLE RVK 0.6/1KV 3X2.5MM NEGRO ASCABLE'],
    ['4', '120', 'NR', 'CAJA ESTANCA TOSUN 85X85X50MM C/7 CONOS'],
    ['5', '500', 'NR', 'TARUGO NYLON M-6 X 30MM'],
    ['6', '500', 'NR', 'TORNILLO CRS H/GRUESO 6X1 NEGRO'],
    ['7', '4', 'NR', 'ADHESIVO PVC TRADICIONAL 240CC C/PINCEL VINILIT'],
    ['8', '120', 'NR', 'SALIDA CAJA CONDUIT 32MM'],
  ];
  const texto = filas.map(f => `<tr>${f.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
  const resultado = parsearPlanillaCosteo([{ nombre: 'Bases_de_Licitacion.pdf', texto }]);
  assert.ok(resultado, 'debe parsear la tabla HTML');
  const cable = resultado!.items.find(i => i.descripcion.includes('CABLE RVK'));
  assert.ok(cable, 'debe encontrar el ítem CABLE RVK');
  assert.equal(cable!.cantidad, 5500, 'la celda HTML "5.500" debe leerse como 5500, no truncarse a 5');
  assert.equal(cable!.unidad, 'MTS');
});

// ── Prioridad del anexo económico DEDICADO sobre el documento ómnibus ─────────────────────
// Caso real 1414396-21-LP26 (24-ago-2026, reporte del usuario "por qué me das 34 productos si
// son 29"): la Resolución Exenta contiene el anexo económico Y el ANEXO N°6 de DISTRIBUCIÓN DE
// ENTREGA (que repite productos por establecimiento). Con "más ítems gana" la Resolución (34)
// le ganaba al Anexo_Económico.xlsx (29, la lista real a cotizar): 5 filas fantasma y, de yapa,
// "Mueble Estante 30 Espacios" (cant. 2) leído como cantidad=30.
// Tabla CSV estilo planilla (el parser exige un mínimo de 8 filas para aceptar un documento).
// `col` es el nombre de la columna de producto: los ómnibus (resolución/bases) la titulan
// "Descripción", que además es lo que los hace pasar el filtro esCandidato() por contenido.
const tablaCsv = (filas: [string, number][], col: 'Producto' | 'Descripción' = 'Producto') => [
  `N°,${col},Cantidad,Precio Neto Unitario,Total Neto`,
  ...filas.map(([d, c], i) => `${i + 1},${d},${c}," 100.000 "," 100.000 "`),
].join('\n');

const CATALOGO: [string, number][] = [
  ['Armario Metálico 5 Niveles con Ruedas', 13], ['Colchoneta de Muda', 8],
  ['Mesa Biblioteca', 6], ['Mueble Estante 30 Espacios', 2],
  ['Silla ISO tapiz negro', 182], ['Kardex', 5],
  ['Mesa de Picnic', 10], ['Sillón para Lactancia', 2],
  ['Estante para Cartulinas', 1], ['Locker Metálicos 1 cuerpo - 4 puertas', 6],
];

test('parsearPlanillaCosteo: el anexo económico dedicado gana al ómnibus con MÁS filas (regresión 1414396-21-LP26)', () => {
  // El ómnibus repite el catálogo, parte mal "Mueble Estante 30 Espacios" (lee el 30 del NOMBRE
  // como cantidad) y le suma filas de la tabla de distribución por establecimiento.
  const omnibus = tablaCsv([
    ...CATALOGO.map(([d, c]) => [d.replace('30 Espacios', 'Espacios'), d.includes('30 Espacios') ? 30 : c] as [string, number]),
    ['Colchoneta de Muda', 4], ['Mesa Biblioteca', 6], ['Gabinete Base 3 Puertas', 1],
  ], 'Descripción');
  const resultado = parsearPlanillaCosteo([
    { nombre: 'Rex._N°1897_de_2026_C.pdf', categoria: 'BASES_ADMINISTRATIVAS', texto: omnibus },
    { nombre: 'Anexo_Económico.xlsx', categoria: 'ANEXOS_OFERENTE', texto: tablaCsv(CATALOGO), metodo: 'excel' },
  ]);
  assert.ok(resultado, 'debe parsear algo');
  assert.equal(resultado!.items.length, 10, 'debe quedarse con los 10 del anexo, no con los 13 del ómnibus');
  const estante = resultado!.items.find(i => /Mueble Estante/.test(i.descripcion));
  assert.equal(estante!.cantidad, 2, 'el "30" es parte del NOMBRE (30 Espacios), no la cantidad');
  assert.ok(!resultado!.items.some(i => /Gabinete/.test(i.descripcion)), 'no debe colarse la fila de distribución');
});

test('parsearPlanillaCosteo: registra TODAS las fuentes leídas y sus discrepancias (traza anti-invento)', () => {
  const resultado = parsearPlanillaCosteo([
    { nombre: 'Rex._N°1897_de_2026_C.pdf', categoria: 'BASES_ADMINISTRATIVAS', texto: tablaCsv([...CATALOGO, ['Gabinete Base 3 Puertas', 1]], 'Descripción') },
    { nombre: 'Anexo_Económico.xlsx', categoria: 'ANEXOS_OFERENTE', texto: tablaCsv(CATALOGO), metodo: 'excel' },
  ]);
  assert.equal(resultado!.candidatos!.length, 2, 'ningún documento legible se descarta en silencio');
  assert.ok(resultado!.candidatos!.find(c => /Rex/.test(c.fuenteDoc) && !c.elegido), 'la fuente no elegida queda registrada');
  assert.ok(resultado!.candidatos!.find(c => /Anexo_Económico/.test(c.fuenteDoc) && c.elegido), 'y cuál se eligió');
  assert.equal(resultado!.discrepancias!.length, 1, 'la diferencia 11 vs 10 queda escrita, no se tapa');
  assert.match(resultado!.discrepancias![0], /11 ítems/);
});

test('parsearPlanillaCosteo: fuentes que concuerdan no generan discrepancias', () => {
  const resultado = parsearPlanillaCosteo([
    { nombre: 'Bases_Administrativas.pdf', categoria: 'BASES_ADMINISTRATIVAS', texto: tablaCsv(CATALOGO) },
    { nombre: 'Anexo_Económico.xlsx', categoria: 'ANEXOS_OFERENTE', texto: tablaCsv(CATALOGO), metodo: 'excel' },
  ]);
  assert.equal(resultado!.discrepancias!.length, 0, 'mismo conteo en ambas fuentes = nada que levantar');
});

// ── Muchas licitaciones NO traen anexo económico con ítems: la lista vive en las bases ─────
// La prioridad por autoridad NO puede volverse una dependencia del anexo económico. Cuando no
// existe (o existe pero en blanco), la lista debe salir de las bases sin fricción.
test('parsearPlanillaCosteo: SIN anexo económico, la lista sale de las bases', () => {
  const resultado = parsearPlanillaCosteo([
    { nombre: 'Bases_Técnicas.pdf', categoria: 'BASES_TECNICAS', texto: tablaCsv(CATALOGO, 'Descripción') },
  ]);
  assert.ok(resultado, 'sin anexo económico igual debe entregar la lista');
  assert.equal(resultado!.items.length, 10);
  assert.equal(resultado!.discrepancias!.length, 0, 'una sola fuente no puede contradecirse');
});

test('parsearPlanillaCosteo: bases técnicas (autoridad 1) le ganan al ómnibus contaminado (autoridad 2)', () => {
  // Mismo patrón del bug, pero sin anexo económico en juego: el ómnibus trae 3 filas de más.
  const resultado = parsearPlanillaCosteo([
    { nombre: 'Rex._N°1897_de_2026_C.pdf', categoria: 'BASES_ADMINISTRATIVAS', texto: tablaCsv([...CATALOGO, ['Colchoneta de Muda', 4], ['Mesa Biblioteca', 6], ['Gabinete Base 3 Puertas', 1]], 'Descripción') },
    { nombre: 'Bases_Técnicas.pdf', categoria: 'BASES_TECNICAS', texto: tablaCsv(CATALOGO, 'Descripción') },
  ]);
  assert.equal(resultado!.items.length, 10, 'la tabla de las bases manda sobre la resolución ómnibus');
  assert.equal(resultado!.discrepancias!.length, 1, 'y la diferencia queda registrada igual');
});

test('parsearPlanillaCosteo: anexo económico en BLANCO no bloquea la lista de las bases', () => {
  // Plantilla sin desglose (solo encabezado y totales): no llega al mínimo de filas del parser,
  // así que ni siquiera es candidata — las bases entregan la lista sin competencia.
  const resultado = parsearPlanillaCosteo([
    { nombre: 'Anexo_Económico.xlsx', categoria: 'ANEXOS_OFERENTE', metodo: 'excel', texto: 'Anexo Económico\nN°,Producto,Cantidad\n,,\nTotal Neto, - \nIVA (19%), - ' },
    { nombre: 'Bases_Técnicas.pdf', categoria: 'BASES_TECNICAS', texto: tablaCsv(CATALOGO, 'Descripción') },
  ]);
  assert.equal(resultado!.items.length, 10, 'un anexo vacío nunca puede dejar la licitación sin productos');
  assert.equal(resultado!.fuenteDoc, 'Bases_Técnicas.pdf');
});

test('parsearPlanillaCosteo: anexo económico TRUNCADO no desplaza al que sí leyó (guardarraíl del 50%)', () => {
  const resultado = parsearPlanillaCosteo([
    { nombre: 'Bases_Administrativas.pdf', categoria: 'BASES_ADMINISTRATIVAS', texto: tablaCsv([...CATALOGO, ...CATALOGO]) },
    { nombre: 'Anexo_Económico.xlsx', categoria: 'ANEXOS_OFERENTE', texto: tablaCsv(CATALOGO.slice(0, 8)), metodo: 'excel' },
  ]);
  assert.ok(resultado, 'debe parsear algo');
  assert.equal(resultado!.items.length, 20, 'con 8 de 20 ítems el anexo está truncado: gana el que más leyó');
});

// Caso real 1250623-4-LE26 (21-jul-2026, detectado por CA leyendo las bases a mano): "se evaluará
// por línea de producto" es sobre el PUNTAJE, no sobre quién gana — esta licitación se adjudica a
// UN SOLO oferente (Art. 13º/15º de sus bases). detectarLenguajePorLinea() SÍ debe seguir
// disparando (sirve para costeo/hints), pero detectarParticipacionParcialPorLinea() —la que decide
// ADJUDICACIÓN— NO debe disparar con esta frase.
test('evaluación por línea NO es evidencia de adjudicación repartida (regresión 1250623-4-LE26)', () => {
  const docs = [{ texto: 'El presente ítem A Incluido y se evaluará por línea de producto, según la tabla siguiente.' }];
  assert.ok(detectarLenguajePorLinea(docs), 'detectarLenguajePorLinea debe seguir disparando (sirve para costeo)');
  assert.equal(detectarParticipacionParcialPorLinea(docs), null, 'participación parcial NO debe disparar solo por "se evaluará por línea"');
});

test('participación parcial SÍ dispara con lenguaje de oferta/omisión por línea', () => {
  const docs = [{ texto: 'Los oferentes podrán ofertar en una o más líneas, según su conveniencia comercial.' }];
  assert.ok(detectarParticipacionParcialPorLinea(docs), 'debe reconocer "podrán ofertar en una o más líneas" como participación parcial');
});

// Caso real 2422-144-LE26 (20-ago-2026, detectado por CA leyendo las bases): el Artículo Nº3 dice
// "La licitación se realizará por líneas […] cada oferente podrá ofertar por una o más DE LAS
// SIGUIENTES líneas: 1. Materiales de ferretería… 2. Herramientas…". Los tres detectores fallaban
// por el conector "de las siguientes" entre "o más" y "líneas": TODOS los patrones lo esperaban
// pegado ("una o más líneas"). Sin ninguna señal determinista, el override forzó GLOBAL con el
// texto "sin evidencia objetiva de que se pueda ganar solo una parte" y la licitación quedó como
// suma alzada, cuando las bases dicen lo contrario en su artículo más explícito.
test('"ofertar por una o más DE LAS SIGUIENTES líneas" es por-línea (regresión 2422-144-LE26)', () => {
  // Con saltos de línea entre palabras, tal como quedó el texto extraído del PDF real.
  const docs = [{ texto: 'La\nlicitación\nse\nrealizará\npor\nlíneas,\nbajo\nla\nmodalidad\nde\nadjudicación\nsimple,\nen\ndonde\ncada\noferente\npodrá\nofertar\npor\nuna\no\nmás\nde\nlas\nsiguientes\nlíneas:\n1.\nMateriales\nde\nferretería.\n2.\nHerramientas.' }];
  assert.ok(detectarLenguajePorLinea(docs), 'lenguaje por línea debe disparar');
  assert.ok(detectarParticipacionParcialPorLinea(docs), 'participación parcial debe disparar: se puede ofertar a un subconjunto');
  assert.ok(detectarOfertaSubconjuntoItems(docs), 'oferta por subconjunto debe disparar');
});

// El conector no puede volverse un comodín: "una o más" seguido de otra cosa que no sean
// ítems/líneas no debe disparar (evita que el arreglo de arriba abra falsos positivos).
test('"una o más" sin ítems/líneas detrás NO dispara', () => {
  const docs = [{ texto: 'El oferente podrá ofertar por una o más de las siguientes formas de pago señaladas.' }];
  assert.equal(detectarParticipacionParcialPorLinea(docs), null, 'no debe disparar sin "líneas"/"ítems"');
  assert.equal(detectarOfertaSubconjuntoItems(docs), null, 'no debe disparar sin "líneas"/"ítems"');
});

// Caso real 2446-167-LP26: 8 archivos separados, uno por línea.
test('detectarFormulariosEconomicosPorArchivo: 8 archivos separados → 8 líneas', () => {
  const docs = Array.from({ length: 8 }, (_, i) => ({ nombre: `0${i + 1}_FORMULARIO_ECONÓMICO_LÍNEA_${i + 1}.xlsx` }));
  const r = detectarFormulariosEconomicosPorArchivo(docs);
  assert.deepEqual(r, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('detectarFormulariosEconomicosPorArchivo: sin ese patrón de nombre → vacío', () => {
  const docs = [{ nombre: 'BASES_ADMINISTRATIVAS.pdf' }, { nombre: 'Anexo_Economico.xlsx' }];
  const r = detectarFormulariosEconomicosPorArchivo(docs);
  assert.deepEqual(r, []);
});

// Caso real 2446-167-LP26: la frase aparece sin el label "TIPO DE ADJUDICACIÓN" pegado (tabla mal
// extraída) y con un error de OCR (í → f).
test('detectarTipoAdjudicacionMultiple: reconoce "Múltiple (Por lineas)" sin label pegado', () => {
  const docs = [{ texto: 'PRESUPUESTO TOTAL DISPONIBLE\n$5.550.000\nMúltiple  (Por lineas)\n4. COMISIÓN EVALUADORA' }];
  assert.ok(detectarTipoAdjudicacionMultiple(docs));
});

test('detectarTipoAdjudicacionMultiple: tolera error de OCR "lfneas" (í→f)', () => {
  const docs = [{ texto: 'el tipo de adjudicación que corresponde es múltiple (adjudicación por lfneas), los oferentes' }];
  assert.ok(detectarTipoAdjudicacionMultiple(docs));
});

test('detectarTipoAdjudicacionMultiple: sin la frase → null', () => {
  const docs = [{ texto: 'Se adjudicará al oferente que obtenga el mayor puntaje.' }];
  assert.equal(detectarTipoAdjudicacionMultiple(docs), null);
});

// Caso real 2295-74-LE26 (dos bugs distintos, ambos regresión aquí):
//  1) el encabezado "LINEA DE PRODUCTO N°X" sin numeral de artículo delante (formato Excel) debe
//     reconocerse igual que con numeral (formato PDF de bases).
//  2) si un documento de referencia (BAE) menciona las líneas SOLO en la tabla de presupuesto (sin
//     productos), no debe ganarle al documento real con los productos (selección por "piso").
test('extraerSeccionesLineaProducto: reconoce encabezado SIN numeral de artículo (formato Excel)', () => {
  const docs = [{
    nombre: 'Anexo_N6.xls',
    texto: `LINEA DE PRODUCTO N°1: Materiales\n${'1,Tapa pino bruto,uni,200\n'.repeat(30)}\nLINEA DE PRODUCTO N°2: Arriendo\n${'1,Arriendo camion,dia,14\n'.repeat(10)}`,
  }];
  const secciones = extraerSeccionesLineaProducto(docs);
  assert.equal(secciones.length, 2);
  assert.equal(secciones[0].linea, 1);
  assert.equal(secciones[1].linea, 2);
});

test('extraerSeccionesLineaProducto: prefiere el documento con contenido real sobre uno con solo menciones sueltas', () => {
  const docReferencia = {
    nombre: 'BAE.pdf',
    // 4 menciones de línea, cada una SOLO con nombre+monto (sin productos) — como una tabla de presupuesto.
    texto: 'Línea de Producto N°1 Materiales 15.906.292\nLínea de Producto N°2 Arriendo 10.215.093\nLínea de Producto N°3 Áridos 4.966.560\nLínea de Producto N°4 Mobiliario 1.904.000',
  };
  const docReal = {
    nombre: 'Anexo_N6.xls',
    texto: `LINEA DE PRODUCTO N°1: Materiales\n${'1,Producto real,uni,10\n'.repeat(40)}\nLINEA DE PRODUCTO N°2: Arriendo\n${'1,Producto real,dia,5\n'.repeat(10)}\nLINEA DE PRODUCTO N°3: Áridos\n${'1,Producto real,m3,3\n'.repeat(12)}\nLINEA DE PRODUCTO N°4: Mobiliario\n${'1,Producto real,uni,2\n'.repeat(8)}`,
  };
  // El orden importa para la regresión: el documento de referencia (sin productos) va PRIMERO,
  // exactamente como pasó en 2295-74-LE26 (BAE antes que el Excel real en la lista de documentos).
  const secciones = extraerSeccionesLineaProducto([docReferencia, docReal]);
  assert.equal(secciones.length, 4);
  // Si eligió el documento real, cada sección tiene cientos de caracteres (muchas filas), no unas
  // pocas decenas (solo el nombre + monto de la tabla de presupuesto).
  for (const s of secciones) assert.ok(s.texto.length > 200, `sección línea ${s.linea} muy chica (${s.texto.length}c) — parece que eligió el documento equivocado`);
});

test('extraerSeccionesLineaProducto: con menos de 2 secciones devuelve vacío', () => {
  const docs = [{ nombre: 'a.pdf', texto: 'LINEA DE PRODUCTO N°1: Materiales\n' + 'x'.repeat(300) }];
  assert.deepEqual(extraerSeccionesLineaProducto(docs), []);
});

// Caso real 1738-18-LE26: el Anexo N°2 Económico de un proyecto PMU trae el encabezado CORTO
// "LÍNEA 1: Nombre" (sin "DE PRODUCTO" ni "N°") — el regex estricto no lo reconocía → 0 secciones
// → nunca corría la extracción dedicada → el manifiesto quedó con 1 ítem "Global" por línea (los
// ~50 productos reales aplastados en el campo "modelo") en vez de una fila por producto.
test('extraerSeccionesLineaProducto: reconoce encabezado corto "LÍNEA N: Nombre" (sin "DE PRODUCTO" ni "N°")', () => {
  const docs = [{
    nombre: 'ANEXOS_PMU.docx',
    texto: `LÍNEA 1: LETRERO DE OBRAS\n${'Cuarton 4" x 4"\nUN\n6.0\n'.repeat(15)}\nLÍNEA 2: ARRIENDO BAÑOS QUÍMICO\n${'Arriendo Baño Químico\nMES\n6.0\n'.repeat(15)}`,
  }];
  const secciones = extraerSeccionesLineaProducto(docs);
  assert.equal(secciones.length, 2);
  assert.equal(secciones[0].linea, 1);
  assert.equal(secciones[1].linea, 2);
});

// El patrón corto solo debe intentarse cuando el estricto no encontró ≥2 secciones — un documento
// que YA matchea bien con "DE PRODUCTO" no debe verse afectado por menciones sueltas de "línea".
test('extraerSeccionesLineaProducto: el patrón corto no interfiere si el estricto ya encontró ≥2 secciones', () => {
  const docs = [{
    nombre: 'bases.pdf',
    texto: `Nota: revisar la línea 1: de la tabla de referencia más abajo.\nLINEA DE PRODUCTO N°1: Materiales\n${'1,Producto real,uni,10\n'.repeat(30)}\nLINEA DE PRODUCTO N°2: Arriendo\n${'1,Producto real,dia,5\n'.repeat(15)}`,
  }];
  const secciones = extraerSeccionesLineaProducto(docs);
  assert.equal(secciones.length, 2, 'debe seguir dando 2 secciones (las de "DE PRODUCTO"), no una tercera espuria de la nota');
});

// Caso real 2713-110-LE26 (Equipamiento Cementerio Municipal Puerto Aysén): las bases dicen "la
// cual será adjudicada por línea" (participio, NO "adjudicar/adjudicará/adjudicarse") — ningún
// patrón anterior lo reconocía y el veredicto caía al default GLOBAL pese a ser inequívoco.
test('detectarTipoAdjudicacionMultiple: reconoce pasiva "será adjudicada por línea"', () => {
  const docs = [{ texto: 'la cual será adjudicada por línea, pudiendo presentarse ofertas para una o varias líneas por parte de los oferentes.' }];
  assert.ok(detectarTipoAdjudicacionMultiple(docs));
});

// Mismo caso real: formulación alternativa "el método de adjudicación... será por línea", sin
// "múltiple"/"independiente" cerca, tampoco cubierta por los patrones anteriores.
test('detectarTipoAdjudicacionMultiple: reconoce "el método de adjudicación... será por línea"', () => {
  const docs = [{ texto: 'El método de adjudicación de la presente licitación será por línea las cuales tiene un presupuesto designado para cada una de ellas.' }];
  assert.ok(detectarTipoAdjudicacionMultiple(docs));
});

// Caso real 1057536-83-LE26 (CESFAM Frutillar, 28-jul-2026): "Se podrá adjudicar A UN SOLO
// PROVEEDOR por línea" — "un solo proveedor" queda ENTRE "adjudicar" y "por línea", así que el
// patrón "adjudicar(?:se|á|an|a)?\s+por\s+…" (sin nada en medio) no la reconocía y el veredicto
// caía al default GLOBAL pese a ser evidencia inequívoca de por_linea (cada línea tiene su propio
// ganador, pueden ser proveedores distintos entre líneas).
test('detectarTipoAdjudicacionMultiple: reconoce "adjudicar a un solo proveedor por línea"', () => {
  const docs = [{ texto: '24.2 Aceptación de la orden de compra Se podrá adjudicar a un solo proveedor por línea; el que tendrá un plazo de 48 horas para la aceptación de orden de compra.' }];
  assert.ok(detectarTipoAdjudicacionMultiple(docs));
});

// Auditoría masiva 28-jul-2026 sobre 892 licitaciones con documentos cacheados: bajó de 280 a 192
// fragmentos "adjudicación + línea/lote/ítem" sin reconocer. Los siguientes tests fijan los
// patrones nuevos que salieron de esa auditoría, verificados sin conflicto contra los 31 casos
// del Golden Set (los 9 que ahora disparan ya esperaban POR_LINEAS).

test('detectarTipoAdjudicacionMultiple: "un oferente" SIN "solo/único" (1057500-53-LE26)', () => {
  const docs = [{ texto: 'Artículo 19°: Adjudicación. - La presente licitación será adjudicada a un oferente por línea.' }];
  assert.ok(detectarTipoAdjudicacionMultiple(docs));
});

test('detectarTipoAdjudicacionMultiple: pasiva "ser adjudicada a un solo oferente por línea" (1057049-210-LP26)', () => {
  const docs = [{ texto: 'La presente licitación podrá ser adjudicada a un solo oferente por línea, atendiendo al mayor puntaje obtenido.' }];
  assert.ok(detectarTipoAdjudicacionMultiple(docs));
});

test('detectarTipoAdjudicacionMultiple: "en cada una de las líneas" en vez de "por línea" (4956-52-LE26)', () => {
  const docs = [{ texto: 'Se podrá adjudicar a un solo proveedor en cada una de las líneas de la presente licitación.' }];
  assert.ok(detectarTipoAdjudicacionMultiple(docs));
});

test('detectarTipoAdjudicacionMultiple: orden invertido singular "un proveedor distinto" (1079576-27-LE26)', () => {
  const docs = [{ texto: 'La adjudicación sólo dice relación con los anexos del N°1 al N°8, pudiendo cada anexo resultar adjudicado a un proveedor distinto, o bien adjudicarse todas las líneas en conjunto.' }];
  assert.ok(detectarTipoAdjudicacionMultiple(docs));
});

test('detectarTipoAdjudicacionMultiple: orden invertido plural "oferentes distintos" (caso real 1260113-2-LE26)', () => {
  const docs = [{ texto: 'Es decir, se evaluará por separado los seis ítems, pudiendo adjudicar hasta a seis oferentes distintos. Los ítems anteriores comprenden: ITEM 1, ITEM 2.' }];
  assert.ok(detectarTipoAdjudicacionMultiple(docs));
});

test('detectarTipoAdjudicacionMultiple: caso real completo 1260113-2-LE26 (ya cubierto por el encabezado "adjudicación es por línea")', () => {
  const docs = [{ texto: 'NOTA: La adjudicación es por línea; es decir, se evaluará por separado los seis ítems, pudiendo adjudicar hasta a seis oferentes distintos.' }];
  assert.ok(detectarTipoAdjudicacionMultiple(docs));
});

test('detectarTipoAdjudicacionMultiple: encabezado nominal "ADJUDICACIÓN POR LÍNEAS" sin verbo (5053-27-LE26)', () => {
  const docs = [{ texto: '10. ADJUDICACIÓN POR LÍNEAS\nSe procederá conforme a lo indicado en el anexo N°3.' }];
  assert.ok(detectarTipoAdjudicacionMultiple(docs));
});

test('detectarTipoAdjudicacionMultiple: "adjudicación... será por línea" (verbo "ser", 3134-59-LP26)', () => {
  const docs = [{ texto: 'b.- La adjudicación será por línea, según lo dispuesto en el punto anterior.' }];
  assert.ok(detectarTipoAdjudicacionMultiple(docs));
});

test('detectarTipoAdjudicacionMultiple: NO dispara con el falso amigo "en línea" = por internet (guard preexistente, no regresión)', () => {
  const docs = [{ texto: 'La resolución de adjudicación se publicará en línea en el portal www.mercadopublico.cl dentro de las 24 horas siguientes.' }];
  assert.equal(detectarTipoAdjudicacionMultiple(docs), null);
});

test('detectarTipoAdjudicacionMultiple: "mejor oferta por cada línea" (confianza media, 3336-16-LP26)', () => {
  const docs = [{ texto: 'La adjudicación se realizará considerando la mejor oferta por cada línea de producto licitada.' }];
  assert.ok(detectarTipoAdjudicacionMultiple(docs));
});

test('detectarTipoAdjudicacionMultiple: "mayor puntaje en la evaluación... DE cada línea" (confianza media, 752-24-LP26)', () => {
  const docs = [{ texto: 'La presente licitación se adjudicará al oferente que tuviere mayor puntaje en la evaluación final de cada línea ofertada.' }];
  assert.ok(detectarTipoAdjudicacionMultiple(docs));
});

// Caso real 859378-8-LE26 (kayaks Escuela Naútica de Gestión en Turismo y Cultura, 17-ago-2026):
// "La presente licitación será de adjudicación múltiple" — el sujeto es "la licitación", no "la
// modalidad" (único sujeto que el patrón del 10-ago cubría), así que caía al default GLOBAL pese
// a la declaración explícita de las bases.
test('detectarTipoAdjudicacionMultiple: "la presente licitación será de adjudicación múltiple" (859378-8-LE26)', () => {
  const docs = [{ texto: 'La presente licitación será de adjudicación múltiple, pudiendo adjudicar a más de un oferente o a un mismo oferente las siguientes cuatro líneas de contratación:' }];
  assert.ok(detectarTipoAdjudicacionMultiple(docs));
});

// Mismo caso: aunque no se detectara la frase anterior, "pudiendo adjudicar a más de un oferente"
// es evidencia decisiva por sí sola (no exige "distintos/diferentes oferentes" como los clusters
// existentes, ni "por línea/lote" pegado a "adjudicar").
test('detectarTipoAdjudicacionMultiple: "adjudicar a más de un oferente" sin "distintos/diferentes" (859378-8-LE26)', () => {
  const docs = [{ texto: 'pudiendo adjudicar a más de un oferente o a un mismo oferente las siguientes cuatro líneas de contratación' }];
  assert.ok(detectarTipoAdjudicacionMultiple(docs));
});

// Caso real 1079650-47-LE26 (Hospital Traumatológico de Concepción): campo formal "c) Tipo de
// licitación: Pública-Adjudicación Múltiple-Licitación Pública Entre 100 y 1000 UTM (LE)" — el
// campo se llama "TIPO DE LICITACIÓN", no "TIPO DE ADJUDICACIÓN" (patrón ya existente en la línea
// 334), así que ningún patrón previo la cazaba y el veredicto cayó al default GLOBAL pese a que la
// propia IA citó la frase como fuente.
test('detectarTipoAdjudicacionMultiple: "Tipo de licitación: Pública-Adjudicación Múltiple" (1079650-47-LE26)', () => {
  const docs = [{ texto: 'c) Tipo de licitación: Pública-Adjudicación Múltiple-Licitación Pública Entre 100 y 1000 UTM (LE)\nd) Tipo de convocatoria: ABIERTO' }];
  assert.ok(detectarTipoAdjudicacionMultiple(docs));
});

// Mismo caso, sección "22. DE LA ADJUDICACION": "el Servicio adjudicará bajo la modalidad de
// Adjudicación Múltiple aceptando la oferta que obtenga el mayor puntaje en la evaluación" — el
// patrón "modalidad...será de adjudicación múltiple" exige el verbo SER; acá el verbo es ADJUDICAR
// y la preposición es "bajo la modalidad de", no "será de". El salto de línea real del PDF entre
// "de" y "Adjudicación" queda cubierto por \s+.
test('detectarTipoAdjudicacionMultiple: "adjudicará bajo la modalidad de Adjudicación Múltiple" (1079650-47-LE26)', () => {
  const docs = [{ texto: 'Finalizado el proceso de evaluación de las Ofertas, el Servicio adjudicará bajo la modalidad de\nAdjudicación Múltiple aceptando la oferta que obtenga el mayor puntaje en la evaluación' }];
  assert.ok(detectarTipoAdjudicacionMultiple(docs));
});

// Caso real 2713-110-LE26: tabla "LINEAS | PARTIDA | UNIDAD | CANTIDAD | Presupuesto disponible
// por línea" con filas numeradas y su monto, agrupadas por categoría (OPERACIONAL/ADMINISTRATIVO)
// vía <td colspan>. La palabra "línea" NO se repite por fila (solo una vez, en el encabezado de
// columna), así que los 3 contadores previos (totalesPorLinea/etiquetasLinea/lineasConMonto) no
// la veían — devolvía null pese a que la frase-ancla sí matcheaba.
test('detectarPresupuestoPorLinea: reconoce tabla "LINEAS | ... | Presupuesto disponible por línea" sin la palabra repetida por fila', () => {
  const docs = [{
    texto: 'El valor de las ofertas presentadas por línea no podrá ser superior al presupuesto oficial disponible para cada una de ellas, ' +
      'el presupuesto por línea se desglosa de la siguiente manera: ' +
      '<table border="1"><tr><td>LINEAS</td><td>PARTIDA</td><td>UNIDAD</td><td>CANTIDAD</td><td>Presupuesto disponible por línea</td></tr>' +
      '<tr><td colspan="5">OPERACIONAL</td></tr>' +
      '<tr><td>1</td><td>Carpa 180m2</td><td>un</td><td>1</td><td>$2.877.420</td></tr>' +
      '<tr><td>2</td><td>Carpa 80m2</td><td>un</td><td>1</td><td>$1.513.124</td></tr>' +
      '<tr><td colspan="5">ADMINISTRATIVO</td></tr>' +
      '<tr><td>3</td><td>Escritorio de oficina</td><td>un</td><td>2</td><td>$312.494</td></tr></table>',
  }];
  assert.ok(detectarPresupuestoPorLinea(docs), 'debe reconocer la tabla como ≥2 líneas presupuestadas');
});

test('detectarPresupuestoPorLinea: tabla genérica sin frase-ancla no dispara (evita falso positivo)', () => {
  const docs = [{
    texto: '<table border="1"><tr><td>N°</td><td>Producto</td><td>Cantidad</td><td>Precio</td></tr>' +
      '<tr><td>1</td><td>Silla</td><td>2</td><td>$10.000</td></tr>' +
      '<tr><td>2</td><td>Mesa</td><td>1</td><td>$20.000</td></tr></table>',
  }];
  assert.equal(detectarPresupuestoPorLinea(docs), null, 'sin la frase "presupuesto...por línea" en el documento, no debe disparar solo por tener una tabla numerada con montos');
});

// Caso real 1079650-47-LE26 (Hospital Traumatológico de Concepción): la Resolución lista el
// presupuesto de cada ítem como PROSA corrida ("Monto disponible Item N°X $ Y.- (IVA incluido)"),
// no como tabla HTML — el manifiesto de la IA traía presupuesto_linea=0 en las 9 líneas pese a que
// el documento sí trae el monto exacto de cada una. La palabra "Item/Ítem" sale OCR-eada distinta
// en CADA línea del mismo documento real (Item/tem/¡tem/Ítem/ltem/ítem) y el símbolo "$" sale como
// "S" en 2 de las 9 — este test fija el caso real completo, con esos mismos errores de OCR.
test('extraerPresupuestoPorLineaTabla: reconoce prosa "Monto disponible Item N°X $ Y" con OCR inconsistente (1079650-47-LE26)', () => {
  const docs = [{
    texto: 'Monto total: $ 7.559.999.-IVA Incluido.\n' +
      'Monto disponible Item N*1 $ 640.001.- (IVA incluido)\n' +
      'Monto disponible tem N*2 $ 1.239.999.- (IVA incluido)\n' +
      'Monto disponible ¡tem N*3 $ 1.049.997.- (IVA incluido)\n' +
      'Monto disponible Ítem N*4 S 899.999.- (IVA incluido)\n' +
      'Monto disponible ltem N*5 $ 350.000.- (IVA incluido)\n' +
      'Monto disponible ltem N*6 $ 1.750.002.- (IVA incluido)\n' +
      'Monto disponible Ítem N*7 S 179.999.- (IVA incluido)\n' +
      'Monto disponible ¡tem N*8 $ 1.150.001.- (IVA incluido)\n' +
      'Monto disponible ítem N*9 $ 300.000.- (IVA incluido)\n',
  }];
  const mapa = extraerPresupuestoPorLineaTabla(docs);
  assert.ok(mapa, 'debe reconocer las 9 líneas presupuestadas');
  assert.equal(mapa!.size, 9);
  assert.equal(mapa!.get(1), 640001);
  assert.equal(mapa!.get(4), 899999, 'ítem 4 usa "S" en vez de "$" (error de OCR)');
  assert.equal(mapa!.get(7), 179999, 'ítem 7 usa "S" en vez de "$" (error de OCR)');
  assert.equal(mapa!.get(9), 300000);
});

test('extraerPresupuestoPorLineaTabla: sin la frase-ancla "monto disponible/máximo/asignado" no dispara', () => {
  const docs = [{ texto: 'El monto del contrato N°1 es $500.000 y el del contrato N°2 es $600.000, ambos referenciales.' }];
  assert.equal(extraerPresupuestoPorLineaTabla(docs), null);
});

// ── TABLAS DE WORD: separadas por TABULACIONES ───────────────────────────────────────────
// (25-ago-2026, caso real 2328-41-LE26.) celdasDe solo entendía pipes y CSV con comas, así que
// el parser era CIEGO a todo cuadro económico en .doc/.docx — justo donde vive el listado
// canónico (el formulario que el oferente llena para cotizar). En esa licitación el
// "Formulario_oferta_económica" traía las 18 herramientas con cantidad y unidad y no se leyó
// ninguna; ganó por volumen un xlsx de útiles escolares que ni correspondía a esa licitación.
const docWord = (texto: string) =>
  [{ nombre: 'Formulario_oferta_económica_E-44.doc', categoria: 'ANEXOS_OFERENTE', texto, metodo: 'word-doc' }];

test('tabla de Word tabulada: se lee el cuadro económico con cantidad y unidad (regresión 2328-41-LE26)', () => {
  const r = parsearPlanillaCosteo(docWord(
    'FORMULARIO Nº 2\n\n'
    + 'Cantidad\tEspecificaciones del producto o servicio solicitado\tUnidad\tCosto Unitario neto\n'
    + '1\tEXTRACTOR DE SOLDADURA Herramienta para la extraccion de soldadura\tUnidad\t \n'
    + '2\tINTERRUPTOR TERMOMAGNETICO Proteccion contra sobrecargas termicas\tUnidad\t \n'
    + '1\tSET DE LLAVES TORX Conjunto de llaves Torx cortas con organizador\tSet\t \n'
    + '3\tTEMPORIZADOR Equipo de control y conmutacion temporizada\tUnidad\t \n'
    + '1\tESTACION NEUMATICA Estacion de compresor silencioso con mesa\tUnidad\t \n'
    + '1\tFUENTE DE PODER regulable para laboratorio de electronica\tUnidad\t \n'
    + '1\tGENERADOR DE FUNCIONES para simulacion de circuitos\tUnidad\t \n'
    + '1\tKIT FOTOVOLTAICO PANEL con estructura y controlador\tUnidad\t \n'
    + '1\tENTRENADOR ANALOGO DIGITAL para simulacion de circuitos\tUnidad\t \n'));
  assert.ok(r, 'el parser no leyó una tabla de Word separada por tabulaciones');
  assert.equal(r!.items.length, 9);
  assert.match(r!.items[0].descripcion, /EXTRACTOR DE SOLDADURA/);
  assert.equal(r!.items[1].cantidad, 2, 'no tomó la cantidad de la columna tabulada');
  assert.equal(r!.items[2].unidad, 'Set', 'no tomó la unidad de la columna tabulada');
});

// El reverso: un anexo administrativo en Word está lleno de líneas tabuladas que son un
// FORMULARIO EN BLANCO. Una plantilla vacía no puede convertirse en un listado de productos.
test('formulario en blanco tabulado NO se lee como planilla (rótulos sin contenido)', () => {
  const r = parsearPlanillaCosteo([{ nombre: 'ANEXOS.doc', categoria: 'ANEXOS_OFERENTE', metodo: 'word-doc', texto:
    'ANEXO N°1 IDENTIFICACIÓN DEL OFERENTE\n'
    + 'NOMBRE OFERENTE\t\t\n' + 'RUT OFERENTE\t\t\n' + 'DIRECCIÓN\t\t\n'
    + 'REPRESENTANTE LEGAL\t\t\n' + 'TELEFONO\t\t\n' + 'CORREO ELECTRÓNICO\t\t\n'
    + ' \t \t \t \t \t \tNombre o Razón Social\t\n' + 'Rut\tDomicilio / Comuna\t\n' }]);
  assert.ok(!r || r.items.length === 0,
    `un formulario en blanco se leyó como planilla de ${r?.items.length} productos`);
});

// Checklist de antecedentes: tiene forma de tabla y hasta una columna numerada, pero sus filas
// son DOCUMENTOS que el oferente debe adjuntar, no productos a cotizar (caso 2258-128-LR26).
test('checklist de antecedentes NO entra al listado de productos (regresión 2258-128-LR26)', () => {
  const r = parsearPlanillaCosteo([{ nombre: 'Anexos_word.doc', categoria: 'ANEXOS_OFERENTE', metodo: 'word-doc', texto:
    'N°\tCRITERIO\tANTECEDENTE PARA PRESENTAR\tDOCUMENTO ADJUNTO (SÍ / NO)\tOBSERVACIONES\t\n'
    + '1\tCertificación\tCertificados vigentes (ISP, ISO, GMP, FDA u otros aplicables)\t\t\t\n'
    + '2\tIdentificación\tFicha técnica en español con imágenes claras y completas\t\t\t\n'
    + '3\tRegistro sanitario\tResolución ISP del fabricante o distribuidor\t\t\t\n' }]);
  const descs = (r?.items || []).map(i => i.descripcion).join(' | ');
  assert.ok(!/Ficha t[eé]cnica|Resoluci[oó]n ISP|Certificados vigentes/i.test(descs),
    `entraron antecedentes a adjuntar como si fueran productos: ${descs}`);
});

// Filas que el extractor de Word parte en dos líneas: descripción en una, cantidad sola en la
// siguiente. Cada mitad es ilegible por separado y la fila se perdía entera (2791-24-LE26).
test('fila partida en dos líneas se reúne y conserva su cantidad (regresión 2791-24-LE26)', () => {
  const r = parsearPlanillaCosteo(docWord(
    'N°\tDescripción\tCantidad\tPrecio\n'
    + '1\tTUBO LED T8 18W 120CM - BLANCO FRÍO\t370\t\n'
    + '2\tPERFIL RECTANGULAR 30X20X3MMx6mts\t20\t\n'
    + '3\tFoco Panel Led 24w Redondo 30cm Sobrepuesto Luz Fria\t115\t\n'
    + '4\tAlargador 6 Toma(s) 3 m Gris\t5\t\n'
    + '5\tTuberia electrica metalica EMT 3 metros 20mm\t70\t\n'
    + '6\tCinta Teflon Agua Jumbo 34 Taumm 50mts\t12\t\n'
    + '7\tCaja Tornillo 6 x 2 CRS 100 unidades\t10\t\n'
    + '8\tSALIDA DE CAJA PARA CONDUIT EMT 20MM\t20\t\n'
    + '9\tTerciado Estructural Pino 18 mm 122x244 cm\n'
    + '\t6\t\t\n'));
  assert.ok(r, 'no se leyó la tabla');
  const terciado = r!.items.find(i => /Terciado Estructural/i.test(i.descripcion));
  assert.ok(terciado, `se perdió la fila partida en dos líneas: ${r!.items.map(i => i.descripcion).join(' | ')}`);
  assert.equal(terciado!.cantidad, 6, 'la fila se reunió pero sin la cantidad de la línea siguiente');
});
