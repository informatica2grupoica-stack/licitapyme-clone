// Nuestra ficha técnica en WORD (27-oct-2026): se abre y se edita; mismo contenido que la versión PDF, sin marca ni modelo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { construirFichaTecnicaDocx, leerImagen } from '../ficha-tecnica-docx';

// PNG de 1×1 y la cabecera de un JPEG de 40×30 (SOF0).
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const JPG = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 30, 0x00, 40, 0x03, 0, 0, 0, 0, 0, 0, 0, 0]).toString('base64');

test('leerImagen: tamaño de PNG y JPG desde su cabecera; WEBP u otra cosa, no', () => {
  assert.deepEqual([leerImagen(PNG)?.type, leerImagen(PNG)?.w, leerImagen(PNG)?.h], ['png', 1, 1]);
  assert.deepEqual([leerImagen(JPG)?.type, leerImagen(JPG)?.w, leerImagen(JPG)?.h], ['jpg', 40, 30]);
  assert.equal(leerImagen('data:image/webp;base64,UklGRg=='), null);
  assert.equal(leerImagen(null), null);
});

test('ficha en Word: una ficha por producto en su página, lo ofertado, sin marca ni modelo', async () => {
  const prod = (nombre: string, item: number) => ({
    nombre, marca: 'Unox', modelo: 'Bakerlux Shop.Pro', fabricante: null, paisFabricacion: null, anioFabricacion: null, garantiaMeses: null,
    confirmado: true, imagenDataUri: PNG, imagenesExtraDataUri: [PNG], incluye: ['Instalación de Horno Unox Bakerlux Shop.Pro'], item,
    especificaciones: [
      { descripcion: 'Control de Humedad', tipo: null, valorRequeridoTexto: 'x', valorRequeridoNumero: null, valorRequeridoNumeroMax: null, unidadRequerida: null, valorOfertadoTexto: '0 - 20 - 40 %', valorOfertadoNumero: null, unidadOfertada: null },
      { descripcion: '', tipo: null, valorRequeridoTexto: 'x', valorRequeridoNumero: null, valorRequeridoNumeroMax: null, unidadRequerida: null, valorOfertadoTexto: null, valorOfertadoNumero: null, unidadOfertada: null },
    ],
    cantidad: 4, unidad: 'Unidad',
  });
  const buf = await construirFichaTecnicaDocx({
    licitacionCodigo: '1414396-26-LP26', licitacionNombre: 'Adq. de Equipamiento', organismo: 'SLEP', generadoPor: null, fechaTexto: '',
    lineas: [{ linea: 1, titulo: 'A', productos: [prod('Horno convector', 1)] }, { linea: 1, titulo: 'B', productos: [prod('Batidora', 2)] }],
    empresa: { razonSocial: 'Comercial MP SpA', rut: '78.388.175-6', giro: null, direccion: null, email: null, telefono: null, representanteNombre: 'Carolina', representanteRut: null, representanteCargo: null, logoDataUri: PNG, firmaDataUri: null, timbreDataUri: JPG },
  });
  const xml = await (await JSZip.loadAsync(buf)).file('word/document.xml')!.async('string');
  const texto = xml.replace(/<[^>]+>/g, ' ');
  assert.ok(texto.includes('Control de Humedad') && texto.includes('0 - 20 - 40 %'));
  assert.ok(texto.includes('Línea 1 · Ítem 2 · Ficha técnica 02'), 'línea con varios ítems');
  assert.ok(texto.includes('Instalación de Horno'));
  assert.ok(!/Unox|Bakerlux/.test(texto), 'sin marca ni modelo');
  assert.ok(!/LICITANK|referenciales y no contractuales/.test(texto), 'sin pie');
  assert.equal((xml.match(/w:pageBreakBefore/g) || []).length, 1, 'la segunda ficha arranca en página nueva');
  assert.equal((texto.match(/Foto referencial/g) || []).length, 4, 'dos fotos por producto, en fila');
  assert.ok(xml.includes('w:fill="FFFBEB"'), 'la casilla sin dato sale vacía y marcada');
});
