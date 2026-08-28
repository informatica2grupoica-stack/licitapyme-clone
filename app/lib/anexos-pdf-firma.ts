// app/lib/anexos-pdf-firma.ts
// Firma/timbre con posición LIBRE, elegida por el usuario arrastrando sobre una vista real del
// PDF — pedido explícito del usuario (29-ago-2026, "así como lo hace ecert Chile"). Un .docx es
// texto que fluye, sin coordenadas de píxel; un PDF sí tiene página fija, así que este es el ÚNICO
// punto del sistema donde una imagen se ubica por posición absoluta en vez de anclarse a un
// párrafo. Flujo completo:
//   1) Se genera el anexo con el texto ya puesto (generarAnexoFinal, SIN firma/timbre — respuestas
//      nunca trae `firma:N`, así que el paso 3 de generarAnexoFinal no estampa nada).
//   2) Ese .docx se convierte a PDF (convertirDocxAPdf, anexos-doc-legacy.ts).
//   3) El navegador muestra ese PDF real (pdfjs) y el usuario arrastra la firma/timbre a
//      cualquier punto — la posición viaja como PORCENTAJE de la página (xPct/yPct/anchoPct), no
//      en píxeles: el zoom con el que el usuario ve el PDF en su pantalla no tiene por qué
//      coincidir con el tamaño real en puntos de la página, y el porcentaje es invariante a eso.
//   4) `estamparPdf` (acá) quema la imagen en esa posición exacta sobre el PDF real (nunca sobre
//      el .docx) y ESE PDF firmado es el archivo final — reemplaza al .docx solo como archivo de
//      salida, el .docx con el texto sigue existiendo si hace falta editarlo.
import { PDFDocument, type PDFImage } from 'pdf-lib';

export interface EstampaPdf {
  tipo: 'firma' | 'timbre';
  /** 0-based — la página donde el usuario soltó la imagen. */
  pagina: number;
  /** 0..1, desde el borde IZQUIERDO de la página — invariante al zoom de la vista previa. */
  xPct: number;
  /** 0..1, desde el borde SUPERIOR de la página (PDF usa origen abajo-izquierda; se convierte acá). */
  yPct: number;
  /** Ancho de la imagen como fracción del ancho de la página — el alto se deriva de la proporción real de la imagen, nunca se deforma. */
  anchoPct: number;
}

export interface ImagenParaEstampar { buffer: Buffer; extension: string }

// pdf-lib solo embebe PNG/JPG de forma nativa (sin decodificar/recodificar nada, que es lo que
// también hace anexos-docx.ts para Word) — mismo límite de formato que ya tiene el resto del
// sistema, no uno nuevo. Un formato distinto (webp, gif, bmp) no se intenta "arreglar" solo:
// mejor un error claro que una firma corrupta o en blanco en el documento final.
async function embeberImagen(pdfDoc: PDFDocument, img: ImagenParaEstampar): Promise<PDFImage> {
  const ext = img.extension.toLowerCase();
  if (ext === 'png') return pdfDoc.embedPng(img.buffer);
  if (ext === 'jpg' || ext === 'jpeg') return pdfDoc.embedJpg(img.buffer);
  throw new Error(`Formato de imagen "${img.extension}" no soportado para estampar sobre PDF (solo PNG/JPG) — vuelve a subir la firma/timbre en uno de esos formatos en /empresas.`);
}

/**
 * Quema cada estampa en su posición exacta sobre el PDF ya generado (con el texto puesto, sin
 * firma). Las estampas cuyo `tipo` no tenga imagen disponible en `imagenes` se ignoran (no
 * revientan la generación completa por una sola imagen faltante).
 */
export async function estamparPdf(
  pdfBuffer: Buffer, estampas: EstampaPdf[], imagenes: { firma?: ImagenParaEstampar; timbre?: ImagenParaEstampar },
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const cacheImagenEmbebida = new Map<'firma' | 'timbre', PDFImage>();

  for (const estampa of estampas) {
    const datos = imagenes[estampa.tipo];
    if (!datos) continue;
    const totalPaginas = pdfDoc.getPageCount();
    if (estampa.pagina < 0 || estampa.pagina >= totalPaginas) continue; // página inexistente: se ignora, no revienta el resto
    const pagina = pdfDoc.getPage(estampa.pagina);
    const { width: anchoPagina, height: altoPagina } = pagina.getSize();

    let imagen = cacheImagenEmbebida.get(estampa.tipo);
    if (!imagen) {
      imagen = await embeberImagen(pdfDoc, datos);
      cacheImagenEmbebida.set(estampa.tipo, imagen);
    }

    const anchoDibujo = anchoPagina * Math.max(0.02, Math.min(1, estampa.anchoPct));
    const escala = anchoDibujo / imagen.width;
    const altoDibujo = imagen.height * escala;
    // yPct viene medido desde ARRIBA (como en pantalla); PDF ubica desde ABAJO — y la coordenada
    // que pide drawImage es la esquina inferior-izquierda del dibujo, no el punto donde soltó el
    // mouse (que se toma como esquina SUPERIOR-izquierda de la imagen al arrastrar).
    const x = anchoPagina * Math.max(0, Math.min(1, estampa.xPct));
    const yDesdeArriba = altoPagina * Math.max(0, Math.min(1, estampa.yPct));
    const y = altoPagina - yDesdeArriba - altoDibujo;
    pagina.drawImage(imagen, { x, y: Math.max(0, y), width: anchoDibujo, height: altoDibujo });
  }

  return Buffer.from(await pdfDoc.save());
}

/** Páginas y tamaño real (en puntos PDF) de cada una — el frontend lo usa para calcular a qué
 *  porcentaje de la página corresponde el punto exacto donde el usuario soltó la imagen. */
export async function dimensionesPdf(pdfBuffer: Buffer): Promise<{ paginas: number; tamanos: { anchoPt: number; altoPt: number }[] }> {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const tamanos = pdfDoc.getPages().map(p => { const { width, height } = p.getSize(); return { anchoPt: width, altoPt: height }; });
  return { paginas: pdfDoc.getPageCount(), tamanos };
}
