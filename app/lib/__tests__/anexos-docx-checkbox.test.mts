// BUG REAL (2-sep-2026, FORMATO N°6 PROGRAMAS DE INTEGRIDAD, 4328-32-LP26, reportado por el
// usuario: "tampoco me deja marcar en los recuadros"). Los checkboxes NATIVOS de Word (control de
// contenido `<w:sdt>` con `<w14:checkbox>`) son un mecanismo TOTALMENTE distinto a un blanco de
// texto: tienen su propio interruptor interno (`<w14:checked>`) que hay que voltear a la vez que
// se actualiza el glifo visible (☐/☒), o quedan desincronizados entre sí.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marcarCheckbox } from '../anexos-docx';

// Misma estructura que trae Word de verdad: dos <w:sdt> hermanos (Cumple / No cumple), cada uno
// con su propio <w:id>, su <w14:checkbox> y un <w:p> adentro con el glifo "☐".
const filaConDosCheckbox = (marcadoCumple = '0', marcadoNoCumple = '0') => `<w:tr>
  <w:tc><w:p><w:r><w:t>Requisito de ejemplo</w:t></w:r></w:p></w:tc>
  <w:sdt><w:sdtPr><w:id w:val="1"/><w14:checkbox>
    <w14:checked w14:val="${marcadoCumple}"/>
    <w14:checkedState w14:val="2612" w14:font="MS Gothic"/>
    <w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/>
  </w14:checkbox></w:sdtPr><w:sdtContent><w:tc><w:p w14:paraId="AAAAAAAA"><w:r><w:rPr><w:rFonts w:ascii="MS Gothic" w:eastAsia="MS Gothic" w:hAnsi="MS Gothic"/></w:rPr><w:t>☐</w:t></w:r></w:p></w:tc></w:sdtContent></w:sdt>
  <w:sdt><w:sdtPr><w:id w:val="2"/><w14:checkbox>
    <w14:checked w14:val="${marcadoNoCumple}"/>
    <w14:checkedState w14:val="2612" w14:font="MS Gothic"/>
    <w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/>
  </w14:checkbox></w:sdtPr><w:sdtContent><w:tc><w:p w14:paraId="BBBBBBBB"><w:r><w:rPr><w:rFonts w:ascii="MS Gothic" w:eastAsia="MS Gothic" w:hAnsi="MS Gothic"/></w:rPr><w:t>☐</w:t></w:r></w:p></w:tc></w:sdtContent></w:sdt>
</w:tr>`;

test('marcarCheckbox: marca el interruptor interno Y el glifo visible a la vez', () => {
  const out = marcarCheckbox(filaConDosCheckbox(), 'AAAAAAAA', true);
  assert.match(out, /<w14:checked w14:val="1"\/>/, 'el interruptor interno debe quedar en 1');
  const t = out.match(/w14:paraId="AAAAAAAA"[\s\S]*?<w:t[^>]*>([^<]*)<\/w:t>/);
  assert.equal(t?.[1], '☒', 'el glifo visible debe pasar a ☒ (checkedState 2612)');
});

test('marcarCheckbox: desmarcar vuelve al interruptor en 0 y al glifo ☐', () => {
  const marcado = marcarCheckbox(filaConDosCheckbox(), 'AAAAAAAA', true);
  const desmarcado = marcarCheckbox(marcado, 'AAAAAAAA', false);
  assert.match(desmarcado, /<w14:checked w14:val="0"\/>/);
  const t = desmarcado.match(/w14:paraId="AAAAAAAA"[\s\S]*?<w:t[^>]*>([^<]*)<\/w:t>/);
  assert.equal(t?.[1], '☐');
});

test('marcarCheckbox: marcar el primero NO toca el segundo (cada <w:sdt> es independiente)', () => {
  const out = marcarCheckbox(filaConDosCheckbox(), 'AAAAAAAA', true);
  const tSegundo = out.match(/w14:paraId="BBBBBBBB"[\s\S]*?<w:t[^>]*>([^<]*)<\/w:t>/);
  assert.equal(tSegundo?.[1], '☐', 'el checkbox hermano debe seguir sin marcar');
});

test('marcarCheckbox: revienta con un aviso claro si el paraId no existe (no falla en silencio)', () => {
  assert.throws(() => marcarCheckbox(filaConDosCheckbox(), '99999999', true), /No se encontró el párrafo/);
});

test('marcarCheckbox: revienta si el párrafo existe pero no es un checkbox (nunca escribe texto por error)', () => {
  const xml = '<w:p w14:paraId="CCCCCCCC"><w:r><w:t>texto normal</w:t></w:r></w:p>';
  assert.throws(() => marcarCheckbox(xml, 'CCCCCCCC', true), /no vive dentro de un <w:sdt>/);
});
