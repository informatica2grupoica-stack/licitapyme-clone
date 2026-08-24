// app/lib/anexos-pdf-rellenar.ts
// Relleno de anexos PDF ESCANEADOS (sin capa de texto, sin campos de formulario) con los datos
// de la empresa — la contraparte de anexos-rellenar.ts (que trabaja sobre .docx). Existe porque
// en una licitación pública el documento que se sube tiene que ser el MISMO que publicó el
// organismo: no se puede pasar a Word y volver a generar un PDF, porque el resultado ya no es el
// archivo oficial. Este motor NUNCA reconstruye el documento — abre el PDF original con pdf-lib
// y escribe los valores encima, en las coordenadas exactas del casillero vacío; todo lo demás
// (logo, timbre, firma, texto) queda intacto byte a byte salvo el texto agregado.
//
// CÓMO DETECTA LOS CASILLEROS (el PDF no tiene estructura, es una imagen escaneada):
//   1. Rasteriza cada página (mupdf) y busca los BORDES de la tabla por análisis de píxeles —
//      líneas horizontales/verticales oscuras, con una banda de tolerancia vertical (±3px) para
//      el leve sesgo típico de un documento escaneado (sin esto, una línea sub-pixel de
//      desviación entre el borde izquierdo y el derecho rompe la corrida "continua" y ninguna
//      línea se detecta — bug real encontrado armando este motor, 24-ago-2026).
//   2. Dentro de cada fila de tabla, ubica el DIVISOR (etiqueta | casillero vacío): la primera
//      línea vertical encontrada es el borde EXTERIOR de la tabla, no el divisor — hay que tomar
//      la SEGUNDA (otro bug real: tomar la primera dejaba una celda de etiqueta de 2px de ancho,
//      OCR puro ruido).
//   3. Una fila sospechosamente alta (>150px) suele ser DOS filas cuya línea divisoria es más
//      débil que el resto de la tabla — se re-busca esa banda con un umbral más laxo antes de
//      descartarla como "no es una fila de campo".
//   4. OCR AISLADO por celda de etiqueta (Tesseract con la opción `rectangle`, sin re-cortar la
//      imagen): mucho más preciso que OCR de la página completa, que se confunde con las líneas
//      del recuadro y da texto irreconocible (confianza ~65 medida en un caso real vs. la misma
//      celda aislada, con ortografía correcta).
//   5. La etiqueta reconocida se resuelve contra el MISMO diccionario que usan los .docx
//      (`campoDeEtiquetaInequivoca`, anexos-determinista.ts — 227 tests, afinado con casos reales)
//      — no se reimplementa el mapeo etiqueta→dato acá. PERO el diccionario espera coincidencia
//      EXACTA (patrones anclados con ^...$): funciona perfecto contra el texto LIMPIO de un XML
//      de Word, pero el OCR nunca es perfecto — "RUT OFERENTE |" (la '|' es ruido del borde de la
//      celda) o "LECIAL" en vez de "LEGAL" (letra mal leída) no matchean nada tal cual. Por eso
//      antes de consultar el diccionario se limpia el ruido típico de OCR (`limpiarRuidoOcr`), y
//      si aun así no matchea, un respaldo de palabras clave AMPLIAS (no anclado) cubre los campos
//      de identificación más comunes — bug real medido armando esto: 0/9 casillas resueltas contra
//      el diccionario exacto sin esta limpieza, 7/9 con ella.
//
// ESTADO: primera versión en producción (24-ago-2026). Cobertura medida sobre un documento real:
// 7 de ~10 casillas. Los que quedan sin resolver NO se inventan ni se dejan en blanco silencioso:
// van en `pendientes`, para que el asistente los complete a mano antes de subir el PDF al portal.
import type { EmpresaCampos } from '@/app/lib/anexos-ia-motor';
import { campoDeEtiquetaInequivoca, normalizarEtiqueta } from '@/app/lib/anexos-determinista';

// Ruido típico que el OCR pega a una celda recortada: la línea del borde de la tabla ("|"), o una
// letra suelta mal leída al final ("Nombre Representante 5 Apoderado" — el "o" de "o Apoderado"
// se leyó "5"). Se limpia ANTES de normalizarEtiqueta, sin tocar esa función (es la que usan los
// .docx, con sus propios 227 tests — no se le agregan reglas pensadas solo para ruido de imagen).
function limpiarRuidoOcr(texto: string): string {
  return String(texto || '')
    .replace(/[|_~`]+/g, ' ')
    .replace(/\s+\d\s*$/, ' ') // dígito suelto al final (línea/borde mal leído)
    .replace(/\s+/g, ' ')
    .trim();
}

// Respaldo SOLO para cuando el diccionario exacto no matchea nada — no lo reemplaza, corre
// después. Palabras clave amplias a propósito (el texto vino de OCR sobre una imagen escaneada,
// nunca perfecto) pero acotadas a los campos de identificación de MENOR ambigüedad: no hay una
// versión de "nombre representante legal" que se pueda confundir con otro dato de la ficha, así
// que ensanchar el match acá es seguro. Campos más finos (fechas partidas, notaría, banco…) se
// dejan al diccionario exacto — si el OCR no los lee limpio, quedan pendientes, que es preferible
// a adivinar en un documento que se presenta a un organismo público.
const RESPALDO_OCR: Array<{ campo: keyof EmpresaCampos; patron: RegExp }> = [
  { campo: 'rut', patron: /^r\.?\s*u\.?\s*t\.?\s*(oferente|empresa)?$/i },
  { campo: 'razon_social', patron: /raz[oó]n\s+social|nombre\s+(del\s+)?oferente/i },
  { campo: 'representante_nombre', patron: /nombre.*(representante|apoderado)/i },
  { campo: 'representante_rut', patron: /c[eé]dula|identidad/i },
  { campo: 'direccion', patron: /direcci[oó]n/i },
  { campo: 'telefono1', patron: /tel[eé]fono|\bfono\b/i },
  { campo: 'email1', patron: /correo|e-?mail/i },
];

function resolverEtiquetaPdf(etiquetaCruda: string, empresa: EmpresaCampos): { campo: string | null; valor: string | null } {
  const limpia = limpiarRuidoOcr(etiquetaCruda);
  let campo = campoDeEtiquetaInequivoca(limpia);
  if (!campo) {
    const n = normalizarEtiqueta(limpia);
    const hit = RESPALDO_OCR.find(r => r.patron.test(n));
    campo = (hit?.campo as any) ?? null;
  }
  const valor = campo ? (empresa as any)[campo] ?? null : null;
  return { campo, valor };
}

const SCALE = 2.5;              // resolución de rasterizado — calibrada contra documentos reales
const TOL_SESGO_PX = 3;         // tolerancia vertical para el leve sesgo del escaneo
const UMBRAL_OSCURO = 35;       // oscuridad (255-luminosidad) que cuenta como "hay tinta"
const PCT_LINEA_PRINCIPAL = 0.65; // % del ancho que debe cubrir una corrida para ser línea de tabla
const PCT_LINEA_SECUNDARIA = 0.45; // umbral más laxo para la segunda pasada (filas fusionadas)
const ALTO_MIN_FILA = 25;
const ALTO_MAX_FILA = 135;
const GAP_SOSPECHOSO = 150;     // separación que dispara la segunda pasada (probable fila doble)

export interface CampoPdfDetectado {
  pagina: number;
  etiqueta: string;
  campo: string | null;
  valor: string | null;
  confianzaOcr: number;
}

export interface ResultadoRellenoPdf {
  bufferFinal: Buffer;
  campos: CampoPdfDetectado[];
  totalDetectados: number;
  completados: number;
}

/** Copia los píxeles ANTES de pedir el PNG: mupdf reusa la memoria WASM y `asPNG()` invalida el
 *  typed array que devuelve `getPixels()` si se llama después (bug real, mismo hallazgo). */
function rasterizarPagina(page: any, mupdf: any) {
  const pix = page.toPixmap(mupdf.Matrix.scale(SCALE, SCALE), mupdf.ColorSpace.DeviceRGB, false);
  const stride = pix.getStride(), n = pix.getNumberOfComponents();
  const width = pix.getWidth(), height = pix.getHeight();
  const pixels = Buffer.from(pix.getPixels());
  const png = Buffer.from(pix.asPNG());
  return { stride, n, width, height, pixels, png };
}

function creaDetectorDeTinta(pixels: Buffer, stride: number, n: number, height: number) {
  const oscuridad = (x: number, y: number) => {
    const i = y * stride + x * n;
    return 255 - (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
  };
  return (x: number, y: number): boolean => {
    for (let dy = -TOL_SESGO_PX; dy <= TOL_SESGO_PX; dy++) {
      const yy = y + dy;
      if (yy >= 0 && yy < height && oscuridad(x, yy) > UMBRAL_OSCURO) return true;
    }
    return false;
  };
}

function lineasHorizontalesEntre(
  hayTinta: (x: number, y: number) => boolean, width: number, yDesde: number, yHasta: number, minPct: number,
): number[] {
  const filas: number[] = [];
  for (let y = yDesde; y < yHasta; y++) {
    let corrida = 0, max = 0;
    for (let x = 0; x < width; x++) { if (hayTinta(x, y)) { corrida++; if (corrida > max) max = corrida; } else corrida = 0; }
    if (max > width * minPct) filas.push(y);
  }
  const grupos: number[][] = [];
  let g: number[] = [];
  for (const y of filas) {
    if (g.length && y - g[g.length - 1] > 5) { grupos.push(g); g = []; }
    g.push(y);
  }
  if (g.length) grupos.push(g);
  return grupos.map(gr => Math.round(gr.reduce((a, b) => a + b, 0) / gr.length));
}

function verticalesEnBanda(
  hayTinta: (x: number, y: number) => boolean, y0: number, y1: number, xDesde: number, xHasta: number,
): number[] {
  const xs: number[] = [];
  for (let x = xDesde; x < xHasta; x++) {
    let corrida = 0, max = 0;
    for (let y = y0; y < y1; y++) { if (hayTinta(x, y)) { corrida++; if (corrida > max) max = corrida; } else corrida = 0; }
    if (max > (y1 - y0) * 0.7) xs.push(x);
  }
  const grupos: number[][] = [];
  let g: number[] = [];
  for (const x of xs) {
    if (g.length && x - g[g.length - 1] > 3) { grupos.push(g); g = []; }
    g.push(x);
  }
  if (g.length) grupos.push(g);
  return grupos.map(gr => Math.round(gr.reduce((a, b) => a + b, 0) / gr.length));
}

interface CasillaDetectada { y0: number; y1: number; xIzquierdo: number; xDivisor: number }

function detectarCasillas(
  hayTinta: (x: number, y: number) => boolean, width: number, height: number,
): CasillaDetectada[] {
  const margenY = Math.round(height * 0.03);
  let yLineas = lineasHorizontalesEntre(hayTinta, width, margenY, height - margenY, PCT_LINEA_PRINCIPAL);

  const completas = [...yLineas];
  for (let i = 0; i < yLineas.length - 1; i++) {
    if (yLineas[i + 1] - yLineas[i] <= GAP_SOSPECHOSO) continue;
    completas.push(...lineasHorizontalesEntre(hayTinta, width, yLineas[i] + 15, yLineas[i + 1] - 15, PCT_LINEA_SECUNDARIA));
  }
  yLineas = [...new Set(completas)].sort((a, b) => a - b);

  const casillas: CasillaDetectada[] = [];
  for (let i = 0; i < yLineas.length - 1; i++) {
    const y0 = yLineas[i], y1 = yLineas[i + 1];
    const alto = y1 - y0;
    if (alto < ALTO_MIN_FILA || alto > ALTO_MAX_FILA) continue;

    const xVerticales = verticalesEnBanda(hayTinta, y0 + 3, y1 - 3, Math.round(width * 0.05), Math.round(width * 0.85));
    if (xVerticales.length < 2) continue; // hace falta borde-izq + divisor, al menos

    casillas.push({ y0, y1, xIzquierdo: xVerticales[0] + 3, xDivisor: xVerticales[1] });
  }
  return casillas;
}

/** Rellena un PDF escaneado (sin capa de texto ni campos de formulario) con los datos de la
 *  empresa, escribiendo directo sobre el documento original. Multi-página: procesa todas. */
export async function rellenarAnexoPdfEscaneado(
  bufferOriginal: Buffer, empresa: EmpresaCampos,
): Promise<ResultadoRellenoPdf> {
  const mupdf = await import('mupdf');
  const { createWorker } = await import('tesseract.js');
  const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');

  const mupdfDoc = mupdf.Document.openDocument(bufferOriginal, 'application/pdf');
  const totalPaginas = mupdfDoc.countPages();

  const pdfLibDoc = await PDFDocument.load(bufferOriginal);
  const font = await pdfLibDoc.embedFont(StandardFonts.Helvetica);
  const paginasPdfLib = pdfLibDoc.getPages();

  const worker = await createWorker('spa', undefined, { cachePath: process.env.TESSERACT_CACHE_PATH || '.tesseract-cache' });
  const camposDetectados: CampoPdfDetectado[] = [];

  try {
    for (let p = 0; p < totalPaginas; p++) {
      const page = mupdfDoc.loadPage(p);
      const pageBounds = page.getBounds(); // [x0,y0,x1,y1] en puntos PDF
      const pageHeightPt = pageBounds[3] - pageBounds[1];
      const { stride, n, width, height, pixels, png } = rasterizarPagina(page, mupdf);
      const hayTinta = creaDetectorDeTinta(pixels, stride, n, height);
      const casillas = detectarCasillas(hayTinta, width, height);

      for (const c of casillas) {
        const rectEtiqueta = {
          left: c.xIzquierdo, top: c.y0 + 3,
          width: Math.max(10, c.xDivisor - c.xIzquierdo), height: (c.y1 - c.y0) - 6,
        };
        const { data: ocr } = await worker.recognize(png, { rectangle: rectEtiqueta });
        const etiqueta = (ocr.text || '').trim().replace(/\s+/g, ' ');
        if (!etiqueta) continue;

        const { campo, valor } = resolverEtiquetaPdf(etiqueta, empresa);
        camposDetectados.push({ pagina: p + 1, etiqueta, campo, valor, confianzaOcr: Math.round(ocr.confidence) });

        if (valor) {
          const pdfPage = paginasPdfLib[p];
          const xPt = (c.xDivisor + 6) / SCALE;
          const yCenterPx = (c.y0 + c.y1) / 2;
          const yPt = pageHeightPt - (yCenterPx / SCALE) - 4;
          pdfPage.drawText(String(valor), { x: xPt, y: yPt, size: 10, font, color: rgb(0.05, 0.05, 0.55) });
        }
      }
    }
  } finally {
    await worker.terminate().catch(() => {});
  }

  const bufferFinal = Buffer.from(await pdfLibDoc.save());
  const completados = camposDetectados.filter(c => c.valor).length;
  return { bufferFinal, campos: camposDetectados, totalDetectados: camposDetectados.length, completados };
}
