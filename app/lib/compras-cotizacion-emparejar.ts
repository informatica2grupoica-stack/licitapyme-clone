// app/lib/compras-cotizacion-emparejar.ts
// EMPAREJAR LÍNEAS DE COTIZACIÓN CON PRODUCTOS — piezas PURAS (sin BD ni IA), generales para cualquier licitación y cualquier formato.
//
// Problema (727202-72-LP26, 141 productos, 18-nov-2026): se le mandaban a la IA TODOS los productos del negocio y toda la cotización en
// una sola llamada, y después casi nada se verificaba:
//   · «Tubería 75 mm» quedó con el precio de la de 63 mm (el parecido de nombre ignora «63»/«75» porque descarta palabras de < 3 letras);
//   · una línea de 20 mm se dio por «cubierta» por una tubería de 63 mm;
//   · una cotización de 40 líneas no cabe en 3.000 tokens de respuesta.
// Reglas de este módulo (valen para cualquier rubro, no hay nada de una licitación escrita aquí):
//   1) Se leen del texto las MEDIDAS con unidad (mm, pulgadas, PN, DN, W/kW, HP, kVA, V, Ah, BTU, bar) y los CÓDIGOS DE MODELO.
//   2) Dos textos con la misma clase de medida pero valores incompatibles NO son el mismo producto (63 mm ≠ 75 mm, 220 V ≠ 380 V).
//   3) A la IA solo se le ofrecen, por cada línea, los productos candidatos (lo que se parece y no choca), no los 141.
//   4) Las cotizaciones largas se parten en tandas de pocas líneas.

import type { LineaCotizacion } from '@/app/lib/compras-cotizacion-lineas';

// ─── Texto normalizado ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const sinTildes = (s: string) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const PALABRAS_VACIAS = new Set(['con', 'para', 'del', 'las', 'los', 'una', 'uno', 'por', 'sin', 'que', 'tipo', 'modelo', 'marca', 'incluye', 'solo', 'entrega', 'unidad', 'unidades', 'set', 'kit']);
/** Raíz burda (singular, sin tildes) para que «coplas» y «copla», «codos» y «codo» se junten. */
const raiz = (t: string) => (t.length >= 5 && t.endsWith('es') ? t.slice(0, -2) : t.length >= 4 && t.endsWith('s') ? t.slice(0, -1) : t);
export function palabrasClave(s: string): Set<string> {
  return new Set(
    sinTildes(s).replace(/[^a-z0-9ñ]+/g, ' ').split(' ')
      .filter(t => t.length >= 3 && !/^\d+$/.test(t) && !PALABRAS_VACIAS.has(t))
      .map(raiz),
  );
}
function dice(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let n = 0; for (const t of a) if (b.has(t)) n++;
  return n / Math.min(a.size, b.size);
}

// ─── Medidas con unidad ───────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Clases de medida que se comparan. «m», «kg» y «L» NO están: son unidades de venta (rollo de 50 m ↔ línea por metro) y ya tienen su propia conversión. */
export type ClaseMedida = 'mm' | 'pulg' | 'pn' | 'dn' | 'w' | 'hp' | 'kva' | 'v' | 'ah' | 'btu' | 'bar';
/** Las medidas físicas (tamaño, potencia, tensión…) son distintas cosas si no coinciden; PN (presión) y modelo se avisan pero son negociables. */
const CLASES_GRAVES = new Set<ClaseMedida>(['mm', 'pulg', 'dn', 'w', 'hp', 'kva', 'v', 'ah', 'btu']);
const NOMBRE_CLASE: Record<ClaseMedida, string> = { mm: 'mm', pulg: 'pulgadas', pn: 'PN', dn: 'DN', w: 'W', hp: 'HP', kva: 'kVA', v: 'V', ah: 'Ah', btu: 'BTU', bar: 'bar' };

interface Rango { lo: number; hi: number }
export interface Atributos { medidas: Map<ClaseMedida, Rango[]>; modelos: Set<string> }

/** "6.000" → 6000 · "3,5" → 3.5 · "1.850" → 1850 · "0,75" → 0.75. */
function num(raw: string): number {
  const s = raw.trim();
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.'));
  return Number(s.replace(',', '.'));
}
const N = String.raw`(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)`;
const sumar = (m: Map<ClaseMedida, Rango[]>, c: ClaseMedida, lo: number, hi = lo) => {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return;
  const a = m.get(c) ?? []; a.push({ lo: Math.min(lo, hi), hi: Math.max(lo, hi) }); m.set(c, a);
};

const UNIDADES_NO_MODELO = /^(?:pn|dn|pe|pvc|hdpe|hz|kw|hp|kva|btu|mm|cm|rpm|bar|ah|v|w|kg|lt|lts|mts|mtr)\d*$/;
export function atributosDe(textoOriginal: string): Atributos {
  const medidas = new Map<ClaseMedida, Rango[]>();
  const t = sinTildes(textoOriginal).replace(/[”″“]/g, '"').replace(/×/g, 'x');
  let m: RegExpExecArray | null;

  // Pulgadas: 3", 1/2", 4 1/2", 4-1/2", 5/8"x3", «3 pulg».
  const rePulg = new RegExp(String.raw`(?:(\d+)[\s-]+)?(\d+)\s*/\s*(\d+)\s*(?:"|pulg\w*|in\b)|${N}\s*(?:"|pulg\w*\b)`, 'g');
  while ((m = rePulg.exec(t))) {
    if (m[2] && m[3]) sumar(medidas, 'pulg', (m[1] ? Number(m[1]) : 0) + Number(m[2]) / Number(m[3]));
    else if (m[4]) sumar(medidas, 'pulg', num(m[4]));
  }
  // «5/8"x3"»: el segundo número también es pulgadas.
  for (const x of t.matchAll(new RegExp(String.raw`\d\s*"\s*x\s*${N}\s*"`, 'g'))) sumar(medidas, 'pulg', num(x[1]));
  // Diámetro o largo en mm: «63 mm», «20-160 mm», «20 x 63 mm», «115Mm», «d= 90» (diámetro), «ø90».
  for (const x of t.matchAll(new RegExp(String.raw`${N}\s*(?:-|a)\s*${N}\s*mm\b`, 'g'))) sumar(medidas, 'mm', num(x[1]), num(x[2]));
  for (const x of t.matchAll(new RegExp(String.raw`${N}\s*x\s*${N}\s*mm\b`, 'g'))) { sumar(medidas, 'mm', num(x[1])); sumar(medidas, 'mm', num(x[2])); }
  for (const x of t.matchAll(new RegExp(String.raw`${N}\s*mm\b`, 'g'))) sumar(medidas, 'mm', num(x[1]));
  for (const x of t.matchAll(new RegExp(String.raw`${N}\s*cm\b`, 'g'))) sumar(medidas, 'mm', num(x[1]) * 10);
  for (const x of t.matchAll(new RegExp(String.raw`(?:\bd\s*=\s*|\bdiametro\s*|ø\s*)${N}(?!\s*(?:mm|cm|"|m\b|mt|metro))`, 'g'))) sumar(medidas, 'mm', num(x[1]));
  // Presión y diámetro nominal: PN10, PN-16, DN100, DN 80.
  for (const x of t.matchAll(/\bpn\s*-?\s*(\d{1,3})\b/g)) sumar(medidas, 'pn', Number(x[1]));
  for (const x of t.matchAll(/\bdn\s*-?\s*(\d{2,4})\b/g)) sumar(medidas, 'dn', Number(x[1]));
  // Potencia: kW → W (un «6000 KW» mal escrito se tolera al comparar, ver compatibles()).
  for (const x of t.matchAll(new RegExp(String.raw`${N}\s*kw\b`, 'g'))) sumar(medidas, 'w', num(x[1]) * 1000);
  for (const x of t.matchAll(new RegExp(String.raw`${N}\s*w\b`, 'g'))) sumar(medidas, 'w', num(x[1]));
  for (const x of t.matchAll(new RegExp(String.raw`${N}\s*hp\b`, 'g'))) sumar(medidas, 'hp', num(x[1]));
  for (const x of t.matchAll(new RegExp(String.raw`${N}\s*kva\b`, 'g'))) sumar(medidas, 'kva', num(x[1]));
  for (const x of t.matchAll(new RegExp(String.raw`${N}\s*btu\b`, 'g'))) sumar(medidas, 'btu', num(x[1]));
  for (const x of t.matchAll(new RegExp(String.raw`${N}\s*ah\b`, 'g'))) sumar(medidas, 'ah', num(x[1]));
  for (const x of t.matchAll(new RegExp(String.raw`${N}\s*bar\b`, 'g'))) sumar(medidas, 'bar', num(x[1]));
  // Tensión: «220V», «100-240 V», «220-240V».
  for (const x of t.matchAll(new RegExp(String.raw`${N}\s*-\s*${N}\s*v\b`, 'g'))) sumar(medidas, 'v', num(x[1]), num(x[2]));
  for (const x of t.matchAll(new RegExp(String.raw`(?<![-\d.,])${N}\s*v\b(?!a)`, 'g'))) sumar(medidas, 'v', num(x[1]));

  // Códigos de modelo: letras y números pegados («PQ128C», «DHR242RFE», «HM1502») o con guion («DPS-22», «AKS-800»).
  // Con espacio solo si las letras van en MAYÚSCULAS en el original («SHDS 160», «PT 500»): «de 100» o «Kaiman 150» no son modelos.
  const modelos = new Set<string>();
  const original = String(textoOriginal ?? '');
  for (const x of original.matchAll(/(?<![A-Za-z0-9])([A-Za-z]{1,6})[- ]?(\d{2,5})([A-Za-z]{0,3})(?![A-Za-z0-9])/g)) {
    const letras = x[1], numero = x[2], cola = x[3];
    const pegado = x[0].length === letras.length + numero.length + cola.length;
    if (!pegado && !(/^[A-Z]{2,6}$/.test(letras))) continue;      // «de 100», «Kaiman 150»: no
    const cod = `${letras}${numero}${cola}`.toUpperCase();
    if (UNIDADES_NO_MODELO.test(cod.toLowerCase()) || UNIDADES_NO_MODELO.test(`${letras}${numero}`.toLowerCase())) continue;
    if (/^(?:PN|DN|PE|PVC|HDPE|IP|DIN|ISO|SDR|NCH|AISI|SAE|CLASE|CL|PT)\d+$/.test(`${letras}${numero}`.toUpperCase()) && letras.length <= 4 && !cola && /^(?:PN|DN|PE|PVC|HDPE|IP|DIN|ISO|SDR|NCH|AISI|SAE|CLASE|CL)$/.test(letras.toUpperCase())) continue;
    modelos.add(cod);
  }
  return { medidas, modelos };
}

function rangosSeCruzan(a: Rango[], b: Rango[], clase: ClaseMedida): boolean {
  for (const x of a) for (const y of b) {
    if (x.lo <= y.hi + 1e-9 && y.lo <= x.hi + 1e-9) return true;
    // «6000 KW» escrito por «6000 W» (error de unidad de ×1000 en una de las dos descripciones): se tolera.
    if (clase === 'w' && (Math.abs(x.lo * 1000 - y.lo) < 1e-6 || Math.abs(y.lo * 1000 - x.lo) < 1e-6)) return true;
  }
  return false;
}

export interface ConflictoMedible { clase: ClaseMedida | 'modelo'; grave: boolean; texto: string }
const fmtR = (r: Rango[]) => [...new Set(r.map(x => x.lo === x.hi ? String(x.lo) : `${x.lo}-${x.hi}`))].join('/');

/**
 * Choques medibles entre lo PEDIDO (producto) y lo COTIZADO (línea): una clase de medida presente en ambos con valores que no se cruzan,
 * o modelos distintos. Solo compara lo que los dos textos dicen: si uno calla la medida, no hay choque.
 */
export function conflictosMedibles(descProducto: string, descLinea: string): ConflictoMedible[] {
  const p = atributosDe(descProducto), l = atributosDe(descLinea);
  const out: ConflictoMedible[] = [];
  for (const [clase, rp] of p.medidas) {
    const rl = l.medidas.get(clase);
    if (!rl || rangosSeCruzan(rp, rl, clase)) continue;
    out.push({ clase, grave: CLASES_GRAVES.has(clase), texto: `${NOMBRE_CLASE[clase]} ${fmtR(rp)} pedido, la cotización dice ${NOMBRE_CLASE[clase]} ${fmtR(rl)}` });
  }
  if (p.modelos.size && l.modelos.size) {
    const comparte = [...p.modelos].some(a => [...l.modelos].some(b => a === b || a.startsWith(b) || b.startsWith(a)));
    if (!comparte) out.push({ clase: 'modelo', grave: false, texto: `modelo ${[...p.modelos].join('/')} pedido, la cotización dice ${[...l.modelos].join('/')}` });
  }
  return out;
}

/** Cuántas medidas con unidad (clase y valor) comparten los dos textos: refuerza un nombre que se parece poco («DGA454Z - Esmeril 4-1/2" 18V» ≈ «Esmeril 4 1/2” 18 V»). */
export function medidasEnComun(a: string, b: string): number {
  const A = atributosDe(a).medidas, B = atributosDe(b).medidas;
  let n = 0;
  for (const [c, ra] of A) { const rb = B.get(c); if (rb && rangosSeCruzan(ra, rb, c)) n++; }
  return n;
}

// ─── Puntaje línea ↔ producto ─────────────────────────────────────────────────────────────────────────────────────────────────────
export interface ProductoParaEmparejar { id: number; descripcion: string; cantidad?: number | null }

export function puntajeLineaProducto(linea: LineaCotizacion, producto: ProductoParaEmparejar, cache?: { lineaPal: Set<string>; lineaAttr: Atributos }): { puntaje: number; choca: boolean } {
  const lp = cache?.lineaPal ?? palabrasClave(linea.descripcion);
  const la = cache?.lineaAttr ?? atributosDe(linea.descripcion);
  const pa = atributosDe(producto.descripcion);
  let s = dice(palabrasClave(producto.descripcion), lp);
  const modeloComun = [...pa.modelos].some(a => [...la.modelos].some(b => a === b || a.startsWith(b) || b.startsWith(a)));
  if (modeloComun) s += 0.6;
  const comunes = medidasEnComun(producto.descripcion, linea.descripcion);
  s += Math.min(comunes, 3) * 0.12;
  if (linea.cantidad != null && producto.cantidad != null && Number(linea.cantidad) === Number(producto.cantidad) && Number(linea.cantidad) > 1) s += 0.08;
  const choca = conflictosMedibles(producto.descripcion, linea.descripcion).some(c => c.grave || c.clase === 'modelo');
  return { puntaje: s, choca };
}

/**
 * Productos que vale la pena ofrecerle a la IA para estas líneas: por cada línea, los que más se parecen y no chocan en medidas
 * (con sus empates: tres filas iguales del mismo producto entran las tres). Siempre hay al menos `minimo` por línea, para no dejar a la IA
 * sin opciones cuando el proveedor nombra distinto («detector de fugas» vs «geófono»).
 */
export function productosCandidatos(lineas: LineaCotizacion[], productos: ProductoParaEmparejar[], opts?: { porLinea?: number; minimo?: number }): Set<number> {
  const maxPorLinea = opts?.porLinea ?? 12, minimo = opts?.minimo ?? 4;
  const elegidos = new Set<number>();
  for (const l of lineas) {
    if ((l.total ?? l.precioUnitario ?? 0) === 0) continue;   // sin precio: título, total o «ACCESORIOS»
    const cache = { lineaPal: palabrasClave(l.descripcion), lineaAttr: atributosDe(l.descripcion) };
    const ptj = productos.map(p => ({ id: p.id, ...puntajeLineaProducto(l, p, cache) }));
    const buenos = ptj.filter(x => !x.choca).sort((a, b) => b.puntaje - a.puntaje);
    const mejor = buenos[0]?.puntaje ?? 0;
    let sel = buenos.filter(x => x.puntaje > 0 && x.puntaje >= Math.max(0.25, mejor * 0.7)).slice(0, maxPorLinea);
    if (sel.length < minimo) sel = [...sel, ...buenos.filter(x => !sel.includes(x))].slice(0, minimo);
    if (!sel.length) sel = ptj.sort((a, b) => b.puntaje - a.puntaje).slice(0, minimo);   // todo choca: que decida la IA con lo menos malo
    for (const x of sel) elegidos.add(x.id);
  }
  return elegidos;
}

/** Parte las líneas con precio en tandas de `tamano`. Menos o igual a `desde` líneas = una sola tanda (el camino de siempre). */
export function tandasDeLineas<T>(lineas: T[], opts?: { desde?: number; tamano?: number }): T[][] {
  const desde = opts?.desde ?? 20, tamano = opts?.tamano ?? 15;
  if (lineas.length <= desde) return [lineas];
  const out: T[][] = [];
  for (let i = 0; i < lineas.length; i += tamano) out.push(lineas.slice(i, i + tamano));
  return out;
}

/**
 * La línea del documento que respalda la asignación de un producto: primero la que trae el MISMO precio que la IA leyó (así el
 * «63 mm» a $3.222 se compara con la línea de 63 mm y no con la de 75 mm que se le parece), y si no, la de mejor puntaje de nombre.
 */
export function lineaDeLaAsignacion(descProducto: string, lineas: LineaCotizacion[], precioDocumento: number | null | undefined): LineaCotizacion | null {
  if (!lineas.length) return null;
  const prod: ProductoParaEmparejar = { id: 0, descripcion: descProducto };
  const porPrecio = precioDocumento != null && precioDocumento > 0 ? lineas.filter(l => l.precioUnitario != null && Math.abs(l.precioUnitario - precioDocumento) <= 1.5) : [];
  const pool = porPrecio.length ? porPrecio : lineas;
  let mejor: LineaCotizacion | null = null, mejorP = -1;
  for (const l of pool) { const p = puntajeLineaProducto(l, prod).puntaje; if (p > mejorP) { mejorP = p; mejor = l; } }
  if (!mejor) return null;
  return porPrecio.length || mejorP >= 0.5 ? mejor : null;
}
