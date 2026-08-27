// app/lib/ficha-segmentar-productos.ts
// Reparte las PÁGINAS de la ficha del proveedor entre los productos de una línea-paquete
// (migración 82, caso real 2446-240-LE26), para que marca/modelo/foto se lean del trozo que
// corresponde a CADA producto — no del documento completo mezclado.
//
// POR QUÉ (27-ago-2026, pedido explícito): con la extracción de un solo producto por línea
// (llenaba solo producto_index 0), una línea con 2+ productos dejaba el resto sin completar —
// alguien tenía que copiarlos a mano uno por uno. Inviable con líneas de 20+ ítems.
//
// CÓMO REPARTE: las fichas de proveedor de este tipo (catálogo con varias hojas, una por
// producto — ver el caso Tecnomaq/2446-240-LE26 que dio origen a esto) traen el NOMBRE del
// producto como título al inicio de CADA página ("HIDROLAVADORA PEATONAL – TECNOMAQ H300" en la
// página 1, "VACUOLAVADORA DIMER DB51" en la página 3). Se compara ese título contra el nombre de
// cada producto de la línea (el mismo que ya tiene el informe — productosCrudosDeLinea) por
// PALABRAS EN COMÚN, y la página se asigna al que más comparte. Una página sin ninguna coincidencia
// razonable (portada, "INDUCCIÓN", "GENERALIDADES", condiciones generales…) queda SIN asignar —
// mejor no repartirla que repartirla mal.
//
// SIN IA: es la misma clase de heurística de texto que ya usa producto-ofertado.ts. No hay forma
// de "entender" el documento sin visión/LLM; el solapamiento de palabras es la señal más simple
// que funciona bien quel documento real que originó esto.

const STOPWORDS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'con', 'para',
  'por', 'en', 'a', 'al', 'que', 'su', 'sus', 'es', 'como', 'sin', 'no', 'se', 'lo', 'mas', 'más',
  'equivalente', 'modelo', 'marca', 'linea', 'producto', 'productos', 'dos', 'tres', 'cuatro',
]);

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Palabras de 4+ letras/números, normalizadas, sin las de relleno — la base de la comparación. */
function palabrasSignificativas(texto: string): Set<string> {
  const palabras = sinTildes(texto).match(/[a-z0-9]{4,}/g) || [];
  return new Set(palabras.filter(p => !STOPWORDS.has(p)));
}

/** Cuántas palabras significativas comparten dos textos. */
function solapamiento(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n;
}

/** Bajo esta cantidad de palabras en común, no se considera una coincidencia real — evita que una
 *  página de condiciones generales "empate" por una palabra suelta como "equipo" o "incluye". */
const SOLAPAMIENTO_MINIMO = 2;

/** Proxy del título de una página: las primeras líneas con texto, unidas y acotadas — el mismo
 *  criterio que ya usa modeloDesdeEncabezado() en producto-ofertado.ts para leer encabezados. */
function encabezadoDePagina(texto: string): string {
  return String(texto || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(0, 3).join(' ').slice(0, 200);
}

export interface ProductoSegmentado {
  productoIndex: number;
  /** Páginas (0-based) que se asignaron a este producto. Vacío = no se encontró su sección — el
   *  llamador decide qué hacer (para productoIndex 0 puede caer al documento completo). */
  paginas: number[];
  /** Texto concatenado de esas páginas, listo para extraerProductoOfertado(). */
  texto: string;
}

/**
 * Reparte las páginas del PDF entre los productos dados, por nombre. Nunca lanza: un fallo al
 * abrir el PDF devuelve todos los productos con `paginas: []` (el llamador decide el respaldo).
 */
export async function segmentarFichaPorProducto(buffer: Buffer, nombresProductos: string[]): Promise<ProductoSegmentado[]> {
  const vacio = nombresProductos.map((_, productoIndex) => ({ productoIndex, paginas: [] as number[], texto: '' }));
  if (nombresProductos.length < 2) return vacio;   // 1 solo producto: no hace falta repartir nada

  let mupdf: typeof import('mupdf');
  try { mupdf = await import('mupdf'); } catch { return vacio; }

  let doc: import('mupdf').Document;
  try { doc = mupdf.Document.openDocument(buffer, 'application/pdf'); } catch { return vacio; }

  const palabrasPorProducto = nombresProductos.map(palabrasSignificativas);
  const totalPaginas = Math.min(doc.countPages(), 40);   // catálogos largos: acotado, no hay IA que gastar de más
  const textoPorPagina: string[] = [];
  const asignacion: number[] = [];   // por página: índice de producto, o -1 sin asignar

  for (let i = 0; i < totalPaginas; i++) {
    let texto = '';
    try { texto = doc.loadPage(i).toStructuredText().asText(); } catch { /* página rota: queda sin texto */ }
    textoPorPagina.push(texto);

    const palabrasPagina = palabrasSignificativas(encabezadoDePagina(texto));
    let mejorIndice = -1, mejorScore = 0;
    palabrasPorProducto.forEach((palabrasProducto, idx) => {
      const score = solapamiento(palabrasPagina, palabrasProducto);
      if (score > mejorScore) { mejorScore = score; mejorIndice = idx; }
    });
    asignacion.push(mejorScore >= SOLAPAMIENTO_MINIMO ? mejorIndice : -1);
  }

  return nombresProductos.map((_, productoIndex) => {
    const paginas = asignacion.reduce<number[]>((acc, idx, pagina) => (idx === productoIndex ? [...acc, pagina] : acc), []);
    return { productoIndex, paginas, texto: paginas.map(p => textoPorPagina[p]).join('\n') };
  });
}
