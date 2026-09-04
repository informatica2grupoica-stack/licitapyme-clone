// Margen POR ÍTEM en el costeo del editor — contrastado contra el Excel REAL del asistente
// (COSTEO_1114-12-LE26_2026-07-27.xlsx, hoja "Costeo"), donde el multiplicador NO es una constante
// del costeo: va escrito fila por fila y cambia entre una y otra.
//   I4 =G4*2.1   (Plataforma satelital)     I5 =G5*2   (Sensor de presión)
// Correr con:
//   npx tsx --test app/lib/__tests__/costeo-editor-margen-fila.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  editorAFilasCosteo, margenDeFila, separarPorLinea, unirEnUnaHoja,
  MARGEN_VENTA_DEFECTO, type EstadoCosteoEditor, type FilaEditorCosteo,
} from '../costeo-editor';
import { parsearRecargo } from '../costeo-comparativo';

const fila = (p: Partial<FilaEditorCosteo> & { id: string }): FilaEditorCosteo => ({
  item: 1, lineaReal: null, detalle: 'X', unidad: 'Unidad', skuProveedor: '',
  cantidad: null, valorConIva: null, costoRealUnitario: null, link1: '', link2: '', link3: '', ...p,
});

/** Las dos filas reales de 1114-12-LE26, en UNA sola hoja (la licitación es suma alzada). */
const estado1114 = (margenPlataforma: number | null, margenSensor: number | null): EstadoCosteoEditor => ({
  modalidad: 'suma_alzada',
  margenVenta: 110,                                   // el global: ×2,1
  grupos: [{
    nombre: 'Costeo', linea: null, ofertamos: true,
    filas: [
      fila({ id: 'a', item: 1, lineaReal: 1, detalle: 'Plataforma satelital - GOES CS2', cantidad: 4, valorConIva: 3822519, margenVenta: margenPlataforma }),
      fila({ id: 'b', item: 2, lineaReal: 2, detalle: 'Sensor de Presión (sumergible)', cantidad: 4, valorConIva: 1992639, margenVenta: margenSensor }),
    ],
  }],
});

test('replica el Excel real de 1114-12-LE26: ×2,1 en una fila y ×2,0 en la otra', () => {
  const filas = editorAFilasCosteo(estado1114(null, 100));   // la plataforma hereda el global (110%)
  assert.equal(filas.length, 2);

  // Fila 1 — J4 = 6.745.621 y K4 = 26.982.484 en el Excel.
  assert.equal(filas[0].precioUnitarioSinDecimales, 6745621);
  assert.equal(filas[0].precioTotalNeto, 26982484);

  // Fila 2 — J5 = 3.348.973 y K5 = 13.395.892. Con el margen global (×2,1) daban 3.516.421 y
  // 14.065.684: $669.792 de más en una oferta que iba a 1,94% del tope.
  assert.equal(filas[1].precioUnitarioSinDecimales, 3348973);
  assert.equal(filas[1].precioTotalNeto, 13395892);

  // K24 del Excel = 40.378.376 (no 41.048.168).
  const ventaNeta = filas.reduce((s, f) => s + (f.precioTotalNeto ?? 0), 0);
  assert.equal(ventaNeta, 40378376);
});

test('sin margen propio en ninguna fila, manda el global — nada cambia para los costeos de siempre', () => {
  const filas = editorAFilasCosteo(estado1114(null, null));
  assert.equal(filas[1].precioUnitarioSinDecimales, 3516421);
  assert.equal(filas.reduce((s, f) => s + (f.precioTotalNeto ?? 0), 0), 41048168);
});

test('la cascada es fila → hoja → global, en ese orden', () => {
  const g = { margenVenta: 50 };
  assert.equal(margenDeFila({ margenVenta: 30 }, g, 27), 30);      // manda la fila
  assert.equal(margenDeFila({ margenVenta: null }, g, 27), 50);    // si no, la hoja
  assert.equal(margenDeFila({}, {}, 27), 27);                      // si no, el global
  assert.equal(margenDeFila({}, {}, NaN), MARGEN_VENTA_DEFECTO);   // global roto → el de la plantilla
  assert.equal(margenDeFila({ margenVenta: 0 }, g, 27), 0);        // 0% es un margen válido, no "vacío"
});

test('mover una fila de hoja no le cambia el precio en silencio', () => {
  // Dos canastas con recargo propio (×1,34 y ×1,25, como el Excel de 1271359-92-LE26): al juntarlas
  // en una hoja, cada fila se lleva puesto el recargo con el que se estaba vendiendo.
  const estado: EstadoCosteoEditor = {
    modalidad: 'por_linea', margenVenta: 27,
    grupos: [
      { nombre: 'Línea 1', linea: 1, ofertamos: true, margenVenta: 34, filas: [fila({ id: 'a', lineaReal: 1, cantidad: 1, valorConIva: 119 })] },
      { nombre: 'Línea 2', linea: 2, ofertamos: true, margenVenta: 25, filas: [fila({ id: 'b', lineaReal: 2, cantidad: 1, valorConIva: 119 })] },
    ],
  };
  const antes = editorAFilasCosteo(estado).map(f => f.precioTotalNeto);
  assert.deepEqual(antes, [134, 125]);

  assert.deepEqual(editorAFilasCosteo(unirEnUnaHoja(estado)).map(f => f.precioTotalNeto), [134, 125]);
  assert.deepEqual(editorAFilasCosteo(separarPorLinea(unirEnUnaHoja(estado))).map(f => f.precioTotalNeto), [134, 125]);
});

test('una hoja apagada sigue afuera aunque sus filas tengan margen propio', () => {
  const estado = estado1114(null, 100);
  estado.grupos[0].ofertamos = false;
  assert.equal(editorAFilasCosteo(estado).length, 0);
});

// ─── Lo que se tipea en la celda "% margen" ───────────────────────────────────────────────────
test('la celda "% margen" entiende el recargo y también el multiplicador del Excel', () => {
  assert.equal(parsearRecargo('110'), 110);
  assert.equal(parsearRecargo('110%'), 110);
  assert.equal(parsearRecargo('14,45'), 14.45);
  assert.equal(parsearRecargo('14.45'), 14.45);
  assert.equal(parsearRecargo('x2,1'), 110);                  // el ×2,1 de la celda I4 del Excel
  assert.equal(parsearRecargo('X 2'), 100);                   // ×2,0 — la fila del sensor
  assert.equal(parsearRecargo('2,1x'), 110);
  assert.equal(parsearRecargo(''), null);                     // vaciar = volver a heredar
  assert.equal(parsearRecargo('   '), null);
  assert.equal(parsearRecargo('abc'), undefined);             // basura: queda lo que había
  assert.equal(parsearRecargo('x0'), undefined);              // vender a $0 no es un margen
  assert.equal(parsearRecargo('-100'), undefined);
});
