// app/lib/anexos-pdf-dividir.ts
// Recorta un PDF ESCANEADO de bases en un archivo por FORMATO, usando las secciones que localizó
// anexos-pdf-secciones.ts. Es el equivalente para PDF de lo que anexos-dividir.ts hace con .docx.
//
// POR QUÉ RECORTAR Y NO RECONSTRUIR: en una licitación pública lo que se sube al portal tiene que
// ser el documento OFICIAL del organismo. Este módulo NO rasteriza, NO convierte y NO vuelve a
// generar nada: copia las páginas tal cual (mismo objeto de imagen, mismos timbres y firmas) y
// solo achica el CROPBOX para que se vea únicamente el formato. El contenido queda byte a byte
// igual — es el mismo escaneo, mirado por una ventana más chica.
//
// UN FORMATO NO EMPIEZA EN UNA PÁGINA NUEVA. En el caso real que motivó esto (545774-35-LE26) el
// FORMATO N°1 arranca en el último tercio de la pág. 29, debajo del "PROCEDIMIENTO DE ENTREGA Y
// REPOSICIÓN"; el N°2 en la mitad de la 30; el N°3 al pie de la 31. Cortar por página entera
// mete media página de bases en un archivo y parte el formato siguiente por la mitad. Por eso el
// corte es por COORDENADA Y, y solo la primera y la última página de cada sección se recortan:
// las del medio (si las hay) van completas.
import type { SeccionPdf } from '@/app/lib/anexos-pdf-secciones';

// ── Página de cola vacía ─────────────────────────────────────────────────────────────────────
// Una sección termina donde empieza la siguiente, y eso a veces deja una última página con una
// franja de puros centímetros: solo el MEMBRETE del organismo, que se repite en todas las hojas.
// Caso real: el FORMATO N°5 termina al pie de la pág. 33 y el N°6 arranca en la 34 al 16% de
// altura — el recorte del N°5 quedaba con una segunda hoja que solo mostraba el logo de la
// Municipalidad. No se puede descartar solo por lo angosta que es la franja (un formato SÍ puede
// terminar con dos líneas de firma arriba de la hoja siguiente): hay que mirar si tiene TINTA
// debajo del membrete.
const ALTO_MEMBRETE_FRAC = 0.13;   // el logo + "Secretaría Comunal de…" ocupan el tope de cada hoja
const ESCALA_SONDEO = 0.8;         // resolución mínima: solo se cuentan píxeles oscuros
const UMBRAL_OSCURO = 40;
const TINTA_MINIMA = 0.0008;       // proporción de píxeles oscuros que ya cuenta como contenido

/** ¿La franja [desde, hasta] de esta página tiene algo más que el membrete? */
async function bandaTieneContenido(
  bufferOriginal: Buffer, paginaIndice: number, desdeFrac: number, hastaFrac: number,
): Promise<boolean> {
  const inicio = Math.max(desdeFrac, ALTO_MEMBRETE_FRAC);
  if (hastaFrac - inicio <= 0.01) return false;

  const mupdf = await import('mupdf');
  const doc = mupdf.Document.openDocument(bufferOriginal, 'application/pdf');
  const pix = doc.loadPage(paginaIndice).toPixmap(
    mupdf.Matrix.scale(ESCALA_SONDEO, ESCALA_SONDEO), mupdf.ColorSpace.DeviceRGB, false,
  );
  const stride = pix.getStride(), comp = pix.getNumberOfComponents();
  const ancho = pix.getWidth(), alto = pix.getHeight();
  const pixels = Buffer.from(pix.getPixels());

  const y0 = Math.round(alto * inicio), y1 = Math.round(alto * hastaFrac);
  let oscuros = 0, total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < ancho; x++) {
      const i = y * stride + x * comp;
      total++;
      if (255 - (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3 > UMBRAL_OSCURO) oscuros++;
    }
  }
  return total > 0 && oscuros / total > TINTA_MINIMA;
}

export interface FormatoRecortado {
  seccion: SeccionPdf;
  nombreArchivo: string;
  buffer: Buffer;
  /** Páginas del ORIGINAL que quedaron en el recorte (puede ser menos que la sección: ver
   *  bandaTieneContenido, que descarta una hoja de cola con solo el membrete). */
  paginaInicio: number;
  paginaFin: number;
}

/** Nombre de archivo estable y legible: "FORMATO_3_DECLARACION_DE_ACEPTACION_DE_BASES.pdf". */
export function nombreDeFormato(seccion: SeccionPdf): string {
  const titulo = (seccion.titulo || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return `FORMATO_${seccion.numero}${titulo ? '_' + titulo : ''}.pdf`;
}

/**
 * Recorta una sección en su propio PDF.
 *
 * Coordenadas: las fracciones vienen medidas DESDE ARRIBA (0 = borde superior), porque así se leen
 * en una imagen; el PDF mide desde ABAJO. La conversión es `y = alto * (1 - frac)`, y se hace
 * relativa al MediaBox de cada página (no se asume que el origen sea 0,0 — hay escaneos cuyo
 * MediaBox arranca desplazado, y ahí un 0 duro corta el documento en el lugar equivocado).
 */
async function recortarSeccion(
  bufferOriginal: Buffer, seccion: SeccionPdf,
): Promise<{ buffer: Buffer; paginaInicio: number; paginaFin: number }> {
  const { PDFDocument } = await import('pdf-lib');
  const original = await PDFDocument.load(bufferOriginal);
  const salida = await PDFDocument.create();

  let paginaFin = seccion.paginaFin;
  let yFinFrac = seccion.yFinFrac;
  if (paginaFin > seccion.paginaInicio && !(await bandaTieneContenido(bufferOriginal, paginaFin - 1, 0, yFinFrac))) {
    paginaFin -= 1;
    yFinFrac = 1;
  }

  const indices: number[] = [];
  for (let p = seccion.paginaInicio; p <= paginaFin; p++) indices.push(p - 1);
  const copiadas = await salida.copyPages(original, indices);

  copiadas.forEach((pagina, i) => {
    salida.addPage(pagina);
    // pdf-lib devuelve {x, y, width, height} — el origen NO siempre es (0,0).
    const { x: mx, y: my, width: ancho, height: alto } = pagina.getMediaBox();

    const esPrimera = i === 0;
    const esUltima = i === copiadas.length - 1;
    // Fracciones desde arriba de ESTA página: la primera empieza en el ancla, la última termina
    // donde arranca el formato siguiente, y cualquier página del medio va entera.
    const desde = esPrimera ? seccion.yInicioFrac : 0;
    const hasta = esUltima ? yFinFrac : 1;
    if (desde <= 0 && hasta >= 1) return; // página completa: no se toca el CropBox

    const y = my + alto * (1 - hasta);
    const altoRecorte = alto * (hasta - desde);
    if (altoRecorte <= 1) return; // recorte degenerado: mejor la página entera que una franja vacía
    pagina.setCropBox(mx, y, ancho, altoRecorte);
  });

  return { buffer: Buffer.from(await salida.save()), paginaInicio: seccion.paginaInicio, paginaFin };
}

/** Recorta TODAS las secciones. Un archivo por formato, en el orden en que vienen en el documento. */
export async function dividirPdfEnFormatos(
  bufferOriginal: Buffer, secciones: SeccionPdf[],
): Promise<FormatoRecortado[]> {
  const salida: FormatoRecortado[] = [];
  for (const seccion of secciones) {
    const recorte = await recortarSeccion(bufferOriginal, seccion);
    salida.push({ seccion, nombreArchivo: nombreDeFormato(seccion), ...recorte });
  }
  return salida;
}
