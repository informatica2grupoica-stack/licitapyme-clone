// Tests de la extracción de la FOTO DEL PRODUCTO desde la ficha del proveedor (PDF).
// Correr con:
//   npx tsx --test app/lib/__tests__/ficha-imagen-extraer.test.mts
//
// Los fixtures son PDFs construidos EN MEMORIA con pdf-lib (imágenes PNG sólidas generadas a
// mano con zlib) — así el test ejercita el mecanismo real (mupdf leyendo un PDF real) sin
// depender de un archivo externo en el repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { PDFDocument, rgb } from 'pdf-lib';
import { extraerImagenProducto } from '../ficha-imagen-extraer';

// ─── PNG sólido mínimo, sin depender de sharp/canvas ──────────────────────────────────────────
const CRC_TABLA = (() => {
  const tabla = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabla[n] = c >>> 0;
  }
  return tabla;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLA[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(tipo: string, data: Buffer): Buffer {
  const tipoBuf = Buffer.from(tipo, 'ascii');
  const largo = Buffer.alloc(4); largo.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tipoBuf, data])));
  return Buffer.concat([largo, tipoBuf, data, crc]);
}
function pngSolido(ancho: number, alto: number, rgbColor: [number, number, number]): Buffer {
  const firma = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0); ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const fila = Buffer.alloc(1 + ancho * 3);
  for (let x = 0; x < ancho; x++) rgbColor.forEach((v, i) => { fila[1 + x * 3 + i] = v; });
  const crudo = Buffer.concat(Array.from({ length: alto }, () => fila));
  const idat = deflateSync(crudo);
  return Buffer.concat([firma, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

async function pdfConImagenes(
  imagenes: Array<{ ancho: number; alto: number; drawAncho: number; drawAlto: number; x: number; y: number }>,
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4 en puntos
  page.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: rgb(1, 1, 1) });
  for (const img of imagenes) {
    const png = pngSolido(img.ancho, img.alto, [200, 30, 30]);
    const embebida = await doc.embedPng(png);
    page.drawImage(embebida, { x: img.x, y: img.y, width: img.drawAncho, height: img.drawAlto });
  }
  return Buffer.from(await doc.save());
}

// ─── Elige la foto grande, descarta el logo chico ─────────────────────────────────────────────
test('con un logo chico y una foto grande, elige la foto grande', async () => {
  const buffer = await pdfConImagenes([
    { ancho: 40, alto: 40, drawAncho: 40, drawAlto: 40, x: 20, y: 780 },       // logo de encabezado
    { ancho: 300, alto: 220, drawAncho: 300, drawAlto: 220, x: 150, y: 400 },  // foto del producto
  ]);
  const resultado = await extraerImagenProducto(buffer);
  assert.ok(resultado, 'debería encontrar una imagen');
  assert.equal(resultado!.anchoPx, 300);
  assert.equal(resultado!.altoPx, 220);
});

// ─── Solo hay un logo chico: no hay foto de producto que elegir ───────────────────────────────
test('con solo un logo chico, no devuelve nada (evita imprimir el logo como si fuera el producto)', async () => {
  const buffer = await pdfConImagenes([
    { ancho: 40, alto: 40, drawAncho: 40, drawAlto: 40, x: 20, y: 780 },
  ]);
  const resultado = await extraerImagenProducto(buffer);
  assert.equal(resultado, null);
});

// ─── PDF sin ninguna imagen ────────────────────────────────────────────────────────────────────
test('un PDF sin imágenes devuelve null, no lanza', async () => {
  const buffer = await pdfConImagenes([]);
  const resultado = await extraerImagenProducto(buffer);
  assert.equal(resultado, null);
});

// ─── Una imagen que cubre casi toda la página (posible escaneo) se descarta ───────────────────
test('una imagen que cubre casi toda la página se descarta (probable escaneo, no foto de producto)', async () => {
  const buffer = await pdfConImagenes([
    { ancho: 595, alto: 842, drawAncho: 595, drawAlto: 842, x: 0, y: 0 },
  ]);
  const resultado = await extraerImagenProducto(buffer);
  assert.equal(resultado, null);
});

// ─── Buffer que no es un PDF válido: nunca lanza ──────────────────────────────────────────────
test('un buffer que no es un PDF válido devuelve null sin lanzar', async () => {
  const resultado = await extraerImagenProducto(Buffer.from('esto no es un PDF'));
  assert.equal(resultado, null);
});
