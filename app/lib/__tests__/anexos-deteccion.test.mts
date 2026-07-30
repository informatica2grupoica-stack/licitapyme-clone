// Regresión de la detección de campos en anexos (30-jul-2026). Correr con:
//   npx tsx --test app/lib/__tests__/anexos-deteccion.test.mts
//
// Todos los casos salen de UN documento real: FORMULARIOS_OBLIGATORIOS.doc de 4291-38-LP26, cinco
// formularios pegados en un archivo. Se encontraron generando el .docx y exportándolo a PDF para
// mirarlo — ninguno se veía en el XML ni en los conteos, solo al ver la hoja terminada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarParaIds, listarParrafos, rellenarFinDeParrafo, rellenarCeldaVacia, parrafoEstaVacio } from '../anexos-docx';
import { analizarAnexo, detectarSecciones, detectarCandidatosCelda } from '../anexos-detectar';
import { esMatchCoherente } from '../anexos-diccionario';

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

// La IA elige entre todos los campos con dato y, si ninguno calza, devuelve el más parecido: a
// "CIUDAD" le asignó banco_email y el anexo salía con un correo escrito en la casilla de la ciudad.
test('esMatchCoherente descarta los matches imposibles de la IA (regresión CIUDAD → banco_email)', () => {
  assert.equal(esMatchCoherente('CIUDAD', 'banco_email'), false);
  assert.equal(esMatchCoherente('FONO', 'rut'), false);
  assert.equal(esMatchCoherente('DIRECCIÓN COMERCIAL', 'email1'), false);
  // …sin bloquear los que sí tienen sentido.
  assert.equal(esMatchCoherente('CORREO ELECTRÓNICO', 'email1'), true);
  assert.equal(esMatchCoherente('Correo para pagos', 'banco_email'), true);
  assert.equal(esMatchCoherente('R.U.T. del oferente', 'rut'), true);
  assert.equal(esMatchCoherente('Teléfono de contacto', 'telefono1'), true);
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
