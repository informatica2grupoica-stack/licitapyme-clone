// Miniatura de página de un anexo (29-oct-2026, pedido del dueño: la vista previa de «Separar
// anexos» tiene que mostrar el anexo «como se ve en el Word», no una lista de texto).
// .docx → PDF con el conversor (LibreOffice, el mismo de la vista previa de firma) → primera página
// rasterizada con mupdf → PNG en data URL. Si algo falla devuelve null: la pantalla cae al texto.
import { convertirDocxAPdf } from '@/app/lib/anexos-doc-legacy';

export interface Miniatura {
  imagen: string;   // data:image/png;base64,…
  paginas: number;  // páginas del anexo ya convertido (una de más al final suele ser un corte sucio)
}

const ESCALA = 0.9;          // ~535×757 px para una carta/A4: legible sin pesar
const SIMULTANEAS = 3;       // conversiones LibreOffice a la vez

export async function miniaturaDePieza(buffer: Buffer, contentType: string): Promise<Miniatura | null> {
  try {
    const pdf = contentType.includes('pdf') ? buffer : await convertirDocxAPdf(buffer);
    const mupdf = await import('mupdf');
    const doc = mupdf.Document.openDocument(pdf, 'application/pdf');
    const paginas = doc.countPages();
    if (paginas < 1) return null;
    const pix = doc.loadPage(0).toPixmap(mupdf.Matrix.scale(ESCALA, ESCALA), mupdf.ColorSpace.DeviceRGB, false);
    return { imagen: `data:image/png;base64,${Buffer.from(pix.asPNG()).toString('base64')}`, paginas };
  } catch {
    return null;
  }
}

export async function miniaturasDePiezas(piezas: { buffer: Buffer; contentType: string }[]): Promise<(Miniatura | null)[]> {
  const salida: (Miniatura | null)[] = new Array(piezas.length).fill(null);
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < piezas.length) {
      const i = siguiente++;
      salida[i] = await miniaturaDePieza(piezas[i].buffer, piezas[i].contentType);
    }
  };
  await Promise.all(Array.from({ length: Math.min(SIMULTANEAS, piezas.length) }, trabajador));
  return salida;
}
