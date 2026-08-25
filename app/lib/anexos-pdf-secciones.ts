// app/lib/anexos-pdf-secciones.ts
// Localiza los FORMATOS/ANEXOS dentro de un PDF ESCANEADO que trae las bases completas.
//
// POR QUÉ EXISTE (caso real 545774-35-LE26, San Miguel, 25-ago-2026): hay organismos que no
// publican los anexos como archivos aparte — van pegados al final del mismo decreto que aprueba
// las bases. Ese PDF viene escaneado (0 caracteres de capa de texto: todo es imagen timbrada y
// firmada), así que ni el separador de .docx (anexos-dividir.ts) ni la lectura de texto sirven.
//
// Sin este paso, el motor de relleno de PDF escaneado (anexos-pdf-rellenar.ts) recibía las 36
// páginas enteras y trabajaba sobre TODAS. Medido sobre el documento real: 35 "casillas"
// detectadas en las páginas 3 a 28, que son las tablas de criterios de evaluación, plazos y
// garantías de las BASES — prosa, no formularios. Escribir un RUT encima del articulado de una
// licitación pública es indefendible, así que primero hay que saber dónde empieza y termina cada
// formato.
//
// CÓMO LO HACE: OCR de página completa a baja resolución, solo para ubicar la LÍNEA ANCLA que
// titula cada formato ("FORMATO N°1", "ANEXO Nº 3", "FORMULARIO N° 2"). Se queda con la
// coordenada Y de esa línea; cada sección va desde su ancla hasta el ancla siguiente. No se
// interpreta el contenido acá — eso es trabajo del motor de relleno.
//
// EL ANCLA NO SE PUEDE MATCHEAR CON UN REGEX ESTRICTO. Medido en la pág. 29 del documento real:
// Tesseract lee "FORMATO N°1" como "FORMATO NI" (el "°1" se funde en una "I"). Un patrón del
// tipo /FORMATO\s*N[°º]\s*\d+/ no caza NADA y el documento entero queda sin secciones. Por eso
// el criterio es: la línea EMPIEZA con la palabra ancla y es CORTA. El número se extrae si se
// puede leer; si no, se numera por orden de aparición, que es lo que importa para separar.
//
// La cortedad es también lo que evita los falsos positivos: las bases mencionan los formatos en
// prosa muchas veces ("...los valores ofertados en el referido Formato N° 7"), pero esas líneas
// son largas. Medido: 0 falsos positivos en las 28 páginas de prosa del documento real.

// Alto máximo (en caracteres) de una línea para que cuente como TÍTULO de formato y no como una
// mención en prosa. 30 deja pasar "FORMATO N°1", "ANEXO Nº 3 (DOCUMENTO ESENCIAL)" y similares,
// y deja fuera cualquier oración.
const LARGO_MAX_ANCLA = 30;

// Palabra con la que un organismo chileno titula un formulario a rellenar. `formulario` se acepta
// solo cuando viene con número ("FORMULARIO N°2"): a secas es el subtítulo descriptivo que suele
// ir DEBAJO del ancla ("FORMULARIO DE IDENTIFICACIÓN DEL OFERENTE"), no el ancla misma.
const RE_ANCLA = /^(formato|anexo)\b/;
const RE_ANCLA_CON_NUMERO = /^(formulario)\b.{0,6}\bn/;

// Cierre del decreto: después de esto ya no hay formatos, vuelve el acto administrativo.
const RE_FIN_FORMATOS = /^an[oó]tese\b/;

export interface LineaOcr {
  texto: string;
  /** Posición vertical del tope de la línea, como FRACCIÓN del alto de la página (0 = arriba). */
  yFrac: number;
  /** Borde izquierdo y derecho de la línea, como fracción del ancho. Se usan para el centrado. */
  xIniFrac: number;
  xFinFrac: number;
}

export interface SeccionPdf {
  /** N° leído del ancla, o el orden de aparición si el OCR no pudo leerlo. */
  numero: number;
  /** Si `numero` se leyó de verdad del documento o es el orden de aparición (para la UI). */
  numeroInferido: boolean;
  /** La línea ancla tal cual la leyó el OCR ("FORMATO NI"). */
  etiqueta: string;
  /** La línea siguiente al ancla, que suele decir de qué es el formato. */
  titulo: string;
  paginaInicio: number; // 1-based
  yInicioFrac: number;
  paginaFin: number;    // 1-based, inclusive
  yFinFrac: number;
  /** El texto OCR de la sección. Sirve para clasificarla (administrativo/técnico/económico) con
   *  el mismo `clasificarAnexo` que usa el separador de .docx — no se reimplementa el criterio. */
  texto: string;
}

/** Normaliza para comparar: sin tildes, minúsculas, espacios colapsados. */
function normalizar(s: string): string {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

// El título de un formato va CENTRADO; una mención en prosa arranca en el margen izquierdo.
// BUG REAL (545774-35-LE26, pág. 24): la oración "…los valores ofertados en el referido Formato
// N° 7" se corta justo ahí y deja "Formato N° 7" SOLO en su línea — corta, empieza con la palabra
// ancla, indistinguible de un título si solo se mira el texto. Se colaba como un octavo formato
// que arrancaba en la pág. 24, y arrastraba 5 páginas de bases dentro del recorte.
const CENTRO_TOLERANCIA = 0.15;  // cuánto puede desviarse el centro de la línea del centro de página
const SANGRIA_MINIMA = 0.20;     // una línea que arranca antes de esto viene del margen, es prosa

/** ¿Esta línea es el título de un formato? */
export function esLineaAncla(linea: LineaOcr): boolean {
  const n = normalizar(linea.texto);
  if (!n || n.length > LARGO_MAX_ANCLA) return false;
  if (!RE_ANCLA.test(n) && !RE_ANCLA_CON_NUMERO.test(n)) return false;
  if (linea.xIniFrac < SANGRIA_MINIMA) return false;
  const centro = (linea.xIniFrac + linea.xFinFrac) / 2;
  return Math.abs(centro - 0.5) < CENTRO_TOLERANCIA;
}

/** Número del formato, si el OCR lo dejó legible. "FORMATO NI" → null (el "°1" se leyó como I). */
export function numeroDeAncla(texto: string): number | null {
  const n = normalizar(texto);
  const m = n.match(/n?\s*[°º*o]?\s*(\d{1,2})\b/);
  if (!m) return null;
  const v = Number(m[1]);
  return v >= 1 && v <= 40 ? v : null;
}

/** Un margen chico hacia arriba para que el recorte no corte el propio título del formato. */
const MARGEN_ARRIBA_FRAC = 0.012;

/**
 * Arma las secciones a partir de las líneas OCR de cada página.
 * Separado del OCR a propósito: así se puede testear con líneas inventadas, sin rasterizar nada.
 */
export function armarSecciones(paginas: LineaOcr[][]): SeccionPdf[] {
  const anclas: Array<{ pagina: number; yFrac: number; etiqueta: string; titulo: string }> = [];
  let finForzado: { pagina: number; yFrac: number } | null = null;

  paginas.forEach((lineas, i) => {
    lineas.forEach((linea, j) => {
      if (esLineaAncla(linea)) {
        anclas.push({
          pagina: i + 1,
          yFrac: Math.max(0, linea.yFrac - MARGEN_ARRIBA_FRAC),
          etiqueta: linea.texto.trim(),
          titulo: (lineas[j + 1]?.texto || '').trim(),
        });
      } else if (!finForzado && anclas.length && RE_FIN_FORMATOS.test(normalizar(linea.texto))) {
        finForzado = { pagina: i + 1, yFrac: linea.yFrac };
      }
    });
  });

  const ultimaConLineas = paginas.reduce((ultima, lineas, i) => (lineas.length ? i + 1 : ultima), 1);
  // El número se lee del ancla cuando el OCR lo deja legible; si no, se DEDUCE del anterior + 1,
  // no del orden de aparición. Caso real: de siete anclas, el OCR leyó bien 1, 2, 3 y 7, y dejó
  // "FORMATO N*%" (el 4), "FORMATO N*S" (el 5) y "FORMATO NS" (el 6) ilegibles. Numerar por orden
  // los deja bien solo si NINGÚN ancla falta; deducir del anterior aguanta además que el OCR se
  // salte un título, que es lo que pasa cuando el escaneo viene torcido.
  let ultimo = 0;
  return anclas.map((a, i) => {
    const siguiente = anclas[i + 1];
    let paginaFin: number, yFinFrac: number;
    if (siguiente) {
      // La sección termina donde empieza la siguiente. Si la siguiente arranca al comienzo de su
      // página, esta termina al final de la anterior — no se arrastra una página en blanco.
      paginaFin = siguiente.pagina;
      yFinFrac = siguiente.yFrac;
      if (yFinFrac <= 0.02 && paginaFin > a.pagina) { paginaFin -= 1; yFinFrac = 1; }
    } else if (finForzado) {
      paginaFin = (finForzado as { pagina: number; yFrac: number }).pagina;
      yFinFrac = (finForzado as { pagina: number; yFrac: number }).yFrac;
    } else {
      // Sin marca de cierre explícita, el último formato termina en la última página que el
      // prefiltro consideró "con pinta de formulario" (ver ocrLineasPorPagina). En el documento
      // real esa es la 35: la 36 solo trae las firmas del decreto, y sin este corte se colaban
      // dentro del anexo económico.
      paginaFin = Math.max(a.pagina, ultimaConLineas);
      yFinFrac = 1;
    }
    // Texto de la sección: todas las líneas que caen entre el ancla y el corte final.
    const trozos: string[] = [];
    for (let pagina = a.pagina; pagina <= paginaFin; pagina++) {
      for (const linea of paginas[pagina - 1] || []) {
        const despuesDelInicio = pagina > a.pagina || linea.yFrac >= a.yFrac;
        const antesDelFin = pagina < paginaFin || linea.yFrac <= yFinFrac;
        if (despuesDelInicio && antesDelFin) trozos.push(linea.texto);
      }
    }

    const leido = numeroDeAncla(a.etiqueta);
    const numero = leido ?? ultimo + 1;
    ultimo = numero;
    return {
      texto: trozos.join('\n'),
      numero,
      numeroInferido: leido == null,
      etiqueta: a.etiqueta,
      titulo: a.titulo,
      paginaInicio: a.pagina,
      yInicioFrac: a.yFrac,
      paginaFin,
      yFinFrac,
    };
  });
}

// Resolución del rasterizado de localización. Baja a propósito: acá solo hace falta LEER UN
// TÍTULO centrado en mayúsculas, no las casillas. El motor de relleno rasteriza aparte, más fino.
const ESCALA_LOCALIZACION = Number(process.env.ANEXOS_PDF_ESCALA_LOCALIZACION ?? 1.5);

// ── POR QUÉ NO SE OCR-EA LA PÁGINA ENTERA ─────────────────────────────────────────────────────
// La primera versión leía cada página completa con Tesseract y buscaba el ancla en el resultado.
// Funcionaba, pero medido sobre el documento real (36 páginas escaneadas) tardaba 210 SEGUNDOS —
// más que cualquier petición HTTP razonable, y el 99% de ese tiempo se gastaba leyendo párrafos
// de bases que no interesan para nada.
//
// El título de un formato tiene una FORMA reconocible sin leerlo: es un renglón CORTO y CENTRADO,
// aislado del resto. Eso se encuentra contando píxeles, que es baratísimo. Así que primero se
// buscan por geometría los renglones con esa forma —unos pocos por página— y solo esos se pasan
// por OCR. El mismo documento baja de 210 s a unos pocos segundos, y el resultado es idéntico:
// los renglones que el prefiltro descarta son justamente los que la regla de "corto y centrado"
// habría descartado igual después de leerlos.
const ANCHO_MAX_FRANJA = 0.55;   // un renglón más ancho que esto es prosa, no un título
const ALTO_MIN_FRANJA = 0.006;   // fracción del alto de página: menos que esto es ruido/mota
const ALTO_MAX_FRANJA = 0.030;   // más que esto son varios renglones pegados
const UMBRAL_OSCURO = 60;
// El borde de la hoja escaneada trae una franja sucia (sombra del escáner, grapas, el filo del
// papel) que pinta píxeles oscuros en CASI TODAS las filas. Sin descartar ese margen, ninguna fila
// queda "en blanco", los renglones no se cierran nunca y la página entera sale como una sola
// franja del 76% de alto — medido en la pág. 29 del documento real: 0 candidatos, 0 formatos.
const MARGEN_BORDE = 0.05;
// Y por la misma razón hace falta un mínimo de tinta para que una fila cuente como "con texto":
// una mota suelta no es un renglón.
const TINTA_MINIMA_FILA = 0.005;

interface Franja { y0: number; y1: number; x0: number; x1: number }

/** Renglones CORTOS y CENTRADOS de la página, por análisis de píxeles (sin leer nada). */
function franjasCandidatas(
  pixels: Buffer, stride: number, comp: number, ancho: number, alto: number,
): Franja[] {
  const margen = Math.round(ancho * MARGEN_BORDE);
  const minimo = Math.max(4, Math.round(ancho * TINTA_MINIMA_FILA));
  const filas: Array<{ x0: number; x1: number } | null> = [];
  for (let y = 0; y < alto; y++) {
    let x0 = -1, x1 = -1, oscuros = 0;
    for (let x = margen; x < ancho - margen; x++) {
      const i = y * stride + x * comp;
      if (255 - (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3 > UMBRAL_OSCURO) {
        if (x0 < 0) x0 = x;
        x1 = x;
        oscuros++;
      }
    }
    filas.push(oscuros < minimo ? null : { x0, x1 });
  }

  const franjas: Franja[] = [];
  let abierta: Franja | null = null;
  let vacias = 0;
  for (let y = 0; y < alto; y++) {
    const fila = filas[y];
    if (fila) {
      vacias = 0;
      if (!abierta) abierta = { y0: y, y1: y, x0: fila.x0, x1: fila.x1 };
      else { abierta.y1 = y; abierta.x0 = Math.min(abierta.x0, fila.x0); abierta.x1 = Math.max(abierta.x1, fila.x1); }
    } else if (abierta && ++vacias > 2) { // 2 filas en blanco cierran el renglón
      franjas.push(abierta); abierta = null;
    }
  }
  if (abierta) franjas.push(abierta);

  return franjas.filter(f => {
    const altoFranja = (f.y1 - f.y0) / alto;
    if (altoFranja < ALTO_MIN_FRANJA || altoFranja > ALTO_MAX_FRANJA) return false;
    const anchoFranja = (f.x1 - f.x0) / ancho;
    if (anchoFranja > ANCHO_MAX_FRANJA) return false;
    if (f.x0 / ancho < SANGRIA_MINIMA) return false;
    const centro = (f.x0 + f.x1) / 2 / ancho;
    return Math.abs(centro - 0.5) < CENTRO_TOLERANCIA;
  });
}

/**
 * Lee con OCR SOLO las páginas que pueden contener el título de un formato.
 *
 * El prefiltro de arriba decide CUÁLES; esas se leen COMPLETAS. Se probó también recortar y leer
 * solo la franja del renglón candidato —sería aún más rápido— y no sirve: una tira de 15 píxeles
 * de alto no le da a Tesseract la altura de línea que necesita y devuelve basura ("FORMATO N°1"
 * salía como "_E=-— !"). Leer la página entera le deja hacer su propio análisis de disposición,
 * que es donde está su calidad.
 *
 * Las páginas descartadas devuelven una lista vacía, no un hueco: `armarSecciones` las recorre
 * igual, y de paso usa "la última página con renglones" para saber dónde termina el último
 * formato (después de eso el documento ya no parece un formulario).
 */
export async function ocrLineasPorPagina(buffer: Buffer): Promise<LineaOcr[][]> {
  const mupdf = await import('mupdf');
  const { createWorker } = await import('tesseract.js');

  const doc = mupdf.Document.openDocument(buffer, 'application/pdf');
  const total = doc.countPages();
  const worker = await createWorker('spa', undefined, {
    cachePath: process.env.TESSERACT_CACHE_PATH || '.tesseract-cache',
  });
  const paginas: LineaOcr[][] = [];

  try {
    for (let i = 0; i < total; i++) {
      const pix = doc.loadPage(i).toPixmap(
        mupdf.Matrix.scale(ESCALA_LOCALIZACION, ESCALA_LOCALIZACION),
        mupdf.ColorSpace.DeviceRGB, false,
      );
      const alto = pix.getHeight(), ancho = pix.getWidth();
      // Los píxeles se copian ANTES de pedir el PNG: mupdf reusa la memoria WASM y `asPNG()`
      // invalida el typed array que devuelve `getPixels()` si se llama después.
      const pixels = Buffer.from(pix.getPixels());
      if (!franjasCandidatas(pixels, pix.getStride(), pix.getNumberOfComponents(), ancho, alto).length) {
        paginas.push([]);
        continue;
      }

      const { data } = await worker.recognize(Buffer.from(pix.asPNG()), {}, { blocks: true } as any);
      const lineas: LineaOcr[] = [];
      for (const b of (data as any).blocks || []) {
        for (const parrafo of b.paragraphs || []) {
          for (const linea of parrafo.lines || []) {
            const texto = String(linea.text || '').trim();
            if (texto) {
              lineas.push({
                texto,
                yFrac: linea.bbox.y0 / alto,
                xIniFrac: linea.bbox.x0 / ancho,
                xFinFrac: linea.bbox.x1 / ancho,
              });
            }
          }
        }
      }
      lineas.sort((a, b) => a.yFrac - b.yFrac);
      paginas.push(lineas);
    }
  } finally {
    await worker.terminate().catch(() => {});
  }
  return paginas;
}

/** Punto de entrada: dado el PDF escaneado de las bases, dónde vive cada formato. */
export async function detectarSeccionesPdfEscaneado(buffer: Buffer): Promise<SeccionPdf[]> {
  return armarSecciones(await ocrLineasPorPagina(buffer));
}
