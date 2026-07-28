// Tests de las señales deterministas de modalidad (Frente A.1). Cada una nació de un caso real
// que se documenta en el comentario de su función en planilla-costeo-parser.ts; aquí se fija ese
// caso como regresión permanente. Correr con:
//   npx tsx --test app/lib/__tests__/planilla-costeo-parser.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectarFormulariosEconomicosPorArchivo, detectarTipoAdjudicacionMultiple, extraerSeccionesLineaProducto,
  detectarLenguajePorLinea, detectarParticipacionParcialPorLinea, detectarPresupuestoPorLinea,
} from '../planilla-costeo-parser';

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
