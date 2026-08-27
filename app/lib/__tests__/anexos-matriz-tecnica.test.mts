// Tests de la MATRIZ DE CUMPLIMIENTO TÉCNICO (Formulario N°3 y equivalentes).
//
// El fixture reproduce la estructura EXACTA del caso real 1057922-23-LE26 —
// FORMULARIO_N3_ESPECIFICACIONES_TÉCNICAS_SET_CONTENEDORES.docx — en miniatura: la columna de
// numeración sin encabezado, filas de sección con menos celdas, y textos de especificación
// idénticos a los que guarda el informe. El .docx real pesa 363 KB y no entra en el repo; se
// verifica aparte con scripts/scratch/_matriz-n3.mts.
//
// Correr con:
//   npx tsx --test app/lib/__tests__/anexos-matriz-tecnica.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectarMatrizTecnica, planDeRelleno, rolDeEncabezado, textoCumple, textoDeXml,
  detectarTablaOferta, aplicarPlanOferta,
  type CaracteristicaConocida,
} from '../anexos-matriz-tecnica';

const celda = (t: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="500" w:type="pct"/></w:tcPr><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
const celdaVacia = '<w:tc><w:tcPr><w:tcW w:w="350" w:type="pct"/></w:tcPr><w:p/></w:tc>';
const fila = (...celdas: string[]) => `<w:tr w:rsidR="00"><w:trPr/>${celdas.join('')}</w:tr>`;

const ENCABEZADO = fila(
  celdaVacia,                                  // ← la numeración viene SIN encabezado (caso real)
  celda('ESPECIFICACIONES TÉCNICAS'),
  celda('TIPO DE REQUERIMIENTO'),
  celda('PUNTAJE EETT'),
  celda('CUMPLE SI/NO'),
  celda('CATÁLOGO/ PÁGINA PROVEEDOR/ DATASHEET'),
  celda('OBSERVACIONES'),
  celda('PUNTAJE ASIGNADO'),
);

const especFila = (n: string, texto: string) => fila(
  celda(n), celda(texto), celda('OBLIGATORIO'), celdaVacia,
  celdaVacia, celdaVacia, celdaVacia, celdaVacia,
);

const DOC = `<w:document><w:body><w:tbl>
  ${fila(celdaVacia, celda('NOMBRE DEL EQUIPO: SET DE CONTENEDORES'))}
  ${ENCABEZADO}
  ${fila(celda('I'), celda('CONTENEDORES CON PEDAL 20 [L]'))}
  ${especFila('1.1', 'Capacidad: 20 [L]')}
  ${especFila('1.2', 'Tapa de cierre hermético accionada por pedal')}
  ${especFila('1.3', 'Material impermeable')}
  ${fila(celda('II'), celda('CONTENEDORES 120 [L]'))}
  ${especFila('2.1', 'Capacidad: 120 [L]')}
  ${especFila('2.2', 'Material impermeable')}
</w:tbl></w:body></w:document>`;

// ─── LECTURA DEL XML ──────────────────────────────────────────────────────────────────────────
// Trampa real: `<w:t` también prefija `<w:tcPr`. Una primera versión del diagnóstico leía las
// propiedades de celda como si fueran texto y mostraba basura tipo `<w:tcPr><w:tcW w:w="208"…`.
test('textoDeXml no confunde <w:tcPr> con <w:t>', () => {
  assert.equal(textoDeXml(celda('Capacidad: 20 [L]')), 'Capacidad: 20 [L]');
  assert.equal(textoDeXml(celdaVacia), '');
});

// ─── ROLES DE COLUMNA ─────────────────────────────────────────────────────────────────────────
test('reconoce las columnas por su encabezado', () => {
  assert.equal(rolDeEncabezado('ESPECIFICACIONES TÉCNICAS'), 'especificacion');
  assert.equal(rolDeEncabezado('CUMPLE SI/NO'), 'cumple');
  assert.equal(rolDeEncabezado('CATÁLOGO/ PÁGINA PROVEEDOR/ DATASHEET'), 'catalogo');
  assert.equal(rolDeEncabezado('OBSERVACIONES'), 'observaciones');
  assert.equal(rolDeEncabezado('TIPO DE REQUERIMIENTO'), 'tipo');
});

// "PUNTAJE ASIGNADO" contiene "PUNTAJE": si el orden de comprobación estuviera al revés, la
// columna del evaluador se confundiría con la del puntaje de las bases.
test('"PUNTAJE ASIGNADO" no se confunde con "PUNTAJE EETT"', () => {
  assert.equal(rolDeEncabezado('PUNTAJE ASIGNADO'), 'puntajeAsignado');
  assert.equal(rolDeEncabezado('PUNTAJE EETT'), 'puntaje');
});

test('tolera variantes de redacción de "cumple"', () => {
  for (const v of ['CUMPLE SI/NO', 'CUMPLE (SI/NO)', '¿CUMPLE?', 'Cumple']) {
    assert.equal(rolDeEncabezado(v), 'cumple', v);
  }
});

// ─── DETECCIÓN ────────────────────────────────────────────────────────────────────────────────
test('detecta la matriz y sus 8 columnas', () => {
  const m = detectarMatrizTecnica(DOC)!;
  assert.ok(m, 'no detectó la matriz');
  assert.equal(m.celdasPorFila, 8);
  assert.deepEqual(m.columnas, [
    'numero', 'especificacion', 'tipo', 'puntaje', 'cumple', 'catalogo', 'observaciones', 'puntajeAsignado',
  ]);
});

// La columna de numeración viene sin encabezado; se deduce de los datos ("1.1", "1.2"…).
test('deduce la columna de numeración aunque su encabezado esté vacío', () => {
  const m = detectarMatrizTecnica(DOC)!;
  assert.equal(m.columnas[0], 'numero');
  assert.equal(m.filas[0].numero, '1.1');
});

// Las filas de sección ("I · CONTENEDORES CON PEDAL 20 [L]") tienen menos celdas y no son
// especificaciones: no hay nada que declarar en ellas.
test('las filas de sección no se cuentan como especificaciones', () => {
  const m = detectarMatrizTecnica(DOC)!;
  assert.equal(m.filas.length, 5);
  assert.ok(!m.filas.some(f => f.especificacion.includes('CONTENEDORES CON PEDAL')));
});

test('un documento que NO es matriz devuelve null (sigue por el motor de anexos)', () => {
  const identificacion = `<w:document><w:body><w:tbl>
    ${fila(celda('Razón social'), celdaVacia)}
    ${fila(celda('RUT'), celdaVacia)}
    ${fila(celda('Representante legal'), celdaVacia)}
  </w:tbl></w:body></w:document>`;
  assert.equal(detectarMatrizTecnica(identificacion), null);
});

test('una tabla con especificaciones pero SIN columna "cumple" no es matriz', () => {
  const sinCumple = `<w:document><w:body><w:tbl>
    ${fila(celda('N°'), celda('ESPECIFICACIONES TÉCNICAS'), celda('OBSERVACIONES'))}
    ${fila(celda('1.1'), celda('Capacidad: 20 [L]'), celdaVacia)}
    ${fila(celda('1.2'), celda('Material impermeable'), celdaVacia)}
  </w:tbl></w:body></w:document>`;
  assert.equal(detectarMatrizTecnica(sinCumple), null);
});

// ─── PLAN DE RELLENO ──────────────────────────────────────────────────────────────────────────
const conocida = (o: Partial<CaracteristicaConocida> & { descripcion: string }): CaracteristicaConocida => ({
  veredicto: null, valorOfertado: null, fuente: null, ...o,
});

// LA regla del módulo, igual que en la ficha propia: sin veredicto no se escribe NADA. Un
// formulario autocompletado con "SÍ" plausibles es una declaración falsa ante un organismo.
test('sin veredicto no se escribe ninguna celda', () => {
  const m = detectarMatrizTecnica(DOC)!;
  const plan = planDeRelleno(m, [
    conocida({ descripcion: 'Capacidad: 20 [L]' }),
    conocida({ descripcion: 'Material impermeable' }),
  ]);
  assert.ok(plan.filasEmparejadas > 0, 'debería emparejar igual');
  assert.equal(plan.celdas.length, 0);
});

test('con veredicto CUMPLE escribe SÍ, y NO_CUMPLE escribe NO', () => {
  assert.equal(textoCumple('CUMPLE'), 'SÍ');
  assert.equal(textoCumple('NO_CUMPLE'), 'NO');
});

// Declarar "SÍ" cuando en realidad cumple sólo con un complemento sería declarar de más en un
// documento que el organismo evalúa. Lo resuelve una persona.
test('CUMPLE_CON_COMPLEMENTO queda en blanco, no se declara SÍ', () => {
  assert.equal(textoCumple('CUMPLE_CON_COMPLEMENTO'), null);
  const m = detectarMatrizTecnica(DOC)!;
  const plan = planDeRelleno(m, [
    conocida({ descripcion: 'Capacidad: 20 [L]', veredicto: 'CUMPLE_CON_COMPLEMENTO' }),
  ]);
  assert.equal(plan.celdas.filter(c => c.rol === 'cumple').length, 0);
});

test('escribe cumple, catálogo y observaciones en sus columnas', () => {
  const m = detectarMatrizTecnica(DOC)!;
  const plan = planDeRelleno(m, [conocida({
    descripcion: 'Capacidad: 20 [L]', veredicto: 'CUMPLE',
    valorOfertado: '20 L exactos', fuente: 'Ficha proveedor · pág. 3',
  })]);
  const porRol = Object.fromEntries(plan.celdas.map(c => [c.rol, c]));
  assert.equal(porRol.cumple.texto, 'SÍ');
  assert.equal(porRol.cumple.columna, m.columnas.indexOf('cumple'));
  assert.equal(porRol.catalogo.texto, 'Ficha proveedor · pág. 3');
  assert.equal(porRol.observaciones.texto, '20 L exactos');
});

// Caso real: "Material impermeable" aparece en la sección de 20 L y otra vez en la de 120 L.
// Contar textos únicos daba "26 de 46" y parecía que faltaba la mitad del formulario.
test('una especificación repetida en varias secciones llena TODAS sus filas', () => {
  const m = detectarMatrizTecnica(DOC)!;
  const plan = planDeRelleno(m, [
    conocida({ descripcion: 'Material impermeable', veredicto: 'CUMPLE' }),
  ]);
  assert.equal(plan.filasEmparejadas, 2, 'debe emparejar las dos filas repetidas');
  assert.equal(plan.textosUsados, 1);
  assert.equal(plan.celdas.filter(c => c.rol === 'cumple').length, 2);
});

// Escribir "CUMPLE" en la fila equivocada es peor que dejarla en blanco: nada de parecido difuso.
test('lo que no calza exacto queda sin emparejar, no se aproxima', () => {
  const m = detectarMatrizTecnica(DOC)!;
  const plan = planDeRelleno(m, [conocida({ descripcion: 'Capacidad: 25 [L]', veredicto: 'CUMPLE' })]);
  assert.equal(plan.filasEmparejadas, 0);
  assert.equal(plan.celdas.length, 0);
  assert.equal(plan.sinEmparejar.length, m.filas.length);
});

test('el emparejamiento tolera tildes y espacios distintos', () => {
  const m = detectarMatrizTecnica(DOC)!;
  const plan = planDeRelleno(m, [
    conocida({ descripcion: 'tapa  de cierre HERMETICO accionada por pedal', veredicto: 'CUMPLE' }),
  ]);
  assert.equal(plan.filasEmparejadas, 1);
});

// Señal de que se eligió el formulario de otra línea: teníamos características que el documento
// no menciona.
test('las características que el documento no trae quedan como sobrantes', () => {
  const m = detectarMatrizTecnica(DOC)!;
  const plan = planDeRelleno(m, [
    conocida({ descripcion: 'Capacidad: 20 [L]', veredicto: 'CUMPLE' }),
    conocida({ descripcion: 'Potencia 1.200 W', veredicto: 'CUMPLE' }),
  ]);
  assert.equal(plan.sobrantes.length, 1);
  assert.equal(plan.sobrantes[0].descripcion, 'Potencia 1.200 W');
});

// ─── TABLA "INFORMACIÓN DE LA OFERTA" (marca/modelo/fabricante/país/garantía) ─────────────────
// Reproduce la estructura real de FORMULARIO_N3_..._SET_CONTENEDORES.docx: filas de 2 celdas,
// etiqueta a la izquierda, valor (vacío o con texto instructivo) a la derecha.
const filaOferta = (etiqueta: string, valor: string) => fila(celda(etiqueta), celda(valor));
const DOC_OFERTA = `<w:document><w:body><w:tbl>
  ${fila(celdaVacia, celda('INFORMACIÓN DE LA OFERTA'))}
  ${filaOferta('Nombre de la Empresa', '')}
  ${filaOferta('Marca', '')}
  ${filaOferta('Modelo', '')}
  ${filaOferta('Fabricante', '')}
  ${filaOferta('País/Año de Fabricación', '')}
  ${filaOferta('Plazo de Entrega (marcar con una X)', '____ 15 días corridos ____ 30 días corridos')}
  ${filaOferta('Garantía Técnica', '____ meses (igual o superior a 12 meses)')}
</w:tbl></w:body></w:document>`;

test('detecta la tabla de oferta y sus campos reconocidos', () => {
  const t = detectarTablaOferta(DOC_OFERTA)!;
  assert.ok(t, 'no detectó la tabla de oferta');
  const roles = t.campos.map(c => c.rol).sort();
  assert.deepEqual(roles, ['fabricante', 'garantia', 'marca', 'modelo', 'pais'].sort());
});

// El bug real: normalizar() convierte "/" en espacio, así que "País/Año de Fabricación" llega
// como "pais ano de fabricacion" — un patrón con "\/" literal nunca la reconocía.
test('reconoce "País/Año de Fabricación" pese a que normalizar() borra la barra', () => {
  const t = detectarTablaOferta(DOC_OFERTA)!;
  assert.ok(t.campos.some(c => c.rol === 'pais'));
});

// "Nombre de la Empresa" y "Plazo de Entrega" NO tienen rol: la empresa es otro flujo (motor de
// anexos) y el plazo es una lista de opciones con X, no un blanco de texto libre.
test('no confunde "Nombre de la Empresa" ni "Plazo de Entrega" con un campo del producto', () => {
  const t = detectarTablaOferta(DOC_OFERTA)!;
  assert.ok(!t.campos.some(c => /empresa/i.test(c.etiqueta)));
  assert.ok(!t.campos.some(c => /plazo/i.test(c.etiqueta)));
});

test('sin ninguna etiqueta reconocida, devuelve null', () => {
  const otra = `<w:document><w:body><w:tbl>
    ${fila(celda('Razón social'), celdaVacia)}
    ${fila(celda('RUT'), celdaVacia)}
  </w:tbl></w:body></w:document>`;
  assert.equal(detectarTablaOferta(otra), null);
});

test('escribe marca, modelo, fabricante y país en las celdas vacías', () => {
  const t = detectarTablaOferta(DOC_OFERTA)!;
  const r = aplicarPlanOferta(DOC_OFERTA, t, {
    marca: 'Konica Minolta', modelo: 'LS-150', fabricante: 'Konica Minolta', paisFabricacion: 'Japón',
  });
  assert.equal(r.escritas, 4);
  const tablas = r.xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g)!;
  const filas = tablas[t.indiceTabla].match(/<w:tr\b[\s\S]*?<\/w:tr>/g)!;
  const valorDe = (rol: string) => {
    const campo = t.campos.find(c => c.rol === rol)!;
    const celdas = filas[campo.fila].match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [];
    return textoDeXml(celdas[1]);
  };
  assert.equal(valorDe('marca'), 'Konica Minolta');
  assert.equal(valorDe('modelo'), 'LS-150');
  assert.equal(valorDe('pais'), 'Japón');
});

// Caso real medido contra el .docx original: la celda de garantía NUNCA está vacía porque trae el
// texto instructivo "____ meses (igual o superior a 12 meses)" — no es un blanco de celda, es un
// blanco DENTRO de una frase. aplicarPlanOferta no la pisa (correcto: mejor omitir que corromper
// el texto instructivo), y por eso queda contada como omitida aunque SÍ había un dato para poner.
test('la garantía con texto instructivo se omite, no se pisa', () => {
  const t = detectarTablaOferta(DOC_OFERTA)!;
  const r = aplicarPlanOferta(DOC_OFERTA, t, { garantiaMeses: 12 });
  assert.equal(r.escritas, 0);
  // Los 5 campos detectados quedan omitidos: marca/modelo/fabricante/país porque no se pasó dato
  // para ellos, y garantía porque SÍ había dato pero la celda ya tenía el texto instructivo.
  assert.equal(r.omitidas, 5);
  assert.ok(r.xml.includes('igual o superior a 12 meses'), 'el texto instructivo debe seguir intacto');
});

// Mismo criterio que aplicarPlan(): nunca pisa una celda que YA tiene algo escrito.
test('no pisa un campo que el equipo ya llenó a mano', () => {
  const conMarca = DOC_OFERTA.replace(filaOferta('Marca', ''), filaOferta('Marca', 'Bosch'));
  const t = detectarTablaOferta(conMarca)!;
  const r = aplicarPlanOferta(conMarca, t, { marca: 'Konica Minolta' });
  assert.equal(r.escritas, 0);
  assert.ok(r.xml.includes('Bosch'));
  assert.ok(!r.xml.includes('Konica Minolta'));
});

test('sin dato para un campo reconocido, se omite sin tocar nada', () => {
  const t = detectarTablaOferta(DOC_OFERTA)!;
  const r = aplicarPlanOferta(DOC_OFERTA, t, { marca: 'Konica Minolta' });   // sin modelo/fabricante/pais/garantía
  assert.equal(r.escritas, 1);
  assert.equal(r.omitidas, 4);   // modelo, fabricante, pais y garantía sin dato para escribir
});
