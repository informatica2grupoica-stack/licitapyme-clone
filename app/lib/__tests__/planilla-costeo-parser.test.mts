// Tests de las señales deterministas de modalidad (Frente A.1). Cada una nació de un caso real
// que se documenta en el comentario de su función en planilla-costeo-parser.ts; aquí se fija ese
// caso como regresión permanente. Correr con:
//   npx tsx --test app/lib/__tests__/planilla-costeo-parser.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectarFormulariosEconomicosPorArchivo, detectarTipoAdjudicacionMultiple, extraerSeccionesLineaProducto,
} from '../planilla-costeo-parser';

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
