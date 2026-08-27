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
 */
export async function extraerImagenProducto(buffer: Buffer): Promise<ImagenExtraida | null> {
  let mupdf: typeof import('mupdf');
  try {
    mupdf = await import('mupdf');
  } catch {
    return null;
  }

  let doc: import('mupdf').Document;
  try {
    doc = mupdf.Document.openDocument(buffer, 'application/pdf');
  } catch {
    return null;
  }

  let mejor: { area: number; image: import('mupdf').Image; pagina: number } | null = null;
  const totalPaginas = Math.min(doc.countPages(), MAX_PAGINAS_REVISADAS);

  for (let i = 0; i < totalPaginas; i++) {
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
      structuredText = page.toStructuredText();
    } catch {
      continue;
    }
    structuredText.walk({
      onImageBlock(bbox, _transform, image) {
        const area = Math.abs((bbox[2] - bbox[0]) * (bbox[3] - bbox[1]));
        const fraccion = area / areaPagina;
        if (fraccion < AREA_MIN_FRACCION || fraccion > AREA_MAX_FRACCION) return;
        if (image.getWidth() < PIXELS_MIN && image.getHeight() < PIXELS_MIN) return;
        if (!mejor || area > mejor.area) mejor = { area, image, pagina: i + 1 };
      },
    });
  }

  if (!mejor) return null;
  const elegida = mejor as { area: number; image: import('mupdf').Image; pagina: number };
  try {
    const pixmap = elegida.image.toPixmap();
    return {
      png: Buffer.from(pixmap.asPNG()),
      anchoPx: elegida.image.getWidth(),
      altoPx: elegida.image.getHeight(),
      pagina: elegida.pagina,
    };
  } catch {
    return null;
  }
}
