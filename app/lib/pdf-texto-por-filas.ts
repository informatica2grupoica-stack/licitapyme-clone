// app/lib/pdf-texto-por-filas.ts
// Render de página para pdf-parse que reconstruye las FILAS visuales del PDF.
// El render por defecto de pdf-parse concatena los textos en el orden del flujo del archivo y solo corta línea cuando cambia la Y: en una
// ficha con la tabla repartida en apartados (PARÁMETROS / CONFIGURACIÓN / CAPACIDADES) los PDF de catálogo guardan primero todas las
// etiquetas, luego todas las unidades y luego todos los valores, y el texto sale con cada columna separada de la suya (caso 2369-74-LR26:
// el Lector perdió valores, mezcló "Motor" y partió un equipo en dos productos). Acá se agrupa por Y y se ordena por X; las celdas de una
// misma fila quedan separadas con " | " (y con " ‖ " si hay un salto de columna grande, p. ej. un dibujo con cotas al costado).

interface Trozo { x: number; y: number; w: number; h: number; s: string }

const SEP_CELDA = ' | ';
const SEP_COLUMNA = ' ‖ ';

export function filasDeTrozos(trozos: Trozo[]): string {
  const validos = trozos.filter(t => t.s.trim() !== '');
  validos.sort((a, b) => b.y - a.y || a.x - b.x);
  const filas: Trozo[][] = [];
  for (const t of validos) {
    const fila = filas[filas.length - 1];
    const tol = Math.max(2, (fila?.[0]?.h || t.h || 8) * 0.5);
    if (fila && Math.abs(fila[0].y - t.y) <= tol) fila.push(t);
    else filas.push([t]);
  }
  return filas.map(fila => {
    fila.sort((a, b) => a.x - b.x);
    let out = '';
    let finPrevio = 0;
    fila.forEach((t, i) => {
      if (i === 0) { out = t.s.trim(); }
      else {
        const hueco = t.x - finPrevio;
        const alto = Math.max(t.h, 6);
        const sep = hueco > alto * 16 ? SEP_COLUMNA : hueco > alto * 1.5 ? SEP_CELDA : (/\s$/.test(out) || /^\s/.test(t.s) ? '' : ' ');
        // Cota suelta de un dibujo (número tras un salto de columna, con la fila ya completa): no es parte de la tabla.
        if (sep === SEP_COLUMNA && i >= 3 && /^[\d.,°\s]+$/.test(t.s)) return;
        out += sep + (sep === '' ? t.s : t.s.trim());
      }
      finPrevio = t.x + t.w;
    });
    return out.trim();
  }).join('\n');
}

/** Para `pdfParse(buffer, { pagerender: renderPaginaPorFilas })`. */
export async function renderPaginaPorFilas(pageData: any): Promise<string> {
  const tc = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
  const trozos: Trozo[] = (tc.items || []).map((it: any) => ({
    x: it.transform?.[4] ?? 0, y: it.transform?.[5] ?? 0, w: it.width ?? 0, h: it.height ?? Math.abs(it.transform?.[3] ?? 8), s: String(it.str ?? ''),
  }));
  return filasDeTrozos(trozos);
}
