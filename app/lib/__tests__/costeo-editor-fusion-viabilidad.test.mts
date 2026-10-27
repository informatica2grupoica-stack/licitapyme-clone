// «Actualizar» del costeo digital contra la viabilidad re-analizada — caso real 3712-74-LP26
// (27-oct-2026): el costeo guardado traía «1.5 hp» y «20.000(Lt)»; la viabilidad nueva los escribe
// «1,5 hp» y «20,000(Lt)», y «Actualizar» los agregaba otra vez como productos nuevos.
// Correr con:
//   npx tsx --test app/lib/__tests__/costeo-editor-fusion-viabilidad.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fusionarConViabilidad, filasQueViabilidadYaNoTrae, type EstadoCosteoEditor, type FilaEditorCosteo } from '../costeo-editor';

const fila = (detalle: string, cantidad: number): FilaEditorCosteo => ({
  id: detalle, item: 1, lineaReal: null, detalle, unidad: 'UN', skuProveedor: '',
  cantidad, valorConIva: null, costoRealUnitario: null, link1: '', link2: '', link3: '',
});
const estado = (filas: FilaEditorCosteo[]): EstadoCosteoEditor =>
  ({ modalidad: 'suma_alzada', margenVenta: 27, grupos: [{ nombre: 'Costeo', linea: null, ofertamos: true, filas }] });

test('3712-74-LP26: coma o punto decimal y &quot; no duplican el producto', () => {
  const guardado = estado([
    fila('Bomba sumergible de agotamiento monofásica 1.5 hp-750 l/m', 9),
    fila('Estanque de agua vertical estándar 20.000(Lt)', 1),
    fila('Llave collar He-He 1/2"', 36),
  ]);
  const fresco = estado([
    fila('Bomba sumergible de agotamiento monofásica 1,5 hp-750 l/m', 9),
    fila('Estanque de agua vertical estándar 20,000(Lt)', 1),
    fila('Llave collar He-He 1/2&quot;', 36),
  ]);
  const r = fusionarConViabilidad(guardado, fresco);
  assert.equal(r.agregados, 0);
  assert.equal(r.estado.grupos[0].filas.length, 3);
});

test('medidas distintas siguen siendo productos distintos', () => {
  const r = fusionarConViabilidad(
    estado([fila('Copla de reparación PVC C-10 DN 63', 20)]),
    estado([fila('Copla de reparación PVC C-10 DN 75', 20), fila('Bomba 1,5 hp', 1)]),
  );
  assert.equal(r.agregados, 2);
});

test('3712-74-LP26: propone quitar pauta, plazo y copias; deja una fila por producto', () => {
  const guardado = estado([
    fila('Electrofusionadora 20-160 mm Rango de operación: 20 a 160 mm.', 4),
    fila('X1', 30),
    fila('“Prevención apoyo para equipos Servicios sanitarios rurales 2026”', 120),
    fila('Electrofusionadora 20-160 mm', 4),
    fila('Bomba sumergible de agotamiento monofásica 1.5 hp-750 l/m', 9),
    fila('Bomba sumergible de agotamiento monofásica 1,5 hp-750 l/m', 9),
  ]);
  const fresco = estado([
    fila('Electrofusionadora 20-160 mm', 4),
    fila('Bomba sumergible de agotamiento monofásica 1,5 hp-750 l/m', 9),
  ]);
  const r = filasQueViabilidadYaNoTrae(guardado, fresco);
  assert.deepEqual(r.quitables.map(f => f.detalle), [
    'X1', '“Prevención apoyo para equipos Servicios sanitarios rurales 2026”',
    'Electrofusionadora 20-160 mm', 'Bomba sumergible de agotamiento monofásica 1,5 hp-750 l/m',
  ]);
  assert.equal(r.trabajadas, 0);
});

test('nunca propone quitar filas con precio, link, SKU o costo real, ni costos adicionales o de Compras', () => {
  const guardado = estado([
    { ...fila('Con precio', 1), valorConIva: 1000 },
    { ...fila('Con link', 1), link2: 'https://tienda.cl/x' },
    { ...fila('Con SKU', 1), skuProveedor: 'ABC-1' },
    { ...fila('Con costo real', 1), costoRealUnitario: 500 },
    { ...fila('Flete', 1), esCostoAdicional: true },
    { ...fila('Agregado por Compras', 1), agregadoPorCompras: true },
    fila('', 1),
    fila('Sin nada', 1),
  ]);
  const r = filasQueViabilidadYaNoTrae(guardado, estado([]));
  assert.deepEqual(r.quitables.map(f => f.detalle), ['Sin nada']);
  assert.equal(r.trabajadas, 4);
});

test('la fila trabajada se queda con el producto y la copia vacía es la que sale', () => {
  const guardado = estado([fila('Pala metálica punta de huevo', 18), { ...fila('Pala metálica punta de huevo', 18), valorConIva: 9990 }]);
  const r = filasQueViabilidadYaNoTrae(guardado, estado([fila('Pala metálica punta de huevo', 18)]));
  assert.equal(r.quitables.length, 1);
  assert.equal(r.quitables[0].valorConIva, null);
});
