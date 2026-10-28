// Regresión del gate "¿este PDF es texto real o hay que OCR-earlo?" (document-extraction.ts).
// Caso real: 4469-159-LE26 (sep-2026) — un decreto de 2 páginas con considerandos legales muy
// densos + 46 páginas ESCANEADAS pegadas atrás (las bases técnicas reales, con las
// especificaciones del producto que el chat/viabilidad debían leer) promediaba 132 chars/pág:
// pasaba el umbral de densidad GLOBAL (≥120) aunque el 96% del documento estuviera en blanco.
// El chat nunca vio las características del producto porque esas 46 páginas quedaron mudas,
// sin ni siquiera la marca OCR_NO_DISPONIBLE que el resto del sistema sabe interpretar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluarCapaDeTextoPdf, construirTextoPdfConHuecos } from '../document-extraction';

test('evaluarCapaDeTextoPdf: caso real 4469-159-LE26 — 2 págs densas + 46 vacías NO pasa como texto', () => {
  const chunksPorPagina = [2686, 3664, ...Array(46).fill(0)];
  const textoReal = 'x'.repeat(2686 + 3664); // 6350 chars reales, densidad 132/pág (pasaría el umbral global solo)
  const r = evaluarCapaDeTextoPdf(chunksPorPagina, textoReal, false);
  assert.equal(r.tieneCapaDeTexto, false, 'con 96% de páginas vacías debe tratarse como escaneado, aunque la densidad global sea alta');
  assert.equal(r.paginasVaciasIdx.length, 46);
  assert.ok(r.fraccionVacias > 0.3);
});

test('evaluarCapaDeTextoPdf: documento de texto normal, sin páginas vacías, SÍ pasa', () => {
  const chunksPorPagina = Array(10).fill(1500); // 15.000 chars, 10 págs, densidad 1500/pág
  const textoReal = 'x'.repeat(15000);
  const r = evaluarCapaDeTextoPdf(chunksPorPagina, textoReal, false);
  assert.equal(r.tieneCapaDeTexto, true);
  assert.deepEqual(r.paginasVaciasIdx, []);
});

test('evaluarCapaDeTextoPdf: documento MIXTO con pocas páginas vacías (bajo el 30%) sigue pasando, pero las reporta', () => {
  // 40 páginas de texto normal + 3 páginas escaneadas sueltas en el medio (7.5% del doc):
  // no debe caer al camino 100%-OCR (sería carísimo re-OCR-ear 40 páginas buenas), pero SÍ
  // debe devolver esas 3 páginas para que se rellenen puntualmente (ver rellenarPaginasVaciasEnTextoPdf).
  const chunksPorPagina = Array(43).fill(1200);
  chunksPorPagina[10] = 0; chunksPorPagina[20] = 0; chunksPorPagina[30] = 0;
  const textoReal = 'x'.repeat(1200 * 40);
  const r = evaluarCapaDeTextoPdf(chunksPorPagina, textoReal, false);
  assert.equal(r.tieneCapaDeTexto, true, 'con solo 3/43 páginas vacías (7%) sigue siendo mayormente texto real');
  assert.deepEqual(r.paginasVaciasIdx, [11, 21, 31]);
});

test('evaluarCapaDeTextoPdf: PDF 100% escaneado (todas las páginas vacías) no pasa', () => {
  const chunksPorPagina = Array(33).fill(0);
  const r = evaluarCapaDeTextoPdf(chunksPorPagina, '', false);
  assert.equal(r.tieneCapaDeTexto, false);
  assert.equal(r.paginasVaciasIdx.length, 33);
});

test('evaluarCapaDeTextoPdf: capa de texto basura (OCR de escáner ilegible) no pasa aunque no haya páginas vacías', () => {
  const chunksPorPagina = Array(5).fill(400);
  const r = evaluarCapaDeTextoPdf(chunksPorPagina, 'x'.repeat(2000), true);
  assert.equal(r.tieneCapaDeTexto, false);
});

test('construirTextoPdfConHuecos: página vacía al medio queda marcada, las vecinas intactas', () => {
  const paginas = ['Hola', '', 'Chao'];
  const out = construirTextoPdfConHuecos(paginas, [2]);
  assert.match(out, /\[\[PÁGINA 2\]\]\n\[OCR_NO_DISPONIBLE:/);
  assert.match(out, /\[\[PÁGINA 1\]\]\nHola/);
  assert.match(out, /\[\[PÁGINA 3\]\]\nChao/);
});

test('construirTextoPdfConHuecos: primera y última página vacías (bordes del documento)', () => {
  const paginas = ['', 'Medio', ''];
  const out = construirTextoPdfConHuecos(paginas, [1, 3]);
  assert.match(out, /\[\[PÁGINA 1\]\]\n\[OCR_NO_DISPONIBLE:/);
  assert.match(out, /\[\[PÁGINA 3\]\]\n\[OCR_NO_DISPONIBLE:/);
  assert.match(out, /\[\[PÁGINA 2\]\]\nMedio/);
});

test('construirTextoPdfConHuecos: varias páginas vacías consecutivas se marcan todas, ninguna se pierde', () => {
  // Este es exactamente el caso que rompía la versión anterior basada en regex: páginas vacías
  // seguidas producían una cantidad de saltos de línea entre marcadores que el regex no preveía.
  const paginas = ['A', '', '', '', 'E'];
  const out = construirTextoPdfConHuecos(paginas, [2, 3, 4]);
  for (const n of [2, 3, 4]) {
    assert.match(out, new RegExp(`\\[\\[PÁGINA ${n}\\]\\]\\n\\[OCR_NO_DISPONIBLE:`), `página ${n} debe quedar marcada`);
  }
  assert.match(out, /\[\[PÁGINA 1\]\]\nA/);
  assert.match(out, /\[\[PÁGINA 5\]\]\nE/);
});

test('construirTextoPdfConHuecos: sin páginas vacías, reproduce el texto real de cada página', () => {
  const paginas = ['A', 'B'];
  const out = construirTextoPdfConHuecos(paginas, []);
  assert.match(out, /\[\[PÁGINA 1\]\]\nA/);
  assert.match(out, /\[\[PÁGINA 2\]\]\nB/);
  assert.ok(!out.includes('OCR_NO_DISPONIBLE'));
});

// Word con imágenes dentro de una tabla: convertToHtml() las incrustaba como base64 en el HTML de
// tablas que se anexa al texto (oct-2026: 99 docs de documentos_cache inflados, un anexo de 1.289
// caracteres quedaba con 1,27 M). Las filas y celdas de texto se deben conservar.
test('extractTextFromDocument (docx): tabla con imagen conserva celdas y no lleva base64', async () => {
  const { Document, Packer, Paragraph, Table, TableRow, TableCell, ImageRun } = await import('docx');
  const { extractTextFromDocument } = await import('../document-extraction');
  // PNG 1x1 válido, repetido como 200 imágenes para que el base64 se notara en el largo.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const celda = (t: string) => new TableCell({ children: [new Paragraph(t)] });
  const doc = new Document({ sections: [{ children: [
    new Paragraph('ANEXO N°4 ITEMIZADO'),
    new Table({ rows: [
      new TableRow({ children: [celda('Ítem'), celda('Producto'), celda('Logo')] }),
      new TableRow({ children: [celda('1'), celda('Silla ergonómica'), new TableCell({
        children: [new Paragraph({ children: Array.from({ length: 200 }, () => new ImageRun({ type: 'png', data: png, transformation: { width: 10, height: 10 } })) })],
      })] }),
    ] }),
  ] }] });
  const buffer = await Packer.toBuffer(doc);
  const r = await extractTextFromDocument(buffer, 'docx', 'prueba.docx');
  assert.equal(r.metodo, 'word');
  assert.ok(!/base64|<img/i.test(r.texto), 'el texto no debe llevar imágenes');
  assert.match(r.texto, /<tr><td><p>1<\/p><\/td><td><p>Silla ergonómica<\/p><\/td>/);
  assert.ok(r.texto.length < 2000, `largo ${r.texto.length}`);
});
