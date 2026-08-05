// app/lib/anexos-pdf-a-docx.ts
// Rescata los anexos que la licitación publicó SOLO impresos dentro del PDF de bases (ver
// anexos-en-bases.ts para la detección y el caso real 1114-12-LE26): recorta las páginas de cada
// anexo y las reconstruye como .docx, que es lo único que el motor de relleno sabe editar.
//
// Qué se conserva y qué no — importa saberlo antes de mandar uno de estos a un organismo:
//   · SÍ: el texto completo, los blancos ("____", "......"), los "Campo:" sin llenar, la negrita,
//     el tamaño de letra, el centrado y los saltos de página. O sea, todo lo que el motor de
//     relleno necesita para hacer su trabajo, y lo suficiente para que la hoja se lea igual.
//   · NO: tablas con sus bordes, logos/imágenes, sangrías finas ni tipografías exactas. Un PDF no
//     guarda "esto era una tabla", solo dibujos y texto con coordenadas — reconstruirlas a ciegas
//     produce tablas mal armadas, peor que no tenerlas.
// Por eso el documento resultante se marca SIEMPRE como reconstruido (ver ADVERTENCIA_ORIGEN): el
// original manda, y esto es una ayuda para no llenar 11 formularios a mano.
//
// Server-only: mupdf y pdf-lib son módulos de Node.
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import type { AnexoEnBases } from '@/app/lib/anexos-en-bases';

export interface RangoAnexo {
  titulo: string;
  /** 1-based, como las ve el usuario en el visor de PDF. */
  desde: number;
  hasta: number;
}

// De la lista de anexos detectados (cada uno con su página de inicio) a rangos de páginas: cada
// anexo llega hasta donde empieza el siguiente. Dos anexos que arrancan en la MISMA página
// (pasa: "ANEXO N° 2-A" y "2-B" comparten la 35) se funden en un solo recorte — separarlos
// exigiría cortar media hoja, que no se puede.
export function rangosDeAnexos(anexos: AnexoEnBases[], totalPaginas: number): RangoAnexo[] {
  const conPagina = anexos.filter(a => a.pagina != null && a.pagina >= 1 && a.pagina <= totalPaginas);
  const rangos: RangoAnexo[] = [];
  for (const a of conPagina) {
    const anterior = rangos[rangos.length - 1];
    if (anterior && anterior.desde === a.pagina) {
      anterior.titulo = `${anterior.titulo} + ${a.titulo}`;
      continue;
    }
    rangos.push({ titulo: a.titulo, desde: a.pagina!, hasta: totalPaginas });
  }
  for (let i = 0; i < rangos.length - 1; i++) {
    rangos[i].hasta = Math.max(rangos[i].desde, rangos[i + 1].desde - 1);
  }
  return rangos;
}

export async function recortarPdf(bufferPdf: Buffer, desde: number, hasta: number): Promise<Buffer> {
  const origen = await PDFDocument.load(new Uint8Array(bufferPdf));
  const destino = await PDFDocument.create();
  const indices: number[] = [];
  for (let p = desde; p <= Math.min(hasta, origen.getPageCount()); p++) indices.push(p - 1);
  const paginas = await destino.copyPages(origen, indices);
  for (const p of paginas) destino.addPage(p);
  return Buffer.from(await destino.save());
}

export async function contarPaginasPdf(bufferPdf: Buffer): Promise<number> {
  return (await PDFDocument.load(new Uint8Array(bufferPdf))).getPageCount();
}

// ── PDF → líneas con formato ─────────────────────────────────────────────────────────────────
interface LineaPdf {
  texto: string;
  negrita: boolean;
  tamano: number;      // en puntos
  serif: boolean;
  x: number;           // borde izquierdo
  ancho: number;
  centrada: boolean;
  pagina: number;      // 1-based dentro del recorte
  y: number;           // línea base — para reunir lo que en el papel va en la MISMA fila
  /** Fragmentos que iban a la derecha en la misma fila, con la posición donde empiezan. */
  continuaciones?: { texto: string; x: number; negrita: boolean }[];
}

// Una línea cuenta como centrada si su centro está cerca del centro de la página Y no ocupa casi
// todo el ancho (un párrafo justificado también tiene su centro ahí, pero es ancho).
const TOLERANCIA_CENTRADO_PT = 22;
const FRACCION_ANCHO_PARRAFO = 0.72;

async function extraerLineas(bufferPdf: Buffer): Promise<LineaPdf[]> {
  const mupdf: any = await import('mupdf');
  const doc = mupdf.Document.openDocument(new Uint8Array(bufferPdf), 'application/pdf');
  const out: LineaPdf[] = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    const [, , anchoPagina] = page.getBounds();
    const json = JSON.parse(page.toStructuredText('preserve-whitespace').asJSON());
    for (const bloque of json.blocks ?? []) {
      if (bloque.type !== 'text') continue;
      for (const linea of bloque.lines ?? []) {
        const texto: string = linea.text ?? '';
        if (!texto.trim()) { out.push({ texto: '', negrita: false, tamano: 11, serif: false, x: 0, ancho: 0, centrada: false, pagina: i + 1, y: linea.bbox?.y ?? 0 }); continue; }
        const font = linea.font ?? {};
        const centro = linea.bbox.x + linea.bbox.w / 2;
        out.push({
          texto,
          negrita: font.weight === 'bold',
          tamano: Math.round(font.size ?? 11),
          serif: font.family === 'serif',
          x: linea.bbox.x,
          ancho: linea.bbox.w,
          centrada: Math.abs(centro - anchoPagina / 2) < TOLERANCIA_CENTRADO_PT
            && linea.bbox.w < anchoPagina * FRACCION_ANCHO_PARRAFO,
          pagina: i + 1,
          y: linea.bbox.y,
        });
      }
    }
  }
  return reunirFilas(out);
}

// Lo que en el papel está en la MISMA fila tiene que quedar en el mismo párrafo del Word. mupdf
// entrega cada celda/columna como una "línea" suelta porque están en bloques distintos, y sin
// esto el resultado quedaba ilegible en los dos casos que más importan:
//   · "Firma: ______" salía como "Firma:" y en el renglón siguiente la raya suelta — el blanco
//     perdía su etiqueta, y con ella el contexto que el motor de relleno usa para saber qué va ahí.
//   · Las tablas de dos columnas ("Nombre: | RUT:") se desarmaban en una lista vertical.
// Se agrupa por línea base (tolerancia de unos pocos puntos, porque una fila con letras de
// distinto tamaño no comparte la Y exacta) y se ordena por posición horizontal.
// La tolerancia tiene que ser MENOR que el interlineado (≈13 pt en estos documentos) o se
// fusionarían renglones seguidos de un mismo párrafo; y mayor que el desfase entre textos de
// distinto tamaño en una misma fila.
const TOLERANCIA_MISMA_FILA_PT = 6;

function reunirFilas(lineas: LineaPdf[]): LineaPdf[] {
  const out: LineaPdf[] = [];
  const paginas = [...new Set(lineas.map(l => l.pagina))].sort((a, b) => a - b);
  for (const pagina of paginas) {
    // Clave: NO basta comparar cada línea con la anterior. mupdf entrega el texto bloque por
    // bloque, así que en una tabla vienen primero todas las celdas de la columna izquierda y
    // después las de la derecha — dos celdas de la MISMA fila nunca están una al lado de la otra
    // en la lista. Hay que reordenar toda la página por posición (arriba→abajo, izq→der) antes de
    // agrupar, que es como se lee el papel.
    const dePagina = lineas.filter(l => l.pagina === pagina)
      .sort((a, b) => (Math.abs(a.y - b.y) <= TOLERANCIA_MISMA_FILA_PT ? a.x - b.x : a.y - b.y));

    let fila: LineaPdf | null = null;
    for (const l of dePagina) {
      if (!l.texto.trim()) { out.push(l); fila = null; continue; }
      if (fila && Math.abs(fila.y - l.y) <= TOLERANCIA_MISMA_FILA_PT) {
        fila.continuaciones = [...(fila.continuaciones ?? []), { texto: l.texto, x: l.x, negrita: l.negrita }];
        fila.centrada = false; // una fila de varias columnas ya no es un título centrado
        continue;
      }
      fila = l;
      out.push(l);
    }
  }
  return out;
}

// ── Filas de varias columnas → TABLAS de Word ────────────────────────────────────────────────
// No es un lujo estético: es lo que hace que el relleno automático acierte. Con las columnas
// pegadas en un solo párrafo separadas por tabulaciones, el motor lee "Correo Electrónico de
// Contacto: Teléfono de Contacto:" como UN campo y escribe UN valor al final — en la prueba con
// el ANEXO N° 2-A metió la DIRECCIÓN de la empresa en el campo de correo/teléfono. Con celdas de
// verdad, cada etiqueta recibe su propio valor, que es como está armado el anexo original.
//
// Se agrupan filas CONSECUTIVAS de 2+ columnas cuyas columnas caen en las mismas posiciones. Las
// líneas en blanco intermedias no cortan el bloque (una celda alta deja huecos entre renglones),
// pero una línea de texto a ancho completo sí: ahí se terminó la tabla.
const TOLERANCIA_COLUMNA_PT = 12;
const MINIMO_FILAS_TABLA = 2;

interface FilaTabla { celdas: { texto: string; negrita: boolean; x: number }[]; tamano: number; serif: boolean }
type Elemento = { tipo: 'parrafo'; linea: LineaPdf } | { tipo: 'tabla'; filas: FilaTabla[]; columnas: number[] };

function celdasDeLinea(l: LineaPdf): { texto: string; negrita: boolean; x: number }[] {
  return [{ texto: l.texto, negrita: l.negrita, x: l.x }, ...(l.continuaciones ?? [])];
}

// Las posiciones de columna del bloque: se van fusionando las x parecidas.
function columnasDe(filas: FilaTabla[]): number[] {
  const xs = filas.flatMap(f => f.celdas.map(c => c.x)).sort((a, b) => a - b);
  const cols: number[] = [];
  for (const x of xs) {
    if (!cols.length || x - cols[cols.length - 1] > TOLERANCIA_COLUMNA_PT) cols.push(x);
  }
  return cols;
}

function agruparEnElementos(lineas: LineaPdf[]): Elemento[] {
  const out: Elemento[] = [];
  let i = 0;
  while (i < lineas.length) {
    const l = lineas[i];
    if (!l.continuaciones?.length) { out.push({ tipo: 'parrafo', linea: l }); i++; continue; }

    const filas: FilaTabla[] = [];
    const enBlanco: LineaPdf[] = [];
    let j = i;
    while (j < lineas.length) {
      const c = lineas[j];
      if (!c.texto.trim()) { enBlanco.push(c); j++; continue; }
      if (!c.continuaciones?.length || c.pagina !== l.pagina) break;
      filas.push({ celdas: celdasDeLinea(c), tamano: c.tamano, serif: c.serif });
      enBlanco.length = 0;
      j++;
    }
    if (filas.length >= MINIMO_FILAS_TABLA) {
      out.push({ tipo: 'tabla', filas, columnas: columnasDe(filas) });
      i = j - enBlanco.length; // las líneas vacías del final no son de la tabla
    } else {
      out.push({ tipo: 'parrafo', linea: l });
      i++;
    }
  }
  return out;
}

// ── Líneas → .docx ───────────────────────────────────────────────────────────────────────────
// Se escribe el OOXML a mano (mismo enfoque que todo el módulo de anexos, que trabaja el XML
// directo) en vez de traer una librería nueva: el documento que hace falta es simple —párrafos
// con formato de carácter— y así queda exactamente con la forma que el detector ya sabe leer.
function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Nota sobre el texto: NO se recorta ni se normalizan los espacios. Los blancos de estos
// formularios son justamente cadenas de "_" y de espacios, y el detector de blancos inline
// (anexos-docx.ts) trabaja sobre el texto tal cual — "arreglarlo" acá sería borrar las casillas.
// El PDF mide en puntos y OOXML en twips (1 pt = 20 twips). El margen izquierdo de la página
// generada se descuenta para que una tabulación puesta en "x del PDF" caiga donde corresponde.
const TWIPS_POR_PUNTO = 20;
const MARGEN_IZQ_TWIPS = 1134;

function runXml(texto: string, fuente: string, negrita: boolean, tamano: number): string {
  const rPr = `<w:rPr><w:rFonts w:ascii="${fuente}" w:hAnsi="${fuente}"/>${negrita ? '<w:b/>' : ''}<w:sz w:val="${Math.max(12, tamano * 2)}"/></w:rPr>`;
  return `<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(texto)}</w:t></w:r>`;
}

function parrafoXml(l: LineaPdf, saltoAntes: boolean): string {
  const fuente = l.serif ? 'Times New Roman' : 'Calibri';
  const tamano = Math.max(12, l.tamano * 2);
  // Cada columna de la fila se ancla con su propia tabulación en la posición REAL que tenía en el
  // PDF: así "Nombre:" y "RUT:" quedan alineados como en el original en vez de correrse con los
  // tabuladores por defecto de Word.
  const cols = l.continuaciones ?? [];
  const tabs = cols.length
    ? `<w:tabs>${cols.map(c => `<w:tab w:val="left" w:pos="${Math.max(240, Math.round(c.x * TWIPS_POR_PUNTO) - MARGEN_IZQ_TWIPS)}"/>`).join('')}</w:tabs>`
    : '';
  const pPr = `<w:pPr>${tabs}<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>`
    + (l.centrada ? '<w:jc w:val="center"/>' : '')
    + (saltoAntes ? '<w:pageBreakBefore/>' : '')
    + `<w:rPr><w:rFonts w:ascii="${fuente}" w:hAnsi="${fuente}"/>${l.negrita ? '<w:b/>' : ''}<w:sz w:val="${tamano}"/></w:rPr></w:pPr>`;
  if (!l.texto) return `<w:p>${pPr}</w:p>`;

  const runs = [runXml(l.texto, fuente, l.negrita, l.tamano)];
  for (const c of cols) {
    runs.push(`<w:r><w:tab/></w:r>`, runXml(c.texto, fuente, c.negrita, l.tamano));
  }
  return `<w:p>${pPr}${runs.join('')}</w:p>`;
}

// Ancho útil de la página en twips (carta menos los dos márgenes de 2 cm).
const ANCHO_UTIL_TWIPS = 11906 - 1134 * 2;

// Una celda LÓGICA: o bien texto real (una etiqueta, un dato, una raya "___"), o bien una celda
// VALOR — vacía a propósito, la casilla donde el motor de relleno va a escribir.
interface CeldaLogica { texto: string; negrita: boolean; esValor: boolean; gridSpan: number }

// BUG REAL (1114-12-LE26, ANEXO 2-A y 2-B): la primera versión mapeaba cada celda a "la columna
// más cercana" de un grid con las posiciones de TODO el bloque fusionadas. Una fila con menos
// columnas que el máximo del bloque (ej. "Correo Electrónico de Contacto:" | "Teléfono de
// Contacto:", solo 2 celdas de texto) terminaba con celdas vacías FANTASMA en el medio —
// posiciones del grid que en esta fila específica no correspondían a NINGÚN valor real. El
// desambiguador de duplicados (detectarCandidatosCelda → desambiguarDuplicados) usa el párrafo
// INMEDIATAMENTE anterior a esa celda vacía para decidir el contexto de una etiqueta repetida;
// con dos celdas fantasma de por medio, terminó agarrando la ETIQUETA VECINA ("Correo...") como
// si fuera "el contexto" de "Teléfono...", fusionando ambas en un solo candidato — el motor le
// puso el teléfono en la celda del correo.
//
// La regla ahora es fila-por-fila, sin grid compartido: cada celda de texto que termine en ":"
// se sigue INMEDIATAMENTE (sin nada en el medio) de UNA sola celda-valor. Nunca dos etiquetas
// quedan separadas por más de una celda vacía, así que no hay dónde perderse.
function celdasLogicasDeFila(f: FilaTabla): CeldaLogica[] {
  const out: CeldaLogica[] = [];
  for (const c of f.celdas) {
    out.push({ texto: c.texto, negrita: c.negrita, esValor: false, gridSpan: 1 });
    if (c.texto.trim().endsWith(':')) out.push({ texto: '', negrita: false, esValor: true, gridSpan: 1 });
  }
  return out;
}

function tablaXml(t: { filas: FilaTabla[]; columnas: number[] }): string {
  const filasLogicas = t.filas.map(f => ({ celdas: celdasLogicasDeFila(f), tamano: f.tamano, serif: f.serif }));
  const maxColumnas = Math.max(1, ...filasLogicas.map(f => f.celdas.length));
  const anchoCelda = Math.floor(ANCHO_UTIL_TWIPS / maxColumnas);

  const bordes = '<w:tblBorders>'
    + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map(b => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`).join('')
    + '</w:tblBorders>';
  const grid = `<w:tblGrid>${Array.from({ length: maxColumnas }, () => `<w:gridCol w:w="${anchoCelda}"/>`).join('')}</w:tblGrid>`;

  const filas = filasLogicas.map(f => {
    const fuente = f.serif ? 'Times New Roman' : 'Calibri';
    // Una fila más corta que el máximo del bloque estira su ÚLTIMA celda con gridSpan — así el
    // ancho total sigue calzando con las demás filas sin dejar columnas fantasma en el medio.
    const faltantes = maxColumnas - f.celdas.length;
    const celdasConSpan = f.celdas.map((c, i) => ({ ...c, gridSpan: i === f.celdas.length - 1 ? c.gridSpan + faltantes : c.gridSpan }));

    const celdasXml = celdasConSpan.map(c => {
      const ancho = anchoCelda * c.gridSpan;
      const spanXml = c.gridSpan > 1 ? `<w:gridSpan w:val="${c.gridSpan}"/>` : '';
      const pPr = `<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:rPr><w:rFonts w:ascii="${fuente}" w:hAnsi="${fuente}"/><w:sz w:val="${Math.max(12, f.tamano * 2)}"/></w:rPr></w:pPr>`;
      const contenido = c.texto ? runXml(c.texto, fuente, c.negrita, f.tamano) : '';
      return `<w:tc><w:tcPr><w:tcW w:w="${ancho}" w:type="dxa"/>${spanXml}</w:tcPr><w:p>${pPr}${contenido}</w:p></w:tc>`;
    }).join('');
    return `<w:tr>${celdasXml}</w:tr>`;
  }).join('');

  return `<w:tbl><w:tblPr><w:tblW w:w="${ANCHO_UTIL_TWIPS}" w:type="dxa"/>${bordes}</w:tblPr>${grid}${filas}</w:tbl>`;
}

// Se deja escrito EN el documento de dónde salió. Un anexo reconstruido puede terminar
// presentándose por error creyendo que es el original; que lo diga la primera línea es la forma
// más barata de que nadie se confunda (y se borra con un clic si el usuario decide que sobra).
const ADVERTENCIA_ORIGEN = 'Documento reconstruido automáticamente desde el PDF de las bases '
  + '(los anexos no se publicaron como archivo Word). Revise el formato contra el original antes de presentarlo.';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;

const NS_DOCUMENT = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
  + 'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" '
  + 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14"';

// Carta vertical con márgenes de 2 cm — el formato de estos formularios.
const SECT_PR = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
  + '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';

export async function pdfADocx(bufferPdf: Buffer): Promise<Buffer> {
  const lineas = await extraerLineas(bufferPdf);
  if (!lineas.some(l => l.texto.trim())) {
    throw new Error('El PDF de este anexo no tiene texto seleccionable (probablemente es un escaneo): no se puede reconstruir como Word.');
  }

  const aviso: LineaPdf = { texto: ADVERTENCIA_ORIGEN, negrita: false, tamano: 8, serif: false, x: 0, ancho: 0, centrada: false, pagina: 1, y: 0 };
  let paginaPrevia = 1;
  const elementos = agruparEnElementos(lineas);
  const cuerpo = [parrafoXml(aviso, false)];
  elementos.forEach((el, i) => {
    if (el.tipo === 'tabla') {
      cuerpo.push(tablaXml(el));
      // Word exige un párrafo entre DOS tablas consecutivas o se funden visualmente en una — pasa
      // seguido acá: la tabla de "Identificación" va pegada directo a la de "Firma", sin ningún
      // título entre medio (1114-12-LE26, ANEXO 2-A). Pero un separador VACÍO ahí es peligroso:
      // BUG REAL — el detector de candidatos (anexos-detectar.ts) lo lee como "la celda de valor
      // que falta" para la ÚLTIMA etiqueta de la tabla anterior, y cuando esa fila tiene DOS
      // etiquetas sin su propia celda de valor a la derecha ("Correo Electrónico de Contacto:" |
      // "Teléfono de Contacto:") las fusionaba en un solo candidato — el motor le puso el
      // teléfono a un párrafo suelto FUERA de la tabla, con letra grande y descolgado, en vez de
      // a su celda. Un carácter de ancho cero (U+200B) no se ve en Word pero hace que el párrafo
      // ya NO cuente como "vacío" para parrafoEstaVacio/listarParrafos — deja de ser candidato,
      // sin dejar ningún rastro visible en la hoja.
      if (elementos[i + 1]?.tipo === 'tabla') cuerpo.push('<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:t>​</w:t></w:r></w:p>');
      return;
    }
    cuerpo.push(parrafoXml(el.linea, el.linea.pagina !== paginaPrevia));
    paginaPrevia = el.linea.pagina;
  });

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS_DOCUMENT}><w:body>${cuerpo.join('')}${SECT_PR}</w:body></w:document>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', RELS);
  zip.file('word/document.xml', documentXml);
  zip.file('word/_rels/document.xml.rels', DOC_RELS);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Recorta las páginas del anexo y devuelve las dos versiones: el PDF fiel y el Word rellenable. */
export async function extraerAnexoDeBases(
  bufferPdf: Buffer, rango: RangoAnexo,
): Promise<{ pdf: Buffer; docx: Buffer }> {
  const pdf = await recortarPdf(bufferPdf, rango.desde, rango.hasta);
  return { pdf, docx: await pdfADocx(pdf) };
}
