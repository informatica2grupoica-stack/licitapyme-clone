// Regresión del motor de precios para el anexo económico .xlsx (anexos-excel-precios.ts).
// Fixture calcado del caso real 2446-249-LE26 ("2-_FORMULARIO_OFERTA_ECONÓMICA.xlsx"): encabezado
// DUPLICADO (filas 7 y 8 idénticas), 3 ítems con cantidad ya puesta, columna de Total con fórmula
// (=E9*D9), pie con la fórmula de "Valor Total Bruto" REALMENTE ROTA como la trae el organismo
// (=F9+F13, el total de la PRIMERA fila + IVA — no la Sumatoria + IVA) y un campo suelto de
// "Plazo de entrega" con blanco de guiones bajos.
//   npx tsx --test app/lib/__tests__/anexos-excel-precios.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  detectarTablaPrecios, matchearPreciosExcel, escribirPreciosExcel, detectarPie, corregirPie,
  detectarCamposSueltos, matchearCamposSueltos, escribirCamposSueltos,
} from '../anexos-excel-precios';
import type { ItemCosteoPrecio } from '../motor-comercial';
import type { DatosAuditorAnexo } from '../anexos-auditor-fuente';

function libroCasoReal(): { wb: ExcelJS.Workbook; ws: ExcelJS.Worksheet } {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Hoja1');
  ws.getCell('C4').value = 'FORMULARIO OFERTA ECONÓMICA';
  ws.getCell('B5').value = 'Nota 1: Se deja constancia...';
  for (const r of [7, 8]) {
    ws.getCell(`B${r}`).value = 'N°';
    ws.getCell(`C${r}`).value = 'Producto';
    ws.getCell(`D${r}`).value = 'Cantidad';
    ws.getCell(`E${r}`).value = 'Valor Unitario Neto';
    ws.getCell(`F${r}`).value = 'Valor Total Neto';
  }
  const items = [
    [1, 'Poste Omega 3 mts. 2,5 mm', 100],
    [2, 'Set Perno coche c/tuerca', 100],
    [3, 'Aluminio compuesto 4 mm', 100],
  ];
  for (let i = 0; i < items.length; i++) {
    const r = 9 + i;
    const [n, producto, cantidad] = items[i];
    ws.getCell(`B${r}`).value = n as number;
    ws.getCell(`C${r}`).value = producto as string;
    ws.getCell(`D${r}`).value = cantidad as number;
    ws.getCell(`F${r}`).value = { formula: `E${r}*D${r}` } as any;
  }
  ws.getCell('E12').value = 'Sumatoria Total Neto';
  ws.getCell('F12').value = { formula: 'F9+F10+F11' } as any;
  ws.getCell('E13').value = 'IVA (19%)';
  ws.getCell('F13').value = { formula: 'F12*19%' } as any;
  ws.getCell('E14').value = 'Valor Total Bruto';
  // BUG REAL de la plantilla del organismo: referencia F9 (total de la primera fila) en vez de
  // F12 (la Sumatoria) — con 1 solo ítem nadie lo nota, con 3 el Bruto sale mal.
  ws.getCell('F14').value = { formula: 'F9+F13' } as any;
  ws.getCell('C15').value = '\n• Plazo de entrega de los productos: _____ día (s) hábil(es). \n';
  ws.getCell('C21').value = 'Firma del Proponente o Representante';
  return { wb, ws };
}

test('detectarTablaPrecios: encabezado duplicado (r7=r8) → una sola tabla, datos desde r9', async () => {
  const { ws } = libroCasoReal();
  const tabla = detectarTablaPrecios(ws);
  assert.ok(tabla, 'esperaba detectar la tabla');
  assert.equal(tabla!.colProducto, 3); // C
  assert.equal(tabla!.colPrecioUnitario, 5); // E
  assert.equal(tabla!.colCantidad, 4); // D
  assert.equal(tabla!.colTotal, 6); // F
  assert.equal(tabla!.encabezadoPrecio, 'Valor Unitario Neto');
  assert.deepEqual(tabla!.filas.map(f => f.fila), [9, 10, 11]);
  assert.equal(tabla!.filas[0].texto, 'Poste Omega 3 mts. 2,5 mm');
});

test('detectarTablaPrecios: corta ANTES de "Sumatoria Total Neto" (no la toma como ítem)', async () => {
  const { ws } = libroCasoReal();
  const tabla = detectarTablaPrecios(ws);
  assert.equal(tabla!.filaFinTabla, 12);
});

test('detectarTablaPrecios: sin columna de precio unitario ni de producto → null', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Hoja1');
  ws.getCell('A1').value = 'Nombre Oferente';
  ws.getCell('B1').value = 'RUT';
  assert.equal(detectarTablaPrecios(ws), null);
});

test('matchearPreciosExcel + escribirPreciosExcel: match exacto, no pisa la fórmula del Total, calcula el total escrito', async () => {
  const { wb, ws } = libroCasoReal();
  const tabla = detectarTablaPrecios(ws)!;
  const items: ItemCosteoPrecio[] = [
    { descripcion: 'Poste Omega 3 mts. 2,5 mm', precioUnitario: 5000, unidad: 'UN' },
    { descripcion: 'Set Perno coche c/tuerca', precioUnitario: 1200, unidad: 'UN' },
    { descripcion: 'Aluminio compuesto 4 mm', precioUnitario: 8500, unidad: 'UN' },
  ];
  const matches = await matchearPreciosExcel(tabla, items);
  assert.equal(matches.length, 3);

  const resultado = escribirPreciosExcel(wb, tabla, matches);
  assert.equal(resultado.completados, 3);
  assert.deepEqual(resultado.filasSinMatch, []);
  assert.equal(resultado.totalEscritoNeto, 100 * 5000 + 100 * 1200 + 100 * 8500);

  assert.equal(ws.getCell('E9').value, 5000);
  // La celda de Total sigue siendo la fórmula del organismo — nunca se toca.
  const f9 = ws.getCell('F9').value as any;
  assert.equal(typeof f9, 'object');
  assert.equal(f9.formula, 'E9*D9');
});

test('matchearPreciosExcel: ítem sin ningún parecido queda sin match (nunca inventa)', async () => {
  const { ws } = libroCasoReal();
  const tabla = detectarTablaPrecios(ws)!;
  const items: ItemCosteoPrecio[] = [{ descripcion: 'Guantes de látex desechables', precioUnitario: 300, unidad: 'UN' }];
  const matches = await matchearPreciosExcel(tabla, items);
  assert.equal(matches.length, 0);
});

test('detectarPie: reconoce Sumatoria/IVA/Bruto por su rótulo, con el % del IVA', () => {
  const { ws } = libroCasoReal();
  const tabla = detectarTablaPrecios(ws)!;
  const pie = detectarPie(ws, tabla);
  assert.deepEqual(pie.sumatoria, { fila: 12, texto: 'Sumatoria Total Neto' });
  assert.equal(pie.iva?.fila, 13);
  assert.equal(pie.iva?.pct, 19);
  assert.deepEqual(pie.bruto, { fila: 14, texto: 'Valor Total Bruto' });
});

test('corregirPie: regresión REAL 2446-249-LE26 — el Bruto roto (=F9+F13) queda ligado a la Sumatoria, no a la primera fila', () => {
  const { ws } = libroCasoReal();
  const tabla = detectarTablaPrecios(ws)!;
  const pie = detectarPie(ws, tabla);
  corregirPie(ws, tabla, pie);

  assert.deepEqual(ws.getCell('F12').value, { formula: 'SUM(F9:F11)' });
  assert.deepEqual(ws.getCell('F13').value, { formula: 'F12*19%' });
  // Antes: "F9+F13" (solo la primera fila). Ahora: Sumatoria (F12) + IVA (F13).
  assert.deepEqual(ws.getCell('F14').value, { formula: 'F12+F13' });
});

test('corregirPie: sin fila de Sumatoria detectada, no toca nada (no hay de dónde enlazar)', () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Hoja1');
  ws.getCell('B7').value = 'Producto'; ws.getCell('C7').value = 'Valor Unitario Neto';
  ws.getCell('B8').value = 'Casco'; ws.getCell('C8').value = 1000;
  const tabla = detectarTablaPrecios(ws)!;
  const pie = detectarPie(ws, tabla);
  assert.equal(pie.sumatoria, null);
  corregirPie(ws, tabla, pie); // no debe lanzar ni escribir nada
});

test('detectarCamposSueltos + matchearCamposSueltos + escribirCamposSueltos: plazo de entrega desde el Auditor Técnico', () => {
  const { ws } = libroCasoReal();
  const tabla = detectarTablaPrecios(ws)!;
  const campos = detectarCamposSueltos(ws, tabla.filaFinTabla);
  assert.equal(campos.length, 1);
  assert.match(campos[0].texto, /plazo de entrega/i);

  const datosAuditor: DatosAuditorAnexo = {
    lineasTecnicas: [],
    itemsComerciales: [{ lineaNumero: null, titulo: 'Plazo de entrega', tipo: 'dato', descripcion: null, valorTexto: '5', valorNumero: 5 }],
  };
  const resueltos = matchearCamposSueltos(campos, datosAuditor);
  assert.equal(resueltos.length, 1);
  assert.equal(resueltos[0].valor, '5');

  escribirCamposSueltos(ws, resueltos);
  const texto = ws.getCell('C15').value as string;
  assert.match(texto, /Plazo de entrega de los productos: 5 día \(s\) hábil\(es\)\./);
});

test('matchearCamposSueltos: sin dato en el Auditor Técnico, no se resuelve nada (nunca inventa)', () => {
  const { ws } = libroCasoReal();
  const tabla = detectarTablaPrecios(ws)!;
  const campos = detectarCamposSueltos(ws, tabla.filaFinTabla);
  const datosAuditor: DatosAuditorAnexo = { lineasTecnicas: [], itemsComerciales: [] };
  const resueltos = matchearCamposSueltos(campos, datosAuditor);
  assert.equal(resueltos.length, 0);
});
