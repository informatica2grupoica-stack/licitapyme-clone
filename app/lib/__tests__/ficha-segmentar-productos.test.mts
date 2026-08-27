// Tests de la SEGMENTACIÓN por producto de una ficha de proveedor multi-página (migración 82).
// Correr con:
//   npx tsx --test app/lib/__tests__/ficha-segmentar-productos.test.mts
//
// El fixture es un PDF de 5 páginas construido EN MEMORIA con pdf-lib (drawText), reproduciendo
// la estructura del documento REAL que originó esto (2446-240-LE26 / Tecnomaq): página 1 el primer
// producto, página 2 un accesorio SUYO, página 3 el segundo producto, páginas 4-5 condiciones
// generales que no son de ningún producto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { segmentarFichaPorProducto } from '../ficha-segmentar-productos';

async function pdfConPaginas(textosPorPagina: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const texto of textosPorPagina) {
    const page = doc.addPage([595, 842]);
    let y = 800;
    for (const linea of texto.split('\n')) {
      page.drawText(linea, { x: 40, y, size: 12, font });
      y -= 18;
    }
  }
  return Buffer.from(await doc.save());
}

const PAGINAS_REALES = [
  'HIDROLAVADORA PEATONAL - TECNOMAQ H300\nPresion de servicio bar max 285 max\nPresion de servicio bar 255',
  'PLATO DE LAVADO 22" INOX / 5000 PSI-350 BAR /40 LPM - MARCA TECNOMAQ PA22\nMax.Psi 4000 - 275 Bar',
  'VACUOLAVADORA DIMER DB51\nProductividad maxima x hora 2890 m2/h\nMotor del cepillo 550 w',
  'INDUCCION INCLUIDA:\nHIDROLAVADORA Y EQUIPO COMPLEMENTARIO:\n1. Incluye induccion sobre funcionamiento',
  'GENERALIDADES\n1. TODO EL EQUIPAMIENTO ES NUEVO Y SIN USO.\n7. GARANTIA 12 MESES',
];

const NOMBRES = [
  'Hidrolavadora peatonal equivalente a modelo H300 de Tecnomaq + 2 (Dos) plato de lavado 22" inoxidable',
  'Vacuolavadora de empuje equivalente a modelo DB51 Dimer + 3 Rodillos (multipropósito orientado a exteriores) + 3 Squeegee',
];

test('caso real 2446-240-LE26: reparte cada página al producto correcto', async () => {
  const buffer = await pdfConPaginas(PAGINAS_REALES);
  const productos = await segmentarFichaPorProducto(buffer, NOMBRES);
  assert.equal(productos.length, 2);

  assert.deepEqual(productos[0].paginas, [0, 1], 'Hidrolavadora (pág. 1) + su accesorio Plato de lavado (pág. 2)');
  assert.match(productos[0].texto, /H300/);

  assert.deepEqual(productos[1].paginas, [2], 'Vacuolavadora — SOLO su propia página');
  assert.match(productos[1].texto, /DB51/);
  // La foto/texto del producto 0 no debe filtrarse al 1 — es justo lo que se rompía antes.
  assert.doesNotMatch(productos[1].texto, /H300/);
});

test('páginas administrativas (INDUCCIÓN, GENERALIDADES) quedan SIN asignar a ningún producto', async () => {
  const buffer = await pdfConPaginas(PAGINAS_REALES);
  const productos = await segmentarFichaPorProducto(buffer, NOMBRES);
  const todasLasAsignadas = [...productos[0].paginas, ...productos[1].paginas];
  assert.ok(!todasLasAsignadas.includes(3), 'la página de INDUCCIÓN no debe quedar pegada a ningún producto');
  assert.ok(!todasLasAsignadas.includes(4), 'la página de GENERALIDADES no debe quedar pegada a ningún producto');
});

test('con un solo producto en la línea, no segmenta nada (no hace falta)', async () => {
  const buffer = await pdfConPaginas(['Cualquier cosa']);
  const productos = await segmentarFichaPorProducto(buffer, ['Barredora vial modelo X']);
  assert.equal(productos.length, 1);
  assert.deepEqual(productos[0].paginas, []);
});

test('un buffer que no es un PDF válido no lanza — devuelve todo sin asignar', async () => {
  const productos = await segmentarFichaPorProducto(Buffer.from('no es un pdf'), NOMBRES);
  assert.equal(productos.length, 2);
  assert.deepEqual(productos[0].paginas, []);
  assert.deepEqual(productos[1].paginas, []);
});
