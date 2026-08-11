// Regresión de la detección de campos en anexos (30-jul-2026). Correr con:
//   npx tsx --test app/lib/__tests__/anexos-deteccion.test.mts
//
// Todos los casos salen de UN documento real: FORMULARIOS_OBLIGATORIOS.doc de 4291-38-LP26, cinco
// formularios pegados en un archivo. Se encontraron generando el .docx y exportándolo a PDF para
// mirarlo — ninguno se veía en el XML ni en los conteos, solo al ver la hoja terminada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarParaIds, listarParrafos, rellenarFinDeParrafo, rellenarCeldaVacia, parrafoEstaVacio,
  unificarRunsDeMarcadores, rellenarRunPorIndice, verificarParrafos, verificarXmlBienFormado,
} from '../anexos-docx';
import { analizarAnexo, detectarSecciones, detectarCandidatosCelda, indiceFilaEncabezado, extraerTablasCrudo, detectarCandidatosTabla, detectarTripletesFecha, detectarAlternativasExcluyentes, esEtiquetaDeCampo } from '../anexos-detectar';
import { valorExisteEnFicha, campoCalzaConLaEtiqueta, type EmpresaCampos } from '../anexos-ia-motor';
import { esCandidatoDePrecioUnitario } from '../anexos-precios-columnas';
import { calcularTotalesAlPie, pareceFilaDePie } from '../anexos-totales-seccion';

const NS = '<w:document xmlns:w="urn:w" xmlns:w14="urn:w14"><w:body>';
const FIN = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>';
const p = (texto: string) => texto === ''
  ? '<w:p/>'
  : `<w:p><w:r><w:t xml:space="preserve">${texto}</w:t></w:r></w:p>`;
const celda = (texto: string) => `<w:tc><w:tcPr><w:tcW w:w="1250" w:type="pct"/></w:tcPr>${p(texto)}</w:tc>`;
const fila = (...textos: string[]) => `<w:tr>${textos.map(celda).join('')}</w:tr>`;
const tabla = (...filas: string[]) => `<w:tbl><w:tblPr/>${filas.join('')}</w:tbl>`;

// El conversor de .doc de producción es LibreOffice, que escribe las celdas vacías con un <w:r>
// que carga el formato pero sin <w:t>; Word las deja sin ningún run. Con la regla vieja ("vacío =
// sin runs") el documento real de producción no mostraba ni una celda libre: cero candidatos, sin
// vista de tabla y sin autocompletar nada. Los dos estilos tienen que dar lo mismo.
test('celda vacía: da igual si la generó Word o LibreOffice (regresión conversor VPS)', () => {
  const celdaWord = '<w:p/>';
  const celdaLibreOffice = '<w:p><w:pPr><w:rPr><w:sz w:val="20"/></w:rPr></w:pPr><w:r><w:rPr><w:sz w:val="20"/></w:rPr></w:r></w:p>';
  const celdaConTVacio = '<w:p><w:r><w:t></w:t></w:r></w:p>';

  for (const [estilo, vacia] of [['Word', celdaWord], ['LibreOffice', celdaLibreOffice], ['<w:t> vacío', celdaConTVacio]] as [string, string][]) {
    const xml = NS + tabla(fila('NOMBRE O RAZÓN SOCIAL', '', 'RUT', '')).replace(/<w:tc><w:tcPr><w:tcW w:w="1250" w:type="pct"\/><\/w:tcPr><w:p\/><\/w:tc>/g,
      `<w:tc><w:tcPr><w:tcW w:w="1250" w:type="pct"/></w:tcPr>${vacia}</w:tc>`) + FIN;
    const { xml: norm } = normalizarParaIds(xml);
    const etiquetas = analizarAnexo(norm).candidatosCelda.map(c => c.etiqueta);
    assert.deepEqual(etiquetas, ['NOMBRE O RAZÓN SOCIAL', 'RUT'], `estilo ${estilo}: ${JSON.stringify(etiquetas)}`);
  }

  // Un párrafo con una IMAGEN no tiene texto pero NO es un blanco: ahí ya se estampó una firma.
  assert.equal(parrafoEstaVacio('<w:r><w:drawing><wp:inline/></w:drawing></w:r>'), false);
  assert.equal(parrafoEstaVacio('<w:r><w:rPr><w:b/></w:rPr></w:r>'), true);
  assert.equal(parrafoEstaVacio('<w:r><w:t>algo</w:t></w:r>'), false);
});

test('rellenarCeldaVacia escribe en los dos estilos y no pisa un dato existente', () => {
  const conParaId = (cuerpo: string) => `<w:document xmlns:w="urn:w" xmlns:w14="urn:w14"><w:body><w:p w14:paraId="AAAA0001">${cuerpo}</w:p></w:body></w:document>`;

  // Estilo LibreOffice: el <w:t> entra DENTRO del run que ya existe, sin agregar párrafos.
  const lo = rellenarCeldaVacia(conParaId('<w:pPr><w:rPr><w:sz w:val="20"/></w:rPr></w:pPr><w:r><w:rPr><w:sz w:val="20"/></w:rPr></w:r>'), 'AAAA0001', 'Comercial MP SpA');
  assert.match(lo, /<w:r><w:rPr><w:sz w:val="20"\/><\/w:rPr><w:t xml:space="preserve">Comercial MP SpA<\/w:t><\/w:r>/);
  assert.equal((lo.match(/<w:p\b/g) || []).length, 1, 'no agrega párrafos');

  // Estilo Word: se crea el run.
  const word = rellenarCeldaVacia(conParaId(''), 'AAAA0001', 'Comercial MP SpA');
  assert.match(word, /<w:t xml:space="preserve">Comercial MP SpA<\/w:t>/);

  // Y sigue negándose a pisar un dato real.
  assert.throws(() => rellenarCeldaVacia(conParaId('<w:r><w:t>ya escrito</w:t></w:r>'), 'AAAA0001', 'x'), /ya tiene contenido/);

  // REGRESIÓN 1058086-43-LP26 (FORMULARIO N°1 no abría en Word): el párrafo vacío declara
  // tabulaciones en su <w:pPr>. El regex de "¿hay un <w:t/> vacío que llenar?" empezaba con
  // `<w:t[^>]*/>`, que también calza <w:tab .../> — el valor se escribía DENTRO de <w:tabs>,
  // XML bien formado pero inválido contra el esquema, y Word rechazaba el documento entero.
  const conTabs = rellenarCeldaVacia(
    conParaId('<w:pPr><w:tabs><w:tab w:val="left" w:pos="567"/></w:tabs><w:jc w:val="both"/></w:pPr>'),
    'AAAA0001', 'Inversiones Claro ARZ SPA',
  );
  assert.match(conTabs, /<w:tabs><w:tab w:val="left" w:pos="567"\/><\/w:tabs>/, 'la tabulación queda intacta');
  assert.match(conTabs, /<\/w:pPr><w:r>(<w:rPr>[\s\S]*?<\/w:rPr>)?<w:t xml:space="preserve">Inversiones Claro ARZ SPA<\/w:t><\/w:r>/,
    'el valor va en un run propio, DESPUÉS de las propiedades del párrafo');
  assert.equal(verificarXmlBienFormado(conTabs).valido, true, 'y el gate de esquema lo aprueba');

  // El gate tiene que cazar el XML corrupto que producía el bug, no solo confiar en el fix.
  const corrupto = conParaId('<w:pPr><w:tabs><w:t xml:space="preserve">valor</w:t></w:tabs></w:pPr>');
  const chequeo = verificarXmlBienFormado(corrupto);
  assert.equal(chequeo.valido, false);
  assert.match(chequeo.error || '', /w:t.*colgando/);
});

// La tabla de identificación del oferente: [etiqueta][valor][etiqueta][valor], SIN fila de
// encabezado. Tratada como tabla de datos, la etiqueta más larga de cada fila se le asignaba a las
// DOS celdas vacías: la dirección terminaba escrita también en "INICIO ACTIV." y el nombre del
// representante en su "RUT"; y CIUDAD/FONO no llegaban a ser candidatos, así que quedaban en
// blanco sin avisar.
test('tabla de formulario: cada etiqueta se queda con SU celda (regresión 4291-38-LP26)', () => {
  const xml = NS + tabla(
    fila('NOMBRE O RAZÓN SOCIAL', '', 'RUT', ''),
    fila('DIRECCIÓN COMERCIAL', '', 'INICIO ACTIV.', ''),
    fila('CIUDAD', '', 'FONO', ''),
  ) + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const etiquetas = analizarAnexo(norm).candidatosCelda.map(c => c.etiqueta);

  for (const esperada of ['NOMBRE O RAZÓN SOCIAL', 'DIRECCIÓN COMERCIAL', 'INICIO ACTIV.', 'CIUDAD', 'FONO']) {
    assert.ok(etiquetas.some(e => e.includes(esperada)), `falta el candidato "${esperada}": ${JSON.stringify(etiquetas)}`);
  }
  // Y ninguna etiqueta se reparte entre dos celdas: la dirección aparece una sola vez.
  assert.equal(etiquetas.filter(e => e === 'DIRECCIÓN COMERCIAL').length, 1,
    `"DIRECCIÓN COMERCIAL" no puede etiquetar dos celdas: ${JSON.stringify(etiquetas)}`);
  // La primera fila NO es un encabezado, así que no puede inventar una columna "RUT" para el resto.
  assert.equal(etiquetas.filter(e => /DIRECCIÓN COMERCIAL — RUT|CIUDAD — RUT/.test(e)).length, 0,
    `no debe inventar columnas desde la primera fila: ${JSON.stringify(etiquetas)}`);
});

// BUG REAL (4999-8-LE26, "ANEXO N°1 FORMULARIO DATOS DEL OFERENTE", encontrado 6-ago-2026 corriendo
// el banco de pruebas contra licitaciones reales): misma tabla [etiqueta][valor] de 2 columnas SIN
// encabezado que el caso de arriba, pero acá la CELDA de la etiqueta viene centrada por estilo del
// organismo (`<w:jc w:val="center"/>`, no negrita ni nada que la distinga de un campo real). El
// heurístico "centrado = título de página, nunca etiqueta de campo" (protege contra un título como
// "IDENTIFICACION DEL OFERENTE" antes de la tabla) descartaba TODAS las filas por igual — 10 de 10
// candidatos perdidos: Nombre/RUT/Representante/Dirección/Ciudad/Teléfono/Correo, ninguno auto, ninguno
// pendiente, invisibles por completo en pantalla.
test('tabla de formulario: una etiqueta CENTRADA por estilo sigue siendo candidato (regresión 4999-8-LE26)', () => {
  const celdaCentrada = (texto: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="1250" w:type="pct"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">${texto}</w:t></w:r></w:p></w:tc>`;
  const xml = NS + tabla(
    `<w:tr>${celdaCentrada('Nombre o Razón Social del Oferente')}${celda('')}</w:tr>`,
    `<w:tr>${celdaCentrada('RUT del Oferente')}${celda('')}</w:tr>`,
    `<w:tr>${celdaCentrada('Dirección')}${celda('')}</w:tr>`,
  ) + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const etiquetas = analizarAnexo(norm).candidatosCelda.map(c => c.etiqueta);
  for (const esperada of ['Nombre o Razón Social del Oferente', 'RUT del Oferente', 'Dirección']) {
    assert.ok(etiquetas.includes(esperada), `falta el candidato centrado "${esperada}": ${JSON.stringify(etiquetas)}`);
  }

  // El caso ORIGINAL que el heurístico protege sigue intacto: un título de página centrado, FUERA
  // de cualquier celda de tabla, antes de la tabla real — no puede colarse como candidato.
  const tituloCentrado = '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">IDENTIFICACION DEL OFERENTE</w:t></w:r></w:p>';
  const xmlConTitulo = NS
    + tituloCentrado
    + p('')
    + tabla(fila('NOMBRE O RAZÓN SOCIAL', ''))
    + FIN;
  const { xml: normTitulo } = normalizarParaIds(xmlConTitulo);
  const etiquetasConTitulo = analizarAnexo(normTitulo).candidatosCelda.map(c => c.etiqueta);
  assert.equal(etiquetasConTitulo.filter(e => e === 'IDENTIFICACION DEL OFERENTE').length, 0,
    `un título de página centrado sigue sin ser candidato: ${JSON.stringify(etiquetasConTitulo)}`);
});

// BUG REAL (1227338-6-LE26, "IDENTIFICACIÓN DEL PROPONENTE"/"…DEL REPRESENTANTE LEGAL"): la celda
// de la ETIQUETA trae un párrafo vacío de relleno DESPUÉS del texto (un salto de línea extra que
// Word deja dentro de la celda) — con la regla vieja (mirar solo el párrafo i+1), el patrón 1
// tomaba ese relleno por el valor: la razón social, el RUT y el domicilio del proponente, y el
// bloque ENTERO del representante legal (nombre/RUT/domicilio/teléfono) quedaban sin ninguna
// casilla donde escribir — ni auto, ni pendiente, directamente invisibles.
test('patrón 1: la etiqueta no se queda pegada al relleno de su PROPIA celda (regresión 1227338-6-LE26)', () => {
  const celdaConRelleno = (texto: string) => `<w:tc><w:tcPr><w:tcW w:w="1250" w:type="pct"/></w:tcPr>${p(texto)}<w:p/></w:tc>`;
  const xml = NS + tabla(
    `<w:tr>${celdaConRelleno('NOMBRE O RAZÓN SOCIAL')}${celda('')}</w:tr>`,
    `<w:tr>${celdaConRelleno('RUT DEL PROPONENTE')}${celda('')}</w:tr>`,
  ) + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const candidatos = analizarAnexo(norm).candidatosCelda;
  const etiquetas = candidatos.map(c => c.etiqueta).sort();
  assert.deepEqual(etiquetas, ['NOMBRE O RAZÓN SOCIAL', 'RUT DEL PROPONENTE'].sort(),
    `deben sobrevivir las dos etiquetas: ${JSON.stringify(etiquetas)}`);

  // Y cada candidato apunta a la celda de VALOR (la segunda de su fila), nunca al relleno que
  // vive dentro de la celda de la etiqueta: rellenar no puede terminar escribiendo el valor
  // pegado bajo la propia etiqueta en la primera celda.
  for (const c of candidatos) {
    const rellenado = rellenarCeldaVacia(norm, c.paraId, 'Comercial MP SpA');
    const filaConEtiqueta = rellenado.split('</w:tr>').find(f => f.includes(c.etiqueta))! + '</w:tr>';
    const celdas = filaConEtiqueta.split('</w:tc>');
    assert.ok(!celdas[0].includes('Comercial MP SpA'), `"${c.etiqueta}": el valor no puede quedar en la celda de la etiqueta`);
    assert.ok(celdas[1]?.includes('Comercial MP SpA'), `"${c.etiqueta}": el valor debe quedar en la celda de al lado`);
  }
});

// La fila de encabezado no es siempre la 0: hay tablas que abren con un TÍTULO mergeado, y otras
// donde la fila 0 SÍ es el encabezado y la 1 ya trae blancos. Las dos formas conviven en el mismo
// documento (4291-38-LP26) y elegir mal rompe cosas distintas en cada una.
test('indiceFilaEncabezado: última fila inicial con todas sus celdas con texto', () => {
  // "INTEGRANTES DE LA UTP" (título, 1 celda) → [N°|Nombre|RUT] (encabezado, 3 celdas) → blancos
  assert.equal(indiceFilaEncabezado([
    { completa: true, numCeldas: 1 }, { completa: true, numCeldas: 3 },
    { completa: false, numCeldas: 2 }, { completa: false, numCeldas: 2 },
  ]), 1);
  // "Para uso exclusivo Proveedor | Universidad" (encabezado, 2 celdas) → filas con blancos
  assert.equal(indiceFilaEncabezado([
    { completa: true, numCeldas: 2 }, { completa: false, numCeldas: 2 },
    { completa: false, numCeldas: 2 }, { completa: false, numCeldas: 2 },
  ]), 0);
  // Tabla de formulario: la fila 0 ya trae celdas vacías → no hay encabezado
  assert.equal(indiceFilaEncabezado([
    { completa: false, numCeldas: 2 }, { completa: false, numCeldas: 2 }, { completa: false, numCeldas: 2 },
  ]), -1);
  // BUG REAL (1057472-89-LE26): tabla de FORMULARIO que abre con un título de 1 celda
  // ("DATOS DEL PROPONENTE:") pero SIN encabezado real después — solo filas [etiqueta][valor].
  // La fila-título de 1 celda no puede contarse como el encabezado (no hay nada que alinear).
  assert.equal(indiceFilaEncabezado([
    { completa: true, numCeldas: 1 }, { completa: false, numCeldas: 2 }, { completa: false, numCeldas: 2 },
  ]), -1);
  // BUG REAL (1057472-89-LE26, ANEXO N°4): la fila que abre cada ítem (N° + descripción + UNA
  // celda combinada de 4 columnas "Requisitos excluyentes:") tiene TODAS sus celdas con texto —
  // pero al traer una celda combinada (gridSpan) nunca es el encabezado real; el de verdad es la
  // fila 0, con los 6 nombres de columna sueltos.
  assert.equal(indiceFilaEncabezado([
    { completa: true, numCeldas: 6 },
    { completa: true, numCeldas: 3, tieneCeldaCombinada: true },
    { completa: false, numCeldas: 6 },
  ]), 0);
});

test('tabla que abre con una fila-título mergeada: el encabezado es la siguiente (regresión cajas sin casillas)', () => {
  const xml = NS + tabla(
    fila('INTEGRANTES DE LA UTP'),
    fila('N°', 'Nombre Integrante/Razón Social', 'RUT'),
    fila('1', '', ''),
    fila('2', '', ''),
  ) + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const etiquetas = analizarAnexo(norm).candidatosCelda.map(c => c.etiqueta);
  assert.ok(etiquetas.some(e => e.includes('Nombre Integrante')), `debe usar el encabezado real: ${JSON.stringify(etiquetas)}`);
  assert.equal(etiquetas.filter(e => e.includes('INTEGRANTES DE LA UTP')).length, 0,
    `el título mergeado no es un nombre de columna: ${JSON.stringify(etiquetas)}`);
});

// BUG REAL (1057472-89-LE26, "ANEXO N°1"): tabla de FORMULARIO (2 columnas [etiqueta][valor], sin
// encabezado de columnas) que abre con un título de 1 celda mergeada ("DATOS DEL PROPONENTE:").
// Antes, esa fila-título se tomaba por el encabezado de la tabla entera (1 columna) y
// alinearFilaConEncabezado colapsaba cada fila de datos (2 celdas) en una sola, perdiendo el
// indiceGlobal de la celda vacía — la tabla entera desaparecía de la vista "réplica visual" del
// documento (ver TablaReal en AnexoRellenoModal.tsx) y esos campos caían a la lista plana.
test('tabla de formulario con título mergeado de 1 celda: sigue viéndose como tabla (regresión 1057472-89-LE26)', () => {
  const xml = NS + tabla(
    fila('DATOS DEL PROPONENTE:'),
    fila('Nombre completo o Razón Social', ''),
    fila('N° Cédula de Identidad o RUT', ''),
    fila('Teléfono', ''),
  ) + FIN;
  const { xml: norm } = normalizarParaIds(xml);

  // Patrón 1 (celdas planas) sigue encontrando cada campo con SU propia etiqueta, no una
  // etiqueta fantasma tipo "Nombre completo o Razón Social — DATOS DEL PROPONENTE:".
  const etiquetas = analizarAnexo(norm).candidatosCelda.map(c => c.etiqueta);
  assert.ok(etiquetas.includes('Nombre completo o Razón Social'), `falta el candidato: ${JSON.stringify(etiquetas)}`);
  assert.ok(etiquetas.includes('Teléfono'), `falta el candidato: ${JSON.stringify(etiquetas)}`);
  assert.equal(etiquetas.filter(e => e.includes('DATOS DEL PROPONENTE')).length, 0,
    `el título mergeado no debe fusionarse con la etiqueta de cada fila: ${JSON.stringify(etiquetas)}`);

  // Y la vista de tabla real (extraerTablasCrudo, la que arma la réplica visual) mantiene cada
  // fila con SUS 2 celdas propias — no las colapsa en 1 sola con el indiceGlobal perdido.
  const tablas = extraerTablasCrudo(norm);
  assert.equal(tablas.length, 1);
  const filaTelefono = tablas[0].filas.find(f => f.celdas[0]?.texto === 'Teléfono');
  assert.ok(filaTelefono, `no se encontró la fila de Teléfono: ${JSON.stringify(tablas[0].filas)}`);
  assert.equal(filaTelefono!.celdas.length, 2, `la fila debe conservar sus 2 celdas: ${JSON.stringify(filaTelefono)}`);
  assert.ok(filaTelefono!.celdas[1].indiceGlobal != null, 'la celda vacía debe conservar su indiceGlobal para poder rellenarse');
});

// Una tabla que se llena ENTERA (especificaciones técnicas, participantes de una capacitación)
// tiene todas sus filas en blanco: la etiqueta sale del nombre de columna. Antes se descartaba la
// fila completa y esas cajas salían sin una sola casilla. Pero como la etiqueta es solo la columna,
// esas celdas NO pueden autocompletarse: la columna "RUT" de una tabla de asistentes no es el RUT
// de la empresa — sin esta marca, el RUT se escribía en las 8 filas de participantes.
test('filas en blanco: dan casilla con el nombre de columna, pero nunca se autocompletan', () => {
  const xml = NS + tabla(
    fila('Nombre', 'RUT', 'Cargo/Profesión'),
    fila('', '', ''),
    fila('', '', ''),
  ) + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const a = analizarAnexo(norm);
  const rut = a.candidatosCelda.filter(c => c.etiqueta === 'RUT');
  assert.equal(rut.length, 2, `una casilla de RUT por fila de datos: ${JSON.stringify(a.candidatosCelda.map(c => c.etiqueta))}`);
  for (const c of rut) {
    assert.ok(a.indicesSoloManual.has(c.indice), 'la columna RUT de una tabla de asistentes no puede autocompletarse');
  }
});

// Una tabla de datos REAL (encabezado con todas las columnas nombradas) tiene que seguir usando el
// nombre de columna — es lo que hace legible un anexo económico de 160 blancos.
test('tabla de datos con encabezado real sigue etiquetando por columna', () => {
  const xml = NS + tabla(
    fila('ÍTEM', 'BIEN O SERVICIO', 'CANT.', 'VALOR UNITARIO'),
    fila('1', '', '', ''),
  ) + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const etiquetas = analizarAnexo(norm).candidatosCelda.map(c => c.etiqueta);
  assert.ok(etiquetas.some(e => e.includes('BIEN O SERVICIO')), `debe usar el nombre de columna: ${JSON.stringify(etiquetas)}`);
});

// BUG REAL (1426039-8-LE26, 10-ago-2026, ANEXO N°6): la celda de VALOR de una fila de tabla trae
// DOS párrafos vacíos (una línea de más que deja Word) en vez de uno. El patrón de tabla se queda
// con el segundo (mejor contexto: "Banco — INFORMACIÓN"), pero el patrón 1 —que solo mira "la
// etiqueta y el párrafo QUE LE SIGUE si está vacío"— se quedaba con el PRIMERO, un candidato
// DISTINTO y sin contexto de tabla para el MISMO campo visual. Con dos candidatos por el mismo
// dato, uno resolvía bien (el de la tabla) y el otro podía resolver "no aplica" — y en la
// pantalla o el documento final, cuál ganaba dependía de qué índice mirara cada parte del código.
test('celda de valor con un párrafo vacío "de más": no genera un segundo candidato sin contexto (regresión 1426039-8-LE26)', () => {
  const filaConDosVacios = '<w:tr>'
    + celda('Banco')
    + '<w:tc><w:tcPr><w:tcW w:w="1250" w:type="pct"/></w:tcPr><w:p/><w:p/></w:tc>'
    + '</w:tr>';
  const xml = NS + tabla(
    fila('Dato solicitado', 'INFORMACIÓN'),
    filaConDosVacios,
  ) + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const analisis = analizarAnexo(norm);
  const conBanco = analisis.candidatosCelda.filter(c => /Banco/i.test(c.etiqueta));
  assert.equal(conBanco.length, 1, `debe haber UN solo candidato para "Banco", no uno por cada párrafo vacío: ${JSON.stringify(conBanco)}`);
  assert.ok(conBanco[0].etiqueta.includes('INFORMACIÓN'), `el único candidato debe ser el de la tabla (con contexto de columna): ${JSON.stringify(conBanco[0])}`);
});

// El FORMULARIO N°1-A es el de Unión Temporal de Proveedores; como la empresa postula siempre como
// persona jurídica, esa sección se omite. Sin corte por formulario, "omitir la sección UTP"
// terminaba omitiendo los formularios 2, 3 y 4 completos — de 44 campos del documento sobrevivían
// 17, y el resto se descartaba en silencio.
test('la sección UTP no se come los formularios siguientes (regresión 4291-38-LP26)', () => {
  const xml = NS
    + p('FORMULARIO N°1-A:') + p('IDENTIFICACIÓN OFERENTE UNIÓN TEMPORAL DE PROVEEDORES')
    + p('Nombre Integrante') + p('')
    + p('FORMULARIO N°2.') + p('OFERTA ECONÓMICA.')
    + p('Nombre o Razón Social') + p('')
    + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const parrafos = listarParrafos(norm);
  const secciones = detectarSecciones(parrafos);

  assert.equal(secciones.length, 1);
  assert.equal(secciones[0].tipo, 'UTP');
  const inicioF2 = parrafos.find(x => x.texto.startsWith('FORMULARIO N°2'))!.indice;
  assert.ok(secciones[0].indiceFin < inicioF2,
    `la sección UTP termina en ${secciones[0].indiceFin} y el FORMULARIO N°2 empieza en ${inicioF2}`);

  const etiquetas = analizarAnexo(norm).candidatosCelda.map(c => c.etiqueta);
  assert.ok(etiquetas.some(e => e.includes('Nombre o Razón Social')),
    `el campo del FORMULARIO N°2 debe sobrevivir: ${JSON.stringify(etiquetas)}`);
});

// BUG REAL (6-ago-2026, "ANEXO N°1-A FORMATO IDENTIFICACIÓN UNIÓN TEMPORAL DE PROVEEDORES (SOLO SI
// CORRESPONDE)"): el TÍTULO del propio formulario matchea el regex de sección UTP, así que el
// documento entero quedaba soloManual — incluidos los campos A/B/C ("NOMBRE COMPLETO DEL
// PROPONENTE", "ROL UNICO TRIBUTARIO", "NOMBRE Y RUT DEL REPRESENTANTE LEGAL DEL PROPONENTE"), que
// son los MISMOS datos que cualquier otro anexo de identificación (perfil_empresa/
// perfil_representante_legal). Pedido explícito del usuario: "proponente" es lo mismo que
// "oferente", son los mismos datos, y están en la ficha.
test('sección UTP: los campos sueltos (A/B/C) son del proponente por defecto; la tabla de integrantes no (regla 6-ago-2026)', () => {
  const xml = NS
    + p('ANEXO N° 1 - A')
    + p('FORMATO IDENTIFICACIÓN UNION TEMPORAL DE PROVEEDORES (SOLO SI CORRESPONDE)')
    + p('A. NOMBRE COMPLETO DEL PROPONENTE:') + p('')
    + p('B. ROL UNICO TRIBUTARIO') + p('')
    + p('C. NOMBRE Y RUT DEL REPRESENTANTE LEGAL DEL PROPONENTE:') + p('')
    + p('D. IDENTIFICACION DE MIEMBROS UNION DE PROVEEDORES')
    + tabla(
      fila('Nombre o Razón Social', 'Representante Legal', 'RUT', 'Domicilio', 'Correo Electrónico'),
      fila('', '', '', '', ''),
    )
    + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const analisis = analizarAnexo(norm);
  const etiquetas = analisis.candidatosCelda.map(c => c.etiqueta);

  // A, B y C siguen siendo candidatos Y no quedan marcados soloManual — se autocompletan normal.
  for (const esperada of ['NOMBRE COMPLETO DEL PROPONENTE', 'ROL UNICO TRIBUTARIO', 'NOMBRE Y RUT DEL REPRESENTANTE LEGAL DEL PROPONENTE']) {
    const c = analisis.candidatosCelda.find(x => x.etiqueta.includes(esperada));
    assert.ok(c, `"${esperada}" debe seguir siendo candidato: ${JSON.stringify(etiquetas)}`);
    assert.ok(!analisis.indicesSoloManual.has(c!.indice), `"${esperada}" no debe quedar soloManual (es el proponente mismo)`);
  }

  // La tabla de integrantes SIGUE excluida — su columna no dice "proponente" ni "tercero", pero
  // es una estructura repetida (una fila por integrante): datos de OTRAS empresas que la ficha no
  // tiene.
  const columnaMiembro = analisis.candidatosCelda.find(c => c.etiqueta.includes('Nombre o Razón Social'));
  assert.ok(columnaMiembro, 'la tabla de integrantes debe seguir detectándose (para mostrarla)');
  assert.ok(analisis.indicesSoloManual.has(columnaMiembro!.indice), 'pero queda soloManual — son datos de otra empresa');
});

// "Nombre de la Unión Temporal de Proveedores: ______" es un CAMPO, no el título de una sección.
test('un párrafo con su propio blanco no abre una sección', () => {
  const { xml: norm } = normalizarParaIds(NS + p('Nombre de la Unión Temporal de Proveedores: ___________') + FIN);
  assert.equal(detectarSecciones(listarParrafos(norm)).length, 0);
});

// Bloque de firma real: raya + leyenda. La leyenda NO es la etiqueta del párrafo vacío que le
// sigue (que es espaciado): tomarla como tal estampaba una segunda firma encima del espaciado.
test('la leyenda de una firma no genera un campo fantasma (regresión 3 firmas apiladas)', () => {
  const xml = NS
    + p('____________________________')
    + p('Firma del Oferente o Represente Legal.')
    + p('')
    + p('Antofagasta,________________')
    + p('')
    + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const etiquetas = detectarCandidatosCelda(listarParrafos(norm)).map(c => c.etiqueta);
  assert.equal(etiquetas.filter(e => /Firma del Oferente/i.test(e)).length, 0,
    `la leyenda de firma no es un campo: ${JSON.stringify(etiquetas)}`);
  assert.equal(etiquetas.filter(e => /Antofagasta/i.test(e)).length, 0,
    `un párrafo con su propio blanco tampoco: ${JSON.stringify(etiquetas)}`);

  const analisis = analizarAnexo(norm);
  assert.equal(analisis.lineasFirma.length, 1, 'una sola línea de firma, la de la raya');
});

// El acta de capacitación trae una columna "Firma" para los asistentes y dos bloques de cierre:
// el del proveedor (nuestro) y el de la universidad (ajeno). Estampar la firma escaneada en los
// tres es falso.
test('solo se firma donde la etiqueta dice que la firma es nuestra', () => {
  const xml = NS + tabla(
    fila('Bloque', 'Para uso exclusivo Proveedor Adjudicado', 'Para uso exclusivo Universidad de Antofagasta', 'Otro'),
    fila('Firma:', '', '', ''),
  ) + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const analisis = analizarAnexo(norm);
  const contextos = analisis.lineasFirma.map(f => f.contexto);
  assert.ok(contextos.some(c => /Proveedor Adjudicado/i.test(c)), `debe firmar el bloque del proveedor: ${JSON.stringify(contextos)}`);
  assert.equal(contextos.filter(c => /Universidad/i.test(c)).length, 0,
    `no se firma el bloque ajeno: ${JSON.stringify(contextos)}`);
  // Y la celda ajena tampoco vuelve al flujo de texto, donde se rellenaba con un cargo inventado.
  assert.equal(analisis.candidatosCelda.filter(c => /firma/i.test(c.etiqueta)).length, 0);
});

// BUG REAL (1426039-8-LE26, 10-ago-2026): la leyenda pide TRES cosas ("Nombre, RUT y Firma
// Representante Legal") — antes solo existía pideNombre, así que el RUT que la leyenda pide
// explícito no se detectaba y nunca se escribía en el documento generado (ver anexos-rellenar.ts,
// que ahora lee pideRut para agregar representante_rut como línea aparte bajo la imagen).
test('la leyenda "Nombre, RUT y Firma..." marca pideNombre Y pideRut (regresión 1426039-8-LE26)', () => {
  const xml = NS
    + p('____________________________________')
    + p('Nombre, RUT y Firma Representante Legal')
    + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const analisis = analizarAnexo(norm);
  const linea = analisis.lineasFirma.find(f => /Representante Legal/i.test(f.contexto));
  assert.ok(linea, `no se encontró la línea de firma: ${JSON.stringify(analisis.lineasFirma)}`);
  assert.equal(linea!.pideNombre, true, 'debe pedir nombre');
  assert.equal(linea!.pideRut, true, 'debe pedir RUT');
});

// BUG REAL (1426039-8-LE26, 10-ago-2026): en esta plantilla la "línea" no es texto ni un borde de
// PÁRRAFO — es el borde SUPERIOR de la CELDA de tabla donde vive la leyenda misma, heredado del
// borde general de la tabla (la celda de al lado anula sus 4 bordes; la de la leyenda solo anula
// izquierda/abajo/derecha, así que el de arriba queda visible). Sin reconocer esto, la firma
// terminaba en la fila de ABAJO (una celda vacía separada, pensada como relleno), lejos de la
// línea real — con este fix se estampa en la MISMA celda de la leyenda, justo debajo del borde.
test('línea de firma = borde superior de celda de tabla (no texto, no borde de párrafo) (regresión 1426039-8-LE26)', () => {
  const xml = NS + '<w:tbl><w:tblPr><w:tblBorders>'
    + '<w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/>'
    + '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/>'
    + '</w:tblBorders></w:tblPr>'
    + '<w:tr>'
    + '<w:tc><w:tcPr><w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders></w:tcPr><w:p/></w:tc>'
    + '<w:tc><w:tcPr><w:tcBorders><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders></w:tcPr>'
    + p('Nombre, RUT y Firma Representante Legal') + '</w:tc>'
    + '</w:tr>'
    + '<w:tr><w:tc><w:tcPr><w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders></w:tcPr><w:p/></w:tc></w:tr>'
    + '</w:tbl>' + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const analisis = analizarAnexo(norm);
  const linea = analisis.lineasFirma.find(f => /Representante Legal/i.test(f.contexto));
  assert.ok(linea, `no se encontró la línea de firma: ${JSON.stringify(analisis.lineasFirma)}`);
  assert.equal(linea!.contexto, 'Nombre, RUT y Firma Representante Legal');
  assert.equal(linea!.sinRaya, true, 'se estampa DENTRO de la celda de la leyenda, sin raya que limpiar');
  assert.equal(linea!.paraIdLeyenda, undefined, 'la leyenda y el lugar de la firma son EL MISMO párrafo');
});

// El motor 100% IA (anexos-ia-motor.ts) reemplazó el diccionario, pero el guardarraíl
// anti-invención sigue siendo obligatorio: la IA elige el valor y, ante la duda, puede
// "mejorarlo" o inventar uno parecido — regresión real (diseño anterior): a "CIUDAD" le asignó
// el correo de pagos y el anexo salía con un email escrito en la casilla de la ciudad. Ahora la
// condición es más simple y más dura: el valor propuesto tiene que existir LITERAL en la ficha
// (normalizado), sea cual sea el campo — si no existe, se descarta sin importar qué tan
// plausible suene la etiqueta.
test('valorExisteEnFicha descarta valores inventados por la IA (regresión CIUDAD → banco_email)', () => {
  const empresa: EmpresaCampos = {
    razon_social: 'Inversiones Claro ARZ SPA', rut: '76.902.659-2', direccion: 'Barros Arana N°492',
    region: 'Región del Bío Bío', giro: 'Venta de Maquinaria', tipo_persona_juridica: 'SpA',
    fecha_sociedad: null, fecha_escritura: null, notaria: null, numero_repertorio: null, fojas_numero_anio: null,
    representante_nombre: 'Santiago López', representante_rut: '15.875.453-3', representante_cargo: 'Ingeniero',
    email1: 'ventas@grupoica.cl', telefono1: '+569 3146 2445',
    banco_tipo_cuenta: 'Cuenta corriente', banco_numero: '921197332', banco_nombre: 'Banco Security',
    banco_email: 'pagos@grupoica.cl', banco_titular_nombre: null, banco_titular_rut: null, firma_url: null, timbre_url: null,
  };
  // Inventado / de otro dominio por completo: no existe en ningún campo de la ficha.
  assert.equal(valorExisteEnFicha('Concepción', empresa), false);
  assert.equal(valorExisteEnFicha('Chile', empresa), false);
  // …sin bloquear los valores que SÍ son reales, aunque vengan con distinta puntuación/mayúsculas.
  assert.equal(valorExisteEnFicha('ventas@grupoica.cl', empresa), true);
  assert.equal(valorExisteEnFicha('76902659-2', empresa), true);
  assert.equal(valorExisteEnFicha('SANTIAGO LOPEZ', empresa), true);
});

// "Nombre o Razón Social       :" y "RUT:" del FORMULARIO N°2 son párrafos sueltos sin celda ni
// subrayado: el valor va escrito a continuación, en la misma línea.
test('campo "Etiqueta:" con el valor en la misma línea (regresión FORMULARIO N°2)', () => {
  const xml = NS + p('Nombre o Razón Social               :') + p('RUT:') + p('otra cosa') + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const etiquetas = analizarAnexo(norm).camposConDosPuntos.map(c => c.etiqueta);
  assert.deepEqual(etiquetas, ['Nombre o Razón Social', 'RUT']);

  const objetivo = analizarAnexo(norm).camposConDosPuntos[1];
  const relleno = rellenarFinDeParrafo(norm, objetivo.paraId, '78.388.175-6');
  assert.match(relleno, /RUT:<\/w:t><\/w:r><w:r>[\s\S]*?78\.388\.175-6/,
    'el valor se agrega al final del MISMO párrafo');
  assert.equal((relleno.match(/<w:p\b/g) || []).length, (norm.match(/<w:p\b/g) || []).length,
    'nunca cambia el conteo de párrafos');
});

// BUG REAL (1057472-89-LE26, ANEXO N°1): "CONTACTO DEL PROPONENTE:" es el título de la fila que
// abre ese bloque dentro de la tabla de identificación (1 sola celda mergeada, igual que "DATOS
// DEL PROPONENTE:" y "REPRESENTANTE LEGAL:" que comparten la misma tabla) — terminaba tomado como
// candidato del patrón 5 ("Etiqueta:" con el valor en la misma línea) y la IA le pegaba el nombre
// del contacto al final del TÍTULO de la sección, en vez de dejarlo intacto.
test('el título de una fila de tabla mergeada nunca es candidato del patrón "Etiqueta:" (regresión 1057472-89-LE26)', () => {
  const xml = NS + tabla(
    fila('CONTACTO DEL PROPONENTE:'),
    fila('Nombre completo', ''),
    fila('Cargo o función', ''),
  ) + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const etiquetas = analizarAnexo(norm).camposConDosPuntos.map(c => c.etiqueta);
  assert.equal(etiquetas.includes('CONTACTO DEL PROPONENTE'), false,
    `el título de la fila no debe ofrecerse como campo suelto: ${JSON.stringify(etiquetas)}`);
});

// BUG REAL (1426039-8-LE26, 10-ago-2026, ANEXO N°5): "NOMBRE O RAZÓN SOCIAL: " y "R.U.T: " venían
// cada una en su PROPIA fila de tabla de 1 sola celda (una tabla de una sola columna, sin ninguna
// fila de 2+ celdas al lado) — la regla de arriba, pensada para un título REDUNDANTE con datos
// reales en las filas siguientes, las descartaba igual aunque acá cada fila de 1 celda ES el
// campo completo (el valor se escribe pegado al final, "NOMBRE O RAZÓN SOCIAL: Inversiones..."),
// sin ninguna fila de repuesto que las vuelva innecesarias. Nombre y RUT — los dos datos más
// básicos que hay — desaparecían sin dejar ni una casilla, ni auto ni pendiente.
test('tabla de una sola columna: cada fila de 1 celda ES un campo, no un título (regresión 1426039-8-LE26)', () => {
  const xml = NS + tabla(
    fila('NOMBRE O RAZÓN SOCIAL:'),
    fila('R.U.T:'),
  ) + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const etiquetas = analizarAnexo(norm).camposConDosPuntos.map(c => c.etiqueta);
  assert.ok(etiquetas.includes('NOMBRE O RAZÓN SOCIAL'), `falta razón social: ${JSON.stringify(etiquetas)}`);
  assert.ok(etiquetas.includes('R.U.T'), `falta RUT: ${JSON.stringify(etiquetas)}`);
});

// BUG REAL (1057472-89-LE26, ANEXO N°2): "El proponente que suscribe, declara lo siguiente:" va
// seguido de un párrafo vacío de espaciado y luego la lista de declaraciones (a, b, c...) con
// numeración AUTOMÁTICA de Word (<w:numPr> — el "a)" nunca es texto literal en el XML). El patrón 1
// tomaba el espaciado por un blanco a llenar y la casilla quedaba pendiente con un motivo inventado
// por la IA, cuando en realidad no hay ningún dato que pedir ahí.
test('"Etiqueta:" antes de una lista numerada de Word no es un campo (regresión 1057472-89-LE26 ANEXO N°2)', () => {
  const xml = NS
    + p('El proponente que suscribe, declara lo siguiente:')
    + '<w:p/>'
    + '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Haber estudiado las bases.</w:t></w:r></w:p>'
    + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const etiquetas = analizarAnexo(norm).candidatosCelda.map(c => c.etiqueta);
  assert.equal(etiquetas.some(e => e.includes('declara lo siguiente')), false,
    `el enunciado antes de una lista numerada no debe ofrecerse como campo: ${JSON.stringify(etiquetas)}`);
});

// BUG REAL (1057472-89-LE26, ANEXO N°4, "ESPECIFICACIONES TÉCNICAS"): la fila que abre cada ítem
// trae Nº + descripción en celdas normales MÁS una celda combinada (gridSpan) con el rótulo
// "Requisitos excluyentes:" — sus celdas SÍ tienen texto, así que se tomaba por el encabezado real
// (en vez de la fila 0, con los 6 nombres de columna). Con ese encabezado falso de 3 columnas, cada
// fila de requisito (con sus 6 celdas reales, 3 vacías: Cumple/Catálogo/Observaciones) se colapsaba
// contra solo 3 columnas y esas 3 casillas quedaban sin input — exactamente lo que no dejaba
// rellenar al usuario.
test('fila de ítem con celda combinada (gridSpan) no es el encabezado (regresión 1057472-89-LE26 ANEXO N°4)', () => {
  const celdaCombinada = (texto: string, span: number) =>
    `<w:tc><w:tcPr><w:gridSpan w:val="${span}"/></w:tcPr>${p(texto)}</w:tc>`;
  const xml = NS + tabla(
    fila('ÍTEM', 'DESCRIPCIÓN PRODUCTO', 'ESPECIFICACIONES TÉCNICAS', 'Cumple (Sí/No)', 'Catálogo', 'Observaciones'),
    `<w:tr>${celda('1')}${celda('Butacas clínicas')}${celdaCombinada('Requisitos excluyentes:', 4)}</w:tr>`,
    fila('', '', '1.Ofrece butacas con ruedas', '', '', ''),
  ) + FIN;
  const { xml: norm } = normalizarParaIds(xml);

  const tablas = extraerTablasCrudo(norm);
  const tablaSpecs = tablas.find(t => t.filas[0]?.celdas[0]?.texto === 'ÍTEM');
  assert.ok(tablaSpecs, 'no se encontró la tabla de especificaciones');
  const filaRequisito = tablaSpecs!.filas.find(f => f.celdas.some(c => c.texto.includes('Ofrece butacas')));
  assert.ok(filaRequisito, `no se encontró la fila del requisito: ${JSON.stringify(tablaSpecs!.filas)}`);
  assert.equal(filaRequisito!.celdas.length, 6,
    `la fila debe conservar sus 6 columnas, no colapsarse: ${JSON.stringify(filaRequisito)}`);
  // Cumple / Catálogo / Observaciones (columnas 3, 4 y 5) deben seguir siendo celdas vacías con su
  // propio indiceGlobal — es decir, casillas que el usuario SÍ puede rellenar.
  for (const col of [3, 4, 5]) {
    assert.ok(filaRequisito!.celdas[col].indiceGlobal != null,
      `columna ${col} (Cumple/Catálogo/Observaciones) debe quedar como casilla vacía rellenable: ${JSON.stringify(filaRequisito!.celdas[col])}`);
  }

  const etiquetas = detectarCandidatosTabla(norm).map(c => c.etiqueta);
  for (const esperada of ['Cumple (Sí/No)', 'Catálogo', 'Observaciones']) {
    assert.ok(etiquetas.some(e => e.includes(esperada)), `falta candidato para "${esperada}": ${JSON.stringify(etiquetas)}`);
  }
});

// BUG REAL (2908-16-LE26, 10-ago-2026): la tabla de identificación del oferente más común que
// existe usa gridSpan para repartir el ANCHO entre dos columnas REALES ("NOMBRE O RAZÓN SOCIAL DEL
// OFERENTE" | "RUT EMPRESA"), cada una fusionando varias columnas de la grilla — DISTINTO del
// gridSpan del test de arriba (una celda-cajón que fusiona VARIAS columnas conceptuales en una
// sola, "Requisitos excluyentes:"). Con la regla vieja ("cualquier gridSpan → nunca encabezado"),
// la tabla entera se descartaba y caía al patrón 1 (celda simple: etiqueta + el ÚNICO párrafo
// vacío siguiente) — como las DOS etiquetas viven en la MISMA fila, "NOMBRE..." nunca se
// emparejaba con nada (su "siguiente" párrafo es "RUT EMPRESA", que no está vacío) y "RUT EMPRESA"
// terminaba emparejado con la celda vacía que en realidad estaba bajo "NOMBRE...". Razón social se
// perdía sin ni siquiera quedar pendiente; RUT se escribía en la celda equivocada.
test('tabla de identificación con encabezado ancho por gridSpan: se detecta y se autocompleta (regresión 2908-16-LE26)', () => {
  const celdaAncha = (texto: string, span: number) =>
    `<w:tc><w:tcPr><w:gridSpan w:val="${span}"/></w:tcPr>${p(texto)}</w:tc>`;
  const xml = NS + tabla(
    `<w:tr>${celdaAncha('NOMBRE O RAZÓN SOCIAL DEL OFERENTE', 5)}${celdaAncha('RUT EMPRESA', 2)}</w:tr>`,
    `<w:tr>${celdaAncha('', 5)}${celdaAncha('', 2)}</w:tr>`,
  ) + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const a = analizarAnexo(norm);
  const etiquetas = a.candidatosCelda.map(c => c.etiqueta);
  assert.ok(etiquetas.includes('NOMBRE O RAZÓN SOCIAL DEL OFERENTE'), `falta razón social: ${JSON.stringify(etiquetas)}`);
  assert.ok(etiquetas.includes('RUT EMPRESA'), `falta RUT: ${JSON.stringify(etiquetas)}`);
  for (const c of a.candidatosCelda.filter(c => etiquetas.includes(c.etiqueta))) {
    assert.ok(!a.indicesSoloManual.has(c.indice),
      `una tabla de UNA sola fila de datos (identificación propia, no una lista de terceros) sí debe poder autocompletarse: ${c.etiqueta}`);
  }
});

// Misma forma (gridSpan de ancho) pero con VARIAS filas de datos: sigue siendo una LISTA de
// entidades desconocidas (no la identificación de una sola), así que sigue solo manual — el fix de
// arriba no debe reabrir el bug original (RUT de la tabla de asistentes rellenado con el nuestro).
test('tabla con gridSpan de ancho pero VARIAS filas de datos: sigue solo manual (no es un formulario de una sola entidad)', () => {
  const celdaAncha = (texto: string, span: number) =>
    `<w:tc><w:tcPr><w:gridSpan w:val="${span}"/></w:tcPr>${p(texto)}</w:tc>`;
  const xml = NS + tabla(
    `<w:tr>${celdaAncha('Nombre', 5)}${celdaAncha('RUT', 2)}</w:tr>`,
    `<w:tr>${celdaAncha('', 5)}${celdaAncha('', 2)}</w:tr>`,
    `<w:tr>${celdaAncha('', 5)}${celdaAncha('', 2)}</w:tr>`,
  ) + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const a = analizarAnexo(norm);
  const rut = a.candidatosCelda.filter(c => c.etiqueta === 'RUT');
  assert.equal(rut.length, 2, `una casilla de RUT por fila de datos: ${JSON.stringify(a.candidatosCelda.map(c => c.etiqueta))}`);
  for (const c of rut) {
    assert.ok(a.indicesSoloManual.has(c.indice), 'una LISTA de varias filas (varias entidades) nunca se autocompleta sola, tenga o no gridSpan');
  }
});

// ── Anexo de OFERTA ECONÓMICA: la fila la nombra su producto, no su celda más larga ──────────
// REGRESIÓN 539119-76-LP26 ("los anexos donde hay que poner precio no los detecta"): en el ANEXO
// N°3, la fila "5 | MASA DE PIZZA | 1 BOLSA CON 2 UNIDADES | ___" se etiquetaba con la UNIDAD DE
// MEDIDA porque ese texto es más largo que el nombre del producto. Esa etiqueta es la que después
// se cruza contra el costeo, así que la fila perdía su precio: "MASA DE PIZZA" está en el costeo,
// "1 BOLSA CON 2 UNIDADES" no.
test('la etiqueta de una fila de precios sale de la columna descriptiva, no de la más larga', () => {
  const xml = NS + tabla(
    fila('N°', 'PRODUCTOS', 'UNIDAD DE MEDIDA', 'VALOR UNITARIO OFERTADO NETO'),
    fila('1', 'EMPANADA PINO', 'UNIDAD', ''),
    fila('5', 'MASA DE PIZZA', '1 BOLSA CON 2 UNIDADES', ''),
  ) + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const etiquetas = detectarCandidatosTabla(norm).map(c => c.etiqueta);

  assert.ok(etiquetas.includes('MASA DE PIZZA — VALOR UNITARIO OFERTADO NETO'),
    `la fila debe nombrarse por el producto: ${JSON.stringify(etiquetas)}`);
  assert.ok(etiquetas.includes('EMPANADA PINO — VALOR UNITARIO OFERTADO NETO'),
    `la fila con unidad corta tampoco debe cambiar: ${JSON.stringify(etiquetas)}`);
});

// Segunda mitad del mismo bug: aunque la etiqueta sea correcta, el cruce con el costeo solo se
// intentaba si la columna se llamaba EXACTAMENTE "precio unitario" / "valor unitario" / "monto
// unitario". El anexo real dice "VALOR UNITARIO OFERTADO NETO" y quedaba fuera, así que
// matchearPreciosConIA cortaba en la primera línea con cero candidatos.
test('esCandidatoDePrecioUnitario reconoce los encabezados reales y sigue excluyendo los totales', () => {
  for (const columna of [
    'VALOR UNITARIO OFERTADO NETO',   // 539119-76-LP26 ANEXO N°3 línea 2
    'PRECIO NETO',                    // 539119-76-LP26 ANEXO N°3 línea 1
    'Precio unitario',
    'PRECIO UNITARIO NETO',
    'Monto unitario (sin IVA)',
    'Valor Unitario',
    'PRECIO',
  ]) {
    assert.equal(esCandidatoDePrecioUnitario(`EMPANADA PINO — ${columna}`), true, `debería aceptar "${columna}"`);
  }

  // La columna TOTAL nunca se autocompleta (la cantidad del Word no tiene por qué ser la del
  // costeo), y una columna que no habla de plata tampoco entra. Los casos con "unitario" Y "total"
  // (o "con IVA") son los que importan: solo se rechazan si la exclusión funciona de verdad — sin
  // ellos el test pasaba igual por el camino del encabezado neutro, y así se coló el bug del
  // cuantificador (`totales?` = "totale"+"s"?, que nunca calzó con "total").
  for (const columna of [
    'PRECIO TOTAL', 'VALOR TOTAL', 'TOTAL NETO', 'MONTO TOTAL OFERTADO', 'SUBTOTAL',
    'CANTIDAD', 'UNIDAD DE MEDIDA', 'PLAZO DE ENTREGA', 'IVA 19%',
    // Todos estos existen tal cual en los anexos ya descargados:
    'Precio Unitario Total (Neto )',                                   // dice unitario Y total
    'Valor Unitario (Impuestos incluidos)',                            // unitario pero CON impuestos
    'VALOR UNITARIO CON IVA $',                                        // idem
    'Precio unitario BRUTO (Precio unitario neto + IVA)',              // el costeo entrega NETOS
    'Valor bruto',
    'PRECIO MÁXIMO DISPONIBLE (INCLUYE IMPUESTOS Y FLETE) POR UNIDAD', // presupuesto del organismo
  ]) {
    assert.equal(esCandidatoDePrecioUnitario(`EMPANADA PINO — ${columna}`), false, `NO debería aceptar "${columna}"`);
  }

  // Y estos SÍ, sacados del mismo corpus.
  for (const columna of ['Costo Unitario Neto', 'Valor Neto precio unitario ($) (*)', 'Valor Unitario (Sin IVA)', 'Precio Unitario Neto (CLP)']) {
    assert.equal(esCandidatoDePrecioUnitario(`EMPANADA PINO — ${columna}`), true, `debería aceptar "${columna}"`);
  }

  // Sin la forma "<ítem> — <columna>" no hay tabla de precios que cruzar.
  assert.equal(esCandidatoDePrecioUnitario('PRECIO UNITARIO'), false);
});

// ── TOTAL NETO / IVA / TOTAL IVA INCLUIDO al pie de la tabla de precios (539119-76-LP26) ─────
// Con los precios ya puestos desde el costeo, estas tres casillas quedaban vacías y había que
// sumar 33 números a mano. El costeo no trae estos totales: se calculan de la propia columna.
test('totales al pie: suma la columna, aplica el IVA que declara la fila y cuadra a la vista', () => {
  const xml = NS + tabla(
    fila('N°', 'PRODUCTOS', 'UNIDAD DE MEDIDA', 'VALOR UNITARIO OFERTADO NETO'),
    fila('1', 'EMPANADA PINO', 'UNIDAD', ''),
    fila('2', 'MASA DE PIZZA', '1 BOLSA', ''),
    fila('TOTAL NETO', '', '', ''),
    fila('IVA 19%', '', '', ''),
    fila('TOTAL IVA INCLUIDO', '', '', ''),
  ) + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const tablas = extraerTablasCrudo(norm);
  // Los índices de las dos celdas de precio, en orden de aparición.
  const preciosIdx = tablas[0].filas.slice(1, 3).map(f => f.celdas[3].indiceGlobal!);
  const valores = new Map([[preciosIdx[0], 3941], [preciosIdx[1], 6531]]);

  const rellenos = calcularTotalesAlPie(tablas, i => valores.get(i) ?? null);
  const porRotulo = new Map(rellenos.map(r => [r.etiqueta.trim(), r.valor]));
  assert.equal(porRotulo.get('TOTAL NETO'), '10.472', JSON.stringify([...porRotulo]));
  assert.equal(porRotulo.get('IVA 19%'), '1.990');
  // 10.472 + 1.990 = 12.462 exacto: el papel tiene que cuadrar con las dos líneas de arriba.
  assert.equal(porRotulo.get('TOTAL IVA INCLUIDO'), '12.462');

  // Regla dura: si UN ítem quedó sin precio, no se escribe NINGÚN total de esa tabla.
  const incompleto = calcularTotalesAlPie(tablas, i => (i === preciosIdx[0] ? 3941 : null));
  assert.deepEqual(incompleto, [], `con un ítem sin precio no se escribe nada: ${JSON.stringify(incompleto)}`);
});

// "Total" es una MARCA de herramientas muy usada en Chile: filas de ítem reales dicen "marca
// equivalente a: Total" (3825-20-LE26, 2322-27-LE26, 2735-55-LE26). Tomarlas por fila de pie las
// dejaba fuera de la suma Y les escribía el total encima de su precio.
test('totales al pie: una fila de ítem que menciona la marca "Total" no es el pie de la tabla', () => {
  const xml = NS + tabla(
    fila('N°', 'DESCRIPCIÓN', 'CANTIDAD', 'PRECIO UNITARIO'),
    fila('1', 'SIERRA CALADORA, 570w, marca equivalente a: Total', '2', ''),
    fila('2', 'HUINCHA DE MEDIR 10M. Marca equivalente a TOTAL', '10', ''),
    fila('TOTAL NETO', '', '', ''),
  ) + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const tablas = extraerTablasCrudo(norm);
  const idx = tablas[0].filas.slice(1, 3).map(f => f.celdas[3].indiceGlobal!);
  const valores = new Map([[idx[0], 50_000], [idx[1], 3_000]]);

  const rellenos = calcularTotalesAlPie(tablas, i => valores.get(i) ?? null);
  assert.equal(rellenos.length, 1, `solo la fila TOTAL NETO es pie: ${JSON.stringify(rellenos)}`);
  assert.equal(rellenos[0].etiqueta.trim(), 'TOTAL NETO');
  // Y las dos sierras/huinchas entraron a la suma con su cantidad: 2×50.000 + 10×3.000 = 130.000.
  assert.equal(rellenos[0].valor, '130.000');
});

// Una fila de pie con TRES casillas vacías (neto | IVA | total en la misma fila) es ambigua: no
// hay forma de saber cuál es cuál, y adivinar escribe un número donde no va.
test('totales al pie: fila de pie con más de una casilla vacía se deja al humano', () => {
  const xml = NS + tabla(
    fila('N°', 'PRODUCTO', 'PRECIO NETO'),
    fila('1', 'PAN AMASADO', ''),
    fila('Total Neto IVA Total con IVA', '', ''),
  ) + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const tablas = extraerTablasCrudo(norm);
  const idx = tablas[0].filas[1].celdas[2].indiceGlobal!;
  assert.deepEqual(calcularTotalesAlPie(tablas, i => (i === idx ? 1689 : null)), []);
});

// Los rótulos de acá salieron de auditar los 300 anexos .docx ya descargados — no son inventados.
test('pareceFilaDePie: rótulos reales del corpus, a favor y en contra', () => {
  const c = (texto: string) => ({ texto, indiceGlobal: null, anchoPct: null, ultimoParaId: null, indicesParrafos: [] }) as any;

  for (const rotulo of [
    'TOTAL NETO', 'IVA 19%', 'TOTAL IVA INCLUIDO', 'IMPUESTO AL VALOR AGREGADO 19%',
    'Total Valor Neto (*)', 'TOTAL IVA INC.', 'VALOR NETO TOTAL (*) $', 'VALOR TOTAL (**) $',
    'Total a ofertar $', 'TOTAL C/IVA $', 'VALOR TOTAL, IMPUESTOS INCLUIDOS $',
    'TOTAL NETO DE LA CONTRATACIÓN', 'I.V.A (19%) $ ___________ .-',
    'SUMATORIA TOTAL NETA (ÍTEM I + ÍTEM II) $ ___________ .-',
  ]) {
    assert.equal(pareceFilaDePie([c(rotulo)], rotulo), true, `debería ser pie de tabla: "${rotulo}"`);
  }

  for (const rotulo of [
    // "Total" es marca de herramientas: estas son filas de ÍTEM, no el pie.
    '2 UNIDAD Se solicita SIERRA CALADORA, 570w, marca equivalente a: Total',
    'HUINCHA DE MEDIR, 10MX25MM. Marca equivalente a TOTAL',
    '18 LLAVES ALLEN Y TORX TOTAL, CROMO VANADIO 01 SET',
    // Este pide el total escrito EN PALABRAS: el número ahí sería incorrecto.
    'Valor Total de la Oferta IVA incluido (en Palabras):',
    // Un IVA condicional lo decide un humano (puede facturar exento).
    'IVA (si aplicará)',
    'Impuesto (19%) (en caso de facturación exenta, dejar en blanco) $',
  ]) {
    assert.equal(pareceFilaDePie([c(rotulo)], rotulo), false, `NO debería ser pie de tabla: "${rotulo}"`);
  }
});

test('totales al pie: sin porcentaje declarado el IVA no se inventa', () => {
  const xml = NS + tabla(
    fila('N°', 'PRODUCTO', 'PRECIO NETO'),
    fila('1', 'PAN AMASADO', ''),
    fila('IVA', '', ''),
    fila('TOTAL', '', ''),
  ) + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const tablas = extraerTablasCrudo(norm);
  const idx = tablas[0].filas[1].celdas[2].indiceGlobal!;
  const rellenos = calcularTotalesAlPie(tablas, i => (i === idx ? 1689 : null));
  const rotulos = rellenos.map(r => r.etiqueta.trim());

  assert.ok(rotulos.includes('TOTAL'), `el neto sí se calcula: ${JSON.stringify(rellenos)}`);
  assert.ok(!rotulos.includes('IVA'), `sin "%" en ninguna fila, el IVA queda pendiente: ${JSON.stringify(rellenos)}`);
});

// ── Patrón 2b: marcadores de relleno (1057480-41-LP26, Hospital San José de Melipilla) ────────
// Sus 11 anexos casi no usan "____": usan "<<NOMBRE …>>", "[Insertar RUT]" y líneas de puntos. Sin
// esto, 5 de los 11 entraban al motor con CERO casillas y salían idénticos al original.
test('marcadores <<…>> / […] / línea de puntos se detectan como blancos', () => {
  const xml = NS
    // El marcador PARTIDO entre runs, tal cual lo dejó Word en el anexo 3 real: sin
    // unificarRunsDeMarcadores ningún patrón lo ve (vive a caballo entre dos <w:t>).
    + '<w:p><w:r><w:t xml:space="preserve">Por la presente, el Oferente, </w:t></w:r>'
    + '<w:r><w:t xml:space="preserve">&lt;&lt;NOMBRE PERSONA NATURAL O PERSONA JURIDICA</w:t></w:r>'
    + '<w:r><w:t xml:space="preserve">&gt;&gt;, declara bajo juramento:</w:t></w:r></w:p>'
    + p('NOMBRE DEL OFERENTE: [Insertar Nombre o Razón Social]')
    + p('Yo, ...........................RUT N°..........................., declaro:')
    + p('Nota al pie [1] y una referencia [2-4] no son casillas.')
    + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const a = analizarAnexo(unificarRunsDeMarcadores(norm));
  const marcadores = a.blancosInline.filter(b => b.textoMarcador).map(b => b.textoMarcador);
  assert.deepEqual(marcadores, ['NOMBRE PERSONA NATURAL O PERSONA JURIDICA', 'Insertar Nombre o Razón Social'],
    `marcadores detectados: ${JSON.stringify(marcadores)}`);
  assert.equal(a.blancosInline.filter(b => !b.textoMarcador).length, 2, 'las dos líneas de puntos del "Yo, …"');
});

// BUG REAL (10-ago-2026): una declaración jurada corrida usa PARÉNTESIS en vez de "[...]" para
// decir qué va en cada casilla — "Yo (nombre), cédula de identidad Nº (RUT), en mi calidad de
// adjudicatario o representante legal del adjudicatario, (razón social empresa), RUT N° (RUT
// empresa), con domicilio en (domicilio), (comuna), (ciudad), declaro bajo juramento que:". Antes
// la frase ENTERA (7 marcadores) era invisible — cero blancos, ni auto ni pendiente.
test('marcadores entre paréntesis: "(nombre)"/"(RUT)"/"(razón social empresa)" se detectan (regresión declaración jurada corrida)', () => {
  const xml = NS + p('Yo (nombre), cédula de identidad Nº (RUT), en mi calidad de adjudicatario o '
    + 'representante legal del adjudicatario, (razón social empresa), RUT N° (RUT empresa), con '
    + 'domicilio en (domicilio), (comuna), (ciudad), declaro bajo juramento que:') + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const a = analizarAnexo(unificarRunsDeMarcadores(norm));
  const marcadores = a.blancosInline.map(b => b.textoMarcador);
  assert.deepEqual(marcadores, ['nombre', 'RUT', 'razón social empresa', 'RUT empresa', 'domicilio', 'comuna', 'ciudad'],
    `marcadores detectados: ${JSON.stringify(marcadores)}`);
});

// El paréntesis es MUY común en prosa legal chilena para incisos que NO son casillas a llenar —
// a diferencia de "[...]"/"<<...>>" (raros ahí), blanket-matching cualquier "(...)" inundaría el
// documento de falsos positivos. Ninguna de estas frases reales debe generar un solo marcador.
test('marcadores entre paréntesis: incisos legales normales NO se confunden con casillas', () => {
  const frasesReales = [
    'de acuerdo a la Ley N° 19.886 (en adelante, "la Ley de Compras")',
    'el oferente (en adelante "el Proponente")',
    'el valor total (IVA incluido) asciende a $500.000',
    'según lo dispuesto en las letras a), b) y c) del artículo 4°',
    'remitido por correo certificado a la dirección indicada',
    'el documento (Resolución Exenta N°251) aprueba las bases',
    'la garantía (Boleta Bancaria) debe presentarse antes de la apertura',
  ];
  for (const frase of frasesReales) {
    const xml = NS + p(frase) + FIN;
    const { xml: norm } = normalizarParaIds(xml);
    const a = analizarAnexo(unificarRunsDeMarcadores(norm));
    assert.equal(a.blancosInline.length, 0, `"${frase}" no debería generar ningún marcador: ${JSON.stringify(a.blancosInline)}`);
  }
});

// Escritura: el marcador se reemplaza ENTERO (no queda medio ">>" suelto), el texto no se
// doble-escapa y el conteo de párrafos no se mueve.
test('rellenar un marcador lo reemplaza entero y deja el XML sano', () => {
  const xml = NS
    + '<w:p><w:r><w:t xml:space="preserve">El Oferente, </w:t></w:r>'
    + '<w:r><w:t xml:space="preserve">&lt;&lt;NOMBRE PERSONA JURIDICA</w:t></w:r>'
    + '<w:r><w:t xml:space="preserve">&gt;&gt;, con giro &amp; comercio, declara.</w:t></w:r></w:p>'
    + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  let final = unificarRunsDeMarcadores(norm);
  const b = analizarAnexo(final).blancosInline[0];
  final = rellenarRunPorIndice(final, b.indiceRun, [{ pos: b.posEnTexto, largo: b.largo, valor: 'Inversiones Claro ARZ SPA' }]);
  assert.equal(listarParrafos(final)[0].texto, 'El Oferente, Inversiones Claro ARZ SPA, con giro & comercio, declara.');
  assert.equal(verificarParrafos(norm, final).parrafosIguales, true);
  assert.equal(verificarXmlBienFormado(final).valido, true);
});

// Firma sin raya de guiones: el espacio para firmar son párrafos vacíos y abajo la leyenda. Y la
// leyenda del EVALUADOR (que llena el organismo al evaluar) nunca recibe nuestra firma.
test('firma: leyenda sin raya sí se firma, la del evaluador no', () => {
  const conLeyenda = (leyenda: string) => p('texto previo') + p('') + p('') + p(leyenda) + p('(OFERENTE)');
  const nuestra = analizarAnexo(normalizarParaIds(NS + conLeyenda('FIRMA Y TIMBRE REPRESENTANTE LEGAL') + FIN).xml);
  assert.equal(nuestra.lineasFirma.length, 1, 'la leyenda del oferente se firma aunque no haya raya');
  assert.equal(nuestra.lineasFirma[0].pideTimbre, true, 'la leyenda dice "Y TIMBRE"');

  const ajena = analizarAnexo(normalizarParaIds(NS + conLeyenda('FIRMA Y TIMBRE EVALUADOR') + FIN).xml);
  assert.equal(ajena.lineasFirma.length, 0, 'la firma del evaluador es del organismo, no nuestra');

  // Misma regla para el patrón viejo (raya + leyenda debajo), que antes NO filtraba por dueño.
  const conRaya = analizarAnexo(normalizarParaIds(NS + p('_'.repeat(40)) + p('FIRMA Y TIMBRE EVALUADOR') + FIN).xml);
  assert.equal(conRaya.lineasFirma.length, 0, 'una raya bajo la leyenda del evaluador tampoco se firma');
});

// BUG REAL (4928-14-LP26, Carabineros de Chile): la leyenda cubre los DOS casos posibles en una
// sola línea ("Firma Persona Natural o Firma Representante Legal", 7 palabras) en vez de la forma
// corta de un solo caso — con el tope de palabras viejo (6), esEtiquetaDeCampo la rechazaba por
// "muy larga" y el documento salía SIN FIRMA pese al hueco vacío listo arriba. No es un problema
// de la IA (que ni siquiera interviene acá): es puro conteo de palabras determinista.
test('firma: la leyenda compuesta ("Persona Natural o Representante Legal") sí se firma (regresión 4928-14-LP26)', () => {
  const xml = NS + p('texto previo') + p('') + p('') + p('Firma Persona Natural o Firma Representante Legal') + FIN;
  const analisis = analizarAnexo(normalizarParaIds(xml).xml);
  assert.equal(analisis.lineasFirma.length, 1, 'la leyenda compuesta debe detectarse como firma propia');

  // El bloqueo por vocabulario de oración (el caso que motivó el tope original, 1227338-6-LE26)
  // sigue intacto: subir el tope de palabras no reabre esa puerta.
  const oracion = NS + p('texto previo') + p('') + p('') + p('El oferente que suscribe declara bajo juramento que firma') + FIN;
  const conOracion = analizarAnexo(normalizarParaIds(oracion).xml);
  assert.equal(conOracion.lineasFirma.length, 0, 'una oración real (con "que"/"declara"/"suscribe") sigue sin firmarse');
});

// BUG REAL (4928-14-LP26, Carabineros de Chile): tabla de 3 filas [Nombre | RUT | Firma], cada
// una con su propia celda vacía A LA DERECHA (mismo patrón que Nombre/RUT). Dos fallas juntas:
// 1) "R.U.T." (una sola "palabra" sin espacios que termina en punto) caía en la regla de "fin de
//    oración" (pensada para "SANTIAGO."), así que su celda vacía quedaba libre;
// 2) el Caso C de detectarLineasFirma, que solo mira HACIA ATRÁS, tomaba esa celda libre (la de
//    RUT, la fila de ARRIBA) como si fuera el hueco para firmar — la imagen quedaba en la fila
//    de RUT y la fila de Firma se quedaba vacía.
test('firma en tabla [Nombre|RUT|Firma]: cada fila usa su PROPIA celda, no la de la fila de arriba (regresión 4928-14-LP26)', () => {
  const xml = NS + p('Nombre') + p('') + p('R.U.T.') + p('') + p('Firma') + p('') + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const parrafos = listarParrafos(norm);
  const analisis = analizarAnexo(norm);

  const etiquetas = analisis.candidatosCelda.map(c => c.etiqueta);
  assert.ok(etiquetas.includes('R.U.T.'), `"R.U.T." debe seguir siendo una etiqueta válida: ${JSON.stringify(etiquetas)}`);

  assert.equal(analisis.lineasFirma.length, 1, 'una sola línea de firma');
  const indiceRUT = parrafos.findIndex(p => p.texto === 'R.U.T.') + 1; // su celda vacía
  const indiceFirma = parrafos.findIndex(p => p.texto === 'Firma') + 1; // su propia celda vacía
  assert.equal(analisis.lineasFirma[0].indice, indiceFirma, 'la firma va en la celda de la fila "Firma", no en la de "R.U.T."');
  assert.notEqual(analisis.lineasFirma[0].indice, indiceRUT, 'nunca en la celda de RUT');
});

// BUG REAL (1057480-41-LP26, anexos 6 y 9 — MISMO párrafo literal en los dos): la firma del
// evaluador ya no se estampa (test de arriba), pero la "FECHA DE EVALUACIÓN" que sigue 1-2
// párrafos después es un blanco APARTE, en su propio párrafo, sin ninguna raya de firma adentro —
// el motor de IA solo veía ESE párrafo aislado, sin la leyenda de arriba, y decidía distinto según
// la corrida: en el anexo 9 la autocompletó con la fecha de HOY (como si fuera nuestra), en el
// anexo 6 la dejó pendiente. Ambas son del HOSPITAL evaluando, nunca del oferente.
test('fecha que sigue a una firma de contraparte no se ofrece como blanco nuestro', () => {
  const bloqueEvaluador = p('_'.repeat(75)) + p('FIRMA Y TIMBRE EVALUADOR') + p('') + p('FECHA DE EVALUACIÓN: _____/______/______');
  const ajena = analizarAnexo(normalizarParaIds(NS + bloqueEvaluador + FIN).xml);
  assert.equal(ajena.blancosInline.length, 0, 'la fecha del evaluador no debe llegar como candidato inline');

  // Control: la MISMA etiqueta de fecha, sin ninguna firma de contraparte cerca, sigue detectándose
  // normal (no es que "fecha de evaluación" quedó bloqueada como frase — depende del contexto real).
  const sola = analizarAnexo(normalizarParaIds(NS + p('FECHA DE EVALUACIÓN: _____/______/______') + FIN).xml);
  assert.equal(sola.blancosInline.length, 3, 'sin firma de contraparte cerca, los 3 blancos (día/mes/año) siguen ofreciéndose');

  // Control: una fecha NUESTRA (tras la firma del representante legal) tampoco se bloquea.
  const nuestra = analizarAnexo(normalizarParaIds(
    NS + p('_'.repeat(75)) + p('FIRMA Y TIMBRE REPRESENTANTE LEGAL') + p('') + p('FECHA: _____/______/______') + FIN,
  ).xml);
  assert.equal(nuestra.blancosInline.length, 3, 'la fecha tras la firma del representante legal sigue siendo nuestra');
});

// SEGUNDO BUG REAL (anexos 7 y 8, mismo documento): la leyenda junta los DOS bloques en un
// párrafo ("FIRMA Y TIMBRE REPRESENTANTE LEGAL      FIRMA Y TIMBRE EVALUADOR") y la fecha que
// sigue también junta las dos casillas en una línea ("Fecha: __/__/__      Fecha: __/__/__").
// Probado dos veces contra el documento real: una corrida llenó el grupo del evaluador COMPLETO
// con nuestra fecha, la otra lo llenó a medias (mes/año sí, día no) — un dato roto. Como con la
// firma, si la leyenda menciona a la contraparte (aunque sea junto con la nuestra), la fecha
// tampoco se autocompleta: no hay forma de saber cuál de los dos grupos es cuál sin adivinar.
test('fecha doble (oferente + evaluador en la misma línea) no se autocompleta ninguna', () => {
  const bloqueDual = p('_'.repeat(75) + '                        ' + '_'.repeat(30))
    + p('FIRMA Y TIMBRE REPRESENTANTE LEGAL                     FIRMA Y TIMBRE EVALUADOR')
    + p('(OFERENTE)')
    + p('')
    + p('Fecha: _________ /_________ /_________                                    Fecha: ________ /________ /_______');
  const a = analizarAnexo(normalizarParaIds(NS + bloqueDual + FIN).xml);
  assert.equal(a.blancosInline.length, 0, 'ninguna de las dos fechas se ofrece: no se puede saber cuál es la nuestra sin adivinar');
  assert.equal(a.candidatosCelda.some(c => c.etiqueta === '(OFERENTE)'), false,
    'el caption "(OFERENTE)" bajo la firma doble no es un campo — corrida a corrida, la IA a veces le escribía la razón social ahí');
});

// TERCER BUG REAL, mismo bloque: "(OFERENTE)" es un caption ("de quién es la columna de arriba"),
// no la etiqueta de un campo — pero como es corto y el párrafo siguiente está vacío, calzaba con
// el patrón 1 (etiqueta + celda vacía) y quedaba disponible para que la IA le escribiera algo.
test('caption de rol bajo una firma ("(OFERENTE)") no es un campo, pero un campo real que lo mencione sigue siéndolo', () => {
  const conCaption = analizarAnexo(normalizarParaIds(NS + p('(OFERENTE)') + p('') + p('siguiente') + FIN).xml);
  assert.equal(conCaption.candidatosCelda.length, 0, '"(OFERENTE)" solo, sin paréntesis o no, nunca es un campo');

  const sinParentesis = analizarAnexo(normalizarParaIds(NS + p('EVALUADOR') + p('') + p('siguiente') + FIN).xml);
  assert.equal(sinParentesis.candidatosCelda.length, 0, 'vale igual sin los paréntesis');

  // Control: una etiqueta real que solo MENCIONA el rol sigue detectándose (el regex está anclado).
  const campoReal = analizarAnexo(normalizarParaIds(NS + p('Nombre del oferente') + p('') + p('siguiente') + FIN).xml);
  assert.equal(campoReal.candidatosCelda.length, 1, 'una etiqueta real que menciona "oferente" no se descarta');
});

// ── Fecha partida en 3 casillas — resuelta en código, nunca por la IA ─────────────────────────
// BUG REAL (608-156-LP26): "Viña del Mar, ___ de ________________ de ________" repetido 5 veces en
// el mismo documento. La IA escribió el mes EN NÚMERO donde el formato pide la palabra ("agosto"),
// y con las 5 ocurrencias casi idénticas mezcló el valor del día en la casilla del mes. Como la
// respuesta NUNCA depende del documento (es la fecha de hoy, mismo orden), se resuelve en código.
test('detectarTripletesFecha: barra = mes en número, "de" = mes en palabra', () => {
  const conBarra = analizarAnexo(normalizarParaIds(NS + p('Fecha: _________ /_________ /_________') + FIN).xml);
  const rolesBarra = [...conBarra.blancosInline].map(b => conBarra.tripletesFecha.get(`${b.indiceRun}:${b.posEnTexto}`));
  assert.deepEqual(rolesBarra, ['dia', 'mes_numero', 'anio']);

  const conDe = analizarAnexo(normalizarParaIds(NS + p('Viña del Mar, _____   de ________________ de ________') + FIN).xml);
  const rolesDe = [...conDe.blancosInline].map(b => conDe.tripletesFecha.get(`${b.indiceRun}:${b.posEnTexto}`));
  assert.deepEqual(rolesDe, ['dia', 'mes_palabra', 'anio']);

  // Dos fechas seguidas en el mismo párrafo (oferente + evaluador, separadas por espacios de
  // layout): cada trío se resuelve por separado, sin que el primero contamine al segundo.
  const doble = analizarAnexo(normalizarParaIds(
    NS + p('Fecha: _________ /_________ /_________                                    Fecha: ________ /________ /_______') + FIN,
  ).xml);
  const rolesDoble = [...doble.blancosInline].map(b => doble.tripletesFecha.get(`${b.indiceRun}:${b.posEnTexto}`));
  assert.deepEqual(rolesDoble, ['dia', 'mes_numero', 'anio', 'dia', 'mes_numero', 'anio']);

  // Control: un blanco suelto que NO forma un trío de fecha no se marca (ej. un solo "Nombre: ___").
  const suelto = analizarAnexo(normalizarParaIds(NS + p('Nombre: ____________________') + FIN).xml);
  assert.equal(suelto.tripletesFecha.size, 0);

  // Control: 3 blancos separados por texto que NO es "/" ni "de" no se confunden con una fecha.
  const noFecha = analizarAnexo(normalizarParaIds(NS + p('A: ____ B: ____ C: ____') + FIN).xml);
  assert.equal(noFecha.tripletesFecha.size, 0);
});

// SEGUNDO FORMATO REAL (3713-7-LE26, 6 ocurrencias del mismo párrafo): el año viene YA IMPRESO en
// el documento y solo el día y el mes quedan en blanco — "Los Vilos, ___de___2026". Sin esto caía
// al camino de la IA y ahí SÍ mezclaba: en una corrida escribió el mes en número ("08") donde el
// formato pide la palabra, en otra intercambió día↔mes entre ocurrencias distintas del documento.
test('detectarTripletesFecha: dupla día/mes con el año ya impreso en el documento', () => {
  const conAnioImpreso = analizarAnexo(normalizarParaIds(NS + p('Los Vilos, ____________de_______________2026') + FIN).xml);
  const roles = [...conAnioImpreso.blancosInline].map(b => conAnioImpreso.tripletesFecha.get(`${b.indiceRun}:${b.posEnTexto}`));
  assert.deepEqual(roles, ['dia', 'mes_palabra']);

  // Control: la palabra "de" entre dos blancos SIN un año de 4 dígitos después no es una fecha —
  // la señal de un solo "de" es débil por sí sola (es una palabra común), así que se exige el año.
  const sinAnio = analizarAnexo(normalizarParaIds(NS + p('Cargo____________de____________Departamento') + FIN).xml);
  assert.equal(sinAnio.tripletesFecha.size, 0);
});

// BUG REAL (4999-8-LE26, "ANEXO N°4-A", encontrado 6-ago-2026): una declaración jurada ofrece dos
// blancos, cada uno al inicio de su propio párrafo, para marcar la alternativa que aplica — la
// MISMA frase, una vez en positivo y otra negada. Antes se le mandaban a la IA como cualquier otro
// blanco suelto y el resultado variaba de corrida en corrida (a veces pendiente, a veces con la
// razón social escrita ahí) según qué otros candidatos le tocaran de vecinos en el lote.
test('detectarAlternativasExcluyentes: "___registra" / "___no registra" se resuelve determinista, sin IA', () => {
  const par = analizarAnexo(normalizarParaIds(
    NS
    + p('_____registra saldos insolutos de remuneraciones o cotizaciones de seguridad social con sus trabajadores.')
    + p('_____no registra saldos insolutos de remuneraciones o cotizaciones de seguridad social con sus trabajadores.')
    + FIN,
  ).xml);
  assert.equal(par.alternativasExcluyentes.size, 2, `debe marcar los DOS blancos del par: ${par.alternativasExcluyentes.size}`);
  for (const b of par.blancosInline) {
    assert.ok(par.alternativasExcluyentes.has(`${b.indiceRun}:${b.posEnTexto}`), 'cada blanco del par debe estar marcado');
  }

  // El orden no importa: negado primero, positivo después, sigue siendo el mismo par.
  const parInvertido = analizarAnexo(normalizarParaIds(
    NS
    + p('_____no cumple con el requisito de experiencia mínima exigido en las bases.')
    + p('_____cumple con el requisito de experiencia mínima exigido en las bases.')
    + FIN,
  ).xml);
  assert.equal(parInvertido.alternativasExcluyentes.size, 2);

  // Control: un blanco suelto sin par no se marca (lo sigue resolviendo la IA normal).
  const suelto = analizarAnexo(normalizarParaIds(NS + p('_____registra deudas previsionales con sus trabajadores.') + FIN).xml);
  assert.equal(suelto.alternativasExcluyentes.size, 0);

  // Control: dos blancos consecutivos SIN relación de negación entre sí (frases distintas) no se
  // confunden con el patrón — cada uno sigue su camino normal (IA o el patrón que le corresponda).
  const sinRelacion = analizarAnexo(normalizarParaIds(
    NS + p('_____Nombre completo del representante.') + p('_____Cédula de identidad del representante.') + FIN,
  ).xml);
  assert.equal(sinRelacion.alternativasExcluyentes.size, 0);
});

// ── Raya de relleno con el carácter ELIPSIS "…" (U+2026), no puntos ASCII ─────────────────────
// BUG REAL (3713-7-LE26): "Plazo de entrega" / "Garantía" rellenan con "…………………" (7 elipsis, un
// solo carácter cada uno) — invisible para el regex viejo (solo conocía "_{4,}" y ".{6,}" ASCII),
// así que el campo entero desaparecía: ni se autocompletaba NI quedaba pendiente para rellenar a
// mano. Nadie escribía ahí porque el sistema nunca vio que había algo que llenar.
test('raya de elipsis "…" se detecta igual que guiones bajos o puntos ASCII', () => {
  const conElipsis = analizarAnexo(normalizarParaIds(NS + p('Plazo de entrega: ………………… días hábiles') + FIN).xml);
  assert.equal(conElipsis.blancosInline.length, 1, 'la raya de elipsis debe verse como un blanco');

  // Control: dos elipsis SUELTOS (puntos suspensivos reales, "etc…") no son una raya — mismo
  // umbral que los puntos ASCII (6+, acá 2+ porque cada glifo ya "vale" 3).
  const puntosSuspensivos = analizarAnexo(normalizarParaIds(NS + p('Etcétera… fin de la frase') + FIN).xml);
  assert.equal(puntosSuspensivos.blancosInline.length, 0, 'un solo "…" es puntuación normal, no una raya');
});

// ── Raya de puntos PARTIDA entre varios <w:r> por Word (revisión ortográfica) ─────────────────
// BUG REAL (4928-15-LE26, "EMPRESA……………………………(Indicar)" / "PLAZO DE ENTREGA…….… (Días hábiles)"):
// Word reparte una sola línea de puntos en 8-9 runs distintos (cada uno con 1-5 caracteres,
// separados por <w:proofErr> de revisión ortográfica, mezclando "." ASCII con el glifo "…").
// detectarBlancosInline mira UN run a la vez, así que sin unificar antes salían 4-9 "blancos"
// duplicados para lo que en el papel es UNA sola casilla — el usuario veía la misma respuesta
// repetida varias veces, partida por puntos sueltos. Reproduce la forma exacta del XML real: en
// "EMPRESA" la etiqueta y el primer tramo de puntos viven en el MISMO run; en "PLAZO DE ENTREGA"
// la etiqueta es un run aparte del primer tramo de puntos (ese caso además prueba que
// rellenarRunPorIndice antepone el espacio mirando el run VECINO cuando el blanco ocupa el suyo
// entero, o el resultado sale pegado: "PLAZO DE ENTREGA30").
const proofErr = '<w:proofErr w:type="gramStart"/>';
const runB = (t: string) => `<w:r><w:rPr><w:b/></w:rPr><w:t>${t}</w:t></w:r>`;
const parrafoEmpresa = '<w:p>'
  + runB('EMPRESA…………………………………………') + proofErr + runB('…….') + proofErr + runB('.………………')
  + proofErr + runB('…….') + proofErr + runB('.……') + proofErr + runB('…') + runB('….') + proofErr
  + runB('.(Indicar)') + '</w:p>';
const parrafoPlazo = '<w:p>'
  + runB('PLAZO DE ENTREGA') + proofErr + runB('…….') + proofErr + runB('……………………') + proofErr
  + runB('…….') + proofErr + runB('……') + proofErr + runB('…….') + proofErr + runB('.………')
  + proofErr + runB('…….') + proofErr + runB('.………') + proofErr + runB('…….') + proofErr
  + runB('. (Días hábiles)') + '</w:p>';

test('raya de puntos partida en varios <w:r> se unifica en UN solo blanco (regresión 4928-15-LE26)', () => {
  const { xml: norm } = normalizarParaIds(NS + parrafoEmpresa + parrafoPlazo + FIN);
  const unificado = unificarRunsDeMarcadores(norm);
  const det = analizarAnexo(unificado);
  assert.equal(det.blancosInline.length, 2, 'una sola casilla por línea, no una por fragmento de puntos');
  assert.equal(det.blancosInline[0].contexto, 'EMPRESA');
  assert.equal(det.blancosInline[1].contexto, 'PLAZO DE ENTREGA');

  let final = unificado;
  const empresa = det.blancosInline[0];
  const plazo = det.blancosInline[1];
  final = rellenarRunPorIndice(final, empresa.indiceRun, [{ pos: empresa.posEnTexto, largo: empresa.largo, valor: 'Comercial MP SpA' }]);
  final = rellenarRunPorIndice(final, plazo.indiceRun, [{ pos: plazo.posEnTexto, largo: plazo.largo, valor: '30' }]);
  const textos = listarParrafos(final).map(p => p.texto);
  assert.equal(textos[0], 'EMPRESA Comercial MP SpA(Indicar)');
  assert.equal(textos[1], 'PLAZO DE ENTREGA 30 (Días hábiles)', 'espacio antepuesto aunque la etiqueta viva en el run vecino');
  assert.equal(verificarXmlBienFormado(final).valido, true);
});

// ── Celda de tabla con SOLO un prefijo de moneda ("$") — el número va pegado después ──────────
// BUG REAL (3713-7-LE26, tabla PRODUCTO/CANTIDAD/VALOR UNITARIO/VALOR TOTAL): la celda de VALOR
// UNITARIO trae "$" ya escrito. Como la celda no está técnicamente vacía, desaparecía por completo
// — ni auto ni pendiente — y el usuario no tenía dónde escribir el precio unitario del producto.
test('celda de tabla con solo "$" se ofrece como candidato (dosPuntos) en vez de desaparecer', () => {
  const xml = NS + tabla(
    fila('Nº', 'PRODUCTO', 'CANTIDAD', 'VALOR UNITARIO', 'VALOR TOTAL'),
    fila('1', 'Contenedores Modulares', '7', '$', ''),
  ) + FIN;
  const a = analizarAnexo(normalizarParaIds(xml).xml);
  const conValorUnitario = a.candidatosCelda.find(c => c.etiqueta.includes('VALOR UNITARIO'));
  assert.ok(conValorUnitario, 'la celda "$" debe aparecer como candidato');
  assert.equal(conValorUnitario?.dosPuntos, true, 'debe marcarse para escribirse con rellenarFinDeParrafo (append), no rellenarCeldaVacia');

  // La celda de VALOR TOTAL (realmente vacía, sin "$") sigue funcionando como siempre.
  const conValorTotal = a.candidatosCelda.find(c => c.etiqueta.includes('VALOR TOTAL'));
  assert.ok(conValorTotal, 'la celda de VALOR TOTAL sigue detectándose');
  assert.equal(conValorTotal?.dosPuntos, undefined, 'una celda realmente vacía no lleva dosPuntos');
});

// ── Anexo que el propio documento dice que NO nos corresponde presentar ───────────────────────
// ANEXO N°4 de 1057480-41-LP26: es de Unión Temporal de Proveedores y cierra con la nota. Antes se
// entregaba a medio llenar (los datos de la UTP en blanco, pero la fecha, la firma y el timbre
// estampados), que parece una falla del relleno cuando en realidad ese anexo no va.
test('la nota "no debe presentar este anexo" se detecta y frena el auto-relleno', () => {
  const conNota = (nota: string) => analizarAnexo(normalizarParaIds(
    NS + p('ANEXO N°4') + p('En [ciudad], a [fecha] <<NOMBRE PERSONA JURIDICA>>, declaro:') + p(nota) + FIN,
  ).xml).avisoNoAplica;

  const utp = conNota('Nota: Todos los representantes de la Unión Temporal de Proveedores deben presentar este anexo, en caso de que el oferente no sea una Unión Temporal de Proveedores no debe presentar este anexo.');
  assert.ok(utp, 'la nota de UTP tiene que detectarse');
  assert.match(utp!.motivo, /Uniones Temporales de Proveedores/i);

  // Estrecho a propósito: mencionar una UTP NO basta, ni tampoco una nota genérica sin condición.
  assert.equal(conNota('Este anexo lo puede presentar una Unión Temporal de Proveedores.'), null);
  assert.equal(conNota('Nota: este formulario no debe presentar tachaduras ni enmendaduras.'), null);
  assert.equal(conNota('NOTA: ESTE FORMULARIO DEBERÁ ADJUNTARLO OBLIGATORIAMENTE.'), null);
});

// El escape: cuando la licitación SÍ se presenta en UTP, los bloques de UTP dejan de omitirse.
test('postulaComoUTP habilita las secciones de Unión Temporal', () => {
  const xml = NS + p('UNIÓN TEMPORAL DE PROVEEDORES') + p('Nombre del integrante') + p('')
    + p('PERSONA JURÍDICA') + p('Razón social') + p('') + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const decision = (utp: boolean) => Object.fromEntries(
    detectarSecciones(listarParrafos(norm), utp).map(s => [s.tipo, s.decision]),
  );
  assert.equal(decision(false).UTP, 'OMITIR');
  assert.equal(decision(true).UTP, 'RELLENAR');
  assert.equal(decision(true).PERSONA_JURIDICA, 'RELLENAR');   // la jurídica nunca cambia
});

// ── Regresión 1227338-6-LE26 (6-ago-2026) ─────────────────────────────────────────────────────
// Los seis anexos de ese documento cierran con el MISMO pie de tres líneas dentro de un cuadro de
// texto flotante: "FIRMA REPRESENTANTE LEGAL:" / "RUT:" / "SANTIAGO, ___ DE ___ DEL 2026". Todo lo
// que sigue salió de comparar el .docx entregado al usuario contra el documento original.

test('una ORACIÓN terminada en ":" no es una etiqueta de campo (patrón 5)', () => {
  // El bug más grave del lote: el patrón 5 autocompleta sin dejar rastro en pantalla, así que
  // "El oferente que suscribe declara bajo juramento que:" terminó con el RUT del representante
  // pegado al final, DENTRO de una declaración jurada real.
  for (const oracion of [
    'El oferente que suscribe declara bajo juramento que:',
    'Asimismo declara que:',
    'Mediante el presente formulario declaro:',
    'Asimismo, mediante el presente formulario declaro:',
    'El proponente que suscribe, declara lo siguiente:',
  ]) {
    assert.equal(esEtiquetaDeCampo(oracion), false, `debería descartarse: ${oracion}`);
  }
  // …y las etiquetas reales del mismo documento (y de los otros del banco) siguen pasando.
  for (const etiqueta of [
    'RUT:', 'FIRMA REPRESENTANTE LEGAL:', 'Nombre o Razón Social:', 'N° de Teléfono:',
    'CONTACTO DEL PROPONENTE:', 'RUT DEL REPRESENTANTE LEGAL:', 'Entidad Bancaria:',
  ]) {
    assert.equal(esEtiquetaDeCampo(etiqueta), true, `debería pasar: ${etiqueta}`);
  }

  const xml = normalizarParaIds(
    NS + p('El oferente que suscribe declara bajo juramento que:') + p('RUT:') + FIN,
  ).xml;
  const etiquetas = analizarAnexo(xml).camposConDosPuntos.map(c => c.etiqueta);
  assert.deepEqual(etiquetas, ['RUT']);
});

test('el RUT que cuelga de una firma es el del firmante que la leyenda nombra, siempre', () => {
  // Seis "RUT:" idénticos en el mismo documento daban tres respuestas distintas cuando lo decidía
  // la IA (uno con el RUT de la empresa, cuatro con el del representante, uno sin nada). No es un
  // problema de prompt: bajo "FIRMA REPRESENTANTE LEGAL" la respuesta no depende de ningún juicio.
  const pie = () => p('FIRMA REPRESENTANTE LEGAL:') + p('RUT:') + p('SANTIAGO, ____ DE ____________ DEL 2026');
  const xml = normalizarParaIds(NS + p('ANEXO N°1') + pie() + p('ANEXO N°2') + pie() + FIN).xml;
  const campos = analizarAnexo(xml).camposConDosPuntos;
  const ruts = campos.filter(c => c.etiqueta === 'RUT');
  assert.equal(ruts.length, 2);
  for (const r of ruts) assert.equal(r.campoFijo, 'representante_rut');

  // Una leyenda que NO nombra al firmante se sigue dejando a la IA: ahí el RUT bien puede ser el
  // de la empresa y no hay por qué adivinarlo en código.
  const generico = normalizarParaIds(NS + p('Firma del oferente:') + p('RUT:') + FIN).xml;
  assert.equal(analizarAnexo(generico).camposConDosPuntos.find(c => c.etiqueta === 'RUT')?.campoFijo, undefined);
});

test('un pie de firma da UN solo lugar de firma, y es el párrafo de la leyenda', () => {
  // Con un párrafo vacío justo encima de la leyenda, dos patrones veían el mismo bloque: se
  // estampaban dos firmas y la del hueco caía FUERA del cuadro de texto — dos de los seis anexos
  // salían visualmente sin firma. Manda el patrón 5: apunta al párrafo de la leyenda, o sea al
  // mismo contenedor donde vive el pie.
  const xml = normalizarParaIds(
    NS + p('NOTAS') + p('') + p('FIRMA REPRESENTANTE LEGAL:') + p('RUT:') + FIN,
  ).xml;
  const firmas = analizarAnexo(xml).lineasFirma;
  assert.equal(firmas.length, 1, JSON.stringify(firmas));
  assert.equal(firmas[0].sinRaya, true);
  assert.equal(listarParrafos(xml)[firmas[0].indice].texto, 'FIRMA REPRESENTANTE LEGAL:');

  // Una RAYA de guiones real sigue ganando: ese es el lugar de firma clásico.
  const conRaya = normalizarParaIds(NS + p('_'.repeat(20)) + p('FIRMA REPRESENTANTE LEGAL:') + FIN).xml;
  const deRaya = analizarAnexo(conRaya).lineasFirma;
  assert.equal(deRaya.length, 1);
  assert.equal(deRaya[0].sinRaya, undefined);
});

test('una etiqueta que termina en punto o coma no recibe datos', () => {
  // "SANTIAGO." (la ciudad de una línea de fecha partida entre dos párrafos) seguida de un vacío de
  // espaciado se ofrecía como campo, y terminó rellenada con la región de la empresa.
  const xml = normalizarParaIds(NS + p('SANTIAGO.') + p('') + p('DOMICILIO') + p('') + FIN).xml;
  assert.deepEqual(analizarAnexo(xml).candidatosCelda.map(c => c.etiqueta), ['DOMICILIO']);
});

test('campoCalzaConLaEtiqueta: ataja el valor real puesto en la casilla equivocada', () => {
  // Reemplaza lo que antes protegía el corte por categoría (que costaba más aciertos de los que
  // salvaba): se mira la FORMA del dato contra lo que la etiqueta pide.
  assert.equal(campoCalzaConLaEtiqueta('Cédula de identidad', 'Lidia Valenzuela'), false);
  assert.equal(campoCalzaConLaEtiqueta('Cédula de identidad', '6.736.698-0'), true);
  assert.equal(campoCalzaConLaEtiqueta('NOMBRE O RAZÓN SOCIAL', '78.388.175-6'), false);
  assert.equal(campoCalzaConLaEtiqueta('MAIL', '+569 7549 1833'), false);
  assert.equal(campoCalzaConLaEtiqueta('MAIL', 'ventas@sociedadcomercialmp.cl'), true);
  assert.equal(campoCalzaConLaEtiqueta('TELÉFONO', '+569 7549 1833'), true);
  assert.equal(campoCalzaConLaEtiqueta('Nombre y RUT del representante', '6.736.698-0'), true);
  // Sin nada que contradecir, no opina — nunca puede ser la razón de que un dato correcto se pierda.
  assert.equal(campoCalzaConLaEtiqueta('Giro Comercial', 'Venta de equipos'), true);
  assert.equal(campoCalzaConLaEtiqueta('Marca Ofertada', 'cualquier cosa'), true);
});

// BUG REAL (4777-24-LE26, ANEXO_2.docx): un cuadro de texto flotante de 7,6" x 11,1" (más alto
// que la página, relleno BLANCO SÓLIDO, dibujado EN FRENTE del texto — behindDoc="0") traía
// adentro el formulario COMPLETO y bien formado de "ANEXO N°2" — verificado exportando el
// documento real a PDF con Word: ESE es el que un humano ve al abrir el archivo. El contenido
// normal del cuerpo, DEBAJO del cuadro ("ANEXO N°1-A" completo, con sus propias casillas), queda
// tapado por el cuadro opaco — nunca se ve, aunque el XML lo trae como texto legible. Ojo: es lo
// CONTRARIO de lo que parece a primera vista — no hay que ignorar lo de ADENTRO del cuadro (eso
// es justo lo que SÍ se ve), hay que ignorar el contenido normal que queda TAPADO detrás.
test('analizarAnexo ignora las casillas normales tapadas detrás de un cuadro flotante opaco (regresión 4777-24-LE26)', () => {
  const cuadroOpacoGrande = '<w:p><w:pPr/><w:r><w:drawing><wp:anchor behindDoc="0"><wp:extent cx="6934200" cy="10172700"/>'
    + '<wps:spPr><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></wps:spPr><w:txbxContent>'
    + p('ANEXO N°2 — OFERTA ECONOMICA')
    + '</w:txbxContent></wp:anchor></w:drawing></w:r></w:p>';
  const xml = normalizarParaIds(
    NS + cuadroOpacoGrande + p('A.NOMBRE COMPLETO DEL PROPONENTE:') + p('') + FIN,
  ).xml;
  const analisis = analizarAnexo(xml);
  const etiquetas = [...analisis.candidatosCelda.map(c => c.etiqueta), ...analisis.camposConDosPuntos.map(c => c.etiqueta)];
  assert.ok(!etiquetas.some(e => e.includes('PROPONENTE')), `la casilla tapada detrás del cuadro no debía verse: ${JSON.stringify(etiquetas)}`);

  // Con un salto de página REAL entre el cuadro y el contenido siguiente, ese contenido ya no
  // queda tapado — el cuadro no puede cubrir una página que no es la suya.
  const conSaltoDePagina = normalizarParaIds(
    NS + cuadroOpacoGrande + '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
      + p('A.NOMBRE COMPLETO DEL PROPONENTE:') + p('') + FIN,
  ).xml;
  const conSalto = analizarAnexo(conSaltoDePagina);
  const etiquetasConSalto = [...conSalto.candidatosCelda.map(c => c.etiqueta), ...conSalto.camposConDosPuntos.map(c => c.etiqueta)];
  assert.ok(etiquetasConSalto.some(e => e.includes('PROPONENTE')), `con salto de página real, la casilla siguiente SÍ debía verse: ${JSON.stringify(etiquetasConSalto)}`);

  // Un cuadro de firma chico y legítimo (1227338-6-LE26) no llega al umbral de altura — nada
  // detrás de él se considera tapado.
  const cuadroFirmaChico = '<w:p><w:pPr/><w:r><w:drawing><wp:anchor behindDoc="0"><wp:extent cx="2000000" cy="900000"/>'
    + '<wps:spPr><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></wps:spPr><w:txbxContent>'
    + p('FIRMA REPRESENTANTE LEGAL:')
    + '</w:txbxContent></wp:anchor></w:drawing></w:r></w:p>';
  const conFirmaChica = analizarAnexo(normalizarParaIds(NS + cuadroFirmaChico + p('DOMICILIO:') + p('') + FIN).xml);
  assert.equal(conFirmaChica.lineasFirma.length, 1, 'un cuadro chico de firma sigue detectándose igual que antes');
  assert.ok(
    [...conFirmaChica.candidatosCelda.map(c => c.etiqueta), ...conFirmaChica.camposConDosPuntos.map(c => c.etiqueta)].some(e => e.includes('DOMICILIO')),
    'un cuadro chico no tapa nada detrás',
  );
});
