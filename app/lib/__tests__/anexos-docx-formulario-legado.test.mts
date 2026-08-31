// BUG REAL (31-ago-2026, 1042-9-LE26, F3_Declaración_de_Postulación_y_Compromiso y
// F4_Declaración_Jurada_Simple): los blancos de estos dos documentos no son rayas de "_" — son
// campos de la barra de herramientas VIEJA de Word ("Formularios", Ctrl+F9), que en el XML se ven
// como `<w:fldChar w:fldCharType="begin"><w:ffData>...<w:textInput/></w:ffData></w:fldChar>` ...
// `<w:fldChar w:fldCharType="separate"/>` ... [runs con el valor actual] ... `<w:fldChar
// w:fldCharType="end"/>`. Ninguna otra capa del módulo sabe leer eso, así que ambos documentos se
// generaban con 0 casillas detectadas — ni un aviso de que algo estaba mal.
//
// sustituirCamposFormularioLegado() traduce cada campo entero a UN run con una raya de "_", antes
// de que el resto del pipeline (detección, resolución, escritura) lo vea — así no hace falta
// enseñarle este formato a cada capa por separado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sustituirCamposFormularioLegado, listarParrafos } from '../anexos-docx';

// Reproduce la forma real de un campo de texto legado tal como lo emite Word, con dos runs de
// "valor actual" (Word puede repartir el placeholder en varios <w:t> con un espacio cada uno).
const campoTexto = (nombre: string) =>
  '<w:r><w:fldChar w:fldCharType="begin">'
  + `<w:ffData><w:name w:val="${nombre}"/><w:enabled/><w:calcOnExit w:val="0"/><w:textInput/></w:ffData>`
  + '</w:fldChar></w:r>'
  + `<w:bookmarkStart w:id="0" w:name="${nombre}"/>`
  + '<w:r><w:instrText xml:space="preserve"> FORMTEXT </w:instrText></w:r>'
  + '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
  + '<w:r><w:rPr><w:rFonts w:ascii="Verdana"/><w:sz w:val="20"/></w:rPr><w:t> </w:t></w:r>'
  + '<w:r><w:rPr><w:rFonts w:ascii="Verdana"/><w:sz w:val="20"/></w:rPr><w:t> </w:t></w:r>'
  + '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
  + '<w:bookmarkEnd w:id="0"/>';

// listarParrafos exige w14:paraId — un valor fijo alcanza, este módulo no depende de que sea único.
const parrafo = (texto: string) => `<w:p w14:paraId="00000001">${texto}</w:p>`;
const run = (t: string) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`;

test('un campo de formulario legado se convierte en una raya de "_" normal', () => {
  const xml = parrafo(`${run('Yo, ')}${campoTexto('Texto1')}${run(', Cédula de Identidad')}`);
  const out = sustituirCamposFormularioLegado(xml);
  assert.equal(/<w:fldChar|<w:ffData|<w:textInput/.test(out), false, 'no debe quedar rastro del campo');
  assert.match(out, /_{4,}/, 'el reemplazo debe ser una raya de guiones bajos, no texto vacío');
});

test('el texto reconstruido del párrafo queda igual que si hubiera nacido con rayas', () => {
  const xml = parrafo(`${run('Yo, ')}${campoTexto('Texto1')}${run(', Cédula de Identidad N° ')}${campoTexto('Texto2')}`);
  const out = sustituirCamposFormularioLegado(xml);
  const [p] = listarParrafos(out);
  assert.match(p.texto, /^Yo, _{4,}, Cédula de Identidad N° _{4,}$/);
});

test('el conteo de párrafos y de campos no cambia entre documentos con varios campos', () => {
  const xml = [1, 2, 3].map(n => parrafo(`${run('Campo ')}${campoTexto(`Texto${n}`)}`)).join('');
  const out = sustituirCamposFormularioLegado(xml);
  assert.equal((xml.match(/<w:p>/g) || []).length, (out.match(/<w:p>/g) || []).length);
  assert.equal((out.match(/_{4,}/g) || []).length, 3);
});

test('conserva la fuente/tamaño (rPr) que traía el campo, no el formato por defecto', () => {
  const xml = parrafo(campoTexto('Texto1'));
  const out = sustituirCamposFormularioLegado(xml);
  assert.match(out, /<w:rFonts w:ascii="Verdana"\/>/);
  assert.match(out, /<w:sz w:val="20"\/>/);
});

test('un campo de CASILLA (checkbox) no se toca — solo se traduce texto libre', () => {
  const checkbox =
    '<w:r><w:fldChar w:fldCharType="begin">'
    + '<w:ffData><w:name w:val="Casilla1"/><w:enabled/><w:calcOnExit w:val="0"/>'
    + '<w:checkBox><w:sizeAuto/><w:default w:val="0"/></w:checkBox></w:ffData>'
    + '</w:fldChar></w:r>'
    + '<w:r><w:instrText xml:space="preserve"> FORMCHECKBOX </w:instrText></w:r>'
    + '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
  const xml = parrafo(checkbox);
  const out = sustituirCamposFormularioLegado(xml);
  assert.equal(out, xml, 'un checkbox no es un blanco de texto — se deja para su propio manejo');
});

test('varios campos en el mismo párrafo se traducen todos, sin mezclar begin/end de campos distintos', () => {
  const xml = parrafo(`${run('a ')}${campoTexto('Texto1')}${run(' b ')}${campoTexto('Texto2')}${run(' c')}`);
  const out = sustituirCamposFormularioLegado(xml);
  const [p] = listarParrafos(out);
  assert.match(p.texto, /^a _{4,} b _{4,} c$/);
});
