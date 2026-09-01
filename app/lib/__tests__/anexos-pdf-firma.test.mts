// Estampado de firma/timbre sobre el PDF ya generado (anexos-pdf-firma.ts).
//
// El test que importa acá es el de VARIAS FIRMAS (migration-84, 1-sep-2026): una empresa puede
// tener firma del titular, del suplente y de un apoderado, y un mismo anexo puede llevar más de
// una. La primera versión cacheaba la imagen embebida por TIPO ('firma'/'timbre'), así que la
// segunda firma del documento se dibujaba con la imagen de la primera — el papel salía firmado por
// la persona equivocada, que es peor que salir sin firmar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { estamparPdf, type EstampaPdf, type ImagenParaEstampar } from '../anexos-pdf-firma';

// PNG 1x1 real, uno por color. Lo que se mide no son los bytes (pdf-lib reescribe el stream) sino
// CUÁNTOS objetos de imagen quedan en el PDF: con el caché viejo, por tipo, dos firmas distintas
// compartían una sola imagen — la segunda salía dibujada con la firma de la primera.
const PNG_ROJO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');
const PNG_AZUL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwAEhQGAVQrXPgAAAABJRU5ErkJggg==',
  'base64');

const imagen = (buffer: Buffer): ImagenParaEstampar => ({ buffer, extension: 'png' });

async function pdfDeUnaPagina(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  return Buffer.from(await doc.save());
}

// Cuántos objetos de imagen quedaron en el PDF. Un PNG con transparencia embebe DOS objetos (la
// imagen y su máscara), así que el número absoluto no significa nada por sí solo — lo que se
// compara siempre es un caso contra otro.
const cuantasImagenes = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Subtype\s*\/Image/g) || []).length;

const estampa = (firmaId: number | undefined, yPct: number): EstampaPdf => ({
  tipo: 'firma', pagina: 0, xPct: 0.2, yPct, anchoPct: 0.2,
  ...(firmaId != null ? { firmaId } : {}),
});

test('estamparPdf: dos firmas distintas en el mismo PDF conservan cada una su imagen', async () => {
  const base = await pdfDeUnaPagina();
  const salida = await estamparPdf(base, [estampa(7, 0.3), estampa(9, 0.6)], {
    firma: imagen(PNG_ROJO),                       // la principal, que ninguna de las dos usa
    firmasPorId: { 7: imagen(PNG_ROJO), 9: imagen(PNG_AZUL) },
  });

  assert.equal((await PDFDocument.load(salida)).getPageCount(), 1);

  // La MISMA firma puesta dos veces comparte una sola imagen (el caché sigue sirviendo); dos firmas
  // DISTINTAS tienen que embeber estrictamente más. Con el caché viejo, por tipo, los dos casos
  // daban lo mismo: la segunda firma se dibujaba con la imagen de la primera.
  const repetida = await estamparPdf(base, [estampa(7, 0.3), estampa(7, 0.6)], {
    firmasPorId: { 7: imagen(PNG_ROJO) },
  });
  assert.ok(cuantasImagenes(salida) > cuantasImagenes(repetida),
    'dos firmas distintas tienen que quedar embebidas por separado');
});

test('estamparPdf: una estampa sin firmaId usa la firma principal (comportamiento de siempre)', async () => {
  const base = await pdfDeUnaPagina();
  const salida = await estamparPdf(base, [estampa(undefined, 0.4)], { firma: imagen(PNG_AZUL) });
  const sinFirma = await estamparPdf(base, [estampa(undefined, 0.4)], {});
  assert.ok(cuantasImagenes(salida) > cuantasImagenes(sinFirma));
});

test('estamparPdf: un firmaId que no se pudo descargar cae en la principal, no revienta', async () => {
  const base = await pdfDeUnaPagina();
  const salida = await estamparPdf(base, [estampa(42, 0.4)], { firma: imagen(PNG_ROJO), firmasPorId: {} });
  const conPrincipal = await estamparPdf(base, [estampa(undefined, 0.4)], { firma: imagen(PNG_ROJO) });
  assert.equal(cuantasImagenes(salida), cuantasImagenes(conPrincipal));
});

test('estamparPdf: sin ninguna imagen disponible el PDF sale igual, sin estampar nada', async () => {
  const base = await pdfDeUnaPagina();
  const salida = await estamparPdf(base, [estampa(1, 0.4)], {});
  assert.equal(cuantasImagenes(salida), 0);
});

test('estamparPdf: una página inexistente se ignora sin cortar el resto', async () => {
  const base = await pdfDeUnaPagina();
  const salida = await estamparPdf(
    base,
    [{ tipo: 'firma', pagina: 5, xPct: 0.2, yPct: 0.2, anchoPct: 0.2 }, estampa(undefined, 0.5)],
    { firma: imagen(PNG_AZUL) },
  );
  // La estampa de la página que no existe se ignora: queda embebida UNA sola firma, la de la 0.
  const soloUna = await estamparPdf(base, [estampa(undefined, 0.5)], { firma: imagen(PNG_AZUL) });
  assert.equal(cuantasImagenes(salida), cuantasImagenes(soloUna));
});
