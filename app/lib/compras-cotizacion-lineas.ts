// app/lib/compras-cotizacion-lineas.ts
// LECTURA ROBUSTA DE COTIZACIONES — piezas PURAS (sin BD ni IA) para que se puedan probar con cotizaciones reales.
//
// Caso real (negocio 142, 07-oct-2026, 6 cotizaciones de formatos distintos): la lectura confiaba en lo que la IA devolvía sin
// comprobarlo contra el documento y fallaba de cuatro maneras:
//   · tomó a NUESTRA empresa como proveedor (la fila "Empresa:" de una cotización es el cliente);
//   · aplicó el descuento dos veces (el total impreso ya venía con el 10 % descontado);
//   · devolvió el precio de una línea como $109 ("121.000,85" leído como 121,00085);
//   · si no encontraba proveedor, la cotización se descartaba entera.
// Regla de este módulo: lo que lee la IA se VERIFICA contra el texto del documento y contra su propia aritmética
// (cantidad × unitario = total de línea; suma de líneas = neto del documento). Lo que no cuadra no se da por bueno.

export interface LineaCotizacion {
  descripcion: string;
  cantidad: number | null;
  /** Precio unitario FINAL (con el descuento de la línea ya aplicado), en la base del documento (neto o con IVA, tal como lo imprime). */
  precioUnitario: number | null;
  /** Descuento de la línea tal como lo imprime (solo informativo: el precioUnitario ya lo trae aplicado). */
  descuentoPct: number | null;
  total: number | null;
}

/** "121.000,85" → 121000.85 · "2,551,206" → 2551206 · "$ 329.990" → 329990 · "1.80" → 1.8. null si no es un número. */
export function numeroDeTexto(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  let s = String(raw ?? '').replace(/[^\d.,-]/g, '');
  if (!s || !/\d/.test(s)) return null;
  const neg = s.startsWith('-'); s = s.replace(/-/g, '');
  const tienePunto = s.includes('.'), tieneComa = s.includes(',');
  if (tienePunto && tieneComa) {
    // El último separador es el decimal ("121.000,85" CL · "1,234.50" US).
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (tieneComa) {
    // "2,551,206" (miles con coma) vs "134,5" (decimal con coma).
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (tienePunto) {
    // "329.990" (miles) vs "1.80" (decimal): 3 dígitos tras el último punto y grupos de 3 = miles.
    s = /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : s;
  }
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

/** Todos los números que aparecen en el texto (normalizados), para comprobar que un valor "leído" existe de verdad. */
export function numerosDelTexto(texto: string): number[] {
  const out: number[] = [];
  for (const m of String(texto || '').matchAll(/\d[\d.,]*\d|\d/g)) {
    const n = numeroDeTexto(m[0]);
    if (n != null) out.push(n);
  }
  return out;
}

/** ¿El número aparece en el documento (con tolerancia de redondeo de ±1 peso o ±0,5 %)? */
export function numeroApareceEnTexto(n: number | null | undefined, texto: string): boolean {
  if (n == null || !Number.isFinite(n) || n <= 0) return false;
  const tol = Math.max(1, Math.abs(n) * 0.005);
  return numerosDelTexto(texto).some(x => Math.abs(x - n) <= tol);
}

const cerca = (a: number, b: number, pct = 0.02) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * pct);
const CERO_IMPRESO = /\$\s*0(?![\d.,]*\d)/;

export interface LineasNormalizadas {
  lineas: LineaCotizacion[];
  /** Suma de los totales de línea. */
  suma: number | null;
  /** true = la suma cuadra con el neto del documento (o con su total con IVA); false = no cuadra; null = no hay neto con qué comparar. */
  cuadra: boolean | null;
  /** 'neto' = las líneas suman el neto; 'bruto' = suman el TOTAL CON IVA (los precios de línea ya incluyen IVA); null = no se pudo saber. */
  base: 'neto' | 'bruto' | null;
  /** Qué más trae el total impreso además de las líneas: 'descuento' = el descuento global se aplica DESPUÉS (las líneas son de lista); 'flete' = el flete está dentro del total. null = solo las líneas. */
  ajuste: AjusteTotal;
  avisos: string[];
}
export type AjusteTotal = 'descuento' | 'flete' | 'descuento+flete' | null;

/**
 * Deja las líneas que leyó la IA en un estado confiable:
 *  · cantidad y total deben aparecer en el documento; si no, se descartan (la IA los habría inventado o mal leído);
 *  · el precio unitario FINAL sale de total ÷ cantidad cuando ambos existen (es lo que de verdad se paga por unidad,
 *    descuento incluido); si falta uno, se usa el unitario leído solo si aparece en el documento;
 *  · se comprueba que la suma de líneas cuadre con el neto/subtotal del documento.
 */
export function normalizarLineas(entrada: unknown, textoDoc: string, netoDocumento: number | null, extra?: { descuentoPct?: number | null; fleteMonto?: number | null }): LineasNormalizadas {
  const avisos: string[] = [];
  const bruto = Array.isArray(entrada) ? entrada : [];
  const lineas: LineaCotizacion[] = [];
  for (const x of bruto) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const descripcion = String(o.descripcion ?? '').replace(/\s+/g, ' ').trim();
    if (!descripcion) continue;
    let cantidad = numeroDeTexto(o.cantidad);
    let total = numeroDeTexto(o.total);
    let unit = numeroDeTexto(o.precioUnitario);
    const desc = numeroDeTexto(o.descuentoPct);
    if (cantidad != null && !(cantidad > 0)) cantidad = null;
    // "$0" impreso (despacho gratis, VENTUS EC-1214) es un total real: descartarlo dejaba la suma sin verificar y botaba el descuento.
    if (total === 0 && CERO_IMPRESO.test(textoDoc)) { lineas.push({ descripcion, cantidad, precioUnitario: 0, descuentoPct: null, total: 0 }); continue; }
    if (total != null && !numeroApareceEnTexto(total, textoDoc)) { avisos.push(`El total de «${descripcion.slice(0, 40)}» (${total}) no aparece en el documento: se ignoró.`); total = null; }
    if (unit != null && !numeroApareceEnTexto(unit, textoDoc)) {
      // Con descuento, el unitario final puede no estar impreso (solo "P. c/Desc"): se recalcula abajo desde el total.
      if (!(total != null && cantidad)) { avisos.push(`El precio de «${descripcion.slice(0, 40)}» (${unit}) no aparece en el documento: se ignoró.`); unit = null; }
    }
    if (total != null && cantidad) {
      const calc = Math.round((total / cantidad) * 100) / 100;
      if (unit != null && !cerca(unit, calc, 0.015) && !(desc && cerca(unit * (1 - desc / 100), calc, 0.015))) {
        avisos.push(`«${descripcion.slice(0, 40)}»: precio × cantidad no cuadra con el total; se usó total ÷ cantidad.`);
      }
      unit = calc;                       // el precio final real por unidad
    } else if (unit != null && cantidad && total == null) {
      const d = desc && desc > 0 && desc < 100 ? desc : 0;
      total = Math.round(unit * (1 - d / 100) * cantidad);
      if (d) unit = Math.round(unit * (1 - d / 100) * 100) / 100;
    }
    lineas.push({ descripcion, cantidad, precioUnitario: unit, descuentoPct: desc && desc > 0 && desc < 100 ? desc : null, total });
  }
  const conTotal = lineas.filter(l => l.total != null);
  const suma = conTotal.length ? conTotal.reduce((a, l) => a + (l.total as number), 0) : null;
  let cuadra: boolean | null = null;
  let base: 'neto' | 'bruto' | null = null;
  let ajuste: AjusteTotal = null;
  if (suma != null && netoDocumento != null && netoDocumento > 0 && conTotal.length === lineas.length) {
    // El neto impreso puede traer, además de las líneas, un descuento global y/o un flete: se prueban esas combinaciones (la simple primero).
    const d = extra?.descuentoPct != null && extra.descuentoPct > 0 && extra.descuentoPct < 100 ? extra.descuentoPct : null;
    const f = extra?.fleteMonto != null && extra.fleteMonto > 0 ? extra.fleteMonto : null;
    const candidatos: Array<{ v: number; ajuste: AjusteTotal }> = [{ v: suma, ajuste: null }];
    if (d != null) candidatos.push({ v: suma * (1 - d / 100), ajuste: 'descuento' });
    if (f != null) candidatos.push({ v: suma + f, ajuste: 'flete' });
    if (d != null && f != null) candidatos.push({ v: suma * (1 - d / 100) + f, ajuste: 'descuento+flete' }, { v: (suma + f) * (1 - d / 100), ajuste: 'descuento+flete' });
    const nota = (a: AjusteTotal) => a ? ` (con ${a === 'descuento' ? 'el descuento' : a === 'flete' ? 'el flete' : 'el descuento y el flete'} del documento)` : '';
    const neto = candidatos.find(c => cerca(c.v, netoDocumento, 0.01));
    const bruto = neto ? undefined : candidatos.find(c => cerca(c.v, netoDocumento * 1.19, 0.01));
    if (neto) { cuadra = true; base = 'neto'; ajuste = neto.ajuste; if (ajuste) avisos.push(`Las líneas cuadran con el neto del documento${nota(ajuste)}.`); }
    else if (bruto) { cuadra = true; base = 'bruto'; ajuste = bruto.ajuste; avisos.push(`Los precios de las líneas ya incluyen IVA (suman el total con IVA del documento${nota(ajuste)}).`); }
    else { cuadra = false; avisos.push(`La suma de las líneas (${Math.round(suma)}) no cuadra con el neto del documento (${Math.round(netoDocumento)}): revisa la lectura.`); }
  }
  return { lineas, suma, cuadra, base, ajuste, avisos };
}

/** Tabla de líneas verificadas, para anteponer al texto del documento que lee la homologación. */
export function tablaDeLineas(lineas: LineaCotizacion[]): string {
  if (!lineas.length) return '';
  const f = (n: number | null) => (n == null ? '—' : String(Math.round(n * 100) / 100));
  return 'LÍNEAS DEL DOCUMENTO (leídas y verificadas; el precio unitario ya trae el descuento de la línea):\n'
    + lineas.map((l, i) => `${i + 1}. ${l.descripcion} | cantidad ${f(l.cantidad)} | precio unitario ${f(l.precioUnitario)} | total ${f(l.total)}`).join('\n')
    + '\n\n';
}

// ─── Descuento GLOBAL (sobre el subtotal): ¿falta aplicarlo a los precios de línea o ya viene adentro? ─────────────────────────
// Caso real (VENTUS EC-1214, negocio 1333, 21-oct-2026): "Subtotal neto $13.149.250 · Descuento (7%) -$920.448 · Total neto $12.228.802".
// El 7 % se perdió: la línea "Despacho RM $0" dejó la suma sin verificar y, ante la duda, se botaba el descuento → el hervidor quedó a
// $52.597 (lista) en vez de $48.915 y el Auditor avisó una pérdida que no existía. Ahora se decide con PRUEBA, no por omisión.

/** "Descuento 7%", "Descuento (7%)", "Dcto. 7,5 %", "Desc: 10%" → el número. Solo con etiqueta explícita. */
export function descuentoPctDelTexto(texto: string): number | null {
  const m = String(texto || '').match(/(?:descuento|dscto|dcto|desc)\.?\s*[:\-(]?\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*%/i);
  if (!m) return null;
  const pct = Number(m[1].replace(',', '.'));
  return Number.isFinite(pct) && pct > 0 && pct < 100 ? pct : null;
}

/** Descuento como MONTO ("Descuento: -$920.448", "Descuento (7%): | -$920.448"). No toma el porcentaje ni un "0". */
export function descuentoMontoDelTexto(texto: string): number | null {
  const m = String(texto || '').match(/(?:descuento|dscto|dcto)\.?(?:\s*\([^)]*\))?\s*[:|]?\s*\|?\s*-?\s*\$?\s*(\d[\d.,]{2,})(?![\d.,]*\s*%)/i);
  const n = m ? numeroDeTexto(m[1]) : null;
  return n != null && n > 0 ? n : null;
}

/**
 * El descuento global que de verdad falta aplicar a los precios de línea (en %), o null si ya viene adentro o no se puede confirmar.
 *  · descuento por línea ("% Desc." / "P. c/Desc.") → ya está en el total de la línea: null (caso 30464, 10 % dos veces);
 *  · monto fijo → se pasa a % solo si el documento lo confirma (subtotal − descuento = neto impreso);
 *  · se aplica si el documento PRUEBA que va después de las líneas: las líneas cuadran restándolo, o imprime el monto descontado y el neto
 *    que resulta (prueba que no depende de qué cifra tomó la IA como "neto");
 *  · si las líneas ya suman el neto impreso, el descuento ya viene adentro: null.
 */
export function descuentoGlobalPorAplicar(
  norm: LineasNormalizadas, pct: number | null, monto: number | null, netoDoc: number | null, textoDoc: string,
): { pct: number | null; aviso: string | null } {
  if (norm.lineas.some(l => l.descuentoPct != null)) return { pct: null, aviso: null };
  const suma = norm.suma;
  if (pct == null && monto && suma && monto < suma
      && ((netoDoc != null && cerca(suma - monto, netoDoc, 0.005)) || numeroApareceEnTexto(suma - monto, textoDoc))) {
    pct = Math.round((monto / suma) * 10000) / 100;
  }
  if (pct == null || !(pct > 0 && pct < 100)) return { pct: null, aviso: null };
  if (suma == null) return { pct, aviso: null };
  const neto = suma * (1 - pct / 100);
  const fmt = (n: number) => '$' + Math.round(n).toLocaleString('es-CL');
  const aplicado = { pct, aviso: `Descuento ${pct} % del documento aplicado sobre ${fmt(suma)}: neto ${fmt(netoDoc != null && cerca(neto, netoDoc, 0.01) ? netoDoc : neto)}.` };
  if (norm.ajuste === 'descuento' || norm.ajuste === 'descuento+flete') return aplicado;
  if (netoDoc != null && cerca(neto, netoDoc, 0.01)) return aplicado;
  if (numeroApareceEnTexto(suma - neto, textoDoc) && numeroApareceEnTexto(neto, textoDoc)) return aplicado;
  if (netoDoc != null && cerca(suma, netoDoc, 0.01)) return { pct: null, aviso: null };   // las líneas ya suman el neto: viene adentro
  if (netoDoc == null) return { pct, aviso: `Descuento ${pct} % aplicado; el documento no muestra un neto para confirmarlo.` };
  return { pct: null, aviso: `El documento trae un descuento de ${pct} % pero no cuadra con sus totales: no se aplicó, revísalo.` };
}

// ─── Proveedor: nunca nuestra propia empresa ────────────────────────────────────────────────────────────────────
export interface EmpresasPropias { nombres: string[]; ruts: string[] }

const normNombre = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(spa|s\.?a\.?|ltda|limitada|e\.?i\.?r\.?l\.?|sociedad|anonima|de|la|el|y|cia|compania)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const normRutTxt = (s: string) => String(s || '').replace(/[^0-9kK]/g, '').toUpperCase();

export function esEmpresaPropia(nombre: string | null | undefined, rut: string | null | undefined, propias: EmpresasPropias): boolean {
  if (rut && propias.ruts.map(normRutTxt).includes(normRutTxt(rut))) return true;
  const n = normNombre(nombre || '');
  if (n.length < 4) return false;
  return propias.nombres.map(normNombre).some(p => p.length >= 4 && (p === n || n.includes(p) || p.includes(n)));
}

const RE_RUT = /\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK]\b/;
const RUIDO_ENCABEZADO = /cotizaci[oó]n|oferta|presupuesto|factura|folio|n[°ºo]\s*\d|fecha|se[ñn]or|cliente|empresa:|r\.?u\.?t|direcci[oó]n|tel[eé]fono|e-?mail|www\.|giro|comuna|ciudad/i;

/**
 * Respaldo SIN IA para encontrar quién EMITE la cotización cuando la IA no lo dio o dio una empresa nuestra:
 *  1) "Razón social: X" con su RUT en datos de facturación (cotizaciones en imagen con membrete como logo);
 *  2) el nombre en mayúsculas de las primeras líneas, seguido (hasta 3 líneas después) de un RUT.
 * Nunca devuelve una empresa propia.
 */
export function proveedorDesdeTexto(texto: string, propias: EmpresasPropias): { nombre: string; rut: string | null } | null {
  const lineas = String(texto || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  // 1) Razón social explícita.
  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(/raz[oó]n\s+social\s*[:|]\s*(.+)$/i);
    if (m) {
      const nombre = m[1].replace(/[|‖].*$/, '').trim();
      const rut = (lineas.slice(i, i + 3).join(' ').match(/\bRUT\s*[:|]?\s*(\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK])\b/i) || [])[1] || null;
      if (nombre.length >= 4 && !esEmpresaPropia(nombre, rut, propias)) return { nombre, rut };
    }
  }
  // 2) Membrete: línea en mayúsculas cerca del comienzo con un RUT en las 3 líneas siguientes.
  for (let i = 0; i < Math.min(lineas.length, 14); i++) {
    const l = lineas[i].replace(/[|‖].*$/, '').trim();
    if (l.length < 4 || l.length > 70 || RUIDO_ENCABEZADO.test(l) || !/[A-ZÁÉÍÓÚÑ]{3}/.test(l) || l !== l.toUpperCase()) continue;
    const contexto = lineas.slice(i, i + 4).join(' ');
    const rut = (contexto.match(RE_RUT) || [])[0] || null;
    if (!rut) continue;
    if (!esEmpresaPropia(l, rut, propias)) return { nombre: l, rut };
  }
  return null;
}

// ─── Adicionales: la cantidad y el precio salen de la LÍNEA del documento, no de lo que "recuerda" la IA ─────────────────────────
// Caso real (Impulzo 399, 3 sets): la IA devolvió el micrófono y los cables como adicionales del set pero con cantidad 1 en vez de
// la de la línea (3); al dividir por los 3 sets quedó 0,33 por set y el precio del set se subvaloró un 14 %.

/** Lee de vuelta la tabla «LÍNEAS DEL DOCUMENTO» que antepone el extractor al texto de la cotización. */
export function lineasDesdeTabla(texto: string): LineaCotizacion[] {
  const out: LineaCotizacion[] = [];
  const bloque = String(texto || '').split(/\n\s*\n/)[0] || '';
  if (!/^LÍNEAS DEL DOCUMENTO/i.test(bloque.trim())) return out;
  for (const l of bloque.split('\n')) {
    const m = l.match(/^\s*\d+\.\s*(.+?)\s*\|\s*cantidad\s+([\d.,—-]+)\s*\|\s*precio unitario\s+([\d.,—-]+)\s*\|\s*total\s+([\d.,—-]+)\s*$/i);
    if (!m) continue;
    out.push({ descripcion: m[1].trim(), cantidad: numeroDeTexto(m[2]), precioUnitario: numeroDeTexto(m[3]), descuentoPct: null, total: numeroDeTexto(m[4]) });
  }
  return out;
}

const tokens = (s: string) => new Set(normNombre(s).split(' ').filter(t => t.length >= 3));
function parecido(a: string, b: string): number {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let n = 0; for (const t of A) if (B.has(t)) n++;
  return n / Math.min(A.size, B.size);
}

/**
 * Corrige los adicionales que devolvió la IA con las líneas verificadas: si el concepto calza (≥ 60 % de palabras) con una línea del
 * documento, la cantidad de la línea y su precio unitario mandan sobre lo que dijo la IA.
 * @returns los mismos adicionales (crudos, con `cantidadLinea` y `precioUnitario`) y cuántos se corrigieron.
 */
export function corregirAdicionalesConLineas(raw: unknown, lineas: LineaCotizacion[]): { adicionales: unknown; corregidos: number } {
  if (!Array.isArray(raw) || !lineas.length) return { adicionales: raw, corregidos: 0 };
  let corregidos = 0;
  const out = raw.map((a: any) => {
    if (!a || typeof a !== 'object' || typeof a.concepto !== 'string') return a;
    let mejor: LineaCotizacion | null = null, mejorP = 0;
    for (const l of lineas) { const p = parecido(a.concepto, l.descripcion); if (p > mejorP) { mejorP = p; mejor = l; } }
    if (!mejor || mejorP < 0.6 || mejor.cantidad == null || mejor.precioUnitario == null) return a;
    const cambia = Number(a.cantidadLinea ?? a.cantidad) !== mejor.cantidad || Math.abs(Number(a.precioUnitario) - mejor.precioUnitario) > 1;
    if (cambia) corregidos++;
    return { ...a, cantidadLinea: mejor.cantidad, cantidad: undefined, precioUnitario: mejor.precioUnitario };
  });
  return { adicionales: out, corregidos };
}

/** Líneas del documento que no calzan con ningún producto asignado ni adicional (por palabras en común): se avisan, no se pierden en silencio. */
export function lineasSinAsignar(lineas: LineaCotizacion[], asignados: string[]): LineaCotizacion[] {
  if (!lineas.length) return [];
  return lineas.filter(l => l.total !== 0 && !asignados.some(a => parecido(l.descripcion, a) >= 0.5));
}

// ─── ¿La línea cotizada es de verdad el producto pedido? Talla y tipo de chasis (1110) ────────────────────────────────────────────
// Caso real (1110): "Silla de ruedas activa chasis plegable talla 42" quedó cubierta por "Silla de Ruedas Activa 43 cm Chasis Rígido":
// otra talla y otro chasis, y el sistema la dio por buena. La IA decide por significado; esto es el freno determinista para lo medible.

/** La línea del documento que más se parece al producto (por palabras en común, ≥ 50 %), o null. */
export function lineaDelProducto(descProducto: string, lineas: LineaCotizacion[]): LineaCotizacion | null {
  let mejor: LineaCotizacion | null = null, mejorP = 0;
  for (const l of lineas) { const p = parecido(descProducto, l.descripcion); if (p > mejorP) { mejorP = p; mejor = l; } }
  return mejor && mejorP >= 0.5 ? mejor : null;
}

const sinTildes = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const RE_TALLA = /\btalla\s*(?:n[°º.]?\s*)?(\d{2,3})\b/g;

/** Diferencias medibles entre lo pedido y lo cotizado: talla y chasis (plegable / rígido / fijo). Vacío = no se detectó ninguna. */
export function desajustesProductoLinea(descProducto: string, descLinea: string): string[] {
  const p = sinTildes(descProducto), l = sinTildes(descLinea);
  const out: string[] = [];
  const tallaP = [...p.matchAll(RE_TALLA)][0]?.[1];
  const tallasL = [...l.matchAll(RE_TALLA)].map(m => m[1]);
  // La talla pedida debe aparecer como número suelto en la línea ("3 un 43 cm y 1 un 45cm" cubre 43 y 45); rangos "42 a 54" no cuentan.
  const numerosL = new Set([...l.replace(/\b\d+\s*a\s*\d+\b/g, ' ').matchAll(/(?<![\d.,])\d{2,3}(?![\d.,]\d)/g)].map(m => m[0]));
  if (tallaP && tallasL.length && !numerosL.has(tallaP)) out.push(`talla ${tallaP} pedida, la cotización dice talla ${[...new Set(tallasL)].join('/')}`);
  const chP = /\bchasis\s+(plegable|rigido|fijo)\b/.exec(p)?.[1];
  const chL = [...l.matchAll(/\bchasis\s+(plegable|rigido|fijo)\b/g)].map(m => m[1]);
  if (chP && chL.length && !chL.includes(chP)) out.push(`chasis ${chP} pedido, la cotización dice chasis ${chL[0]}`);
  return out;
}

/**
 * Quita de los adicionales los componentes que ya van DENTRO de la línea del propio producto.
 * Caso real (1110): la línea "Catre clínico eléctrico + Colchón CIC Med Home 8cm + Batería de Emergencia" (4 × $618.000) la IA la partió en
 * catre + 2 adicionales; cada adicional calzó con esa misma línea y tomó su precio ($618.000) → el catre salía a $1.854.000 (3 veces).
 * Un componente nombrado en el título de la línea del producto no tiene precio aparte: está en el precio de la línea.
 */
export function sinComponentesDeLaLineaPropia(raw: unknown, lineaProducto: LineaCotizacion | null): unknown {
  if (!Array.isArray(raw) || !lineaProducto) return raw;
  return raw.filter((a: any) => !(a && typeof a.concepto === 'string' && parecido(a.concepto, lineaProducto.descripcion) >= 0.6));
}
