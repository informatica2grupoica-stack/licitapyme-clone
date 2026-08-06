// Regresión de la división de anexos por formulario (5-ago-2026). Correr con:
//   npx tsx --test app/lib/__tests__/anexos-dividir.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarParaIds, verificarXmlBienFormado, eliminarRespaldoVmlDuplicado, abrirDocx } from '../anexos-docx';
import { dividirPorFormularios, detectarFormularios } from '../anexos-dividir';
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
