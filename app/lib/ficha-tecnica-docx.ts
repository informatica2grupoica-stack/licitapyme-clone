// app/lib/ficha-tecnica-docx.ts
// NUESTRA ficha técnica en WORD (.docx), para que el equipo la pueda editar antes de presentarla (27-oct-2026, pedido
// del dueño: «el archivo debe ser en Word, no en PDF»). Mismo contenido y orden que la versión HTML/PDF de
// ficha-tecnica.ts (que sigue para la ficha antigua del costeo): encabezado con logo, datos de la empresa, una ficha por
// producto en su página (fotos en fila, especificaciones, «Incluye», información de la oferta) y la firma con el timbre.
// Sin marca ni modelo (sinMarcaNiModelo) y sin pie. Se arma con tablas de anchos fijos: en Word se ve y se edita igual.
import {
  AlignmentType, BorderStyle, Document, ImageRun, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun,
  VerticalAlign, WidthType, type IBorderOptions, type ParagraphChild,
} from 'docx';
import {
  num, ofertadoImpreso, productosEnOrden, sinMarcaNiModelo,
  type DatosFichaTecnica, type LineaFicha, type ProductoFicha,
} from '@/app/lib/ficha-tecnica';

const AZUL = '1F3864', GRIS = '52525B', GRIS_CLARO = 'A1A1AA', BORDE = 'E4E4E7', VACIA = 'FFFBEB', FUENTE = 'Arial';
// Carta con márgenes de 2 cm: 12240 − 2 × 1134 = 9972 twips de ancho útil.
const MARGEN = 1134, ANCHO = 9972;

// ── Imágenes ────────────────────────────────────────────────────────────────────────────────────────
// Word solo muestra PNG, JPG, GIF y BMP. El tamaño se lee de la cabecera del archivo (sin librerías) para respetar la
// proporción; una imagen que no se puede leer (WEBP, dañada) se deja fuera: mejor sin foto que una ficha que no abre.
interface Img { data: Buffer; type: 'png' | 'jpg'; w: number; h: number }
export function leerImagen(dataUri: string | null | undefined): Img | null {
  const m = String(dataUri || '').match(/^data:image\/[a-z+]+;base64,(.+)$/i);
  if (!m) return null;
  const b = Buffer.from(m[1], 'base64');
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { data: b, type: 'png', w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const marca = b[i + 1], largo = b.readUInt16BE(i + 2);
      if (marca >= 0xc0 && marca <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marca)) return { data: b, type: 'jpg', w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + largo;
    }
  }
  return null;
}
/** WEBP (fotos del costeo) → PNG con sharp, para que Word la muestre. Si no se puede, queda como estaba y se omite. */
async function aFormatoWord(src: string | null | undefined): Promise<string | null> {
  if (!src || !/^data:image\/webp;base64,/i.test(src)) return src ?? null;
  try {
    const sharp = (await import('sharp')).default;
    return `data:image/png;base64,${(await sharp(Buffer.from(src.split(',')[1], 'base64')).png().toBuffer()).toString('base64')}`;
  } catch { return src; }
}

/** La imagen dentro de una caja de ancho × alto máximos (en píxeles), sin deformarla. */
function imagen(src: string | null | undefined, maxW: number, maxH: number): ImageRun | null {
  const img = leerImagen(src);
  if (!img || !img.w || !img.h) return null;
  const k = Math.min(maxW / img.w, maxH / img.h, 1);
  return new ImageRun({ type: img.type, data: img.data, transformation: { width: Math.round(img.w * k), height: Math.round(img.h * k) } });
}

// ── Piezas de texto ─────────────────────────────────────────────────────────────────────────────────
const t = (text: string, o: { b?: boolean; i?: boolean; color?: string; size?: number; caps?: boolean } = {}) =>
  new TextRun({ text, bold: o.b, italics: o.i, color: o.color, size: o.size ?? 20, font: FUENTE, allCaps: o.caps });
const p = (children: ParagraphChild[], o: { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; antes?: number; despues?: number; bajo?: IBorderOptions; sobre?: IBorderOptions; saltoAntes?: boolean; conSiguiente?: boolean } = {}) =>
  new Paragraph({
    children, alignment: o.align, spacing: { before: o.antes ?? 0, after: o.despues ?? 0 },
    border: o.bajo || o.sobre ? { bottom: o.bajo, top: o.sobre } : undefined,
    pageBreakBefore: o.saltoAntes, keepNext: o.conSiguiente,
  });
const SIN: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const sinBordes = { top: SIN, bottom: SIN, left: SIN, right: SIN, insideHorizontal: SIN, insideVertical: SIN };
const borde: IBorderOptions = { style: BorderStyle.SINGLE, size: 4, color: BORDE };
const bordesTabla = { top: borde, bottom: borde, left: borde, right: borde, insideHorizontal: borde, insideVertical: borde };
const lineaAzul: IBorderOptions = { style: BorderStyle.SINGLE, size: 12, color: AZUL, space: 4 };

const celda = (children: (Paragraph | Table)[], ancho: number, o: { fondo?: string; span?: number; vAlign?: typeof VerticalAlign.TOP | typeof VerticalAlign.CENTER | typeof VerticalAlign.BOTTOM } = {}) =>
  new TableCell({
    children, width: { size: ancho, type: WidthType.DXA }, columnSpan: o.span, verticalAlign: o.vAlign,
    shading: o.fondo ? { type: ShadingType.CLEAR, color: 'auto', fill: o.fondo } : undefined,
    margins: { top: 70, bottom: 70, left: 110, right: 110 },
  });
/** Tabla «rótulo | valor» sin bordes (datos de la empresa, cantidad). */
function tablaRotulos(filas: Array<[string, string]>, anchoRotulo: number, valor: { b?: boolean; color?: string } = {}): Table {
  return new Table({
    width: { size: ANCHO, type: WidthType.DXA }, columnWidths: [anchoRotulo, ANCHO - anchoRotulo], borders: sinBordes,
    rows: filas.map(([k, v]) => new TableRow({ children: [
      celda([p([t(k, { color: GRIS, size: 19 })])], anchoRotulo),
      celda([p([t(v, { b: valor.b, color: valor.color })])], ANCHO - anchoRotulo),
    ] })),
  });
}
const tituloSeccion = (texto: string) => p([t(texto, { b: true, color: AZUL, size: 22, caps: true })], { antes: 260, despues: 100, conSiguiente: true });

// ── Una ficha por producto ──────────────────────────────────────────────────────────────────────────
function fotos(pr: ProductoFicha): Table | null {
  const fuentes = [pr.imagenDataUri, ...(pr.imagenesExtraDataUri || [])].filter(Boolean);
  const imgs = fuentes.map(src => imagen(src, fuentes.length > 2 ? 150 : 230, fuentes.length > 2 ? 120 : 160)).filter((x): x is ImageRun => !!x);
  if (!imgs.length) return null;
  const ancho = Math.floor(ANCHO / imgs.length);
  return new Table({
    width: { size: ANCHO, type: WidthType.DXA }, columnWidths: imgs.map(() => ancho), borders: sinBordes,
    rows: [new TableRow({ cantSplit: true, children: imgs.map(img => celda([
      p([img], { align: AlignmentType.CENTER }),
      p([t('Foto referencial', { i: true, color: GRIS_CLARO, size: 16 })], { align: AlignmentType.CENTER, antes: 40 }),
    ], ancho, { vAlign: VerticalAlign.BOTTOM })) })],
  });
}

function especificaciones(pr: ProductoFicha): (Paragraph | Table)[] {
  if (!pr.especificaciones.length) return [p([t('Sin especificaciones técnicas registradas para este producto.', { i: true, color: GRIS_CLARO })])];
  const a = Math.round(ANCHO * 0.34), b = ANCHO - a;
  const encabezado = new TableRow({ tableHeader: true, children: ['Característica', 'Especificación ofertada'].map((x, i) =>
    celda([p([t(x, { b: true, color: 'FFFFFF', size: 18, caps: true })])], i ? b : a, { fondo: AZUL })) });
  const filas = pr.especificaciones.map((e, i) => {
    const ofertado = ofertadoImpreso(e, pr);
    const fondo = ofertado ? (i % 2 ? 'FAFAFA' : undefined) : VACIA;   // casilla sin dato: vacía y con fondo, nunca un valor supuesto
    const valor = celda([p([t(ofertado)])], e.descripcion?.trim() ? b : ANCHO, { fondo, span: e.descripcion?.trim() ? undefined : 2 });
    return new TableRow({ cantSplit: true, children: e.descripcion?.trim()
      ? [celda([p([t(e.descripcion, { b: true })])], a, { fondo: i % 2 ? 'F4F4F5' : 'FAFAFA' }), valor]
      : [valor] });
  });
  return [new Table({ width: { size: ANCHO, type: WidthType.DXA }, columnWidths: [a, b], borders: bordesTabla, rows: [encabezado, ...filas] })];
}

function listaSimple(titulo: string, items: string[]): (Paragraph | Table)[] {
  if (!items.length) return [];
  return [tituloSeccion(titulo), new Table({
    width: { size: ANCHO, type: WidthType.DXA }, columnWidths: [ANCHO], borders: bordesTabla,
    rows: items.map(x => new TableRow({ cantSplit: true, children: [celda([p([t(x)])], ANCHO)] })),
  })];
}

function fichaDeProducto(pr: ProductoFicha, linea: LineaFicha, numero: number, conItem: boolean, primera: boolean): (Paragraph | Table)[] {
  const rotulo = `${linea.linea != null ? `Línea ${linea.linea} · ` : ''}${conItem && pr.item != null ? `Ítem ${pr.item} · ` : ''}Ficha técnica ${String(numero).padStart(2, '0')}`;
  const info = ([
    ['Fabricante', pr.fabricante], ['País de fabricación', pr.paisFabricacion], ['Año de fabricación', pr.anioFabricacion],
    ['Garantía técnica', pr.garantiaMeses != null ? `${pr.garantiaMeses} meses` : null],
  ] as Array<[string, string | null]>).filter((x): x is [string, string] => !!x[1] && !!String(x[1]).trim());
  const foto = fotos(pr);
  return [
    p([t(rotulo, { b: true, color: '71717A', size: 18, caps: true })], { saltoAntes: !primera, antes: primera ? 200 : 0, despues: 120, bajo: lineaAzul }),
    p([t(pr.nombre, { b: true, size: 30, caps: true })], { despues: 80 }),
    ...(pr.cantidad != null ? [tablaRotulos([['Cantidad ofertada', [num(pr.cantidad), pr.unidad].filter(Boolean).join(' · ')]], 1900, { b: true, color: AZUL })] : []),
    ...(foto ? [p([], { antes: 120 }), foto] : []),
    tituloSeccion('Especificaciones técnicas'),
    ...especificaciones(pr),
    ...listaSimple('Incluye', (pr.incluye || []).map(x => sinMarcaNiModelo(x || '', pr)).filter(Boolean)),
    ...(info.length ? [tituloSeccion('Información de la oferta'), tablaRotulos(info, 2600)] : []),
  ];
}

// ── Documento ───────────────────────────────────────────────────────────────────────────────────────
export async function construirFichaTecnicaDocx(datos: DatosFichaTecnica): Promise<Buffer> {
  const d: DatosFichaTecnica = {
    ...datos,
    empresa: { ...datos.empresa, logoDataUri: await aFormatoWord(datos.empresa.logoDataUri), firmaDataUri: await aFormatoWord(datos.empresa.firmaDataUri), timbreDataUri: await aFormatoWord(datos.empresa.timbreDataUri) },
    lineas: await Promise.all(datos.lineas.map(async l => ({ ...l, productos: await Promise.all(l.productos.map(async pr => ({
      ...pr, imagenDataUri: await aFormatoWord(pr.imagenDataUri),
      imagenesExtraDataUri: (await Promise.all((pr.imagenesExtraDataUri || []).map(aFormatoWord))).filter((x): x is string => !!x),
    }))) }))),
  };
  const e = d.empresa;
  const logo = imagen(e.logoDataUri, 190, 56);
  const titulos = [
    p([t(d.titulo || 'Ficha Técnica de la Oferta', { b: true, size: 30 })], { despues: 40 }),
    ...(d.subtitulo ? [p([t(d.subtitulo, { b: true, color: AZUL, size: 24 })], { despues: 40 })] : []),
    p([t(`${d.licitacionNombre || ''}${d.organismo ? ` · ${d.organismo}` : ''}`, { color: GRIS, size: 19 })]),
    p([t(d.licitacionCodigo, { b: true, color: AZUL, size: 19 })], { antes: 40 }),
  ];
  const anchoLogo = logo ? 3000 : 0;
  const encabezado = new Table({
    width: { size: ANCHO, type: WidthType.DXA }, columnWidths: logo ? [anchoLogo, ANCHO - anchoLogo] : [ANCHO],
    borders: { ...sinBordes, bottom: lineaAzul },
    rows: [new TableRow({ children: [
      ...(logo ? [celda([p([logo])], anchoLogo, { vAlign: VerticalAlign.CENTER })] : []),
      celda(titulos, ANCHO - anchoLogo, { vAlign: VerticalAlign.CENTER }),
    ] })],
  });
  const empresa = tablaRotulos(([
    ['Razón social', e.razonSocial], ['RUT', e.rut], ['Giro', e.giro], ['Dirección', e.direccion], ['Correo', e.email], ['Teléfono', e.telefono],
  ] as Array<[string, string | null]>).filter((x): x is [string, string] => !!x[1] && !!String(x[1]).trim()), 1900);

  const enOrden = productosEnOrden(d.lineas);
  const fichas = enOrden.flatMap(({ linea, producto }, i) =>
    fichaDeProducto(producto, linea, i + 1, enOrden.filter(x => x.linea.linea != null && x.linea.linea === linea.linea).length > 1, i === 0));

  // Firma sobre la línea y el timbre en su propia columna, como en la versión PDF.
  const firma = imagen(e.firmaDataUri, 210, 52), timbre = imagen(e.timbreDataUri, 110, 92);
  const anchoFirma = 4000, anchoTimbre = 2000;
  const linea: IBorderOptions = { style: BorderStyle.SINGLE, size: 6, color: '18181B', space: 2 };
  const colFirma = [
    p(firma ? [firma] : [], { align: AlignmentType.CENTER }),
    p([t(e.representanteNombre || e.razonSocial, { b: true })], { align: AlignmentType.CENTER, sobre: linea, antes: 40 }),
    ...(e.representanteRut ? [p([t(`RUT ${e.representanteRut}`, { color: GRIS, size: 19 })], { align: AlignmentType.CENTER })] : []),
    ...(e.representanteCargo ? [p([t(e.representanteCargo, { color: GRIS, size: 19 })], { align: AlignmentType.CENTER })] : []),
    p([t(e.razonSocial, { color: GRIS, size: 19 })], { align: AlignmentType.CENTER }),
  ];
  const bloqueFirma = new Table({
    width: { size: anchoFirma + anchoTimbre, type: WidthType.DXA }, columnWidths: [anchoFirma, anchoTimbre], borders: sinBordes,
    rows: [new TableRow({ cantSplit: true, children: [
      celda(colFirma, anchoFirma, { vAlign: VerticalAlign.BOTTOM }),
      celda([p(timbre ? [timbre] : [], { align: AlignmentType.CENTER })], anchoTimbre, { vAlign: VerticalAlign.BOTTOM }),
    ] })],
  });

  const doc = new Document({
    creator: e.razonSocial || 'LICITANK', title: `${d.titulo || 'Ficha Técnica de la Oferta'} — ${d.licitacionCodigo}`,
    styles: { default: { document: { run: { font: FUENTE, size: 20 } } } },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: MARGEN, bottom: MARGEN, left: MARGEN, right: MARGEN } } },
      children: [encabezado, p([], { despues: 160 }), empresa, ...fichas, p([], { antes: 500 }), bloqueFirma],
    }],
  });
  return Packer.toBuffer(doc);
}
