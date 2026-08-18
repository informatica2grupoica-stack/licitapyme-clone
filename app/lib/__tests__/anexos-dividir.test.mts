// Regresión de la división de anexos por formulario (5-ago-2026). Correr con:
//   npx tsx --test app/lib/__tests__/anexos-dividir.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarParaIds, verificarXmlBienFormado, eliminarRespaldoVmlDuplicado, abrirDocx } from '../anexos-docx';
import { dividirPorFormularios, detectarFormularios, clasificarAnexo, nombreArchivoDesdeTitulo } from '../anexos-dividir';
import { puntajeCoincidencia } from '../anexos-match';
import JSZip from 'jszip';

const NS = '<w:document xmlns:w="urn:w" xmlns:w14="urn:w14" xmlns:mc="urn:mc"><w:body>';
const FIN = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>';
const p = (texto: string) => `<w:p><w:r><w:t xml:space="preserve">${texto}</w:t></w:r></w:p>`;

async function bufferDe(xml: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="urn:ct"/>');
  zip.file('word/document.xml', xml);
  return zip.generateAsync({ type: 'nodebuffer' });
}

// BUG REAL (1227338-6-LE26, "FIRMA REPRESENTANTE LEGAL" en un cuadro de texto flotante): un
// párrafo ancla trae un cuadro de texto (<w:drawing>…<w:txbxContent>) con SUS PROPIOS párrafos
// adentro — listarBloquesCrudos los cuenta como bloques sueltos (a propósito, para no desalinear
// la numeración de índices que comparte con anexos-rellenar.ts — ver el comentario de
// finDeTabla), pero el cierre real del cuadro (`</w:txbxContent>` y lo que venga después del
// ÚLTIMO párrafo interno, en el MISMO <w:p> ancla) caía en el hueco entre un bloque y el
// siguiente y se perdía sin más. El fragmento dividido quedaba con un tag sin cerrar.
test('dividirPorFormularios: un cuadro de texto con párrafos internos no pierde su cierre (regresión 1227338-6-LE26)', async () => {
  const cuadroDeTexto = '<w:p><w:pPr/><w:r><w:drawing><w:txbxContent>'
    + p('FIRMA REPRESENTANTE LEGAL:') + p('RUT:')
    + '</w:txbxContent></w:drawing></w:r>' + p('texto normal después del cuadro, mismo párrafo ancla').replace(/^<w:p>|<\/w:p>$/g, '') + '</w:p>';

  const xml = NS
    + p('ANEXO N°1: IDENTIFICACIÓN')
    + p('Nombre del proponente')
    + p('ANEXO N°2: DECLARACIÓN')
    + cuadroDeTexto
    + p('Último párrafo del formulario 2, después del cuadro')
    + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const buffer = await bufferDe(norm);

  const formularios = await dividirPorFormularios(buffer, norm);
  assert.equal(formularios.length, 2, 'deben salir los 2 formularios');

  for (const f of formularios) {
    const { xml: fxml } = await abrirDocx(f.buffer);
    const abre = (fxml.match(/<w:txbxContent\b/g) || []).length;
    const cierra = (fxml.match(/<\/w:txbxContent>/g) || []).length;
    assert.equal(abre, cierra, `"${f.nombreSufijo}": txbxContent desbalanceado (${abre} abre / ${cierra} cierra)`);
    const chequeo = verificarXmlBienFormado(fxml);
    assert.equal(chequeo.valido, true, `"${f.nombreSufijo}" quedó mal formado: ${chequeo.error}`);
  }
  // Y el texto que vino DESPUÉS del cuadro, en el mismo párrafo ancla, sigue ahí — no solo el
  // tag de cierre, el contenido real también sobrevive.
  const { xml: xmlN2 } = await abrirDocx(formularios[1].buffer);
  assert.match(xmlN2, /texto normal después del cuadro/);
});

// BUG REAL (4777-24-LE26): un cuadro de texto flotante gigante envuelve casi todo el formulario y
// trae, como su PRIMER párrafo interno, el título "ANEXO N°2" — el mismo patrón que
// detectarFormularios usa para marcar el INICIO de un formulario nuevo. El bloque que abre ese
// cuadro (el <w:p> ancla) queda ordinalmente ANTES del título (es un párrafo interno más, contado
// aparte), así que si se usa igual como borde, dividirPorFormularios lo excluye del fragmento por
// rango de ordinales — pero el bloque que se lleva el CIERRE del cuadro sí entra, dejando un
// "</w:txbxContent>" sin su apertura. Un título real nunca debería vivir dentro de un cuadro de
// texto sin cerrar: se ignora como borde de formulario y, al quedar un solo título real, no se
// divide — un solo archivo, nunca corrupto.
test('dividirPorFormularios: un título dentro de un cuadro de texto flotante no se usa como borde (regresión 4777-24-LE26)', async () => {
  // El párrafo vacío ANTES del título es el caso real (4777-24-LE26): el <w:p> ancla se funde con
  // el PRIMER párrafo interno del cuadro (indexOf toma su </w:p>, no el del ancla) — recién el
  // SEGUNDO párrafo interno (el del título) arranca con el cuadro ya "abierto" para el contador de
  // profundidad. Sin este párrafo vacío el título quedaría fundido con el ancla, que sí abre el
  // cuadro dentro de su propio bloque — un falso negativo que no prueba nada.
  const cuadroConTituloDentro = '<w:p><w:pPr/><w:r><w:drawing><w:txbxContent>'
    + p('')
    + p('ANEXO N°2: DECLARACIÓN')
    + p('contenido dentro del cuadro')
    + '</w:txbxContent></w:drawing></w:r>' + p('texto normal después del cuadro, mismo párrafo ancla').replace(/^<w:p>|<\/w:p>$/g, '') + '</w:p>';

  const xml = NS
    + p('ANEXO N°1: IDENTIFICACIÓN')
    + p('Nombre del proponente')
    + cuadroConTituloDentro
    + p('Último párrafo, fuera del cuadro')
    + FIN;
  const { xml: norm } = normalizarParaIds(xml);

  const formularios = detectarFormularios(norm);
  assert.equal(formularios.length, 1, 'el título dentro del cuadro no cuenta como borde — solo queda el real');
  assert.equal(formularios[0].titulo, 'ANEXO N°1: IDENTIFICACIÓN');

  const buffer = await bufferDe(norm);
  const divididos = await dividirPorFormularios(buffer, norm);
  assert.equal(divididos.length, 0, 'con menos de 2 encabezados no se divide — un solo archivo, nunca corrupto');
});

// Cuadro de texto duplicado (DrawingML + respaldo VML) vía mc:AlternateContent — Word escribe
// SIEMPRE las dos versiones del mismo cuadro; solo la primera (mc:Choice) es la que cualquier
// Word real usa. Sin quitar el respaldo, la vista previa mostraba el bloque de firma DOS VECES.
test('eliminarRespaldoVmlDuplicado: se queda con la copia moderna (mc:Choice), tira el respaldo VML (mc:Fallback)', () => {
  const xml = '<mc:AlternateContent><mc:Choice Requires="wps">'
    + '<w:drawing><w:txbxContent>' + p('FIRMA REPRESENTANTE LEGAL:') + '</w:txbxContent></w:drawing>'
    + '</mc:Choice><mc:Fallback>'
    + '<w:pict><v:textbox><w:txbxContent>' + p('FIRMA REPRESENTANTE LEGAL:') + '</w:txbxContent></v:textbox></w:pict>'
    + '</mc:Fallback></mc:AlternateContent>';
  const limpio = eliminarRespaldoVmlDuplicado(xml);
  assert.equal((limpio.match(/FIRMA REPRESENTANTE LEGAL/g) || []).length, 1, 'debe quedar UNA sola copia del texto');
  assert.ok(!limpio.includes('mc:Fallback'), 'el respaldo VML no puede sobrevivir');
  assert.ok(limpio.includes('<w:drawing>'), 'la copia moderna (DrawingML) sí se conserva');
});

// Separación en archivos independientes por título (13-ago-2026): el nombre debe salir del
// TÍTULO real (no solo el número), y cada fragmento debe quedar clasificado por categoría.
test('clasificarAnexo: reconoce administrativo/técnico/económico por palabras clave del título + cuerpo', () => {
  assert.equal(
    clasificarAnexo('ANEXO N°1: DECLARACIÓN JURADA SIMPLE', 'Yo, representante legal, declaro bajo juramento que no tengo inhabilidad para contratar'),
    'administrativo',
  );
  assert.equal(
    clasificarAnexo('ANEXO N°2: ESPECIFICACIONES TÉCNICAS', 'El equipo de trabajo y el cronograma de la propuesta técnica se detallan a continuación'),
    'tecnico',
  );
  assert.equal(
    clasificarAnexo('ANEXO N°3: OFERTA ECONÓMICA', 'Cuadro de precios unitarios, valor total e IVA incluido'),
    'economico',
  );
});

test('clasificarAnexo: sin señal clara (0 coincidencias o empate) no adivina, queda sin_clasificar', () => {
  assert.equal(clasificarAnexo('ANEXO N°4', 'texto sin ninguna palabra clave reconocible'), 'sin_clasificar');
});

// BUG REAL evitado en esta implementación: limpiar el título a un nombre de archivo no puede
// convertir el guion de un sufijo tipo "N°1-A" en "_", porque anexos-match.ts (repartirArchivosGenerados)
// usa ESE guion literal para reconocer el mismo número+letra al repartir cada archivo dividido a
// su punto del checklist del Auditor Técnico — con "_" en vez de "-", el matching de letra se
// pierde en silencio y el archivo cae en el ítem genérico en vez del suyo.
test('nombreArchivoDesdeTitulo: conserva el guion del sufijo de letra ("N°1-A") para que anexos-match.ts lo siga reconociendo', () => {
  const nombre = nombreArchivoDesdeTitulo('ANEXO Nº 1-A: IDENTIFICACIÓN DEL OFERENTE');
  assert.match(nombre, /N1-A/, `debe conservar "N1-A" literal, salió: ${nombre}`);
  // Y ese nombre sigue matcheando contra el título del checklist con el mismo número+letra —
  // la prueba de fondo es que repartirArchivosGenerados no lo mande al ítem equivocado.
  assert.ok(puntajeCoincidencia('Anexo N°1-A - Identificación del Oferente', nombre) >= 100, 'debe matchear por número con letra, no solo por número');
});

// Sin prefijo de categoría a propósito (13-ago-2026, regresión 1063538-204-LE26): la categoría
// ya se ve en la caja donde queda el archivo — repetirla en el nombre solo hacía que varios
// anexos de la MISMA categoría se vieran idénticos en una lista truncada por la UI.
test('nombreArchivoDesdeTitulo: nombre legible, en mayúsculas, SIN prefijo de categoría', () => {
  const nombre = nombreArchivoDesdeTitulo('ANEXO N°3: OFERTA ECONÓMICA');
  assert.equal(nombre, 'ANEXO_N3_OFERTA_ECONÓMICA');
});

test('dividirPorFormularios: cada fragmento sale con categoría y nombreArchivo (título limpio, sin prefijo de categoría)', async () => {
  const xml = NS
    + p('ANEXO N°1: DECLARACIÓN JURADA SIMPLE')
    + p('Yo, representante legal, declaro bajo juramento que no tengo inhabilidad para contratar con el Estado')
    + p('ANEXO N°2: OFERTA ECONÓMICA')
    + p('Cuadro de precios unitarios y valor total con IVA incluido')
    + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const buffer = await bufferDe(norm);

  const divididos = await dividirPorFormularios(buffer, norm);
  assert.equal(divididos.length, 2);
  assert.equal(divididos[0].categoria, 'administrativo');
  assert.match(divididos[0].nombreArchivo, /^ANEXO_N1/);
  assert.equal(divididos[1].categoria, 'economico');
  assert.match(divididos[1].nombreArchivo, /^ANEXO_N2/);
});

// Regresión real 1063538-204-LE26: encabezado "pelado" (nada más que el número) con el título
// verdadero en el párrafo SIGUIENTE — antes el nombre de archivo salía genérico ("FORMULARIO_N1"),
// indistinguible de los otros 9 formularios del mismo documento.
test('dividirPorFormularios: encabezado pelado toma el título del párrafo siguiente (regresión 1063538-204-LE26)', async () => {
  const xml = NS
    + p('FORMULARIO Nº 1')
    + p('IDENTIFICACION DEL PROPONENTE')
    + p('“SERVICIO DE ARRIENDO LITOTRIPTOR NEUMÁTICO”')
    + p('Nombre completo o Razón Social')
    + p('FORMULARIO Nº 3')
    + p('OFERTA ECONÓMICA')
    + p('“SERVICIO DE ARRIENDO LITOTRIPTOR NEUMÁTICO”')
    + p('Valor unitario')
    + FIN;
  const { xml: norm } = normalizarParaIds(xml);

  const formularios = detectarFormularios(norm);
  assert.equal(formularios[0].titulo, 'FORMULARIO Nº 1 IDENTIFICACION DEL PROPONENTE');
  assert.equal(formularios[1].titulo, 'FORMULARIO Nº 3 OFERTA ECONÓMICA');

  const buffer = await bufferDe(norm);
  const divididos = await dividirPorFormularios(buffer, norm);
  assert.match(divididos[0].nombreArchivo, /^FORMULARIO_N1_IDENTIFICACION_DEL_PROPONENTE/);
  assert.match(divididos[1].nombreArchivo, /^FORMULARIO_N3_OFERTA_ECONÓMICA/);
});

// Regresión real 1063538-204-LE26 (mismo documento, otro bug): el organismo tituló el primer
// formulario "FORMULARIO Nº 7" (sin punto) pero los siguientes "FORMULARIO N.º 8"/"N.º 9" — con
// el punto ANTES del símbolo º, no después. El regex solo aceptaba el punto en el orden símbolo→
// punto, así que detectarFormularios veía un solo encabezado (el Nº 7) y todo el resto del
// documento (8, 9, 10…) quedaba fusionado en ese mismo bloque — "Separar anexos" respondía "no
// trae más de un anexo pegado" en un archivo que en realidad traía cuatro.
test('detectarFormularios: "N.º" con el punto ANTES del símbolo º se reconoce igual que "Nº"/"N°" (regresión 1063538-204-LE26)', () => {
  const xml = NS
    + p('FORMULARIO Nº 7')
    + p('DECLARACION JURADA SIMPLE LEY Nº 20.393')
    + p('FORMULARIO N.º 8')
    + p('DECLARACIÓN JURADA DE INHABILIDAD')
    + p('FORMULARIO N.º 9')
    + p('DECLARACIÓN JURADA DE INDEPENDENCIA')
    + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const formularios = detectarFormularios(norm);
  assert.equal(formularios.length, 3);
  assert.equal(formularios[0].titulo, 'FORMULARIO Nº 7 DECLARACION JURADA SIMPLE LEY Nº 20.393');
  assert.equal(formularios[1].titulo, 'FORMULARIO N.º 8 DECLARACIÓN JURADA DE INHABILIDAD');
  assert.equal(formularios[2].titulo, 'FORMULARIO N.º 9 DECLARACIÓN JURADA DE INDEPENDENCIA');
});

// Encabezado YA descriptivo ("ANEXO N°1: IDENTIFICACIÓN") no debe mirar el párrafo siguiente —
// solo los encabezados PELADOS (nada más que el número) disparan la búsqueda de subtítulo.
test('detectarFormularios: un encabezado ya descriptivo no se contamina con el párrafo siguiente', () => {
  const xml = NS
    + p('ANEXO N°1: IDENTIFICACIÓN')
    + p('Nombre del proponente')
    + p('ANEXO N°2: DECLARACIÓN')
    + p('Yo declaro')
    + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const formularios = detectarFormularios(norm);
  assert.equal(formularios[0].titulo, 'ANEXO N°1: IDENTIFICACIÓN');
  assert.equal(formularios[1].titulo, 'ANEXO N°2: DECLARACIÓN');
});

// BUG REAL (13-ago-2026, caso 1211839-58-LE26, "FORMULARIOS.doc"): el conversor de producción
// (LibreOffice) fusiona el párrafo del encabezado con el del contenido siguiente SIN dejar
// ningún espacio ni salto entre medio — mismo .doc convertido con Word real sí los separa en
// párrafos distintos. La línea completa queda demasiado larga (LARGO_MAX_ENCABEZADO) y antes se
// descartaba entera: "Separar anexos" detectaba 0 formularios en un documento con 6 reales.
// Strings EXACTOS capturados del log de producción (docker compose logs, mismo caso real).
test('detectarFormularios: encabezado pegado sin espacio al contenido siguiente (regresión 1211839-58-LE26, bug de conversión LibreOffice)', async () => {
  const xml = NS
    + p('FORMULARIO N°1 - AIDENTIFICACIÓN DEL PROPONENTEPROPUESTA PÚBLICA“SERVICIO DE MOVILIZACIÓN')
    + p('FORMULARIO N°1 - BIDENTIFICACIÓN DEL PROPONENTE EN UNIÓN TEMPORAL DE PROVEEDORESPROPUESTA PÚBLICA“SERVICIO DE MOVILIZACIÓN')
    + p('FORMULARIO Nº 2OFERTA ECONÓMICAPROPUESTA PÚBLICA“SERVICIO DE MOVILIZACIÓN PARA EDUCACIÓN')
    + p('FORMULARIO N°3EXPERIENCIA DEL OFERENTE“SERVICIO DE MOVILIZACIÓN PARA EDUCACIÓN MUNICIPAL')
    + p('FORMULARIO N°4LISTADO DE VEHÍCULOS“SERVICIO DE MOVILIZACIÓN PARA EDUCACIÓN MUNICIPAL')
    + p('FORMULARIO N°5DECLARACIÓN JURADA INHABILIDADES DEL ARTÍCULO 35 QUÁTER DE LA LEY N°19.886')
    + FIN;
  const { xml: norm } = normalizarParaIds(xml);

  const formularios = detectarFormularios(norm);
  assert.equal(formularios.length, 6, 'deben detectarse los 6 formularios reales, no 0');
  assert.equal(formularios[0].titulo, 'FORMULARIO N°1 - A');
  assert.equal(formularios[1].titulo, 'FORMULARIO N°1 - B');
  assert.equal(formularios[2].titulo, 'FORMULARIO Nº 2');
  assert.equal(formularios[3].titulo, 'FORMULARIO N°3');
  assert.equal(formularios[4].titulo, 'FORMULARIO N°4');
  assert.equal(formularios[5].titulo, 'FORMULARIO N°5');

  // Y la división real produce 6 fragmentos válidos (no solo la detección de encabezados).
  const buffer = await bufferDe(norm);
  const divididos = await dividirPorFormularios(buffer, norm);
  assert.equal(divididos.length, 6);
  for (const d of divididos) {
    const { xml: fxml } = await abrirDocx(d.buffer);
    assert.equal(verificarXmlBienFormado(fxml).valido, true, `"${d.nombreArchivo}" debe quedar bien formado`);
  }
});

// GUARDARRAÍL: el fallback NO debe reabrir el falso positivo original que motivó
// LARGO_MAX_ENCABEZADO — una oración larga real que MENCIONA "Formulario N°1" (con espacio o
// puntuación normal después, como cualquier prosa) nunca debe contarse como encabezado.
test('detectarFormularios: una oración larga que MENCIONA un formulario (con espacio real) sigue sin contar como encabezado', () => {
  const xml = NS
    + p('ANEXO N°1: IDENTIFICACIÓN')
    + p('Nombre del proponente')
    + p('Formulario N°1 debe presentarse junto con la boleta de garantía correspondiente al proceso licitatorio, dentro del sobre cerrado que se entrega en la oficina de partes')
    + p('ANEXO N°2: DECLARACIÓN')
    + p('Yo declaro')
    + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const formularios = detectarFormularios(norm);
  assert.equal(formularios.length, 2, 'la mención suelta en prosa no debe contarse como un 3er encabezado');
  assert.equal(formularios[0].titulo, 'ANEXO N°1: IDENTIFICACIÓN');
  assert.equal(formularios[1].titulo, 'ANEXO N°2: DECLARACIÓN');
});

// Una tabla de 1 celda con varios párrafos internos (recurso visual para dibujarle un recuadro
// al título — sin esto, cualquier título metido en una tabla era invisible para el detector).
const tabla = (...parrafos: string[]) => `<w:tbl><w:tr><w:tc>${parrafos.map(p).join('')}</w:tc></w:tr></w:tbl>`;

// BUG REAL (14-ago-2026, caso 759-21-LE26): CADA título ("ANEXO Nº 1" a "ANEXO Nº 10") vivía
// dentro de su propia tabla de una celda, "pelado" (sin descripción propia) — el título real y el
// nombre de la licitación (siempre entre comillas) vienen en los párrafos SIGUIENTES, dentro de
// la MISMA tabla. Antes esto daba 0 encabezados: el documento entero quedaba sin dividir.
test('detectarFormularios: título "pelado" dentro de una tabla de 1 celda, con subtítulo en los párrafos siguientes de esa misma tabla (regresión 759-21-LE26)', () => {
  const xml = NS
    + tabla('ANEXO Nº 1', 'IDENTIFICACIÓN DEL OFERENTE', '“SERVICIO DE ARRIENDO”')
    + p('Nombre completo o Razón Social')
    + tabla('ANEXO Nº 2', 'DECLARACIÓN JURADA SIMPLE', '“SERVICIO DE ARRIENDO”')
    + p('Yo declaro')
    + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const formularios = detectarFormularios(norm);
  assert.equal(formularios.length, 2);
  assert.equal(formularios[0].titulo, 'ANEXO Nº 1 IDENTIFICACIÓN DEL OFERENTE');
  assert.equal(formularios[1].titulo, 'ANEXO Nº 2 DECLARACIÓN JURADA SIMPLE');
});

// BUG REAL (14-ago-2026, caso 634-49-LR26): el documento ENTERO (los 10 formularios) vive dentro
// de UNA SOLA tabla gigante, usada como layout de página completo — no una cajita chica por
// título. El detector no debe depender de "la tabla es chica" para revisarla: la seguridad viene
// del propio regex del encabezado, no del tamaño.
test('detectarFormularios: el documento ENTERO adentro de una sola tabla grande, sin tope de tamaño (regresión 634-49-LR26)', () => {
  const filas = ['FORMULARIO N°1', 'texto del formulario 1'.repeat(5), 'FORMULARIO N°2', 'texto del formulario 2'.repeat(5), 'FORMULARIO N°3', 'texto del formulario 3'.repeat(5)];
  const xml = NS + tabla(...filas) + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const formularios = detectarFormularios(norm);
  assert.equal(formularios.length, 3);
  assert.equal(formularios[0].titulo.startsWith('FORMULARIO N°1'), true);
  assert.equal(formularios[1].titulo.startsWith('FORMULARIO N°2'), true);
  assert.equal(formularios[2].titulo.startsWith('FORMULARIO N°3'), true);
});

// BUG REAL (14-ago-2026, caso 5827-3-LE26): una tabla de DATOS real puede traer una columna que
// repite literalmente "ANEXO N.° 9" en varias filas (a qué línea/anexo pertenece cada ítem) — cada
// aparición, sola en su celda, calza con el regex de encabezado igual que un título real. Un
// título real aparece UNA sola vez; si el mismo texto se repite dentro de una tabla, se descarta
// entero (todas sus apariciones), porque no hay forma de saber cuál, si alguna, es la real.
test('detectarFormularios: un valor de columna repetido dentro de una tabla NO se confunde con un título (regresión 5827-3-LE26)', () => {
  const xml = NS
    + tabla('ANEXO N.° 9', '26 INSUMOS FARMACÉUTICOS')
    + tabla('ANEXO N.° 9', '27 INSUMOS QUÍMICOS')
    + tabla('ANEXO N.° 9', 'NETO IVA')
    + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const formularios = detectarFormularios(norm);
  assert.equal(formularios.length, 0, 'las 3 repeticiones de "ANEXO N.° 9" se descartan todas');
});

// TERCERA forma de encabezado: letra entre comillas tipográficas en vez de número (regresión
// 761391-104-LE26) — y guardarraíl del falso positivo real que motivó exigir las comillas: el
// plural "ANEXOS"/"FORMULARIOS" (título de portada genérico, sin número) NO debe calzar como si la
// "S" final fuera la letra del anexo.
test('detectarFormularios: anexos rotulados con LETRA entre comillas tipográficas (regresión 761391-104-LE26)', () => {
  const xml = NS
    + p('ANEXO “A”')
    + p('Contenido del anexo A')
    + p('ANEXO “B”')
    + p('Contenido del anexo B')
    + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const formularios = detectarFormularios(norm);
  assert.equal(formularios.length, 2);
  assert.equal(formularios[0].titulo, 'ANEXO “A”');
  assert.equal(formularios[1].titulo, 'ANEXO “B”');
});

test('detectarFormularios: "ANEXOS"/"FORMULARIOS" en plural (portada genérica, sin número) no se confunde con "Anexo + letra S"', () => {
  const xml = NS
    + p('ANEXOS')
    + p('FORMULARIOS')
    + p('ANEXO Nº 1')
    + p('Contenido')
    + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const formularios = detectarFormularios(norm);
  assert.equal(formularios.length, 1);
  assert.equal(formularios[0].titulo, 'ANEXO Nº 1 Contenido');
});

// CUARTA forma de encabezado (14-ago-2026, caso real 1057536-107-LE26, CESFAM Frutillar): el
// organismo rotula por CATEGORÍA + número — "FORMULARIO A-1"/"A-2"/"A-3" (Administrativos),
// "T-1".."T-6" (Técnicos), "E-1"/"E-2" (Económicos) — letra PRIMERO, guion, número, sin "N" y sin
// comillas. Documento real de 10.452 párrafos, 12 formularios así, 0 detectados antes de esto.
test('detectarFormularios: encabezados por categoría + número, "FORMULARIO A-1"/"T-1"/"E-1" sin "N" (regresión 1057536-107-LE26)', () => {
  const xml = NS
    + p('FORMULARIO A-1')
    + p('Nombre completo o Razón Social')
    + p('FORMULARIO T-1')
    + p('Especificaciones técnicas')
    + p('FORMULARIO E-1')
    + p('Oferta económica')
    + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const formularios = detectarFormularios(norm);
  assert.equal(formularios.length, 3);
  assert.equal(formularios[0].titulo, 'FORMULARIO A-1 Nombre completo o Razón Social');
  assert.equal(formularios[1].titulo, 'FORMULARIO T-1 Especificaciones técnicas');
  assert.equal(formularios[2].titulo, 'FORMULARIO E-1 Oferta económica');
});

// QUINTA forma (18-ago-2026, caso real 2296-48-LE26, Municipalidad de Conchalí): la palabra es
// "FORMATO", no "FORMULARIO"/"ANEXO". Documento real de 445 párrafos, 7 formatos pegados,
// 0 detectados — "Separar anexos" no hacía absolutamente nada.
test('detectarFormularios: encabezados con la palabra "FORMATO" (regresión 2296-48-LE26)', () => {
  const xml = NS
    + p('FORMATO Nº1-A')
    + p('IDENTIFICACIÓN DEL OFERENTE')
    + p('FORMATO  Nº2')
    + p('IDENTIFICACIÓN DE SOCIOS Y ACCIONISTAS')
    + p('FORMATO Nº 3')
    + p('OFERTA ECONÓMICA')
    + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const formularios = detectarFormularios(norm);
  assert.equal(formularios.length, 3);
  assert.equal(formularios[0].titulo, 'FORMATO Nº1-A IDENTIFICACIÓN DEL OFERENTE');
  assert.equal(formularios[2].titulo, 'FORMATO Nº 3 OFERTA ECONÓMICA');
  // El sufijo de letra tiene que sobrevivir al nombre de archivo (lo usa anexos-match.ts).
  assert.match(nombreArchivoDesdeTitulo(formularios[0].titulo), /^FORMATO_N1-A/);
});

// El plural "Formatos" aparece en la prosa real de estos mismos documentos ("las Bases
// Administrativas, Bases Técnicas, Formatos, y demás antecedentes") — no puede contar como
// encabezado, igual que ya pasa con "ANEXOS"/"FORMULARIOS".
test('detectarFormularios: "Formatos" en prosa no se confunde con un encabezado "FORMATO"', () => {
  const xml = NS
    + p('FORMATO Nº1')
    + p('Conocer y aceptar las Bases Administrativas, Bases Técnicas, Formatos, y demás antecedentes')
    + p('FORMATOS')
    + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  assert.equal(detectarFormularios(norm).length, 1);
});

// BUG REAL (18-ago-2026, 2296-48-LE26): ese organismo pone el TÍTULO del formulario entre
// comillas tipográficas, y la regla "una línea entre comillas es el nombre de la licitación,
// corta ahí" dejaba los anexos con nombre pelado ("FORMATO_Nº1-B"). Lo repetido (el nombre de la
// licitación, una vez por formulario) sigue cortando; lo que aparece UNA sola vez es el título.
test('detectarFormularios: un título entre comillas que aparece una sola vez SÍ sirve de subtítulo (regresión 2296-48-LE26)', () => {
  const xml = NS
    + p('FORMATO Nº1-B')
    + p('“IDENTIFICACIÓN DEL OFERENTE”')
    + p('(SÓLO PARA UNIÓN TEMPORAL DE PROVEEDORES)')
    + p('“ADQUISICIÓN DE COMPUTADORES”')
    + p('FORMATO Nº2')
    + p('“IDENTIFICACIÓN DE SOCIOS”')
    + p('“ADQUISICIÓN DE COMPUTADORES”')
    + FIN;
  const { xml: norm } = normalizarParaIds(xml);
  const formularios = detectarFormularios(norm);
  assert.equal(formularios.length, 2);
  // El título entrecomillado único entra (sin sus comillas); el nombre de licitación repetido no.
  assert.equal(formularios[0].titulo, 'FORMATO Nº1-B IDENTIFICACIÓN DEL OFERENTE (SÓLO PARA UNIÓN TEMPORAL DE PROVEEDORES)');
  assert.equal(formularios[1].titulo, 'FORMATO Nº2 IDENTIFICACIÓN DE SOCIOS');
});
