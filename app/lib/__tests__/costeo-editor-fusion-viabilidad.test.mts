// «Actualizar» del costeo digital contra la viabilidad re-analizada — caso real 3712-74-LP26
// (27-oct-2026): el costeo guardado traía «1.5 hp» y «20.000(Lt)»; la viabilidad nueva los escribe
// «1,5 hp» y «20,000(Lt)», y «Actualizar» los agregaba otra vez como productos nuevos.
// Correr con:
//   npx tsx --test app/lib/__tests__/costeo-editor-fusion-viabilidad.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fusionarConViabilidad, filasQueViabilidadYaNoTrae, corregirDesdeViabilidad, ordenarComoViabilidad, resumenCambiosCosteo, type EstadoCosteoEditor, type FilaEditorCosteo } from '../costeo-editor';

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

// 1028897-42-LP26 (28-oct-2026): en cada re-análisis la IA reescribía el nombre («Notebook» → «Notebook -
// Ryzen 5 3450U», «… igual o superior» → «… o superior») y el costeo agregaba una copia: la línea 3 pasó
// de 8 a 11 filas en tres re-análisis.
test('re-análisis: el nombre reescrito por la IA no agrega copia y se corrige si nadie lo tocó', () => {
  const l3 = (detalle: string, cantidad: number): FilaEditorCosteo => ({ ...fila(detalle, cantidad), lineaReal: 3 });
  const anterior = estado([l3('Notebook', 57), l3('Tablet', 35), l3('Proyector - Epson PowerLite W49 igual o superior', 10)]);
  const actual = estado([
    { ...l3('Notebook', 57), valorConIva: 450000 }, l3('Tablet', 35), l3('Proyector - Epson PowerLite W49 igual o superior', 10),
  ]);
  const nuevo = estado([l3('Notebook - Ryzen 5 3450U', 57), l3('Tablet - Dimensity 6300', 35), l3('Proyector - Epson PowerLite W49 o superior', 10)]);
  const f = fusionarConViabilidad(actual, nuevo);
  assert.equal(f.agregados, 0);
  const c = corregirDesdeViabilidad(f.estado, nuevo, anterior);
  assert.deepEqual(c.estado.grupos[0].filas.map(x => x.detalle), [
    'Notebook - Ryzen 5 3450U', 'Tablet - Dimensity 6300', 'Proyector - Epson PowerLite W49 o superior',
  ]);
  assert.equal(c.estado.grupos[0].filas[0].valorConIva, 450000);
  assert.equal(filasQueViabilidadYaNoTrae(actual, nuevo).quitables.length, 0);
});

test('nombre reescrito con otra cantidad, otra línea u otra medida sigue siendo otro producto', () => {
  const en = (linea: number, detalle: string, cantidad: number): FilaEditorCosteo => ({ ...fila(detalle, cantidad), lineaReal: linea });
  assert.equal(fusionarConViabilidad(estado([en(1, 'Notebook', 57)]), estado([en(1, 'Notebook - Ryzen 5', 20)])).agregados, 1);
  assert.equal(fusionarConViabilidad(estado([en(1, 'Notebook', 57)]), estado([en(2, 'Notebook - Ryzen 5', 57)])).agregados, 1);
  assert.equal(fusionarConViabilidad(estado([en(1, 'Basurero acero inox con tapa 16 lt', 1)]), estado([en(1, 'Basurero acero inox con tapa 12 lt', 1)])).agregados, 1);
  assert.equal(fusionarConViabilidad(estado([en(1, 'Silla escolar', 30)]), estado([en(1, 'Mesa escolar', 30)])).agregados, 1);
});

test('701426-14 / 1002588-102: palabras reordenadas o nombre corto vs largo no duplican', () => {
  const r = fusionarConViabilidad(
    estado([fila('SET TASAS DE LOZA 12 BLANCO', 2), fila('TACA TACA', 4)]),
    estado([fila('SET 12 TAZAS DE LOZA 12 BLANCO', 2), fila('TACA TACA MEDIDAS: LARGO 145 MM, ANCHO 93 CMS', 4)]),
  );
  assert.equal(r.agregados, 0);
});

test('701426-14: «set de vasos» y «set de copas» con el mismo número no se confunden', () => {
  assert.equal(fusionarConViabilidad(estado([fila('SET VASOS CORTOS 12 VIDRIO', 3)]), estado([fila('SET COPAS 12 DE AGUA VIDRIO 390 ML.', 3)])).agregados, 1);
});

// 2827-102-LE26 (28-oct-2026): las dos líneas de la viabilidad se llaman igual («Barredora de suelos», el nombre
// genérico de Mercado Público). El re-análisis tomaba la primera y movía la barredora manual de LINEA2 a LINEA1,
// donde la hoja tenía recargo 0 %: el precio de venta bajaba en silencio de $774.687 a $609.989.
test('dos líneas con el mismo nombre: la fila no se cambia de línea ni de hoja (regresión 2827-102-LE26)', () => {
  const conLinea = (detalle: string, lineaReal: number): FilaEditorCosteo => ({ ...fila(detalle, 1), lineaReal });
  const guardado: EstadoCosteoEditor = { modalidad: 'por_linea', margenVenta: 27, grupos: [
    { nombre: 'LINEA1', linea: 1, ofertamos: true, margenVenta: 0, filas: [{ ...conLinea('Barredora mecánica eléctrica para limpieza urbana', 1), margenVenta: 17 }] },
    { nombre: 'LINEA2', linea: 2, ofertamos: true, filas: [conLinea('Barredora de suelos manual - sin especificaciones adicionales', 2)] },
  ] };
  const fresco: EstadoCosteoEditor = { modalidad: 'por_linea', margenVenta: 27, grupos: [
    { nombre: 'LINEA1', linea: 1, ofertamos: true, filas: [conLinea('Barredora de suelos', 1)] },
    { nombre: 'LINEA2', linea: 2, ofertamos: true, filas: [conLinea('Barredora de suelos', 2)] },
  ] };
  const r = fusionarConViabilidad(guardado, fresco);
  assert.equal(r.reclasificados, 0);
  assert.deepEqual(r.estado.grupos.map(g => [g.nombre, g.filas.map(f => f.lineaReal)]), [['LINEA1', [1]], ['LINEA2', [2]]]);
  // Un producto que la viabilidad trae SOLO en otra línea sí se mueve (la reclasificación de siempre).
  const movido = fusionarConViabilidad(guardado, { ...fresco, grupos: [fresco.grupos[0]] });
  assert.equal(movido.reclasificados, 1);
});

test('el registro de cambios dice cuando una fila cambia de hoja o de línea (regresión 2827-102-LE26)', () => {
  const f = { ...fila('Barredora de suelos', 1), lineaReal: 1 };
  const antes: EstadoCosteoEditor = { modalidad: 'por_linea', margenVenta: 27, grupos: [{ nombre: 'LINEA1', linea: 1, ofertamos: true, filas: [f] }] };
  const despues: EstadoCosteoEditor = { modalidad: 'por_linea', margenVenta: 27, grupos: [
    { nombre: 'LINEA1', linea: 1, ofertamos: true, filas: [] },
    { nombre: 'LINEA2', linea: 2, ofertamos: true, filas: [{ ...f, lineaReal: 2 }] },
  ] };
  assert.deepEqual(resumenCambiosCosteo(antes, despues), ['Nueva hoja LINEA2 (1 ítem(s))', '"Barredora de suelos": hoja LINEA1 → LINEA2 · línea 1 → 2']);
});

test('resumenCambiosCosteo: anota hojas nuevas/eliminadas, detalle de ítems, links y orden', () => {
  const a = { ...fila('Horno', 1), id: 'a' }, b = { ...fila('Mesa', 2), id: 'b', link1: 'x' };
  const antes: EstadoCosteoEditor = { modalidad: 'por_linea', margenVenta: 27, grupos: [
    { nombre: 'LINEA1', linea: 1, ofertamos: true, filas: [a, b] },
    { nombre: 'LINEA2', linea: 2, ofertamos: true, filas: [] },
  ] };
  const nueva = { ...fila('Flete', 1), id: 'c', esCostoAdicional: true, costoAdicionalNeto: 5000 };
  const despues: EstadoCosteoEditor = { modalidad: 'por_linea', margenVenta: 27, grupos: [
    { nombre: 'LINEA1', linea: 1, ofertamos: true, filas: [{ ...b, link1: '', link2: 'y' }, a, nueva] },
    { nombre: 'LINEA3', linea: 3, ofertamos: true, filas: [] },
  ] };
  const r = resumenCambiosCosteo(antes, despues).join(' | ');
  for (const t of ['Nueva hoja LINEA3', 'Hoja LINEA2 eliminada', 'Agregó el ítem "Flete" (costo adicional $5.000) en LINEA1', 'link 1 quitado, link 2 agregado', 'cambió el orden']) assert.ok(r.includes(t), t + ' ← ' + r);
});
