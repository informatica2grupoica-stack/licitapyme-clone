// app/lib/compras-guia-pdf.ts
// PDF propio de una guía de despacho (DTE 52) armado desde su XML timbrado, para verla sin entrar a Obuma (dueño, 16-nov-2026):
// el PDF de Obuma (`dte_pdf`) solo abre con sesión de Obuma; el XML (`dte_xml_url`, S3) es público.
// NO lleva el timbre electrónico (código PDF417): es una COPIA DE CONSULTA y lo dice en la hoja. El documento oficial es el de Obuma/SII.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fs from 'fs';
import path from 'path';

export interface GuiaXml {
  folio: string; fecha: string; tipoDespacho: string | null; indTraslado: string | null;
  emisor: { rut: string; razonSocial: string; giro: string; direccion: string; comuna: string; ciudad: string; telefono: string; correo: string };
  receptor: { rut: string; razonSocial: string; giro: string; direccion: string; comuna: string; ciudad: string; contacto: string; correo: string };
  transporte: { patente: string; rutTransportista: string; rutChofer: string; nombreChofer: string; direccion: string; comuna: string; ciudad: string } | null;
  detalle: { codigo: string; nombre: string; descripcion: string; cantidad: number; unidad: string; precio: number; monto: number }[];
  referencias: { tipo: string; folio: string; fecha: string; razon: string }[];
  totales: { neto: number; exento: number; tasaIva: number; iva: number; total: number };
  timbrado: string | null;
}

// El XML del SII es simple y sin atributos en los datos: se lee con expresiones, sin librería.
const uno = (xml: string, tag: string) => (xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)) || [])[1]?.trim() ?? '';
const todos = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map(m => m[1]);
const ent = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const t = (xml: string, tag: string) => ent(uno(xml, tag));
const n = (s: string) => Number(s) || 0;

/** `xml` ya decodificado (los DTE del SII vienen en ISO-8859-1: leer el buffer como 'latin1'). */
export function leerXmlGuia(xml: string): GuiaXml {
  const doc = uno(xml, 'Documento') || xml;
  const enc = uno(doc, 'Encabezado');
  const id = uno(enc, 'IdDoc'), em = uno(enc, 'Emisor'), re = uno(enc, 'Receptor'), tr = uno(enc, 'Transporte'), to = uno(enc, 'Totales');
  if (t(id, 'TipoDTE') !== '52') throw new Error('El XML no es una guía de despacho (tipo 52).');
  const chofer = uno(tr, 'Chofer');
  return {
    folio: t(id, 'Folio'), fecha: t(id, 'FchEmis'), tipoDespacho: t(id, 'TipoDespacho') || null, indTraslado: t(id, 'IndTraslado') || null,
    emisor: {
      rut: t(em, 'RUTEmisor'), razonSocial: t(em, 'RznSoc'), giro: t(em, 'GiroEmis'), direccion: t(em, 'DirOrigen'),
      comuna: t(em, 'CmnaOrigen'), ciudad: t(em, 'CiudadOrigen'), telefono: t(em, 'Telefono'), correo: t(em, 'CorreoEmisor'),
    },
    receptor: {
      rut: t(re, 'RUTRecep'), razonSocial: t(re, 'RznSocRecep'), giro: t(re, 'GiroRecep'), direccion: t(re, 'DirRecep'),
      comuna: t(re, 'CmnaRecep'), ciudad: t(re, 'CiudadRecep'), contacto: t(re, 'Contacto'), correo: t(re, 'CorreoRecep'),
    },
    transporte: tr ? {
      patente: t(tr, 'Patente'), rutTransportista: t(tr, 'RUTTrans'), rutChofer: t(chofer, 'RUTChofer'), nombreChofer: t(chofer, 'NombreChofer'),
      direccion: t(tr, 'DirDest'), comuna: t(tr, 'CmnaDest'), ciudad: t(tr, 'CiudadDest'),
    } : null,
    detalle: todos(doc, 'Detalle').map(d => ({
      codigo: t(d, 'VlrCodigo'), nombre: t(d, 'NmbItem'), descripcion: t(d, 'DscItem'),
      cantidad: n(t(d, 'QtyItem')), unidad: t(d, 'UnmdItem'), precio: n(t(d, 'PrcItem')), monto: n(t(d, 'MontoItem')),
    })),
    referencias: todos(doc, 'Referencia').map(r => ({ tipo: t(r, 'TpoDocRef'), folio: t(r, 'FolioRef'), fecha: t(r, 'FchRef'), razon: t(r, 'RazonRef') })),
    totales: { neto: n(t(to, 'MntNeto')), exento: n(t(to, 'MntExe')), tasaIva: n(t(to, 'TasaIVA')), iva: n(t(to, 'IVA')), total: n(t(to, 'MntTotal')) },
    timbrado: t(doc, 'TmstFirma') || null,
  };
}

const TRASLADO: Record<string, string> = {
  '1': 'Operación constituye venta', '2': 'Ventas por efectuar', '3': 'Consignaciones', '4': 'Entrega gratuita',
  '5': 'Traslado interno', '6': 'Otros traslados no venta', '7': 'Guía de devolución', '8': 'Traslado para exportación', '9': 'Venta para exportación',
};
const DESPACHO: Record<string, string> = { '1': 'Por cuenta del receptor', '2': 'Por el emisor a instalaciones del cliente', '3': 'Por el emisor a otras instalaciones' };
// Códigos de referencia más comunes en estas guías (801 = OC de Mercado Público, 802 = nota de pedido); el resto se muestra con su número.
const REFERENCIA: Record<string, string> = { '801': 'Orden de compra', '802': 'Nota de pedido', '33': 'Factura', '52': 'Guía de despacho', 'HES': 'HES' };

const PW = 595.28, PH = 841.89, L = 36, R = PW - 36;
const miles = (x: number) => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(x);
const pesos = (x: number) => '$' + new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(x));
const fecha = (f: string) => /^\d{4}-\d{2}-\d{2}/.test(f) ? f.slice(0, 10).split('-').reverse().join('-') : f;
const limpio = (s: string) => String(s ?? '').replace(/\s+/g, ' ').replace(/[^\x20-\xFF]/g, '?');

export async function generarPdfGuia(g: GuiaXml, opciones: { logo?: string } = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Guía de despacho ${g.folio}`);
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = opciones.logo ? await pdf.embedPng(fs.readFileSync(path.join(process.cwd(), 'public', opciones.logo))) : null;
  const gris = rgb(0.38, 0.38, 0.42), negro = rgb(0, 0, 0), rojo = rgb(0.75, 0.1, 0.1), linea = rgb(0.8, 0.8, 0.82);

  let page!: PDFPage;
  const w = (s: string, f: PDFFont, size: number) => f.widthOfTextAtSize(limpio(s), size);
  const txt = (s: string, x: number, top: number, size = 8, f: PDFFont = helv, color = negro) => {
    if (s) page.drawText(limpio(s), { x, y: PH - top - size * 0.87, size, font: f, color });
  };
  const der = (s: string, xd: number, top: number, size = 8, f: PDFFont = helv, color = negro) => txt(s, xd - w(s, f, size), top, size, f, color);
  const caja = (x: number, top: number, ancho: number, alto: number, color = linea, grosor = 0.8) =>
    page.drawRectangle({ x, y: PH - top - alto, width: ancho, height: alto, borderColor: color, borderWidth: grosor });
  /** Corta un texto en líneas que quepan en `ancho` (máx. `max` líneas; la última con «…» si sobra). */
  const lineas = (s: string, f: PDFFont, size: number, ancho: number, max = 3) => {
    const palabras = limpio(s).split(' '), out: string[] = [];
    let actual = '';
    for (const p of palabras) {
      const prueba = actual ? `${actual} ${p}` : p;
      if (w(prueba, f, size) <= ancho) actual = prueba; else { if (actual) out.push(actual); actual = p; }
    }
    if (actual) out.push(actual);
    if (out.length > max) { out.length = max; out[max - 1] = out[max - 1].replace(/.{0,3}$/, '…'); }
    return out.length ? out : [''];
  };
  /** Par «Etiqueta: valor» en una fila. */
  const par = (et: string, val: string, x: number, top: number, ancho: number) => {
    txt(et, x, top, 7.5, bold, gris);
    const xv = x + w(et, bold, 7.5) + 4;
    txt(lineas(val, helv, 8, ancho - (xv - x), 1)[0], xv, top - 0.3, 8);
  };

  // ── Encabezado (se repite en cada hoja) ──
  const encabezado = (hoja: number) => {
    page = pdf.addPage([PW, PH]);
    let x = L;
    if (logo) { const k = Math.min(110 / logo.width, 55 / logo.height); page.drawImage(logo, { x: L, y: PH - 36 - logo.height * k, width: logo.width * k, height: logo.height * k }); x = L + 120; }
    txt(g.emisor.razonSocial, x, 38, 11, bold);
    let y = 54;
    for (const l of lineas(g.emisor.giro, helv, 7.5, 230, 2)) { txt(l, x, y, 7.5, helv, gris); y += 9.5; }
    txt([g.emisor.direccion, g.emisor.comuna, g.emisor.ciudad].filter(Boolean).join(', '), x, y, 7.5, helv, gris); y += 9.5;
    txt([g.emisor.telefono && `Tel. ${g.emisor.telefono}`, g.emisor.correo].filter(Boolean).join(' · '), x, y, 7.5, helv, gris);

    // Recuadro rojo del SII
    const bx = 392, bw = R - bx;
    caja(bx, 34, bw, 72, rojo, 1.6);
    const centro = (s: string, top: number, size: number, f: PDFFont) => txt(s, bx + (bw - w(s, f, size)) / 2, top, size, f, rojo);
    centro(`R.U.T.: ${g.emisor.rut}`, 44, 10.5, bold);
    centro('GUÍA DE DESPACHO', 61, 10.5, bold);
    centro('ELECTRÓNICA', 74, 10.5, bold);
    centro(`N° ${g.folio}`, 89, 10.5, bold);
    if (hoja > 1) der(`Hoja ${hoja}`, R, 112, 7.5, helv, gris);
    return 126;
  };

  let y = encabezado(1);

  // ── Receptor ──
  caja(L, y, R - L, 70);
  const c1 = L + 8, c2 = L + (R - L) / 2 + 4, a1 = (R - L) / 2 - 12;
  par('Señor(es):', g.receptor.razonSocial, c1, y + 8, R - L - 16);
  par('R.U.T.:', g.receptor.rut, c1, y + 21, a1); par('Fecha emisión:', fecha(g.fecha), c2, y + 21, a1);
  par('Giro:', g.receptor.giro, c1, y + 34, a1); par('Contacto:', g.receptor.contacto, c2, y + 34, a1);
  par('Dirección:', g.receptor.direccion, c1, y + 47, a1); par('Correo:', g.receptor.correo, c2, y + 47, a1);
  par('Comuna:', g.receptor.comuna, c1, y + 58, a1); par('Ciudad:', g.receptor.ciudad, c2, y + 58, a1);
  y += 78;

  // ── Traslado y transporte ──
  const tr = g.transporte;
  const altoTr = tr ? 44 : 20;
  caja(L, y, R - L, altoTr);
  par('Traslado:', g.indTraslado ? `${g.indTraslado} · ${TRASLADO[g.indTraslado] ?? ''}` : '—', c1, y + 7, a1);
  par('Despacho:', g.tipoDespacho ? `${g.tipoDespacho} · ${DESPACHO[g.tipoDespacho] ?? ''}` : 'No indicado', c2, y + 7, a1);
  if (tr) {
    par('Chofer:', [tr.nombreChofer, tr.rutChofer && `RUT ${tr.rutChofer}`].filter(Boolean).join(' · ') || '—', c1, y + 19, a1);
    par('Patente:', tr.patente || '—', c2, y + 19, a1);
    par('Destino:', [tr.direccion, tr.comuna, tr.ciudad].filter(Boolean).join(', ') || '—', c1, y + 31, R - L - 16);
  }
  y += altoTr + 8;

  // ── Detalle ──
  const col = { cod: L + 6, desc: L + 92, cant: L + 350, um: L + 356, precio: L + 452, total: R - 6 };
  const cabecera = () => {
    page.drawRectangle({ x: L, y: PH - y - 16, width: R - L, height: 16, color: rgb(0.95, 0.95, 0.96) });
    txt('Código', col.cod, y + 4.5, 7.5, bold, gris); txt('Descripción', col.desc, y + 4.5, 7.5, bold, gris);
    der('Cantidad', col.cant, y + 4.5, 7.5, bold, gris); txt('Unidad', col.um, y + 4.5, 7.5, bold, gris);
    der('Precio unit.', col.precio, y + 4.5, 7.5, bold, gris); der('Total', col.total, y + 4.5, 7.5, bold, gris);
    y += 20;
  };
  cabecera();
  const FIN = PH - 150;   // espacio reservado abajo para referencias, totales y la nota
  let hoja = 1;
  for (const d of g.detalle) {
    const desc = lineas([d.nombre, d.descripcion].filter(Boolean).join(' — '), helv, 8, col.cant - col.desc - 50, 4);
    const alto = desc.length * 10 + 4;
    if (y + alto > FIN) { hoja++; y = encabezado(hoja); cabecera(); }
    txt(d.codigo, col.cod, y, 7.5);
    desc.forEach((l, i) => txt(l, col.desc, y + i * 10, 8));
    der(miles(d.cantidad), col.cant, y, 8); txt(d.unidad, col.um, y, 7.5, helv, gris);
    der(pesos(d.precio), col.precio, y, 8); der(pesos(d.monto), col.total, y, 8, bold);
    y += alto;
    page.drawLine({ start: { x: L, y: PH - y + 2 }, end: { x: R, y: PH - y + 2 }, thickness: 0.4, color: linea });
    y += 3;
  }

  // ── Referencias (izquierda) y totales (derecha) ──
  y = Math.max(y + 10, FIN - 6);
  if (g.referencias.length) {
    txt('Referencias', L, y, 8, bold);
    g.referencias.slice(0, 5).forEach((r, i) => {
      const s = `${REFERENCIA[r.tipo] ?? `Tipo ${r.tipo}`} N° ${r.folio}${r.fecha ? ` del ${fecha(r.fecha)}` : ''}${r.razon ? ` · ${r.razon}` : ''}`;
      txt(lineas(s, helv, 7.5, 300, 1)[0], L, y + 12 + i * 10, 7.5, helv, gris);
    });
  }
  const tx = R - 190;
  caja(tx, y - 4, 190, g.totales.exento ? 62 : 50);
  const filaTot = (et: string, val: string, top: number, f: PDFFont = helv) => { txt(et, tx + 8, top, 8, f); der(val, R - 8, top, 8, f); };
  let ty = y + 2;
  filaTot('Monto neto', pesos(g.totales.neto), ty); ty += 12;
  if (g.totales.exento) { filaTot('Monto exento', pesos(g.totales.exento), ty); ty += 12; }
  filaTot(`IVA ${miles(g.totales.tasaIva || 19)}%`, pesos(g.totales.iva), ty); ty += 12;
  filaTot('TOTAL', pesos(g.totales.total), ty, bold);

  // ── Nota de copia (en todas las hojas) ──
  const nota = 'Copia de consulta generada por LICITANK desde el XML del documento tributario. No incluye el timbre electrónico del SII: '
    + 'el documento oficial es el que emite Obuma.';
  for (const p of pdf.getPages()) {
    page = p;
    page.drawLine({ start: { x: L, y: 58 }, end: { x: R, y: 58 }, thickness: 0.5, color: linea });
    lineas(nota, helv, 7, R - L, 2).forEach((l, i) => txt(l, L, PH - 52 + i * 9, 7, helv, gris));
    if (g.timbrado) der(`Firmado el ${fecha(g.timbrado.slice(0, 10))} ${g.timbrado.slice(11, 16)}`, R, PH - 34, 7, helv, gris);
  }
  return pdf.save();
}
