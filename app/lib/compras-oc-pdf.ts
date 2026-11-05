// app/lib/compras-oc-pdf.ts
// PDF de una orden de compra de Obuma, con la MISMA plantilla que imprime Obuma (copia medida sobre «orden-de-compra-3870.pdf»:
// A4, Helvetica 8/10/12 pt, mismas posiciones, cajas, tabla, totales, condiciones y firmas). Solo cambia el contenido.
// Coordenadas en puntos, con el origen arriba a la izquierda (como en el PDF de Obuma); se convierten al escribir.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import type { OcDocumento } from '@/app/lib/compras-oc-documento';

const PW = 595.28, PH = 841.89;
const L = 28.3, R = 566.9;          // márgenes de las cajas y la tabla
const PIE_Y = 770;                   // hasta aquí llega el contenido (como corta Obuma); abajo va el pie
const ASC = 0.87;                    // el texto se mide desde su borde superior (como el PDF de Obuma)

const miles = (n: number) => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(n));
const dec = (n: number) => `${miles(Math.trunc(n))},${String(Math.round(Math.abs(n - Math.trunc(n)) * 100)).padStart(2, '0')}`;
const limpio = (s: string | null | undefined) => String(s ?? '').replace(/\t/g, ' ').replace(/[^\x20-\xFF]/g, '?');
const fechaDMA = (f: string | null) => !f ? '' : /^\d{4}-\d{2}-\d{2}/.test(f) ? f.slice(0, 10).split('-').reverse().join('-') : f;

/** Descarga la foto del producto (solo enlaces https del almacenamiento de Obuma) y la deja lista para incrustar; null si no se puede. */
async function bajarFoto(url: string | null): Promise<Buffer | null> {
  try {
    if (!url) return null;
    const u = new URL(url);
    if (u.protocol !== 'https:' || !u.hostname.endsWith('.amazonaws.com')) return null;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const b = Buffer.from(await r.arrayBuffer());
    return b.length > 0 && b.length < 8_000_000 ? b : null;
  } catch { return null; }
}

const imagen = (ruta: string) => fs.readFileSync(path.join(process.cwd(), 'public', ruta));

/** Para una OC que no sale de Obuma (OC propia de Comercial MP, 05-nov-2026): otro logo y, si no hay firma, sin imagen de firma. */
export interface OpcionesPdfOc { logo?: string; firma?: string | null }

export async function generarPdfOc(oc: OcDocumento, opciones: OpcionesPdfOc = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(imagen(opciones.logo ?? 'oc-obuma/logo.png'));
  const firmaRuta = opciones.firma === undefined ? 'oc-obuma/firma.png' : opciones.firma;
  const firma = firmaRuta ? await pdf.embedPng(imagen(firmaRuta)) : null;
  // Logo propio: cabe en la caja de 180 × 100 pt sin deformarse, pegado arriba a la derecha. El de Obuma queda exactamente como antes.
  const kLogo = opciones.logo ? Math.min(180 / logo.width, 100 / logo.height) : 0;
  const logoW = kLogo ? logo.width * kLogo : 180, logoH = kLogo ? logo.height * kLogo : 100;
  const paginas: PDFPage[] = [];

  let page!: PDFPage;
  const w = (s: string, f: PDFFont, size: number) => f.widthOfTextAtSize(limpio(s), size);
  const texto = (s: string, x: number, top: number, size = 8, f: PDFFont = helv) => {
    if (!s) return;
    page.drawText(limpio(s), { x, y: PH - top - ASC * size, size, font: f, color: rgb(0, 0, 0) });
  };
  const derecha = (s: string, xDer: number, top: number, size = 8, f: PDFFont = helv) => texto(s, xDer - w(s, f, size), top, size, f);
  /** Texto de una caja: si no cabe en `ancho` se achica a 7 pt y, si aún no cabe, va en dos líneas de 6,5 pt (Obuma lo deja salirse de la caja). */
  const enCaja = (s: string, x: number, top: number, ancho: number, f: PDFFont = bold) => {
    const t = limpio(s);
    for (const size of [8, 7.5, 7]) if (w(t, f, size) <= ancho) { texto(t, x, top + (8 - size) * 0.45, size, f); return; }
    const lineas = envolver(t, f, 6.5, ancho);
    // «: » queda en la primera línea; la segunda se sangra bajo el texto. Más de dos líneas se cortan.
    const dos = [lineas[0], lineas.slice(1).join(' ')];
    dos.forEach((l, i) => { let u = l; while (u.length > 1 && w(u, f, 6.5) > ancho) u = u.slice(0, -1); texto(u, x, top - 0.8 + i * 6.2, 6.5, f); });
  };
  const centro = (s: string, xCen: number, top: number, size = 8, f: PDFFont = helv) => texto(s, xCen - w(s, f, size) / 2, top, size, f);
  const rect = (x1: number, y1: number, x2: number, y2: number, gris = false) => {
    page.drawRectangle({ x: x1, y: PH - y2, width: x2 - x1, height: y2 - y1, borderColor: rgb(0, 0, 0), borderWidth: 1, color: gris ? rgb(0.8, 0.8, 0.8) : undefined });
  };
  /** Parte `s` en líneas de a lo más `ancho` puntos, por palabras (y por letras si una palabra sola no cabe). */
  const envolver = (s: string, f: PDFFont, size: number, ancho: number): string[] => {
    const salida: string[] = [];
    let actual = '';
    for (const palabra of limpio(s).split(' ')) {
      const prueba = actual ? `${actual} ${palabra}` : palabra;
      if (w(prueba, f, size) <= ancho) { actual = prueba; continue; }
      if (actual) salida.push(actual);
      actual = palabra;
      while (w(actual, f, size) > ancho && actual.length > 1) {
        let i = actual.length - 1;
        while (i > 1 && w(actual.slice(0, i), f, size) > ancho) i--;
        salida.push(actual.slice(0, i)); actual = actual.slice(i);
      }
    }
    salida.push(actual);
    return salida;
  };

  // Encabezado que se repite en todas las hojas: empresa, logo y título.
  const encabezado = () => {
    if (oc.emisor) {
      texto(oc.emisor.razonSocial, 28, 25, 10, bold);
      texto(`R.U.T.: ${oc.emisor.rut}`, 28, 39);
      let y = 49;
      for (const l of envolver(oc.emisor.giro, helv, 8, 262)) { texto(l, 28, y); y += 10; }
      texto(`Direccion: ${oc.emisor.direccion}`, 28, y);
      texto('Telefono:', 28, y + 10, 8, bold); texto(` ${oc.emisor.telefono}`, 28 + w('Telefono:', bold, 8), y + 10);
      texto('E-mail:', 28, y + 24, 8, bold); texto(` ${oc.emisor.email}`, 28 + w('E-mail:', bold, 8), y + 24);
    }
    page.drawImage(logo, { x: 389.7 + 180 - logoW, y: PH - 40.8 - logoH, width: logoW, height: logoH });
    derecha(`ORDEN DE COMPRA N° ${oc.folio}`, 566.5, 175, 10, bold);
  };
  const nuevaHoja = () => { page = pdf.addPage([PW, PH]); paginas.push(page); encabezado(); };

  nuevaHoja();

  // Caja del proveedor.
  rect(28.4, 198.4, R, 268.4);
  const p = oc.proveedor;
  const filasProv: Array<[string, string, string, string]> = [
    ['Señor(es)', p.nombre, 'Fecha', fechaDMA(oc.fecha)],
    ['Rut', p.rut ?? '', 'Direccion', p.direccion ?? ''],
    ['Giro', p.giro ?? '', 'Comuna', p.comuna ?? ''],
    ['Telefono', p.telefono ?? '', 'Ciudad/Region', ''],
    ['E-mail', p.email ?? '', 'Atte. Sr(a).', p.contacto ?? ''],
  ];
  filasProv.forEach(([a, b, c, d], i) => {
    const top = 199 + 14 * i;
    texto(a, 30, top, 8, bold); enCaja(`: ${b}`, 164, top, 131);
    texto(c, 299, top, 8, bold); enCaja(`: ${d}`, 434, top, 130);
  });

  // Caja de entrega, despacho y pago.
  rect(L, 283.4, R, 367.4);
  const filasEnt: Array<[string, string]> = [
    ['FECHA ENTREGA', fechaDMA(oc.fechaEntrega)], ['DIRECCION DE ENVIO FACTURA', oc.direccionEnvioFactura ?? ''],
    ['DIRECCION DE DESPACHO', oc.direccionDespacho ?? ''], ['METODO DE DESPACHO', oc.metodoDespacho ?? ''],
    ['FORMA DE PAGO', oc.formaPago ?? ''], ['CENTRO DE COSTO', oc.centroCosto ?? ''],
  ];
  filasEnt.forEach(([a, b], i) => { texto(a, 30, 284 + 14 * i, 8, bold); enCaja(`: ${b}`, 164, 284 + 14 * i, 400); });

  texto('Agradecemos a Ud.(s) se sirva(n) dar curso a la siguiente Orden de Compra: ', 28, 381, 12);

  // Tabla de ítems.
  const COLS = [L, 82.2, 351.5, 405.4, 459.2, 513.1, R];
  let y = 397.4;
  const cabeceraTabla = () => {
    for (let i = 0; i < 6; i++) rect(COLS[i], y, COLS[i + 1], y + 24, true);
    texto('IMAGEN', 30, y + 0.6, 8, bold); texto('ITEM', 84, y + 0.6, 8, bold);
    centro('CANTIDAD', (COLS[2] + COLS[3]) / 2, y + 0.6, 8, bold);
    centro('PRECIO', (COLS[3] + COLS[4]) / 2, y + 0.6, 8, bold); centro('UNIT.', (COLS[3] + COLS[4]) / 2, y + 10.6, 8, bold);
    centro('DSCTO.', (COLS[4] + COLS[5]) / 2, y + 0.6, 8, bold); centro('SUBTOTAL', (COLS[5] + COLS[6]) / 2, y + 0.6, 8, bold);
    y += 24;
  };
  cabeceraTabla();
  const fotos = await Promise.all(oc.items.map(async it => {
    const b = await bajarFoto(it.imagenUrl);
    if (!b) return null;
    try { return b[0] === 0x89 ? await pdf.embedPng(b) : await pdf.embedJpg(b); } catch { return null; }
  }));
  for (const [idx, it] of oc.items.entries()) {
    const lineasDesc = envolver(`${it.codigo ? `${it.codigo} ` : ''}${it.descripcion}`, helv, 8, COLS[2] - 84 - 3);
    const lineasPrecio = envolver(dec(it.precio), helv, 8, 50).flatMap(s => s);
    // Una sola «palabra»: si no cabe se parte por letras (como hace Obuma con «12.390.000,0 / 0»).
    const alto = Math.max(41.7, Math.max(lineasDesc.length, lineasPrecio.length) * 10 + 4);
    if (y + alto > PIE_Y) { nuevaHoja(); y = 197; cabeceraTabla(); }
    for (let i = 0; i < 6; i++) rect(COLS[i], y, COLS[i + 1], y + alto);
    const foto = fotos[idx];
    if (foto) {
      // La foto cabe en 47,6 × 35,7 pt (como en Obuma) sin deformarse.
      const k = Math.min(47.6 / foto.width, 35.7 / foto.height);
      page.drawImage(foto, { x: 32.6, y: PH - (y + 2) - foto.height * k, width: foto.width * k, height: foto.height * k });
    }
    lineasDesc.forEach((l, i) => texto(l, 84, y + 0.6 + 10 * i));
    centro(dec(it.cantidad), (COLS[2] + COLS[3]) / 2, y + 0.6);
    lineasPrecio.forEach((l, i) => derecha(l, COLS[4] - 5, y + 0.6 + 10 * i));
    derecha(String(Math.round(it.descuento)), COLS[5] - 5, y + 0.6);
    derecha(miles(it.subtotal), R - 5, y + 0.6);
    y += alto;
  }

  // Totales (juntos en una hoja).
  if (y + 70 > PIE_Y) { nuevaHoja(); y = 197; }
  const totales: Array<[string, string]> = [
    ['SUBTOTAL', miles(oc.subtotal)], [`DCTO ${Math.round(oc.descuentoPorcentaje * 100) / 100}%`, miles(oc.descuento)],
    ['NETO', miles(oc.neto)], ['I.V.A.', miles(oc.iva)], ['TOTAL', miles(oc.total)],
  ];
  totales.forEach(([a, b], i) => {
    const top = y + 14 * i;
    rect(413, top, 490, top + 14); rect(490, top, R, top + 14);
    derecha(a, 485, top + 0.9, 8, bold); derecha(b, R - 5, top + 0.9);
  });
  y += 70;

  // Moneda y condiciones, línea por línea (pasan a otra hoja si no caben).
  let cursor = y + 14;
  const linea = (s: string, f: PDFFont = helv) => {
    if (cursor + 10 > PIE_Y) { nuevaHoja(); cursor = 197; }
    texto(s, 28, cursor, 8, f); cursor += 10;
  };
  if (cursor + 40 > PIE_Y) { nuevaHoja(); cursor = 197; }
  texto('MONEDA :', 28, cursor, 8, bold); texto(' CLP ( Peso chileno )', 28 + w('MONEDA :', bold, 8), cursor);
  cursor += 40;
  if (oc.condiciones) {
    linea('CONDICIONES :', bold);
    for (const bruto of oc.condiciones.replace(/\r/g, '').split('\n')) {
      const t = bruto.replace(/\s+$/, '');
      if (!t) { linea(''); continue; }
      for (const l of envolver(t, helv, 8, 538)) linea(l);
    }
  }

  // Firmas: «Emitido por» y «Aprobado por», con la imagen de firma de la plantilla de Obuma.
  if (cursor + 61 + (firma ? 120 : 45) > PIE_Y) { nuevaHoja(); cursor = 197; }
  const fy = cursor + 61;
  for (const [rotulo, xRot, xCen, xImg] of [['Emitido por:', 35, 161.5, 110.9], ['Aprobado por:', 304, 430.5, 380.2]] as const) {
    texto(rotulo, xRot, fy + 2, 8, bold);
    if (oc.generadoPor) centro(oc.generadoPor, xCen, fy + 22);
    centro('_________________________', xCen, fy + 32.5);
    if (firma) page.drawImage(firma, { x: xImg, y: PH - (fy + 41.4) - 77.1, width: 100, height: 77.1 });
  }

  // Pie de cada hoja.
  paginas.forEach((pg, i) => {
    page = pg;
    page.drawLine({ start: { x: 28.4, y: PH - 799.4 }, end: { x: R, y: PH - 799.4 }, thickness: 1, color: rgb(0, 0, 0) });
    texto(`O.C. # ${oc.folio}${oc.generadoPor ? ` | Generado por: ${oc.generadoPor}` : ''}`, 28, 798);
    texto(`Pagina ${i + 1} de ${paginas.length}`, 482, 798);
  });

  return pdf.save();
}
