// Lector de la cláusula de adjudicación con cita verificada.
//   npx tsx --test app/lib/__tests__/clausulas-adjudicacion.test.mts
// CASO REAL 1171317-88-LE26: la frase de las bases usa "postular", que ningún regex reconocía.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extraerFragmentosClave, leerClausulaAdjudicacion, verificarCita } from '../clausulas-adjudicacion';

const BASES = {
  nombre: '52.26.1_Bases_Administrativas.pdf',
  texto: 'La Municipalidad licita materiales.\nEl presupuesto se distribuye por líneas de la siguiente forma:\n'
    + 'A) LÍNEA N°1: $30.407.287.- IMPUESTOS INCLUIDOS\nB) LÍNEA N°2: $5.152.024.- IMPUESTOS INCLUIDOS\n'
    + 'Los oferentes podrán postular a una o a ambas líneas. Cada línea será evaluada y adjudicada\n'
    + 'en forma independiente. Para que una oferta sea admisible deberá incluir el 100 % de los ítems.',
};
const RELLENO = { nombre: 'Formulario_1.docx', texto: 'Nombre del oferente: ______ Firma: ______' };
const CITA_REAL = 'Los oferentes podrán postular a una o a ambas líneas. Cada línea será evaluada y adjudicada en forma independiente.';

test('extrae la frase de las bases aunque esté partida en líneas del PDF', () => {
  const f = extraerFragmentosClave([RELLENO, BASES]);
  assert.equal(f.length, 1);
  assert.match(f[0].texto, /postular a una o a ambas líneas/);
});

test('cita textual verificada → se acepta', async () => {
  const r = await leerClausulaAdjudicacion([BASES, RELLENO], async () => ({ modo: 'POR_LINEAS', cita: CITA_REAL, documento: BASES.nombre }));
  assert.equal(r.modo, 'POR_LINEAS');
  assert.equal(r.verificada, true);
  assert.equal(r.documento, BASES.nombre);
});

test('cita inventada → se descarta (el modelo no puede afirmar sin respaldo)', async () => {
  const r = await leerClausulaAdjudicacion([BASES], async () => ({ modo: 'POR_LINEAS', cita: 'Cada línea se adjudicará a un proveedor distinto en todos los casos', documento: BASES.nombre }));
  assert.equal(r.modo, 'INDETERMINADO');
  assert.equal(r.verificada, false);
});

test('el documento citado por el modelo puede estar mal: se busca en todos', async () => {
  const r = await leerClausulaAdjudicacion([RELLENO, BASES], async () => ({ modo: 'POR_LINEAS', cita: CITA_REAL, documento: 'otro.pdf' }));
  assert.equal(r.verificada, true);
  assert.equal(r.documento, BASES.nombre);
});

test('respuesta INDETERMINADO, sin cita o error del modelo → INDETERMINADO sin lanzar', async () => {
  assert.equal((await leerClausulaAdjudicacion([BASES], async () => ({ modo: 'INDETERMINADO', cita: null }))).modo, 'INDETERMINADO');
  assert.equal((await leerClausulaAdjudicacion([BASES], async () => ({ modo: 'GLOBAL', cita: '' }))).verificada, false);
  assert.equal((await leerClausulaAdjudicacion([BASES], async () => { throw new Error('timeout'); })).modo, 'INDETERMINADO');
});

test('sin fragmentos relevantes no se llama al modelo', async () => {
  let llamadas = 0;
  const r = await leerClausulaAdjudicacion([RELLENO], async () => { llamadas++; return {}; });
  assert.equal(llamadas, 0);
  assert.equal(r.modo, 'INDETERMINADO');
});

test('verificarCita ignora tildes, mayúsculas y saltos de línea; rechaza citas cortas', () => {
  assert.equal(verificarCita('LOS OFERENTES PODRAN POSTULAR A UNA O A AMBAS LINEAS', [BASES]), BASES.nombre);
  assert.equal(verificarCita('una o a', [BASES]), null);
});
