// app/lib/ficha-imagen-extraer.ts
// Extrae la FOTO DEL PRODUCTO desde la ficha técnica del proveedor (PDF), para imprimirla en
// NUESTRA ficha técnica — ver ficha-tecnica.ts.
//
// POR QUÉ (27-ago-2026, idea del usuario): las fichas de los proveedores casi siempre traen una
// foto del equipo bajo el título (ver ejemplo Tecnomaq). En vez de pedirle a alguien que la
// recorte y suba a mano, se saca directo del PDF con mupdf — mismo motor que ya usa el proyecto
// para render de páginas (anexos-pdf-secciones.ts, tesseract-ocr.ts).
//
// CÓMO ELIGE "LA" FOTO cuando el PDF trae varias imágenes (logo del proveedor, íconos, la foto):
// StructuredText.walk() entrega, por cada imagen incrustada, su posición y tamaño REAL en la
// página (bbox, en coordenadas de página — no el tamaño en píxeles del archivo). Se queda con la
// que ocupa MÁS ÁREA en la página, dentro de un rango razonable:
//   · por debajo de AREA_MIN_FRACCION: es un ícono o el logo del encabezado, no la foto del equipo.
//   · por encima de AREA_MAX_FRACCION: probablemente toda la página es una imagen (un PDF
//     escaneado), no una foto de producto recortada — eso hay que revisarlo a mano.
// No hay forma de "reconocer" cuál imagen es el producto sin visión por IA; el área es la señal
// más simple y la que mejor acierta en fichas comerciales reales (logo chico arriba, foto grande
// y centrada debajo del título — como en el caso que dio origen a esto).
//
// SIN IA, SIN RED: todo el trabajo es local sobre el PDF ya descargado.

export const AREA_MIN_FRACCION = 0.03;
export const AREA_MAX_FRACCION = 0.85;
/** Ancho o alto mínimo en píxeles REALES de la imagen — descarta vectores/imágenes de muy baja
 *  resolución que se verían pixeladas al imprimirse en nuestra ficha, aunque ocupen buena área. */
export const PIXELS_MIN = 120;
/** Las fichas de proveedor son documentos cortos (1-2 páginas casi siempre); mirar más no aporta
 *  y sí cuesta tiempo en documentos largos que alguien subió por error. */
const MAX_PAGINAS_REVISADAS = 5;

export interface ImagenExtraida {
  png: Buffer;
  anchoPx: number;
  altoPx: number;
  /** 1-based, solo para logs/depuración. */
  pagina: number;
}

/**
 * Busca la foto del producto en un PDF y la devuelve como PNG. `null` si el PDF no se pudo abrir
 * o si ninguna imagen incrustada calzó con el rango esperado (nunca lanza: esto es un plus visual,
 * no debe romper el flujo de comparar la ficha si falla).
 *
 * `paginas` (0-based) acota la búsqueda a esas páginas nomás — lo usa
 * ficha-segmentar-productos.ts cuando la ficha trae VARIOS productos y ya se sabe en qué páginas
 * está cada uno: mirar solo "sus" páginas evita agarrar la foto de OTRO producto de la misma
 * ficha. Sin este parámetro, revisa las primeras páginas del documento completo (comportamiento
 * de siempre, para fichas de un solo producto).
 */
export async function extraerImagenProducto(buffer: Buffer, paginas?: number[]): Promise<ImagenExtraida | null> {
  return (await extraerImagenesProducto(buffer, 1, paginas))[0] ?? null;
}

/** Las `max` imágenes más grandes del PDF que pasan los mismos filtros (de mayor a menor). La ficha propia del
 *  Auditor muestra varias fotos referenciales (27-oct-2026); el resto del sistema sigue usando solo la primera. */
export async function extraerImagenesProducto(buffer: Buffer, max: number, paginas?: number[]): Promise<ImagenExtraida[]> {
  let mupdf: typeof import('mupdf');
  try {
    mupdf = await import('mupdf');
  } catch {
    return [];
  }

  let doc: import('mupdf').Document;
  try {
    doc = mupdf.Document.openDocument(buffer, 'application/pdf');
  } catch {
    return [];
  }

  const candidatas: Array<{ area: number; image: import('mupdf').Image; pagina: number }> = [];
  const aRevisar = paginas ?? Array.from({ length: Math.min(doc.countPages(), MAX_PAGINAS_REVISADAS) }, (_, i) => i);

  for (const i of aRevisar) {
    let page: import('mupdf').Page;
    try {
      page = doc.loadPage(i);
    } catch {
      continue;
    }
    const bounds = page.getBounds();
    const areaPagina = Math.abs((bounds[2] - bounds[0]) * (bounds[3] - bounds[1]));
    if (!areaPagina) continue;

    let structuredText: import('mupdf').StructuredText;
    try {
      // Sin 'preserve-images' toStructuredText() no reporta bloques de imagen — walk() nunca
      // llama a onImageBlock y esto siempre devolvería null, en silencio. Detectado con un PDF
      // real de prueba (mupdf.js no lo documenta con claridad, hay que pasarlo explícito).
      structuredText = page.toStructuredText('preserve-images');
    } catch {
      continue;
    }
    structuredText.walk({
      onImageBlock(bbox, _transform, image) {
        const area = Math.abs((bbox[2] - bbox[0]) * (bbox[3] - bbox[1]));
        const fraccion = area / areaPagina;
        if (fraccion < AREA_MIN_FRACCION || fraccion > AREA_MAX_FRACCION) return;
        if (image.getWidth() < PIXELS_MIN && image.getHeight() < PIXELS_MIN) return;
        candidatas.push({ area, image, pagina: i + 1 });
      },
    });
  }

  const out: ImagenExtraida[] = [];
  const vistas = new Set<string>();   // la misma foto repetida en varias páginas (mismo tamaño en píxeles) se toma una vez
  // Primero las fotos y después los planos: un plano acotado es casi todo blanco y, por ser grande, le ganaba
  // a la foto del equipo (horno Unox, 1414396-26-LP26). Dentro de cada grupo, la más grande primero.
  const esPlano = new Map(candidatas.map(c => [c, fraccionBlanca(c.image) > FRACCION_BLANCA_PLANO]));
  candidatas.sort((a, b) => Number(esPlano.get(a)) - Number(esPlano.get(b)) || b.area - a.area);
  for (const c of candidatas) {
    if (out.length >= max) break;
    const clave = `${c.image.getWidth()}x${c.image.getHeight()}`;
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    try {
      out.push({ png: aplanarSobreBlanco(mupdf, c.image), anchoPx: c.image.getWidth(), altoPx: c.image.getHeight(), pagina: c.pagina });
    } catch { /* imagen ilegible: sigue con la próxima */ }
  }
  return out;
}

/** Sobre esta fracción de píxeles casi blancos la imagen es un plano o un dibujo de líneas, no una foto. */
const FRACCION_BLANCA_PLANO = 0.88;
function fraccionBlanca(image: import('mupdf').Image): number {
  try {
    const pix = image.toPixmap();
    const px = pix.getPixels(), comps = pix.getNumberOfComponents(), stride = pix.getStride();
    const ancho = pix.getWidth(), alto = pix.getHeight();
    const paso = Math.max(1, Math.floor(Math.sqrt((ancho * alto) / 4000)));
    let blancos = 0, total = 0;
    for (let y = 0; y < alto; y += paso) for (let x = 0; x < ancho; x += paso) {
      const i = y * stride + x * comps;
      const claro = comps >= 3 ? px[i] > 235 && px[i + 1] > 235 && px[i + 2] > 235 : px[i] > 235;
      if (claro) blancos++;
      total++;
    }
    return total ? blancos / total : 0;
  } catch { return 0; }
}

/**
 * PNG de la imagen COMPUESTA SOBRE BLANCO, sin canal alfa.
 *
 * BUG REAL (27-ago-2026, caso 2446-240-LE26): las fotos de producto de un catálogo suelen venir
 * recortadas, con la transparencia en una MÁSCARA APARTE (`image.getMask()`) en vez de en el
 * propio mapa de píxeles. `toPixmap()` NO aplica esa máscara: devuelve el RGB crudo —que en el
 * fondo recortado es NEGRO— con alfa 255 en todas partes. Resultado: la hidrolavadora salía
 * dentro de un cuadrado negro en la ficha, y como el PNG "tenía" alfa opaco no había forma de
 * arreglarlo con CSS.
 *
 * Acá se lee la máscara (o el alfa propio del pixmap, si lo trae) y se mezcla contra blanco, que
 * es el fondo del documento. Sale un PNG opaco, listo para imprimir. Si no hay transparencia por
 * ningún lado, se devuelve el PNG tal cual — sin trabajo de más.
 */
function aplanarSobreBlanco(mupdf: typeof import('mupdf'), image: import('mupdf').Image): Buffer {
  const base = image.toPixmap();
  const ancho = base.getWidth(), alto = base.getHeight();
  const compsBase = base.getNumberOfComponents();
  const strideBase = base.getStride();
  const tieneAlfaPropio = base.getAlpha() === 1;

  // La máscara puede venir a otra resolución que la foto: se muestrea proporcionalmente.
  let mascara: { px: Buffer; ancho: number; alto: number; stride: number; comps: number } | null = null;
  try {
    const m = image.getMask();
    if (m) {
      const mp = m.toPixmap();
      mascara = {
        px: Buffer.from(mp.getPixels()), ancho: mp.getWidth(), alto: mp.getHeight(),
        stride: mp.getStride(), comps: mp.getNumberOfComponents(),
      };
    }
  } catch { /* sin máscara legible: se sigue con el alfa propio, o sin transparencia */ }

  // Los píxeles se copian ANTES de crear nada más: mupdf reusa la memoria WASM y cualquier
  // operación posterior puede invalidar el typed array que devolvió getPixels().
  const pxBase = Buffer.from(base.getPixels());
  if (!mascara && !tieneAlfaPropio) return Buffer.from(base.asPNG());

  const salida = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, ancho, alto], false);
  salida.clear(255);   // blanco: el fondo del documento
  const strideOut = salida.getStride();
  const pxOut = salida.getPixels();

  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const iBase = y * strideBase + x * compsBase;
      let alfa = 255;
      if (mascara) {
        const mx = Math.min(mascara.ancho - 1, Math.floor((x * mascara.ancho) / ancho));
        const my = Math.min(mascara.alto - 1, Math.floor((y * mascara.alto) / alto));
        alfa = mascara.px[my * mascara.stride + mx * mascara.comps];
      } else if (tieneAlfaPropio) {
        alfa = pxBase[iBase + compsBase - 1];
      }
      const iOut = y * strideOut + x * 3;
      for (let c = 0; c < 3; c++) {
        // El pixmap base puede ser gris (1 comp) o RGB (3): con gris el mismo valor va a los tres.
        const canal = pxBase[iBase + (compsBase >= 3 ? c : 0)];
        pxOut[iOut + c] = Math.round((canal * alfa + 255 * (255 - alfa)) / 255);
      }
    }
  }
  return Buffer.from(salida.asPNG());
}
