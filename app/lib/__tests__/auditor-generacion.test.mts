// Reglas de "¿ya se puede generar el anexo de este bloque?" (18-ago-2026).
//   npx tsx --test app/lib/__tests__/auditor-generacion.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidirGeneracion, type DocumentoCandidato } from '../auditor-generacion';

const DOCS: DocumentoCandidato[] = [
  { id: 1, nombre: 'ANEXO_N1_IDENTIFICACION.docx', categoria: 'administrativo' },
  { id: 2, nombre: 'ANEXO_N3_OFERTA_ECONOMICA.docx', categoria: 'economico' },
  { id: 3, nombre: 'ANEXO_N4_OFERTA_TECNICA.docx', categoria: 'tecnico' },
];
const aprobados = (n: number) => Array.from({ length: n }, () => ({ estado: 'APROBADO' }));

test('todo en orden: se puede generar y se pre-selecciona el anexo de la licitación', () => {
  const d = decidirGeneracion({ bloque: 'COMERCIAL', items: aprobados(3), hayCosteoVigente: true, documentos: DOCS });
  assert.equal(d.puede, true);
  // El documento es el de la LICITACIÓN, nunca una plantilla nuestra.
  assert.equal(d.documentoSugerido?.nombre, 'ANEXO_N3_OFERTA_ECONOMICA.docx');
  assert.deepEqual(d.alternativas, []);
});

test('sin costeo cargado no se genera el económico, y lo dice', () => {
  const d = decidirGeneracion({ bloque: 'COMERCIAL', items: aprobados(3), hayCosteoVigente: false, documentos: DOCS });
  assert.equal(d.puede, false);
  assert.match(d.motivo, /costeo/i);
  assert.equal(d.documentoSugerido, null);
});

// El bloque técnico no depende del costeo: su dato viene de la ficha técnica del producto.
test('el técnico no exige costeo', () => {
  const d = decidirGeneracion({ bloque: 'TECNICO', items: aprobados(2), hayCosteoVigente: false, documentos: DOCS });
  assert.equal(d.puede, true);
  assert.equal(d.documentoSugerido?.nombre, 'ANEXO_N4_OFERTA_TECNICA.docx');
});

test('sin la visación del asesor no se genera', () => {
  const items = [...aprobados(2), { estado: 'CARGADO' }];
  const d = decidirGeneracion({ bloque: 'COMERCIAL', items, hayCosteoVigente: true, documentos: DOCS });
  assert.equal(d.puede, false);
  assert.match(d.motivo, /por aprobar/i);
});

test('un punto OBSERVADO da un motivo distinto: hay que corregirlo, no solo esperar', () => {
  const items = [...aprobados(2), { estado: 'OBSERVADO' }];
  const d = decidirGeneracion({ bloque: 'COMERCIAL', items, hayCosteoVigente: true, documentos: DOCS });
  assert.equal(d.puede, false);
  assert.match(d.motivo, /observado/i);
});

// Un anexo económico generado desde cifras que el asesor no vio es justo lo que la doble firma
// existe para impedir.
test('si el costeo cambió después de aprobar, se exige volver a visar', () => {
  const d = decidirGeneracion({
    bloque: 'COMERCIAL', items: aprobados(3), hayCosteoVigente: true, documentos: DOCS,
    costeoCambiadoTrasAprobar: true,
  });
  assert.equal(d.puede, false);
  assert.match(d.motivo, /volver a visar|cambió/i);
});

// Hay licitaciones que no piden anexo técnico: eso NO es un error, y el botón simplemente no va.
test('si la licitación no trae ese anexo, no se ofrece generar', () => {
  const soloAdmin = DOCS.filter(d => d.categoria === 'administrativo');
  const d = decidirGeneracion({ bloque: 'TECNICO', items: aprobados(2), hayCosteoVigente: true, documentos: soloAdmin });
  assert.equal(d.puede, false);
  assert.match(d.motivo, /no trae ning[úu]n anexo/i);
});

test('con varios anexos de la categoría, se pide confirmar cuál', () => {
  const docs = [...DOCS, { id: 4, nombre: 'ANEXO_N3B_PRESUPUESTO_DETALLADO.docx', categoria: 'economico' as const }];
  const d = decidirGeneracion({ bloque: 'COMERCIAL', items: aprobados(3), hayCosteoVigente: true, documentos: docs });
  assert.equal(d.puede, true);
  assert.equal(d.alternativas.length, 1);
  assert.match(d.motivo, /confirma cuál/i);
});

// Una línea que no se oferta no puede bloquear la generación por "no tener precio".
test('las líneas marcadas "no ofertamos" no bloquean', () => {
  const items = [...aprobados(2), { estado: 'PENDIENTE', ofertamos: false }];
  const d = decidirGeneracion({ bloque: 'COMERCIAL', items, hayCosteoVigente: true, documentos: DOCS });
  assert.equal(d.puede, true);
});
