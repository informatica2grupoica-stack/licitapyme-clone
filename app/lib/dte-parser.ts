// app/lib/dte-parser.ts
// Parser liviano del XML de una factura electrónica chilena (DTE, formato SII) — mismo criterio
// que el resto del proyecto usa para XML (anexos-docx.ts): extracción por regex sobre tags planos,
// sin agregar una librería de parsing XML nueva solo para esto. El DTE es un formato fijo y sin
// namespaces con prefijo (xmlns por defecto), así que alcanza.
//
// DOS FORMAS reales del mismo documento, vistas en la cuenta de Obuma: algunos XML son el
// "envoltorio" completo (<EnvioDTE><SetDTE><DTE><Documento>…</Documento></DTE></SetDTE></EnvioDTE>,
// con la Carátula del envío al SII) y otros son solo <DTE><Documento>…</Documento></DTE> pelado. En
// los dos casos el dato real vive en el primer <Documento>…</Documento> del archivo — se busca ese
// bloque sin importar qué lo envuelve.
import { decodificarXml } from '@/app/lib/anexos-docx';

const TIPO_DTE_NOMBRE: Record<string, string> = {
  '33': 'Factura Electrónica',
  '34': 'Factura Exenta Electrónica',
  '39': 'Boleta Electrónica',
  '41': 'Boleta Exenta Electrónica',
  '46': 'Factura de Compra Electrónica',
  '56': 'Nota de Débito Electrónica',
  '61': 'Nota de Crédito Electrónica',
};

function campo(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)<\\/${tag}>`));
  return m ? decodificarXml(m[1]).trim() : null;
}

function num(xml: string, tag: string): number | null {
  const v = campo(xml, tag);
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export interface DteItem {
  descripcion: string;
  detalle: string | null;
  cantidad: number | null;
  unidad: string | null;
  precioUnitario: number | null;
  monto: number | null;
  exento: boolean;
}

export interface DteReferencia {
  tipo: string | null;
  folio: string | null;
  fecha: string | null;
  razon: string | null;
}

export interface DteParte {
  rut: string | null;
  razonSocial: string | null;
  giro: string | null;
  direccion: string | null;
  comuna: string | null;
  ciudad: string | null;
}

export interface DteParseado {
  tipoDte: string | null;
  tipoDteNombre: string;
  folio: string | null;
  fechaEmision: string | null;
  fechaVencimiento: string | null;
  formaPago: string | null;
  emisor: DteParte;
  receptor: DteParte;
  totales: { neto: number | null; exento: number | null; iva: number | null; tasaIva: number | null; total: number | null };
  detalle: DteItem[];
  referencias: DteReferencia[];
}

const FORMAS_PAGO: Record<string, string> = { '1': 'Contado', '2': 'Crédito', '3': 'Sin costo (gratuito)' };

/** null si el XML no trae un bloque <Documento> reconocible (archivo corrupto o de otro formato). */
export function parsearDte(xmlCrudo: string): DteParseado | null {
  const mDoc = xmlCrudo.match(/<Documento\b[^>]*>[\s\S]*?<\/Documento>/);
  if (!mDoc) return null;
  const doc = mDoc[0];
  const encabezado = doc.match(/<Encabezado\b[^>]*>[\s\S]*?<\/Encabezado>/)?.[0] || '';
  const idDoc = encabezado.match(/<IdDoc\b[^>]*>[\s\S]*?<\/IdDoc>/)?.[0] || '';
  const emisorXml = encabezado.match(/<Emisor\b[^>]*>[\s\S]*?<\/Emisor>/)?.[0] || '';
  const receptorXml = encabezado.match(/<Receptor\b[^>]*>[\s\S]*?<\/Receptor>/)?.[0] || '';
  const totalesXml = encabezado.match(/<Totales\b[^>]*>[\s\S]*?<\/Totales>/)?.[0] || '';

  const parte = (bloque: string, prefijo: 'Emis' | 'Recep', rutTag: string): DteParte => ({
    rut: campo(bloque, rutTag),
    razonSocial: campo(bloque, `RznSoc${prefijo === 'Emis' ? '' : 'Recep'}`),
    giro: campo(bloque, `Giro${prefijo}`),
    direccion: campo(bloque, `Dir${prefijo === 'Emis' ? 'Origen' : 'Recep'}`),
    comuna: campo(bloque, `Cmna${prefijo === 'Emis' ? 'Origen' : 'Recep'}`),
    ciudad: campo(bloque, `Ciudad${prefijo === 'Emis' ? 'Origen' : 'Recep'}`),
  });

  const detalle: DteItem[] = [...doc.matchAll(/<Detalle\b[^>]*>[\s\S]*?<\/Detalle>/g)].map(m => {
    const d = m[0];
    return {
      descripcion: campo(d, 'NmbItem') || `Ítem ${campo(d, 'NroLinDet') || ''}`.trim(),
      detalle: campo(d, 'DscItem'),
      cantidad: num(d, 'QtyItem'),
      unidad: campo(d, 'UnmdItem'),
      precioUnitario: num(d, 'PrcItem'),
      monto: num(d, 'MontoItem'),
      exento: campo(d, 'IndExe') === '1',
    };
  });

  const referencias: DteReferencia[] = [...doc.matchAll(/<Referencia\b[^>]*>[\s\S]*?<\/Referencia>/g)].map(m => ({
    tipo: campo(m[0], 'TpoDocRef'),
    folio: campo(m[0], 'FolioRef'),
    fecha: campo(m[0], 'FchRef'),
    razon: campo(m[0], 'RazonRef'),
  }));

  const tipoDte = campo(idDoc, 'TipoDTE');
  const formaPagoCod = campo(idDoc, 'FmaPago');

  return {
    tipoDte,
    tipoDteNombre: (tipoDte && TIPO_DTE_NOMBRE[tipoDte]) || `Documento tipo ${tipoDte ?? '?'}`,
    folio: campo(idDoc, 'Folio'),
    fechaEmision: campo(idDoc, 'FchEmis'),
    fechaVencimiento: campo(idDoc, 'FchVenc'),
    formaPago: campo(idDoc, 'TermPagoGlosa') || (formaPagoCod ? FORMAS_PAGO[formaPagoCod] || formaPagoCod : null),
    emisor: parte(emisorXml, 'Emis', 'RUTEmisor'),
    receptor: parte(receptorXml, 'Recep', 'RUTRecep'),
    totales: {
      neto: num(totalesXml, 'MntNeto'),
      exento: num(totalesXml, 'MntExe'),
      iva: num(totalesXml, 'IVA'),
      tasaIva: num(totalesXml, 'TasaIVA'),
      total: num(totalesXml, 'MntTotal'),
    },
    detalle,
    referencias,
  };
}
