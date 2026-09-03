// Reconciliación de las filas `linea_tecnica` contra las líneas REALES del informe.
// Caso real que lo motivó: 1271359-92-LE26 (negocio 415) — 2 canastas en las bases, 6 filas en el
// checklist (numeradas por posición, antes del fix de numeración del 26-ago-2026). El selector
// ofrecía 2 líneas, el usuario eligió la 2 y el bloque técnico seguía mostrando las 6 sin atenuar
// ninguna, con la línea 1 (Pasto sintético, que NO se oferta) arriba de todo.
//   npx tsx --test app/lib/__tests__/checklist-lineas-tecnicas-reconciliacion.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planDeLineasTecnicas, hayLineasTecnicasHuerfanas, tituloDeLineaTecnica, descripcionDeLineaTecnica,
  generarItemsDesdeViabilidad, type FilaLineaTecnicaExistente,
} from '../checklist-comercial';

// El informe real de 1271359-92-LE26: 6 productos repartidos en 2 canastas.
const INFORME_CANASTAS = {
  modalidad: { tipo: 'por_linea' },
  manifiesto_productos: [
    { linea: 1, descripcion: 'Pasto sintético', cantidad: 2500, unidad_medida: 'MT2', presupuesto_linea: 17839600 },
    { linea: 2, descripcion: 'Locker metálicos colores', cantidad: 33, unidad_medida: 'Un', presupuesto_linea: 21478000 },
    { linea: 2, descripcion: 'Bancas para plaza', cantidad: 10, unidad_medida: 'Un', presupuesto_linea: 21478000 },
  ],
  productos: { items: [
    { linea: 'Canasta 1', nombre: 'Pasto sintético', caracteristicas: ['Altura de fibra 40 mm', 'Densidad mínima'] },
    { linea: 'Canasta 2', nombre: 'Locker metálicos colores', caracteristicas: ['15 cuerpos', 'Chapa por puerta'] },
    { linea: 'Canasta 2', nombre: 'Bancas para plaza', caracteristicas: ['Largo 1,50 a 1,80 m'] },
  ] },
};

const fila = (id: number, lineaNumero: number | null, titulo: string, extra?: Partial<FilaLineaTecnicaExistente>): FilaLineaTecnicaExistente =>
  ({ id, lineaNumero, titulo, descripcion: '1 característica(s) técnica(s) a verificar.', virgen: true, ...extra });

test('borra las filas vírgenes de líneas que el informe ya no tiene', () => {
  const plan = planDeLineasTecnicas([
    fila(1, 1, 'Línea 1 — Pasto sintético'),
    fila(2, 2, 'Línea 2 — Locker metálicos colores'),
    fila(3, 3, 'Línea 3 — Bancas para plaza'),
    fila(4, 4, 'Línea 4 — Estante metálico dos puertas'),
  ], INFORME_CANASTAS);
  assert.deepEqual(plan.borrar, [3, 4], 'las líneas 3 y 4 no existen: eran productos de la canasta 2');
  assert.equal(plan.conflictivas.length, 0);
});

test('una fila huérfana CON trabajo no se borra: se avisa para que la resuelva una persona', () => {
  const plan = planDeLineasTecnicas([
    fila(1, 1, 'Línea 1 — Pasto sintético'),
    fila(9, 5, 'Línea 5 — Mesas plegables', { virgen: false }),
  ], INFORME_CANASTAS);
  assert.deepEqual(plan.borrar, []);
  assert.equal(plan.conflictivas.length, 1);
  assert.equal(plan.conflictivas[0].id, 9);
});

test('refresca el título de la línea que sí existe: la canasta es un paquete de productos', () => {
  // Ese era el reclamo textual del usuario ("no detecta las líneas ni los ítems de las líneas"):
  // la fila de la canasta 2 conservaba el nombre de UN producto.
  const plan = planDeLineasTecnicas([fila(2, 2, 'Línea 2 — Locker metálicos colores')], INFORME_CANASTAS);
  assert.equal(plan.retitular.length, 1);
  assert.match(plan.retitular[0].titulo, /Locker metálicos colores/);
  assert.match(plan.retitular[0].titulo, /Bancas para plaza/);
  assert.equal(plan.retitular[0].descripcion, '3 característica(s) técnica(s) a verificar.');
});

test('el título que escribe la reconciliación es EXACTAMENTE el que genera el checklist (no se reescribe en loop)', () => {
  const items = generarItemsDesdeViabilidad(INFORME_CANASTAS);
  const filas = items.filter(i => i.tipo === 'linea_tecnica').map((i, n) =>
    fila(n + 1, i.lineaNumero, i.titulo, { descripcion: i.descripcion }));
  const plan = planDeLineasTecnicas(filas, INFORME_CANASTAS);
  assert.deepEqual(plan, { borrar: [], retitular: [], conflictivas: [] }, 'un checklist recién generado no tiene nada que reconciliar');
});

test('FAIL-OPEN: un informe sin líneas técnicas no borra nada', () => {
  // Un re-análisis fallido o una lectura incompleta jamás puede hacer desaparecer el trabajo.
  const plan = planDeLineasTecnicas([fila(1, 1, 'Línea 1 — Pasto sintético')], { modalidad: { tipo: 'por_linea' } });
  assert.deepEqual(plan, { borrar: [], retitular: [], conflictivas: [] });
  assert.equal(hayLineasTecnicasHuerfanas([{ tipo: 'linea_tecnica', linea_numero: 1 }], {}), false);
});

test('hayLineasTecnicasHuerfanas: detecta el desfase sin consultar la base', () => {
  const items = [
    { tipo: 'linea_tecnica', linea_numero: 1 },
    { tipo: 'linea_tecnica', linea_numero: 2 },
    { tipo: 'precio', linea_numero: 7 },      // otros tipos no cuentan
  ];
  assert.equal(hayLineasTecnicasHuerfanas(items, INFORME_CANASTAS), false);
  assert.equal(hayLineasTecnicasHuerfanas([...items, { tipo: 'linea_tecnica', linea_numero: 6 }], INFORME_CANASTAS), true);
  assert.equal(hayLineasTecnicasHuerfanas([{ tipo: 'linea_tecnica', linea_numero: null }], INFORME_CANASTAS), true);
});

test('el título se recorta a lo que aguanta la columna (VARCHAR(300))', () => {
  const largo = tituloDeLineaTecnica({ linea: 2, nombre: 'x'.repeat(500) });
  assert.equal(largo.length, 300);
  assert.equal(descripcionDeLineaTecnica({ caracteristicas: [1, 2, 3] }), '3 característica(s) técnica(s) a verificar.');
});
