// Importar un Excel de costeo al costeo digital (fusionarDesdeExcel). Correr con:
//   npx tsx --test app/lib/__tests__/costeo-editor-importar-excel.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fusionarDesdeExcel, calcularFormulas, type EstadoCosteoEditor, type FilaEditorCosteo, type FilaExcelImport } from '../costeo-editor';

const fila = (item: number, detalle: string, cantidad: number | null, extra: Partial<FilaEditorCosteo> = {}): FilaEditorCosteo => ({
  id: `f${item}`, item, lineaReal: item, detalle, unidad: 'UN', skuProveedor: '', cantidad, valorConIva: null, costoRealUnitario: null,
  link1: '', link2: '', link3: '', ...extra,
});
const estado = (filas: FilaEditorCosteo[], margenVenta = 27): EstadoCosteoEditor => ({ modalidad: 'suma_alzada', margenVenta, grupos: [{ nombre: 'Costeo', linea: null, ofertamos: true, filas }] });
const ex = (n: number, detalle: string | null, cantidad: number | null, costoNeto: number | null, precioVenta: number | null, links: string[] = []): FilaExcelImport =>
  ({ hoja: 'Costeo', fila: n + 3, detalle, unidad: 'UN', cantidad, costoNeto, precioVenta, links, lineaPublicada: null });

// Caso real 5586-104-LE26: el digital trae los 7 ítems sin precio; el Excel (recargo 34%) trae costo y precio.
test('5586-104-LE26: rellena valor c/IVA de las 7 filas, adopta el recargo 34% y el precio de venta calza con el Excel', () => {
  const e = estado([
    fila(1, 'Placas calefactoras con agitación', 15), fila(2, 'Balanza electrónica 500G', 15), fila(3, 'Balanza electrónica analítica', 3),
    fila(4, 'Espectrofotómetro UV-Visible', 5), fila(5, 'Medidor de pH metro', 10),
    fila(6, 'Centrífuga con rotores para tubos de 15 y 50 ml', 2), fila(7, 'Centrífuga refrigerada con Rotores para tubos', 1),
  ]);
  const excel = [
    ex(1, 'Placas calefactoras con agitación - Sin especificar', 15, 120924, 162038), ex(2, 'Balanza electrónica 500G - Sin especificar', 15, 7555, 10123),
    ex(3, 'Balanza electrónica analítica - Sin especificar', 3, 1079483, 1446507), ex(4, 'Espectrofotómetro UV-Visible - Sin especificar', 5, 850000, 1139000),
    ex(5, 'Medidor de pH metro - Sin especificar', 10, 116806, 156519), ex(6, 'Centrífuga con rotores para tubos de 15 y 50 ml - Sin especificar', 2, 1041176, 1395176),
    ex(7, 'Centrífuga refrigerada con Rotores para tubos - Sin especificar', 1, 1452941, 1946941),
  ];
  const r = fusionarDesdeExcel(e, excel);
  assert.equal(r.rellenadas, 7);
  assert.deepEqual(r.sinPareja, []);
  assert.equal(r.recargoAdoptado, true);
  assert.equal(r.estado.margenVenta, 34);
  const f = r.estado.grupos[0].filas;
  assert.equal(f[0].valorConIva, 143900);
  assert.equal(f[3].valorConIva, 1011500);
  const venta = f.map(x => calcularFormulas(x, 34).precioUnitarioSinDecimales);
  assert.deepEqual(venta.slice(0, 5), [162038, 10123, 1446507, 1139000, 156519]);
  // El original no se modifica (se trabaja sobre una copia).
  assert.equal(e.grupos[0].filas[0].valorConIva, null);
});

test('nunca pisa un precio, cantidad o link que ya estaba cargado', () => {
  const e = estado([fila(1, 'Pantalón cargo', 150, { valorConIva: 23690, link1: 'https://a.cl/x' })]);
  const r = fusionarDesdeExcel(e, [ex(1, 'PANTALÓN CARGO', 150, 99999, 120000, ['https://b.cl/y'])]);
  const f = r.estado.grupos[0].filas[0];
  assert.equal(f.valorConIva, 23690);
  assert.equal(f.link1, 'https://a.cl/x');
  assert.equal(f.link2, 'https://b.cl/y'); // el link nuevo entra en un hueco libre, sin pisar el existente
  assert.equal(r.recargoAdoptado, false);    // ya había precios: el recargo no se toca
});

test('fila del Excel sin pareja en el costeo: se informa y NO se agrega', () => {
  const e = estado([fila(1, 'Silla ergonómica', 10)]);
  const r = fusionarDesdeExcel(e, [ex(1, 'Escritorio de madera', 4, 50000, 60000)]);
  assert.deepEqual(r.sinPareja, ['Escritorio de madera']);
  assert.equal(r.estado.grupos[0].filas.length, 1);
  assert.equal(r.rellenadas, 0);
});

test('nombre ilegible en el Excel: empareja por posición solo si la cantidad coincide', () => {
  const e = estado([fila(1, 'PANTALÓN CARGO', 150), fila(2, 'POLERA', 300)]);
  const r = fusionarDesdeExcel(e, [ex(1, null, 150, 19908, 23690), ex(2, null, 777, 12605, 15000)]);
  assert.equal(r.estado.grupos[0].filas[0].valorConIva, 23691); // round(19908 × 1,19)
  assert.equal(r.estado.grupos[0].filas[1].valorConIva, null);  // cantidad distinta: no se adivina
  assert.equal(r.sinPareja.length, 1);
});

test('costeo digital vacío: se crean las filas del Excel', () => {
  const e: EstadoCosteoEditor = { modalidad: 'suma_alzada', margenVenta: 27, grupos: [] };
  const r = fusionarDesdeExcel(e, [ex(1, 'Luminancímetro', 3, 4369748, 7332000, ['https://t.cl/l'])]);
  assert.equal(r.creadas, 1);
  assert.equal(r.estado.grupos[0].filas[0].valorConIva, 5200000);
  assert.equal(r.estado.grupos[0].filas[0].link1, 'https://t.cl/l');
});

test('recargos distintos entre filas: no se adopta ninguno', () => {
  const e = estado([fila(1, 'A producto uno', 1), fila(2, 'B producto dos', 1)]);
  const r = fusionarDesdeExcel(e, [ex(1, 'A producto uno', 1, 1000, 1340), ex(2, 'B producto dos', 1, 1000, 1210)]);
  assert.equal(r.recargoExcel, null);
  assert.equal(r.recargoAdoptado, false);
  assert.equal(r.estado.margenVenta, 27);
});

// Caso real 1288505-5-LE26: planilla antigua, el nombre del ítem trae pegado un párrafo "Especificación: …" y hay una fila de nota.
test('1288505-5-LE26: empareja nombres con «Especificación: …» pegada e ignora la fila de nota', () => {
  const e = estado([
    fila(1, 'APILADOR ELÉCTRICO 1500 KG 4,8 a 5,5 METROS BATERÍA 24V/210AH (E15GL) - E15GL', 1),
    fila(2, 'ELEVADOR ELÉCTRICO TIPO TIJERA DE 6M Y 300 KG (2 PERSONAS INTERIOR Y 1 EN EXTERIOR) 220V - 220V', 1),
  ]);
  const excel = [
    ex(1, 'APILADOR ELÉCTRICO 1500 KG 4,8 a 5,5 METROS BATERÍA 24V/210AH (E15GL)\nEspecificación: Apilador diseñado para interiores, base ajustable', 1, 2689075.63, 7878991),
    ex(2, 'ELEVADOR ELÉCTRICO TIPO TIJERA DE 6M Y 300 KG (2 PERSONAS INTERIOR Y 1 EN EXTERIOR) 220V.    ELEVADOR ELÉCTRICO TIPO TIJERA DE 6M Y 300 KG\nEspecificación: Altura de trabajo 8 metros', 1, 3819921.01, 11192368),
    ex(3, '06-07 nota carolina.  Postulado MP. Modificados anexos con error', 2, null, null),
  ];
  const r = fusionarDesdeExcel(e, excel);
  assert.equal(r.rellenadas, 2);
  assert.deepEqual(r.sinPareja, []);
  assert.equal(r.estado.grupos[0].filas[0].valorConIva, 3200000);
  assert.equal(r.estado.grupos[0].filas[1].valorConIva, 4545706);
});

test('dos productos parecidos: no se adivina cuando la mejor candidata no se destaca', () => {
  const e = estado([fila(1, 'Silla de oficina ergonómica negra', 5), fila(2, 'Silla de oficina ergonómica gris', 5)]);
  const r = fusionarDesdeExcel(e, [ex(1, 'Silla de oficina ergonómica', 5, 40000, 50000)]);
  // Ambas contienen todas las palabras de la corta: empate → se evalúa por posición+cantidad solo si el nombre del costeo está vacío (no es el caso).
  assert.equal(r.estado.grupos[0].filas[0].valorConIva ?? r.estado.grupos[0].filas[1].valorConIva, null);
  assert.equal(r.sinPareja.length, 1);
});
