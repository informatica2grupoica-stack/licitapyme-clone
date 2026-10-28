// «Actualizar» del costeo digital contra la viabilidad re-analizada — caso real 3712-74-LP26
// (27-oct-2026): el costeo guardado traía «1.5 hp» y «20.000(Lt)»; la viabilidad nueva los escribe
// «1,5 hp» y «20,000(Lt)», y «Actualizar» los agregaba otra vez como productos nuevos.
// Correr con:
//   npx tsx --test app/lib/__tests__/costeo-editor-fusion-viabilidad.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fusionarConViabilidad, filasQueViabilidadYaNoTrae, corregirDesdeViabilidad, ordenarComoViabilidad, type EstadoCosteoEditor, type FilaEditorCosteo } from '../costeo-editor';

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

// Re-análisis que actualiza solo el costeo (decisión del dueño, 28-oct-2026): corrige nombre y cantidad
// que vinieron del documento, sin pisar lo que alguien cambió a mano ni precios/links.
test('re-análisis: corrige la forma del nombre (&quot;) y la cantidad que nadie tocó', () => {
  const anterior = estado([fila('Manguera Espiralada 2&quot;x50(m)', 9), fila('Pozometro 50(m)', 9)]);
  const guardada = { ...fila('Manguera Espiralada 2&quot;x50(m)', 9), valorConIva: 223990, link1: 'https://x' };
  const actual = estado([guardada, fila('Pozometro 50(m)', 9)]);
  const nuevo = estado([fila('Manguera Espiralada 2"x50(m)', 9), fila('Pozometro 50(m)', 12)]);
  const r = corregirDesdeViabilidad(actual, nuevo, anterior);
  const [m, p] = r.estado.grupos[0].filas;
  assert.equal(r.corregidos, 2);
  assert.equal(m.detalle, 'Manguera Espiralada 2"x50(m)');
  assert.equal(m.valorConIva, 223990);
  assert.equal(m.link1, 'https://x');
  assert.equal(p.cantidad, 12);
});

test('re-análisis: una cantidad cambiada a mano no se pisa', () => {
  const r = corregirDesdeViabilidad(
    estado([fila('Pozometro 50(m)', 10)]), estado([fila('Pozometro 50(m)', 12)]), estado([fila('Pozometro 50(m)', 9)]));
  assert.equal(r.corregidos, 0);
  assert.equal(r.estado.grupos[0].filas[0].cantidad, 10);
});

test('re-análisis: el detalle complementado a mano conserva el complemento', () => {
  const editada = { ...fila('Electrofusionadora 20-160mm Potencia: 2,5 kW', 4), detalleBase: 'Electrofusionadora 20-160mm' };
  const r = corregirDesdeViabilidad(
    estado([editada]), estado([fila('Electrofusionadora 20-160mm Ref. X', 4)]), estado([fila('Electrofusionadora 20-160mm', 4)]));
  assert.equal(r.estado.grupos[0].filas[0].detalle, 'Electrofusionadora 20-160mm Ref. X Potencia: 2,5 kW');
  assert.equal(r.estado.grupos[0].filas[0].detalleBase, 'Electrofusionadora 20-160mm Ref. X');
});

// 3712-74-LP26 (28-oct-2026): el costeo traía los nombres escritos distinto a la viabilidad (espacios,
// signos, erratas de OCR) y «Actualizar» agregó 23 copias sin precio.
test('mismo nombre con otros espacios, signos o 1-2 letras distintas no se duplica', () => {
  const guardado = estado([
    fila('Generador eléctrico diésel portátil 4 kw', 9), fila('Estanque Químitank 150 (Lt)', 9),
    fila('Suministro e Instalación Bomba SSR El Estuerzo', 1), fila('Chuzo de acero 1,6 (m)', 18),
    fila('Cono de seguridad 90cm, base pesada', 36), fila('Set llave punta corona 6" – 32"', 9),
  ]);
  const fresco = estado([
    fila('Generador eléctrico diésel partátil 4 kw', 9), fila('Estanque Quimitank 150(Lt)', 9),
    fila('Suministro e Instalación Bomba SSR El Esfuerzo', 1), fila('Chuzo de acero 1.6(m)', 18),
    fila('Cono de seguridad 90 cm. base pesada', 36), fila('Set llave punta corona 6&quot;-32&quot;', 9),
  ]);
  assert.equal(fusionarConViabilidad(guardado, fresco).agregados, 0);
});

test('mismos letras con otros números siguen siendo productos distintos', () => {
  const r = fusionarConViabilidad(
    estado([fila('Válvula Elastomérica 80(mm) PN 10', 27), fila('Union Autobloqueante 2" Fierro Fundido', 18)]),
    estado([fila('Válvula Elastomérica 50(mm) PN 10', 27), fila('Union Autobloqueante 3" Fierro Fundido', 18)]),
  );
  assert.equal(r.agregados, 2);
});

test('«½” – ¾” y 1"» es lo mismo que «1/2"-3/4" y 1"»', () => {
  const r = fusionarConViabilidad(
    estado([fila('Obturador de cañeria profesional cobre 1/2"-3/4" y 1"', 9)]),
    estado([fila('Obturador de cañeria profesional cobre ½” – ¾” y 1"', 9)]),
  );
  assert.equal(r.agregados, 0);
});

test('re-análisis: la errata de OCR se corrige con el nombre del documento si nadie lo complementó', () => {
  const guardada = { ...fila('Suministro e Instalación Bomba SSR El Estuerzo', 1), valorConIva: 2051293, link1: 'https://x' };
  const r = corregirDesdeViabilidad(estado([guardada]), estado([fila('Suministro e Instalación Bomba SSR El Esfuerzo', 1)]), null);
  assert.equal(r.estado.grupos[0].filas[0].detalle, 'Suministro e Instalación Bomba SSR El Esfuerzo');
  assert.equal(r.estado.grupos[0].filas[0].valorConIva, 2051293);
  const conComplemento = { ...guardada, detalleBase: 'Suministro e Instalación Bomba SSR El Estuerzo', detalle: 'Suministro e Instalación Bomba SSR El Estuerzo (con flete)' };
  const r2 = corregirDesdeViabilidad(estado([conComplemento]), estado([fila('Suministro e Instalación Bomba SSR El Esfuerzo', 1)]), null);
  assert.equal(r2.estado.grupos[0].filas[0].detalle, conComplemento.detalle);
});

test('2446-307-LE26: al re-analizar el costeo queda en el orden del anexo económico', () => {
  const guardado = estado([
    { ...fila('Pack de 10 un de discos de desbaste', 10), valorConIva: 4 },
    fila('Llave ajustable de 12" de acero', 2),
    { ...fila('Flete a Coquimbo', 1), esCostoAdicional: true },
    fila('Set de brocas SDS Plus, makita o equivalente', 2),
    fila('Juego de herramientas de 151 piezas', 1),
  ]);
  const fresco = estado([
    fila('Pack de 10 un de discos de desbaste', 10), fila('Set de brocas SDS Plus, makita o equivalente', 2),
    fila('Juego de herramientas de 151 piezas', 1), fila('Llave ajustable de 12" de acero', 2),
  ]);
  const r = ordenarComoViabilidad(guardado, fresco);
  assert.deepEqual(r.estado.grupos[0].filas.map(f => f.detalle), [
    'Pack de 10 un de discos de desbaste', 'Set de brocas SDS Plus, makita o equivalente',
    'Juego de herramientas de 151 piezas', 'Llave ajustable de 12" de acero', 'Flete a Coquimbo',
  ]);
  assert.deepEqual(r.estado.grupos[0].filas.map(f => f.item), [1, 2, 3, 4, 5]);
  assert.equal(r.estado.grupos[0].filas[0].valorConIva, 4);
  assert.equal(ordenarComoViabilidad(r.estado, fresco).reordenados, 0);
});
