// Regresión de la detección de campos en anexos (30-jul-2026). Correr con:
//   npx tsx --test app/lib/__tests__/anexos-deteccion.test.mts
//
// Todos los casos salen de UN documento real: FORMULARIOS_OBLIGATORIOS.doc de 4291-38-LP26, cinco
// formularios pegados en un archivo. Se encontraron generando el .docx y exportándolo a PDF para
// mirarlo — ninguno se veía en el XML ni en los conteos, solo al ver la hoja terminada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarParaIds, listarParrafos, rellenarFinDeParrafo, rellenarCeldaVacia, parrafoEstaVacio } from '../anexos-docx';
import { analizarAnexo, detectarSecciones, detectarCandidatosCelda, indiceFilaEncabezado, extraerTablasCrudo, detectarCandidatosTabla } from '../anexos-detectar';
import { valorExisteEnFicha, type EmpresaCampos } from '../anexos-ia-motor';

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
    banco_email: 'pagos@grupoica.cl', banco_titular_nombre: null, banco_titular_rut: null, firma_url: null,
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
