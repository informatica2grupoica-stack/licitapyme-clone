// app/lib/compras-cotizacion-lectura.ts
// LO QUE UNA COTIZACIÓN DICE Y EL SISTEMA LEÍA PERO NO USABA — funciones PURAS (sin red ni BD), con pruebas.
//
// Auditoría de Compras (07-oct-2026) sobre el negocio 457, con cotizaciones de prueba buenas y malas:
//   · "PRECIOS IVA INCLUIDO" quedaba solo en notas y el precio se trataba como NETO → "19 % más cara" y
//     "compra con pérdida" falsos.
//   · "Validez de la oferta: 15 días" + "Fecha: 07-10-2026" nunca llegaba a la vigencia → una cotización
//     vencida figuraba vigente y el auditor del costeo decía "sin fecha de vigencia".
//   · "Despacho incluido en Santiago" quedaba en notas y el auditor decía "no dice si incluye flete".
//   · "Precio: consultar" se guardaba como $0 (y daba "margen 100 %").
//   · El texto del OCR (HTML/markdown) terminaba crudo en "Qué cotizó".
// Regla de siempre: solo se concluye lo que el documento dice de forma explícita; ante la duda, null.

export const IVA_CHILE = 0.19;

/** true = el documento dice que los precios YA incluyen IVA; false = dice que son netos / "+ IVA"; null = no dice. */
export function ivaIncluidoDelTexto(texto: string): boolean | null {
  const t = texto.replace(/\s+/g, ' ');
  // Netos explícitos primero: "+ IVA", "más IVA", "precios netos", "valores netos".
  if (/(\+|m[aá]s)\s*iva\b|precios?\s+netos?|valores?\s+netos?|neto\s*\+\s*iva|no\s+incluye\s+iva|exento\s+de\s+iva|sin\s+iva/i.test(t)) return false;
  if (/iva\s+incluid[oa]|incluye\s+iva|con\s+iva\s+incluid[oa]|iva\s+inc\b\.?|precios?\s+(?:con|brutos?)\s+iva|valores?\s+(?:con|brutos?)\s+iva|total\s+con\s+iva\s+incluid/i.test(t)) return true;
  return null;
}

/** Precio neto a partir de uno con IVA incluido (CLP, entero). */
export function netoDesdeBruto(bruto: number): number {
  return Math.round(bruto / (1 + IVA_CHILE));
}

const aISO = (d: Date) => d.toISOString().slice(0, 10);

const MESES: Record<string, number> = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };

function fechaUTC(dia: number, mes: number, anio: number): Date | null {
  if (anio < 100) anio += 2000;
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || anio < 2000 || anio > 2100) return null;
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Primera fecha que aparece en el texto: "07-10-2026", "07/10/2026" o "LUNES, 05 DE OCTUBRE DE 2026". */
function primeraFecha(texto: string, desde = 0): { fecha: Date; fin: number } | null {
  const t = texto.slice(desde);
  const numerica = /(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(t);
  const larga = /(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+(?:de\s+|del\s+)?(\d{4})/i.exec(t);
  const cand: Array<{ fecha: Date | null; idx: number; fin: number }> = [];
  if (numerica) cand.push({ fecha: fechaUTC(Number(numerica[1]), Number(numerica[2]), Number(numerica[3])), idx: numerica.index, fin: numerica.index + numerica[0].length });
  if (larga) cand.push({ fecha: fechaUTC(Number(larga[1]), MESES[larga[2].toLowerCase()], Number(larga[3])), idx: larga.index, fin: larga.index + larga[0].length });
  const validas = cand.filter(c => c.fecha).sort((x, y) => x.idx - y.idx);
  return validas.length ? { fecha: validas[0].fecha as Date, fin: desde + validas[0].fin } : null;
}

/** Fecha (YYYY-MM-DD) hasta la que vale la oferta, si el documento la dice:
 *  · "Válida hasta 20-10-2026" → esa fecha;
 *  · "Validez de la oferta / de cotización / Duración de la cotización: 15 días" + la fecha de emisión (la primera fecha del
 *    documento, con "Fecha:" o escrita como "05 DE OCTUBRE DE 2026") → emisión + 15 días corridos.
 *  Sin fecha de emisión no se inventa una (null). */
export function vigenciaDelTexto(texto: string): string | null {
  const t = texto.replace(/\s+/g, ' ');
  const hasta = /(?:v[aá]lid[ao]|vigente|vigencia)[^.\d]{0,30}hasta(?:\s+el)?\s*:?\s*/i.exec(t);
  if (hasta) { const f = primeraFecha(t.slice(hasta.index + hasta[0].length, hasta.index + hasta[0].length + 40)); if (f) return aISO(f.fecha); }
  const dias = /(?:validez|vigencia|v[aá]lid[ao]\s+por|duraci[oó]n)\s+(?:de\s+(?:la\s+)?)?(?:oferta|cotizaci[oó]n|presupuesto)?[^.\d]{0,25}?(\d{1,3})\s*d[ií]as?/i.exec(t)
    ?? /offer\s+valid\s+for\s+(\d{1,3})\s*days/i.exec(t);
  if (!dias) return null;
  const emision = primeraFecha(t);
  if (!emision) return null;
  const base = new Date(emision.fecha.getTime());
  base.setUTCDate(base.getUTCDate() + Number(dias[1]));
  return aISO(base);
}

/** true = el despacho/flete va incluido en el precio; false = dice que NO se incluye; null = no dice. */
export function incluyeFleteDelTexto(texto: string): boolean | null {
  const t = texto.replace(/\s+/g, ' ');
  if (/no\s+incluye\s+(?:flete|despacho|env[ií]o|transporte)|(?:flete|despacho|env[ií]o|transporte)\s+(?:no\s+incluid[oa]|por\s+cuenta\s+del\s+cliente|aparte)|retiro\s+en\s+(?:bodega|tienda|local)/i.test(t)) return false;
  if (/(?:flete|despacho|env[ií]o|transporte)\s+(?:incluid[oa]|gratis|sin\s+costo)|incluye\s+(?:flete|despacho|env[ií]o|transporte)|(?:free|shipping)\s+included/i.test(t)) return true;
  return null;
}

/** Cantidad mínima de venta ("mínimo 2 unidades", "solo comprando 2 unidades"): null si no hay. */
export function minimoDeVentaDelTexto(texto: string): number | null {
  const t = texto.replace(/\s+/g, ' ');
  const m = t.match(/(?:m[ií]nimo(?:\s+de\s+(?:venta|compra))?|solo\s+comprando|compra\s+m[ií]nima)[^.\d]{0,25}(\d{1,5})\s*(?:unidades?|un\b|u\b|piezas?)/i);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 1 ? n : null;
}

/** El OCR devuelve HTML/markdown (<table>, <div>, #, **). Esto lo deja como texto legible por una persona. */
export function textoLegible(src: string): string {
  return src
    .replace(/<\/(?:tr|p|div|h\d|li)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/^\s*#{1,6}\s*/gm, '').replace(/\*\*/g, '')
    .replace(/[ \t]+\|\s*$/gm, '').replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n').trim();
}

/** Un precio de 0 (o negativo / no finito) NO es un precio: es "sin precio". */
export function precioONull(n: number | null | undefined): number | null {
  return n != null && Number.isFinite(n) && n > 0 ? n : null;
}
