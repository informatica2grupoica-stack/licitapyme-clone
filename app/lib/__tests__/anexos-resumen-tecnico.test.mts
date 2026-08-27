// Tests del RESUMEN TÉCNICO LIBRE — tercer tipo de anexo, distinto de la matriz de cumplimiento.
//
// El fixture reproduce la estructura EXACTA del ANEXO N°2 "OFERTA TÉCNICA" real de
// 611669-17-LE26: tres tablas de 2 filas, encabezado + una fila de producto con la última celda
// en blanco. Verificado además contra el .docx real con
// scripts/scratch/_rellenar-resumen-tecnico.mts.
//
// Correr con:
//   npx tsx --test app/lib/__tests__/anexos-resumen-tecnico.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectarResumenTecnico, planDeRellenoResumen, aplicarPlanResumen, textoCaracteristicaResumen,
  type ProductoResumenDatos,
} from '../anexos-resumen-tecnico';

const celda = (t: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="500" w:type="pct"/></w:tcPr><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
const celdaVacia = '<w:tc><w:tcPr><w:tcW w:w="500" w:type="pct"/></w:tcPr><w:p/></w:tc>';
const fila = (...celdas: string[]) => `<w:tr w:rsidR="00"><w:trPr/>${celdas.join('')}</w:tr>`;

const DOC = `<w:document><w:body>
  <w:tbl>${fila(celda('Oferente'), celda('RUT'))}${fila(celdaVacia, celdaVacia)}</w:tbl>
  <w:tbl>
    ${fila(celda('Cantidad'), celda('Producto'), celda('Especificaciones Técnicas'))}
    ${fila(celda('3'), celda('Luminancímetros'), celdaVacia)}
  </w:tbl>
  <w:tbl>
    ${fila(celda('Cantidad'), celda('Producto'), celda('Plazo de Entrega (días hábiles)'))}
    ${fila(celda('3'), celda('Luminancímetros'), celdaVacia)}
  </w:tbl>
  <w:tbl>
    ${fila(celda('Cantidad'), celda('Producto'), celda('Plazo de Garantía (meses)'))}
    ${fila(celda('3'), celda('Luminancímetros'), celdaVacia)}
  </w:tbl>
</w:body></w:document>`;

// ─── TEXTO DE CADA CARACTERÍSTICA ─────────────────────────────────────────────────────────────
test('junta descripción y exigido con dos puntos', () => {
  assert.equal(textoCaracteristicaResumen('Ángulo de Medición', 'al menos 1°'), 'Ángulo de Medición: al menos 1°');
});

// Caso real: el clasificador guarda la MISMA frase completa en descripcion y en exigido para los
// tipo EXACTO. Sin este chequeo saldría "Cumplimiento de Norma DIN 5032-Parte 7, Clase B: DIN
// 5032-Parte 7, Clase B" — repetido y torpe.
test('no duplica cuando el exigido ya está incluido en la descripción', () => {
  assert.equal(
    textoCaracteristicaResumen('Cumplimiento de Norma DIN 5032-Parte 7, Clase B', 'DIN 5032-Parte 7, Clase B'),
    'Cumplimiento de Norma DIN 5032-Parte 7, Clase B',
  );
});

test('sin exigido, devuelve solo la descripción', () => {
  assert.equal(textoCaracteristicaResumen('Interfaz USB 2.0', null), 'Interfaz USB 2.0');
});

// ─── DETECCIÓN ────────────────────────────────────────────────────────────────────────────────
test('detecta las 3 tablas por su rol', () => {
  const t = detectarResumenTecnico(DOC);
  assert.equal(t.length, 3);
  assert.deepEqual(t.map(x => x.rol), ['especificaciones', 'plazo_entrega', 'garantia']);
});

test('cada tabla trae la fila de producto con su columna de valor', () => {
  const t = detectarResumenTecnico(DOC);
  for (const tabla of t) {
    assert.equal(tabla.filas.length, 1);
    assert.equal(tabla.filas[0].producto, 'Luminancímetros');
  }
});

// La tabla de "Oferente | RUT" no tiene "Cantidad" ni "Producto": no debe colarse como si fuera
// una tabla de especificaciones.
test('no confunde la tabla de identificación del oferente', () => {
  const t = detectarResumenTecnico(DOC);
  assert.ok(!t.some(x => x.indiceTabla === 0));
});

test('sin las tres columnas (Cantidad/Producto/rol) no detecta nada', () => {
  const otra = `<w:document><w:body><w:tbl>
    ${fila(celda('Especificaciones Técnicas'), celdaVacia)}
  </w:tbl></w:body></w:document>`;
  assert.equal(detectarResumenTecnico(otra).length, 0);
});

// ─── PLAN DE RELLENO ──────────────────────────────────────────────────────────────────────────
const PRODUCTO: ProductoResumenDatos = {
  nombre: 'Luminancímetros',
  especificaciones: [
    { descripcion: 'Ángulo de Medición', valorRequeridoTexto: 'al menos 1°' },
    { descripcion: 'Interfaz USB 2.0', valorRequeridoTexto: 'USB 2.0' },
  ],
  plazoEntregaTexto: '40 días hábiles',
  garantiaTexto: null,
};

test('arma el texto de especificaciones, una por línea', () => {
  const plan = planDeRellenoResumen(detectarResumenTecnico(DOC), [PRODUCTO]);
  const espec = plan.celdas.find(c => c.columna === 2 && c.texto.includes('Ángulo'));
  assert.ok(espec);
  assert.equal(espec!.texto, 'Ángulo de Medición: al menos 1°\nInterfaz USB 2.0');
});

test('llena el plazo de entrega con el texto ya cargado', () => {
  const plan = planDeRellenoResumen(detectarResumenTecnico(DOC), [PRODUCTO]);
  const plazo = plan.celdas.find(c => c.texto === '40 días hábiles');
  assert.ok(plazo);
});

// EL LÍMITE HONESTO del módulo: sin un dato real de garantía, no se escribe nada — y sobre todo,
// NO se inventa un número plausible. Queda listado en `sinDato` para que se sepa que falta.
test('sin garantía cargada, no se escribe nada y queda listada como sin dato', () => {
  const plan = planDeRellenoResumen(detectarResumenTecnico(DOC), [PRODUCTO]);
  assert.ok(!plan.celdas.some(c => c.texto.includes('meses')));
  assert.equal(plan.sinDato.length, 1);
  assert.equal(plan.sinDato[0].rol, 'garantia');
});

test('un producto del documento que no se conoce queda en sinEmparejar', () => {
  const otroProducto: ProductoResumenDatos = { ...PRODUCTO, nombre: 'Termómetros' };
  const plan = planDeRellenoResumen(detectarResumenTecnico(DOC), [otroProducto]);
  assert.equal(plan.celdas.length, 0);
  assert.ok(plan.sinEmparejar.length > 0);
});

test('empareja aunque el nombre venga con el prefijo de línea', () => {
  const conPrefijo: ProductoResumenDatos = { ...PRODUCTO, nombre: 'Línea 1 — Luminancímetros' };
  const plan = planDeRellenoResumen(detectarResumenTecnico(DOC), [conPrefijo]);
  assert.ok(plan.celdas.length >= 2);
});

// ─── ESCRITURA ────────────────────────────────────────────────────────────────────────────────
test('escribe las celdas y el XML sigue bien formado', () => {
  const plan = planDeRellenoResumen(detectarResumenTecnico(DOC), [PRODUCTO]);
  const r = aplicarPlanResumen(DOC, plan.celdas);
  assert.equal(r.escritas, 2);
  assert.equal(r.omitidas, 0);
  assert.ok(r.xml.includes('Ángulo de Medición: al menos 1°'));
  assert.ok(r.xml.includes('40 días hábiles'));
});

// Varias características en una sola celda necesitan varios <w:p> — no un solo párrafo con un "\n"
// literal en el texto, que Word muestra como un espacio y no como un salto de línea real.
test('cada característica queda en su propio párrafo dentro de la celda', () => {
  const plan = planDeRellenoResumen(detectarResumenTecnico(DOC), [PRODUCTO]);
  const r = aplicarPlanResumen(DOC, plan.celdas);
  const textos = Array.from(r.xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)).map(m => m[1]);
  // Las dos líneas aparecen como <w:t> INDEPENDIENTES (párrafos separados), no como uno solo con
  // un "\n" literal adentro — que Word mostraría como un espacio, no como un salto de línea real.
  assert.ok(textos.includes('Ángulo de Medición: al menos 1°'));
  assert.ok(textos.includes('Interfaz USB 2.0'));
  assert.ok(!textos.some(t => t.includes('\n')), 'ningún <w:t> debe traer un salto de línea literal');
});

// Mismo criterio que el resto del proyecto: nunca se pisa una celda que ya tiene algo escrito.
test('no pisa una celda que el equipo ya llenó a mano', () => {
  const docConDato = DOC.replace(
    fila(celda('3'), celda('Luminancímetros'), celdaVacia),
    fila(celda('3'), celda('Luminancímetros'), celda('Ya lo llenó una persona')),
  );
  const plan = planDeRellenoResumen(detectarResumenTecnico(docConDato), [PRODUCTO]);
  const r = aplicarPlanResumen(docConDato, plan.celdas);
  assert.ok(r.xml.includes('Ya lo llenó una persona'));
});
