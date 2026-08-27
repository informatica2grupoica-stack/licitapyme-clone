// Tests de etiquetasDistinguibles — los botones de "generar anexo" tienen que decir CUÁL es cuál.
// Correr con:
//   npx tsx --test app/lib/__tests__/auditor-generacion-etiquetas.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { etiquetasDistinguibles } from '../auditor-generacion';

// CASO REAL que motivó todo (1057922-23-LE26): 7 anexos técnicos cuyo prefijo común
// "FORMULARIO_N3_ESPECIFICACIONES_TÉCNICAS_" mide EXACTAMENTE 40 caracteres — justo el largo al
// que la pantalla cortaba el nombre. Los 7 botones salían idénticos y elegir era imposible.
const REALES = [
  'FORMULARIO_N3_ESPECIFICACIONES_TÉCNICAS_SET_HERRAMIENTAS.docx',
  'FORMULARIO_N3_ESPECIFICACIONES_TÉCNICAS_CARRO_ASEO_C_ESTRUJAMOPAS.docx',
  'FORMULARIO_N3_ESPECIFICACIONES_TÉCNICAS_CARRO_YEGUA.docx',
  'FORMULARIO_N3_ESPECIFICACIONES_TÉCNICAS_ESCALERA_2_PELDAÑOS.docx',
  'FORMULARIO_N3_ESPECIFICACIONES_TÉCNICAS_PALLET.docx',
  'FORMULARIO_N3_ESPECIFICACIONES_TÉCNICAS_ROMANA.docx',
  'FORMULARIO_N3_ESPECIFICACIONES_TÉCNICAS_TERMOHIGÓMETRO.docx',
];

test('los 7 anexos reales quedan todos distintos entre sí', () => {
  const e = etiquetasDistinguibles(REALES);
  assert.equal(new Set(e).size, REALES.length, `hay etiquetas repetidas: ${JSON.stringify(e)}`);
});

test('la etiqueta muestra el producto, no el prefijo compartido', () => {
  const e = etiquetasDistinguibles(REALES);
  assert.equal(e[5], 'Romana');
  assert.equal(e[4], 'Pallet');
  assert.ok(e[0].toLowerCase().includes('set herramientas'));
  for (const x of e) assert.ok(!x.startsWith('FORMULARIO'), `todavía muestra el prefijo: ${x}`);
});

test('se le quita la extensión', () => {
  for (const x of etiquetasDistinguibles(REALES)) assert.ok(!/\.docx$/i.test(x));
});

// Con un solo candidato no hay nada que distinguir; igual se limpia para que se lea.
test('un solo documento conserva su nombre legible', () => {
  assert.equal(etiquetasDistinguibles(['ANEXO_N5_FICHA_TECNICA.docx'])[0], 'Anexo n5 ficha tecnica');
});

// No se corta a mitad de palabra: el prefijo común entre "PALLET" y "PALLETIZADO" es "PALLET",
// pero recortar ahí dejaría "IZADO", que no se entiende.
test('el recorte respeta el separador, no parte palabras', () => {
  const e = etiquetasDistinguibles(['FORM_PALLET.docx', 'FORM_PALLETIZADO.docx']);
  assert.deepEqual(e, ['Pallet', 'Palletizado']);
});

// Si a alguno le quedara la etiqueta vacía (su nombre es prefijo de los otros), se prefiere el
// nombre completo: largo pero inequívoco es mejor que corto y ambiguo.
test('si el recorte dejaría una etiqueta vacía, se devuelven los nombres completos', () => {
  const e = etiquetasDistinguibles(['ANEXO_TECNICO.docx', 'ANEXO_TECNICO_2.docx']);
  assert.equal(new Set(e).size, 2);
  assert.ok(e.every(x => x.length > 0));
});

test('sin nombres o con uno vacío no revienta', () => {
  assert.deepEqual(etiquetasDistinguibles([]), []);
  assert.equal(etiquetasDistinguibles(['']).length, 1);
});

test('nombres que no comparten prefijo quedan tal cual', () => {
  const e = etiquetasDistinguibles(['ANEXO_5.docx', 'FORMULARIO_3.docx']);
  assert.equal(new Set(e).size, 2);
  assert.ok(e[0].toLowerCase().includes('anexo'));
  assert.ok(e[1].toLowerCase().includes('formulario'));
});
