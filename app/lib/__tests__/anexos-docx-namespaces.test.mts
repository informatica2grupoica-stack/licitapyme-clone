// Regresión del bug de namespaces de la firma (29-jul-2026, caso real 4291-38-LP26). Correr con:
//   npx tsx --test app/lib/__tests__/anexos-docx-namespaces.test.mts
//
// Qué pasó: 5 de los 7 anexos que el módulo había generado eran rechazados por Word con "Namespace
// prefix a on graphicFrameLocks is not defined". Un documento con dibujos propios declara `xmlns:a`
// LOCALMENTE en su dibujo (`<a:graphic xmlns:a="…">`) y NO en la raíz — lo hace LibreOffice al
// convertir un .doc (caso 4291-38-LP26) y también Word en sus .docx (caso 1738-18-LE26). El chequeo
// de insertarImagenEnParrafo preguntaba `/xmlns:a=/` sobre TODO el XML, encontraba esa declaración
// local, y dejaba la raíz sin declarar — así que nuestro <a:graphicFrameLocks>, en otro párrafo,
// quedaba fuera de alcance. Ni verificarParrafos ni el verificarXmlBienFormado de entonces (solo
// etiquetas) lo detectaban: el archivo se subía y Word lo rechazaba entero.
//
// El documento de abajo replica esa condición exacta. No hace falta el conversor .doc del VPS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  abrirDocx, guardarDocx, normalizarParaIds, insertarImagenEnParrafo, verificarXmlBienFormado,
  listarParrafos,
} from '../anexos-docx';
import { dividirPorFormularios, detectarFormularios } from '../anexos-dividir';

const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
// PNG 1×1 válido — leerDimensionesImagen() lee ancho/alto reales del IHDR.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

// Un dibujo tal como lo emite LibreOffice al convertir un .doc: el prefijo `a` declarado en el
// propio <a:graphic>, nada en la raíz del documento.
const DIBUJO_LIBREOFFICE =
  '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'
  + '<wp:extent cx="360000" cy="360000"/><wp:docPr id="1" name="Forma libre: forma 1793758816"/>'
  + `<a:graphic xmlns:a="${NS_A}"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">`
  + '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="lo"/><pic:cNvPicPr/></pic:nvPicPr>'
  + '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
  + '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="360000" cy="360000"/></a:xfrm>'
  + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
  + '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';

// Ojo: la raíz declara w/w14/wp/pic/r/mc pero NO `a` — igual que la salida real de LibreOffice.
const DOCUMENT_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
  + ' xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"'
  + ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"'
  + ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"'
  + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
  + ' xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><w:body>'
  + '<w:p w14:paraId="0000A001"><w:r><w:t>FORMULARIO N°1</w:t></w:r></w:p>'
  + '<w:p w14:paraId="0000A002"><w:r><w:rPr><w:sz w:val="20"/></w:rPr>'
  + '<w:t xml:space="preserve">____________ Nombre Persona Natural</w:t></w:r></w:p>'
  + `<w:p w14:paraId="0000A003">${DIBUJO_LIBREOFFICE}</w:p>`
  + '<w:p w14:paraId="0000A004"><w:r><w:t>FORMULARIO N°2</w:t></w:r></w:p>'
  + '<w:p w14:paraId="0000A005"><w:r><w:t>__________________</w:t></w:r></w:p>'
  + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>'
  + '</w:body></w:document>';

async function docxDePrueba(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="png" ContentType="image/png"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '</Types>');
  zip.file('_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '</Relationships>');
  zip.file('word/_rels/document.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/lo.png"/>'
    + '</Relationships>');
  zip.file('word/media/lo.png', PNG_1X1);
  zip.file('word/document.xml', DOCUMENT_XML);
  return zip.generateAsync({ type: 'nodebuffer' });
}

// El gate de producción (route.ts lo corre sobre cada fragmento antes de subir) tiene que CAZAR un
// prefijo sin declarar. Sin este test, el de abajo podría pasar por tener un validador ciego —
// que es precisamente lo que ocurrió: el chequeo anterior solo comparaba etiquetas.
test('verificarXmlBienFormado caza un prefijo de namespace sin declarar', () => {
  const roto = '<w:document xmlns:w="urn:w"><w:body><w:p><a:graphicFrameLocks noChangeAspect="1"/></w:p></w:body></w:document>';
  const r = verificarXmlBienFormado(roto);
  assert.equal(r.valido, false, 'un prefijo sin declarar NO es XML válido');
  assert.match(r.error!, /"a"/, 'el error debe nombrar el prefijo culpable');

  // Un atributo con prefijo sin declarar cuenta igual (r:embed sin xmlns:r).
  assert.equal(
    verificarXmlBienFormado('<w:document xmlns:w="urn:w"><w:body><w:p r:embed="rId1"/></w:body></w:document>').valido,
    false, 'un ATRIBUTO con prefijo sin declarar también invalida',
  );

  // Y no debe dar falsos positivos: declaración local en el propio elemento, en un ancestro, o
  // el prefijo `xml:` predefinido, son todos válidos.
  for (const bueno of [
    `<w:document xmlns:w="urn:w"><w:body><w:p><a:graphic xmlns:a="${NS_A}"><a:blip/></a:graphic></w:p></w:body></w:document>`,
    `<w:document xmlns:w="urn:w" xmlns:a="${NS_A}"><w:body><w:p><a:graphic/></w:p></w:body></w:document>`,
    // El <w:t> va dentro de su <w:r> como en un documento real: el gate ahora exige ese padre
    // (ver la regla de esquema en verificarXmlBienFormado), no solo etiquetas calzadas.
    '<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t xml:space="preserve">x</w:t></w:r></w:p></w:body></w:document>',
  ]) {
    const ok = verificarXmlBienFormado(bueno);
    assert.equal(ok.valido, true, `falso positivo: ${ok.error}`);
  }
});

// Segundo bug de la misma familia, destapado por el chequeo de namespaces al correrlo sobre 40
// .docx reales de la base: 2 traían un párrafo vacío AUTOCERRADO (<w:p w:rsidR="0034565C"
// w:rsidRDefault="0034565C"/>). normalizarParaIds() lo tomaba como apertura y dejaba el "/" en
// medio — `<w:p …/ w14:paraId="…">` — corrompiendo el documento igual que el de la firma.
test('normalizarParaIds no corrompe un párrafo vacío autocerrado (regresión <w:p .../>)', () => {
  const xml = '<w:document xmlns:w="urn:w"><w:body>'
    + '<w:p w:rsidR="0034565C" w:rsidRDefault="0034565C"/>'
    + '<w:p><w:r><w:t>con contenido</w:t></w:r></w:p>'
    + '</w:body></w:document>';
  const { xml: norm } = normalizarParaIds(xml);

  const chequeo = verificarXmlBienFormado(norm);
  assert.equal(chequeo.valido, true, `quedó mal formado: ${chequeo.error}`);
  assert.doesNotMatch(norm, /\/\s+w14:paraId/, 'el "/" del autocierre no puede quedar antes de los atributos nuevos');
  assert.equal((norm.match(/<w:p\b/g) || []).length, 2, 'el conteo de párrafos no cambia (lo compara verificarParrafos)');
  assert.equal((norm.match(/<\/w:p>/g) || []).length, 2, 'el autocerrado se expande a apertura + cierre');
  // Y el párrafo ahora es visible para el resto del módulo, que exige </w:p> para ubicarlo.
  assert.equal(listarParrafos(norm).length, 2, 'listarParrafos debe ver los 2 párrafos, no 1');
  assert.match(norm, /w:rsidR="0034565C"/, 'los atributos originales se conservan');
});

// Tercer bug de la misma familia, también destapado al validar anexos reales (caso
// "Formularios.docx"): una TABLA DENTRO DE UNA CELDA de otra tabla. El no-greedy que extraía los
// bloques cerraba la tabla externa en el </w:tbl> de la interna → el fragmento salía con <w:tc> sin
// cerrar y los ordinales de párrafo se contaban sobre el trozo truncado.
test('dividirPorFormularios respeta las tablas anidadas (regresión tabla dentro de celda)', async () => {
  const celdaConTablaAnidada =
    '<w:tc><w:tcPr/><w:tbl><w:tblPr/><w:tr><w:tc><w:tcPr/>'
    + '<w:p w14:paraId="0000B101"><w:r><w:t>interna 1</w:t></w:r></w:p>'
    + '<w:p w14:paraId="0000B102"><w:r><w:t>interna 2</w:t></w:r></w:p>'
    + '</w:tc></w:tr></w:tbl>'
    + '<w:p w14:paraId="0000B103"><w:r><w:t>externa, después de la anidada</w:t></w:r></w:p>'
    + '</w:tc>';
  const xml =
    '<w:document xmlns:w="urn:w" xmlns:w14="urn:w14"><w:body>'
    + '<w:p w14:paraId="0000B001"><w:r><w:t>FORMULARIO N°1</w:t></w:r></w:p>'
    + `<w:tbl><w:tblPr/><w:tr>${celdaConTablaAnidada}</w:tr></w:tbl>`
    + '<w:p w14:paraId="0000B002"><w:r><w:t>FORMULARIO N°2</w:t></w:r></w:p>'
    + '<w:p w14:paraId="0000B003"><w:r><w:t>contenido del 2</w:t></w:r></w:p>'
    + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>'
    + '</w:body></w:document>';

  // Los ordinales tienen que cubrir TODOS los párrafos: 6 en total (3 sueltos + 3 dentro de las
  // tablas). Si la tabla externa se corta en la interna, el último indiceFin se queda corto y los
  // rangos de formulario —que anexos-rellenar usa para ubicar campos— apuntan al lugar equivocado.
  const forms = detectarFormularios(xml);
  assert.equal(forms.length, 2, 'debe detectar los 2 formularios');
  assert.equal(listarParrafos(xml).length, 6, 'el documento de prueba tiene 6 párrafos');
  assert.equal(forms[forms.length - 1].indiceFin, 5,
    'el último ordinal debe llegar al total de párrafos (misma numeración que listarParrafos)');

  const zip = new JSZip();
  zip.file('word/document.xml', xml);
  const fragmentos = await dividirPorFormularios(await zip.generateAsync({ type: 'nodebuffer' }), xml);
  assert.equal(fragmentos.length, 2);

  const { xml: xmlN1 } = await abrirDocx(fragmentos[0].buffer);
  const chequeo = verificarXmlBienFormado(xmlN1);
  assert.equal(chequeo.valido, true, `el fragmento con la tabla anidada quedó mal formado: ${chequeo.error}`);
  assert.equal((xmlN1.match(/<w:tbl\b/g) || []).length, 2, 'las 2 tablas (externa + anidada) entran completas');
  assert.equal((xmlN1.match(/<\/w:tbl>/g) || []).length, 2, 'con sus 2 cierres');
  assert.match(xmlN1, /externa, después de la anidada/, 'el contenido de la externa POSTERIOR a la anidada no se pierde');
});

test('la firma queda válida en TODOS los fragmentos aunque LibreOffice declare xmlns:a solo localmente', async () => {
  const { zip, xml } = await abrirDocx(await docxDePrueba());
  const { xml: xmlNorm } = normalizarParaIds(xml);
  assert.equal(/xmlns:a\s*=/.test(xmlNorm.match(/<w:document\b[^>]*>/)![0]), false,
    'precondición del caso real: la raíz NO declara xmlns:a, pero el XML sí lo tiene (local, en el dibujo de LibreOffice)');
  assert.ok(xmlNorm.includes('xmlns:a='), 'precondición: hay una declaración local que engañaba al chequeo global');

  // Dos firmas: una en el formulario que YA trae el dibujo de LibreOffice, otra en el que no.
  let xmlFinal = await insertarImagenEnParrafo(zip, xmlNorm, '0000A002', PNG_1X1, 'png');
  xmlFinal = await insertarImagenEnParrafo(zip, xmlFinal, '0000A005', PNG_1X1, 'png');

  const combinado = await guardarDocx(zip, xmlFinal);
  const chequeoCombinado = verificarXmlBienFormado(xmlFinal);
  assert.equal(chequeoCombinado.valido, true, `el combinado quedó inválido: ${chequeoCombinado.error}`);
  assert.equal((xmlFinal.match(/<a:graphicFrameLocks/g) || []).length, 2, 'deben quedar las 2 firmas');

  const fragmentos = await dividirPorFormularios(combinado, xmlFinal);
  assert.equal(fragmentos.length, 2, 'debe dividir en FORMULARIO N°1 y N°2');

  for (const f of fragmentos) {
    const { xml: xmlFrag } = await abrirDocx(f.buffer);
    const chequeo = verificarXmlBienFormado(xmlFrag);
    assert.equal(chequeo.valido, true, `fragmento ${f.nombreSufijo} inválido: ${chequeo.error}`);
    assert.equal((xmlFrag.match(/<a:graphicFrameLocks/g) || []).length, 1,
      `el fragmento ${f.nombreSufijo} debe llevarse su firma`);
  }

  // La leyenda que compartía run con la raya no se pierde al meter el dibujo (patrón B2).
  const { xml: xmlN1 } = await abrirDocx(fragmentos[0].buffer);
  assert.match(xmlN1, /Nombre Persona Natural/, 'la leyenda del párrafo de firma debe sobrevivir');
});

// BUG REAL (1057678-2-LE26, "Nombre y Firma del Oferente o su Representante Legal"): la leyenda
// pide el nombre ADEMÁS de la firma — insertarImagenEnParrafo ahora escribe el nombre debajo de
// la imagen (`nombreDebajo`). Dos fallas encontradas verificando esto contra el documento real:
// 1) un párrafo puede traer la raya partida en DOS runs (una segunda tanda de guiones sueltos,
//    a veces detrás de un <w:tab/>) — la segunda sobrevivía intacta al lado del nombre;
// 2) un run de raya puede traer ESPACIOS antes de los guiones ("    ______"), y el recorte de
//    "resto de texto" solo esperaba que empezara directo en un guión — con espacio adelante no
//    recortaba nada y la raya completa se conservaba como si fuera texto de leyenda real.
test('insertarImagenEnParrafo con nombreDebajo no deja rayas sueltas (regresión 1057678-2-LE26)', async () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="urn:ct"><Default Extension="xml" ContentType="application/xml"/></Types>');
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');

  // Raya principal partida de la raya sobrante por un <w:tab/>, y la sobrante con espacios antes
  // de los guiones — el patrón exacto encontrado en el documento real.
  const parrafo = '<w:p w14:paraId="0000B001" w14:textId="77777777">'
    + '<w:r><w:t xml:space="preserve">___________________________________</w:t></w:r>'
    + '<w:r><w:tab/><w:t xml:space="preserve">   _________________________________________________</w:t></w:r>'
    + '</w:p>';
  const xml = `<w:document xmlns:w="urn:w" xmlns:w14="urn:w14"><w:body>${parrafo}`
    + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>';

  const final = await insertarImagenEnParrafo(zip, xml, '0000B001', PNG_1X1, 'png', { nombreDebajo: 'Lidia Valenzuela' });

  assert.match(final, /Lidia Valenzuela/, 'el nombre debe quedar escrito');
  assert.doesNotMatch(final, /_{5,}/, `no debe sobrevivir ninguna raya de guiones: ${final}`);
  const chequeo = verificarXmlBienFormado(final);
  assert.equal(chequeo.valido, true, `quedó mal formado: ${chequeo.error}`);
});

// BUG REAL (1426039-8-LE26, 10-ago-2026): "Nombre, RUT y Firma Representante Legal" pide TRES
// cosas — antes nombreDebajo solo aceptaba un string, así que solo el nombre salía escrito y el
// RUT que la leyenda pedía explícito no aparecía en ningún lugar del documento generado.
test('insertarImagenEnParrafo con nombreDebajo como array: nombre y RUT, cada uno en su línea (regresión 1426039-8-LE26)', async () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="urn:ct"><Default Extension="xml" ContentType="application/xml"/></Types>');
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');

  const parrafo = '<w:p w14:paraId="0000B002" w14:textId="77777777">'
    + '<w:r><w:t xml:space="preserve">___________________________________</w:t></w:r>'
    + '</w:p>';
  const xml = `<w:document xmlns:w="urn:w" xmlns:w14="urn:w14"><w:body>${parrafo}`
    + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>';

  const final = await insertarImagenEnParrafo(zip, xml, '0000B002', PNG_1X1, 'png', {
    nombreDebajo: ['Lidia Valenzuela', '6.736.698-0'],
  });

  assert.match(final, /Lidia Valenzuela/, 'el nombre debe quedar escrito');
  assert.match(final, /6\.736\.698-0/, 'el RUT debe quedar escrito');
  assert.equal([...final.matchAll(/<w:br\/>/g)].length, 2, `debe haber una línea (un <w:br\\/>) por cada dato: ${final}`);
  const chequeo = verificarXmlBienFormado(final);
  assert.equal(chequeo.valido, true, `quedó mal formado: ${chequeo.error}`);
});

// BUG REAL (1426039-8-LE26, 10-ago-2026, tercera vuelta): el usuario pidió que TODO el bloque de
// la firma —imagen, nombre y RUT si la leyenda los pide— vaya JUNTO, arriba de la leyenda: "si
// piden nombre y RUT y firma tiene que ir todo arriba". La segunda vuelta ya dejaba la imagen
// antes de la leyenda, pero nombreDebajo seguía agregándose DESPUÉS de ella — "me dejaste la
// firma arriba y el RUT y el nombre abajo". Ahora imagen+nombre+RUT quedan juntos, y la leyenda
// sola después, como pie.
test('insertarImagenEnParrafo con saltoAntesDeImagen: imagen + nombreDebajo quedan JUNTOS, ambos ANTES de la leyenda (regresión 1426039-8-LE26)', async () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="urn:ct"><Default Extension="xml" ContentType="application/xml"/></Types>');
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');

  const parrafo = '<w:p w14:paraId="0000B003" w14:textId="77777777">'
    + '<w:r><w:t xml:space="preserve">Nombre, RUT y Firma Representante Legal</w:t></w:r>'
    + '</w:p>';
  const xml = `<w:document xmlns:w="urn:w" xmlns:w14="urn:w14"><w:body>${parrafo}`
    + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>';

  const final = await insertarImagenEnParrafo(zip, xml, '0000B003', PNG_1X1, 'png', {
    conservar: true, saltoAntesDeImagen: true, nombreDebajo: ['Lidia Valenzuela', '6.736.698-0'],
  });

  const posImagen = final.indexOf('<w:drawing>');
  const posNombre = final.indexOf('Lidia Valenzuela');
  const posRut = final.indexOf('6.736.698-0');
  const posLeyenda = final.indexOf('Nombre, RUT y Firma Representante Legal');
  assert.ok(posImagen >= 0 && posLeyenda >= 0 && posNombre >= 0 && posRut >= 0, `faltó algún elemento: ${final}`);
  assert.ok(posImagen < posNombre && posNombre < posRut && posRut < posLeyenda,
    `orden esperado imagen < nombre < RUT < leyenda: img=${posImagen} nombre=${posNombre} rut=${posRut} leyenda=${posLeyenda}`);
  assert.match(final, /Nombre, RUT y Firma Representante Legal/, 'la leyenda original debe sobrevivir intacta');
  const chequeo = verificarXmlBienFormado(final);
  assert.equal(chequeo.valido, true, `quedó mal formado: ${chequeo.error}`);
});
