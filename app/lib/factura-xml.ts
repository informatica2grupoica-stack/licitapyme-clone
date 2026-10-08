// app/lib/factura-xml.ts
// Lee el XML de un DTE (factura electrónica del SII) y lo deja como datos para dibujar una vista tipo factura.
// Función pura (sin red ni BD): el XML llega como texto. Solo se leen los campos que la vista muestra.

export interface FacturaLinea { n: number; codigo: string | null; descripcion: string; cantidad: number | null; precio: number | null; monto: number | null }
export interface FacturaLeida {
  tipoDte: string; tipoNombre: string; folio: string; fechaEmision: string | null; fechaVenc: string | null;
  emisor: { rut: string; razonSocial: string; giro: string | null; direccion: string | null };
  receptor: { rut: string; razonSocial: string; giro: string | null; direccion: string | null };
  lineas: FacturaLinea[];
  totales: { neto: number | null; exento: number | null; tasaIva: number | null; iva: number | null; total: number | null };
  referencias: Array<{ tipoDoc: string; folio: string; fecha: string | null }>;
}

const TIPOS: Record<string, string> = { '33': 'Factura electrónica', '34': 'Factura exenta electrónica', '39': 'Boleta electrónica', '46': 'Factura de compra electrónica', '52': 'Guía de despacho electrónica', '56': 'Nota de débito electrónica', '61': 'Nota de crédito electrónica' };

const decodificar = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&').trim();
const tag = (xml: string, nombre: string): string | null => {
  const m = xml.match(new RegExp(`<${nombre}>([\\s\\S]*?)</${nombre}>`));
  return m ? decodificar(m[1]) : null;
};
const num = (v: string | null): number | null => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const bloques = (xml: string, nombre: string): string[] => [...xml.matchAll(new RegExp(`<${nombre}>[\\s\\S]*?</${nombre}>`, 'g'))].map(m => m[0]);
const unir = (...p: Array<string | null>) => p.filter(Boolean).join(', ') || null;

/** null si el texto no es un DTE legible (ni encabezado ni folio). */
export function parsearFacturaXml(xml: string): FacturaLeida | null {
  const enc = bloques(xml, 'Encabezado')[0];
  if (!enc) return null;
  const id = bloques(enc, 'IdDoc')[0] ?? '';
  const emi = bloques(enc, 'Emisor')[0] ?? '';
  const rec = bloques(enc, 'Receptor')[0] ?? '';
  const tot = bloques(enc, 'Totales')[0] ?? '';
  const folio = tag(id, 'Folio');
  if (!folio) return null;
  const tipoDte = tag(id, 'TipoDTE') ?? '';
  // Cada <Detalle> es una línea; se leen antes del bloque TED (timbre) para no confundir sus campos.
  const lineas: FacturaLinea[] = bloques(xml.split('<TED')[0], 'Detalle').map((d, i) => ({
    n: num(tag(d, 'NroLinDet')) ?? i + 1,
    codigo: tag(d, 'VlrCodigo'),
    descripcion: [tag(d, 'NmbItem'), tag(d, 'DscItem')].filter(Boolean).join(' — '),
    cantidad: num(tag(d, 'QtyItem')), precio: num(tag(d, 'PrcItem')), monto: num(tag(d, 'MontoItem')),
  }));
  return {
    tipoDte, tipoNombre: TIPOS[tipoDte] ?? `Documento tributario ${tipoDte}`, folio,
    fechaEmision: tag(id, 'FchEmis'), fechaVenc: tag(id, 'FchVenc'),
    emisor: { rut: tag(emi, 'RUTEmisor') ?? '', razonSocial: tag(emi, 'RznSoc') ?? '', giro: tag(emi, 'GiroEmis'), direccion: unir(tag(emi, 'DirOrigen'), tag(emi, 'CmnaOrigen'), tag(emi, 'CiudadOrigen')) },
    receptor: { rut: tag(rec, 'RUTRecep') ?? '', razonSocial: tag(rec, 'RznSocRecep') ?? '', giro: tag(rec, 'GiroRecep'), direccion: unir(tag(rec, 'DirRecep'), tag(rec, 'CmnaRecep'), tag(rec, 'CiudadRecep')) },
    lineas,
    totales: { neto: num(tag(tot, 'MntNeto')), exento: num(tag(tot, 'MntExe')), tasaIva: num(tag(tot, 'TasaIVA')), iva: num(tag(tot, 'IVA')), total: num(tag(tot, 'MntTotal')) },
    referencias: bloques(xml.split('<TED')[0], 'Referencia').map(r => ({ tipoDoc: tag(r, 'TpoDocRef') ?? '', folio: tag(r, 'FolioRef') ?? '', fecha: tag(r, 'FchRef') })),
  };
}
