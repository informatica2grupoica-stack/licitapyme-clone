// app/lib/compras-pareo-global-core.ts
// PAREO GLOBAL DE COTIZACIONES — núcleo PURO (sin BD; la IA entra como función, igual que en compras-cotizacion-resolver.ts).
//
// El motor por cotización (homologarCotizacionIA) lee UNA cotización a la vez y pierde dos señales que solo se ven con todo el negocio a la vista:
//   · la CANTIDAD de una línea, que se reparte entre varios productos (7 máquinas iguales → 7 ítems de 1; 400 m → 300 m + 100 m);
//   · la comparación ENTRE proveedores (la más barata que cumple es la principal; las demás quedan como alternativa).
// Aquí se le pasan a la IA TODOS los productos y TODAS las líneas ya leídas de TODAS las cotizaciones, y el código DECIDE con 8 comprobaciones
// (docs/diseno-pareo-global-cotizaciones.md §5). Nada de una empresa o licitación está escrito aquí: las equivalencias propias de una empresa
// (modelo → familia) entran por parámetro.
import {
  lineasDesdeTabla, numeroApareceEnTexto, precioPorUnidadDeProducto, conversionDesdeTexto, conversionCoherenteConLinea, type LineaCotizacion,
} from '@/app/lib/compras-cotizacion-lineas';
import { conflictosMedibles, lineaConElMismoModelo, productosCandidatos, puntajeLineaProducto, type ConflictoMedible } from '@/app/lib/compras-cotizacion-emparejar';
import { netoDesdeBruto, conDescuento } from '@/app/lib/compras-cotizacion-lectura';
import { parseJsonIA } from '@/app/lib/json-ia';
import type { LlamarIA } from '@/app/lib/compras-cotizacion-resolver';

// ─── Entrada ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface ProductoPareo { id: number; descripcion: string; cantidad: number | null; unidad?: string | null; montoUnitario?: number | null }
export interface CotizacionPareo {
  id: number; proveedor_nombre: string | null; moneda: string | null; tipo_cambio_usado: number | string | null; notas: string | null;
  descuento_pct: number | string | null; precio_total: number | string | null; flete_monto: number | string | null; descripcion_libre: string | null;
  /** nombre del archivo (para mostrar «INGAP 176397»): opcional */ archivo_nombre?: string | null;
}
/** Equivalencia propia de una empresa: un patrón de texto (modelo comercial) y la familia/proceso que significa. Se guarda por empresa, no aquí. */
export interface EquivalenciaFamilia { patron: string; familia: string }

export interface LineaPareo {
  codigo: string;                 // L1, L2…
  cotizacionId: number; proveedor: string;
  descripcion: string; cantidad: number | null; unidad: string | null;
  /** precio unitario tal como lo imprime el documento (su moneda, con o sin IVA) */
  precioDoc: number | null;
  /** precio unitario NETO en CLP (sin IVA, con el descuento de la cotización, × tipo de cambio) */
  precioNeto: number | null;
  totalNeto: number | null;
  esFlete: boolean;
  linea: LineaCotizacion;
}

const RE_FLETE = /\b(flete|transporte|despacho|env[ií]o|shipping|freight|costo de envio)\b/i;
const esIvaIncluido = (c: CotizacionPareo) => /se guardaron en neto \(÷ 1,19\)/.test(String(c.notas || '')) && (c.moneda || 'CLP') === 'CLP';

/** Precio impreso → CLP neto efectivo (IVA fuera, descuento de la cotización aplicado, moneda extranjera × tipo de cambio). */
export function precioNetoClp(precioDoc: number | null, c: CotizacionPareo): number | null {
  if (precioDoc == null || !Number.isFinite(precioDoc) || precioDoc <= 0) return null;
  let x = esIvaIncluido(c) ? netoDesdeBruto(precioDoc) : precioDoc;
  const d = c.descuento_pct != null ? Number(c.descuento_pct) : null;
  if (d != null && d > 0 && d < 100) x = conDescuento(x, d, 'unitario');
  const tc = c.moneda && c.moneda !== 'CLP' && c.tipo_cambio_usado ? Number(c.tipo_cambio_usado) : 1;
  return Math.round(x * tc * 100) / 100;
}

/** DESCUENTO SOBRE EL TOTAL (migration-195): en esas cotizaciones `precio_base` se guarda a PRECIO DE LISTA y recalcularPrecioItem aplica el %.
 *  El pareo compara en neto con descuento, así que antes de guardar hay que devolverlo a lista; si no, el % se restaba dos veces
 *  (2378-117-LP26, #419: filtro $3.866 − 15 % − 15 %). `pct` null = la cotización no está en ese modo: el neto se guarda tal cual. */
export function precioBaseAGuardar(neto: number, pct: number | null | undefined): number {
  return pct != null && pct > 0 && pct < 100 ? Math.round((neto * 10000) / (100 - pct)) / 100 : neto;
}
/** Lo contrario: del precio guardado a lista al neto con descuento, para compararlo con las líneas del pareo. */
export function netoDeBaseGuardada(base: number, pct: number | null | undefined): number {
  return pct != null && pct > 0 && pct < 100 ? Math.round(base * (100 - pct)) / 100 : base;
}

/** Todas las líneas con precio de todas las cotizaciones, numeradas L1…Lm, en CLP neto. */
export function lineasDelNegocio(cotizaciones: CotizacionPareo[]): LineaPareo[] {
  const out: LineaPareo[] = [];
  for (const c of cotizaciones) {
    for (const l of lineasDesdeTabla(String(c.descripcion_libre || ''))) {
      if ((l.total ?? l.precioUnitario ?? 0) === 0) continue;
      const precioNeto = precioNetoClp(l.precioUnitario, c);
      out.push({
        codigo: `L${out.length + 1}`, cotizacionId: c.id, proveedor: String(c.proveedor_nombre || 'Proveedor'),
        descripcion: l.descripcion, cantidad: l.cantidad, unidad: l.unidad ?? null, precioDoc: l.precioUnitario, precioNeto,
        totalNeto: precioNeto != null && l.cantidad != null ? Math.round(precioNeto * l.cantidad) : null,
        esFlete: RE_FLETE.test(l.descripcion), linea: l,
      });
    }
  }
  return out;
}

const corto = (s: string, n: number) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const nombreCot = (c: CotizacionPareo) => `${corto(String(c.proveedor_nombre || 'Proveedor'), 40)}${c.archivo_nombre ? ' · ' + corto(String(c.archivo_nombre).replace(/\.[a-z0-9]+$/i, ''), 30) : ''}`;

/** Entrada compacta (tabular) para la IA: caben ~150 productos + ~60 líneas sin gastar tokens de más. */
export function armarEntrada(productos: ProductoPareo[], lineas: LineaPareo[], cotizaciones: CotizacionPareo[], equivalencias: EquivalenciaFamilia[] = []): string {
  const cot = new Map(cotizaciones.map(c => [c.id, c]));
  const prods = productos.map((p, i) => `P${i + 1} | ${corto(p.descripcion, 150)} | ${p.cantidad ?? '?'} ${corto(String(p.unidad || 'un'), 10)}`);
  const lins = lineas.map(l => `${l.codigo} | ${nombreCot(cot.get(l.cotizacionId)!)} | ${corto(l.descripcion, 170)} | ${l.cantidad ?? '?'} ${corto(String(l.unidad || 'un'), 8)} | ${l.precioNeto ?? '?'}${l.esFlete ? ' | FLETE' : ''}`);
  const eq = equivalencias.length ? `\n\nEQUIVALENCIAS QUE FIJÓ LA EMPRESA (mandan sobre tu conocimiento):\n${equivalencias.map(e => `- «${e.patron}» = ${e.familia}`).join('\n')}` : '';
  return `PRODUCTOS (código | descripción | cantidad y unidad que hay que comprar)\n${prods.join('\n')}\n\nLINEAS (código | cotización | texto de la línea | cantidad cotizada y unidad | precio = CLP NETO por la unidad indicada)\n${lins.join('\n')}${eq}`;
}

export const SYS_PAREO_GLOBAL = `Eres el comprador de una empresa que revende productos adjudicados en licitaciones públicas chilenas.
Tienes TODOS los productos que hay que comprar (P1…Pn, con cantidad y unidad) y TODAS las líneas de TODAS las cotizaciones recibidas para este negocio (L1…Lm, ya en CLP NETO por la unidad indicada, con proveedor y cantidad cotizada).

Tu trabajo es repartir las líneas entre los productos de la forma más correcta y barata posible.

REGLAS
1. Una línea puede cubrir VARIOS productos. Su CANTIDAD es lo que alcanza a cubrir: reparte esa cantidad entre productos de la misma familia (ej.: línea de 7 máquinas iguales → hasta 7 productos de 1 unidad; 400 m de tubería → 300 m a un producto y 100 m a otro). Que las cantidades calcen exacto es una señal muy fuerte de que esa era la intención del comprador. No asignes más cantidad que la cotizada.
2. Un producto recibe UNA línea principal. Si otras líneas también lo cumplen, ponlas en "alternativas" con su precio. Elige como principal la MÁS BARATA QUE CUMPLE.
3. Familia y proceso son identidad: electrofusión ≠ termofusión, bomba sumergible ≠ centrífuga, diésel ≠ gasolina, monofásico ≠ trifásico, geófono ≠ medidor. Usa tu conocimiento de la MARCA y el MODELO comercial para saber a qué familia y proceso pertenece cada producto y cada línea (un modelo conocido puede decir el proceso aunque el texto no lo diga).
4. Medidas: igual o mayor a lo pedido = cumple (avisa si es mayor); menor = NO cumple. Potencia, tensión, diámetro y PN son identidad. Tubería PE/HDPE, medida nominal: 1/2"=d20, 3/4"=d25, 1"=d32, 1¼"=d40, 1½"=d50, 2"=d63, 2½"=d75, 3"=d90, 4"=d110, 6"=d160.
5. Si el producto nombra un modelo y una línea trae ESE modelo, va a esa línea antes que a cualquier equivalente.
6. Un producto sin diámetro o sin modelo puede inferirse por la cantidad o por el grupo en que aparece, pero con confianza "media" y diciendo de qué lo infieres.
7. Si la línea dice una medida distinta de lo pedido (ej.: 15 HP cotizado vs 30 HP pedido), asígnala igual SOLO si el modelo coincide, con confianza "revisar" y la discrepancia en "motivo". Si no coincide el modelo, no la asignes.
8. No inventes precios: precioUnitario sale de la línea. Si la línea es por metro/kilo y el producto por rollo/caja de N, di "conversion": N (el código multiplica) y "cantidad" en unidades del PRODUCTO.
9. Flete, despacho e instalación no son productos (salvo que exista un producto de flete o instalación en la lista): van en "cargosAparte".
10. Toda línea termina en "asignaciones", "alternativas" de algún producto, "sobrantes" (con por qué) o "cargosAparte". Ninguna se pierde.

Responde SOLO JSON con este formato:
{"asignaciones":[{"producto":"P12","linea":"L7","cantidad":1,"precioUnitario":1380000,"conversion":null,"confianza":"alta|media|revisar","motivo":"<1 frase>"}],
 "alternativas":[{"producto":"P12","linea":"L31","precioUnitario":1187500,"motivo":"<por qué no es la principal>"}],
 "sobrantes":[{"linea":"L33","cantidadSobrante":1,"motivo":"<1 frase>"}],
 "cargosAparte":[{"linea":"L40","concepto":"despacho","monto":12000}],
 "sinCotizacion":["P8","P9"]}`;

// ─── Comprobaciones ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type Confianza = 'alta' | 'media' | 'revisar';
const RANGO: Record<Confianza, number> = { alta: 3, media: 2, revisar: 1 };
const confianzaDe = (v: unknown): Confianza => (v === 'alta' || v === 'media' || v === 'revisar' ? v : 'media');
const peor = (a: Confianza, b: Confianza): Confianza => (RANGO[a] <= RANGO[b] ? a : b);

/** Medida nominal de tubería PE/HDPE: pulgadas → diámetro exterior en mm. Solo se usa cuando el texto es de tubería o fitting de tubería. */
export const PULGADA_A_MM_TUBERIA: Array<[number, number]> = [[0.5, 20], [0.75, 25], [1, 32], [1.25, 40], [1.5, 50], [2, 63], [2.5, 75], [3, 90], [4, 110], [6, 160]];
const RE_TUBERIA = /\b(tuber[ií]a|tubo|ca[ñn]er[ií]a|rollo|hdpe|pead|polietileno|pe100|pe80|manguera)\b/i;
/** Agrega «(Ø20 mm)» a un texto de tubería que dice 1/2": así conflictosMedibles compara pulgadas nominales con mm. */
export function conEquivalenciaNominal(texto: string): string {
  if (!RE_TUBERIA.test(texto)) return texto;
  const t = String(texto).replace(/[”″“]/g, '"');
  const extras: string[] = [];
  for (const m of t.matchAll(/(?:(\d+)[\s.-]+)?(\d+)\s*\/\s*(\d+)\s*"|(\d+(?:[.,]\d+)?)\s*"/g)) {
    const v = m[2] && m[3] ? (m[1] ? Number(m[1]) : 0) + Number(m[2]) / Number(m[3]) : Number(String(m[4]).replace(',', '.'));
    const mm = PULGADA_A_MM_TUBERIA.find(([p]) => Math.abs(p - v) < 1e-6)?.[1];
    if (mm) extras.push(`${mm} mm`);
  }
  return extras.length ? `${texto} (${extras.join(', ')})` : texto;
}

/** Grupos de palabras que se excluyen entre sí: si el producto dice una y la línea dice otra del mismo grupo, son productos distintos. */
const FAMILIAS: Array<Array<[string, RegExp]>> = [
  [['electrofusión', /electro\s*-?\s*fusi[oó]n|electrofusora|electrosoldadora/i], ['termofusión', /termo\s*-?\s*fusi[oó]n|termofusora|termofusionadora|soldadura a tope|socket/i]],
  [['sumergible', /sumergible|de pozo|pozo profundo/i], ['centrífuga', /centr[ií]fuga/i], ['periférica', /perif[eé]rica/i]],
  [['diésel', /di[eé]sel|petr[oó]leo/i], ['gasolina', /gasolina|bencin/i]],
  [['monofásico', /monof[aá]sic/i], ['trifásico', /trif[aá]sic/i]],
  [['PVC', /\bpvc\b/i], ['HDPE', /\b(hdpe|pead|pe100|pe80|polietileno)\b/i], ['cobre', /\bcobre\b/i], ['galvanizado', /galvaniz/i]],
];
/** Familias que dice un texto. Las equivalencias de la empresa (modelo → familia) cuentan como si el texto lo dijera. */
export function familiasDe(texto: string, equivalencias: EquivalenciaFamilia[] = []): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>();
  const extra = equivalencias.filter(e => e.patron && String(texto).toLowerCase().includes(e.patron.toLowerCase())).map(e => e.familia.toLowerCase());
  FAMILIAS.forEach((grupo, gi) => {
    for (const [nombre, re] of grupo) {
      if (re.test(texto) || extra.some(f => f.includes(nombre.toLowerCase()) || re.test(f))) {
        const s = out.get(gi) ?? new Set<string>(); s.add(nombre); out.set(gi, s);
      }
    }
  });
  return out;
}
/** ¿La empresa declaró equivalentes a estos dos textos? Comparten una familia que SOLO existe por una equivalencia suya (ej. «Easy Weld» y «Termofusionadora INGAP» = termofusión). */
export function declaradasEquivalentes(descProducto: string, descLinea: string, equivalencias: EquivalenciaFamilia[] = []): boolean {
  const p = String(descProducto).toLowerCase(), l = String(descLinea).toLowerCase();
  for (const e of equivalencias) {
    const pat = e.patron?.trim().toLowerCase(); if (!pat) continue;
    const enP = p.includes(pat), enL = l.includes(pat);
    if (enP && enL) return true;
    if (!enP && !enL) continue;
    // La empresa dijo «<patrón> = <familia>»: el otro texto tiene que decir esa familia.
    const familiaDeclarada = familiasDe(e.familia), delOtro = familiasDe(enP ? descLinea : descProducto);
    for (const [g, nombres] of familiaDeclarada) for (const n of nombres) if (delOtro.get(g)?.has(n)) return true;
  }
  return false;
}
/** Choque de familia: el producto y la línea dicen familias distintas del mismo grupo (y ninguno dice las dos). */
export function choqueDeFamilia(descProducto: string, descLinea: string, equivalencias: EquivalenciaFamilia[] = []): string | null {
  const fp = familiasDe(descProducto, equivalencias), fl = familiasDe(descLinea, equivalencias);
  for (const [g, sp] of fp) {
    const sl = fl.get(g);
    if (!sl || sp.size > 1 || sl.size > 1) continue;
    const [a] = [...sp], [b] = [...sl];
    if (a !== b) return `${a} pedido, la línea es ${b}`;
  }
  return null;
}

// ─── Repuesto ≠ máquina ────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 2378-117-LP26 (productos «MOTOSIERRA … + REPUESTOS»): «FILTRO DE MEZCLA MS-172» trae el modelo del producto y era la línea más barata con ese
// modelo, así que le ganaba como precio principal a la motosierra ($3.592,90 en vez de $210.080).
const PARTES = new Set(['repuesto', 'recambio', 'accesorio', 'insumo', 'filtro', 'bujia', 'carburador', 'espada', 'cadena', 'pinon', 'cabezal', 'juego',
  'bateria', 'cargador', 'aceite', 'correa', 'empaquetadura', 'sello', 'rodamiento', 'piston', 'embrague']);
/** Un producto que ES un conjunto de partes («kit de repuestos»): ahí cualquier parte puede ser su línea. */
const PARTES_GENERICAS = ['repuesto', 'recambio', 'accesorio', 'insumo', 'kit', 'set', 'juego'];
const palabras = (s: string) => (String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z]+/g) ?? [])
  .map(w => (w.length > 4 && w.endsWith('es') && PARTES.has(w.slice(0, -2)) ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w));
/** El nombre de la cosa: lo que va antes de «+», «con», «para», «incluye», «sin»… (lo de después son complementos o para qué sirve). */
const cabezaDe = (s: string) => String(s).split(/\+|\bc\/|\b(?:con|para|incluy\w*|incl|sin|mas|más)\b/i)[0];

/** ¿La línea es un repuesto o accesorio del producto, y no el producto? Mira el nombre de la línea: si antes de la palabra que nombra al producto
 *  («motosierra», la primera del producto) aparece una parte («filtro», «espada», «cargador»…) que el producto no dice ser, es un repuesto.
 *  La marca delante no cuenta («STIHL CARBURADOR …»). */
export function esRepuestoDelProducto(descProducto: string, descLinea: string): boolean {
  const producto = palabras(cabezaDe(descProducto));
  // El producto que se pide ES una parte (un filtro, una cadena) o un conjunto de partes: aquí no hay máquina que confundir.
  if (!producto.length || PARTES.has(producto[0]) || producto.some(w => PARTES_GENERICAS.includes(w))) return false;
  // «MS 250 STIHL 2 BUJIA, 2 FILTRO…»: una parte con su cantidad DESPUÉS del nombre es lo que viene incluido.
  const sinIncluidos = String(descLinea).split(/(?<=[a-z].*)\s\d{1,2}\s*(?=(?:buj[ií]a|filtro|carburador|espada|cadena|bater[ií]a|cargador|pi[ñn][oó]n)e?s?\b)/i)[0];
  const linea = palabras(cabezaDe(sinIncluidos.split(/\b(?:de|del)\b/i)[0])).slice(0, 4);
  for (const w of linea) {
    if (w === producto[0]) return false;
    if (!PARTES.has(w) || producto.includes(w)) { if (PARTES.has(w)) return false; continue; }
    // «Repuesto cuchillo» para el producto «cuchillo»: es el producto, salvo que además nombre otra parte («Repuesto Motosierra Cadena»).
    if (w !== 'repuesto' && w !== 'recambio') return true;
    const todas = palabras(descLinea);
    return !todas.includes(producto[0]) || todas.some(x => x !== w && x !== 'accesorio' && PARTES.has(x) && !producto.includes(x));
  }
  return false;
}

/** Debajo de este puntaje de texto (0 a 1) una asignación se considera un código mal puesto de la IA. HST 300 contra Connect160 saca 0,23; una copla contra una máquina, ~0. */
export const UMBRAL_PARECIDO = 0.15;
export interface AsignacionPareo {
  productoId: number; linea: string; cotizacionId: number; cantidad: number;
  /** unidades de la línea que trae cada unidad del producto (rollo de 100 m por línea en metros = 100) */
  factor: number;
  precioUnitarioClp: number; confianza: Confianza; motivo: string; avisos: string[];
}
export interface AlternativaPareo { productoId: number; linea: string; cotizacionId: number; precioUnitarioClp: number; motivo: string }
export interface CuadrePareo { cotizacionId: number; proveedor: string; sumaLineas: number; netoDocumento: number | null; diferenciaLectura: number | null; cuadraLectura: boolean | null; asignado: number; sobrante: number; cargos: number }
export interface ResultadoPareo {
  lineas: LineaPareo[];
  asignaciones: AsignacionPareo[];
  alternativas: AlternativaPareo[];
  sobrantes: Array<{ linea: string; cantidad: number; motivo: string }>;
  cargos: Array<{ linea: string; concepto: string; monto: number }>;
  sinCotizacion: number[];
  /** lo que la IA propuso y el código rechazó, con el porqué */
  descartes: Array<{ producto?: number; linea?: string; motivo: string }>;
  cuadres: CuadrePareo[];
}

interface Ctx { productos: ProductoPareo[]; lineas: LineaPareo[]; cotizaciones: CotizacionPareo[]; equivalencias: EquivalenciaFamilia[] }

/** Precio por unidad del PRODUCTO desde la línea: con la conversión rollo/caja solo si se sostiene (factor escrito en el producto, línea por metro
 *  o cantidad múltiplo, y si hay precio de venta, el costo más parecido a la venta). Reusa las piezas del motor por cotización. */
function precioDeLinea(p: ProductoPareo, l: LineaPareo, c: CotizacionPareo, conversionIA: unknown): { precio: number; factor: number; nota: string | null } | null {
  if (l.precioNeto == null) return null;
  const texto = String(c.descripcion_libre || '');
  const nIA = Number(conversionIA);
  const conv = (Number.isFinite(nIA) && nIA > 1 ? precioPorUnidadDeProducto({ unidadLinea: l.unidad && /^(m|mt|mts|mtr|metros?|kg|kgs|kilos?|lt|lts|litros?)\.?$/i.test(l.unidad) ? l.unidad : 'MT', precioLinea: l.precioDoc, cantidadPorUnidad: nIA }, p.descripcion, texto) : null)
    ?? precioPorUnidadDeProducto(conversionDesdeTexto(l.precioDoc, p.descripcion, texto), p.descripcion, texto);
  if (!conv) return { precio: l.precioNeto, factor: 1, nota: null };
  const conPor = l.precioNeto * conv.factor;
  const venta = Number(p.montoUnitario);
  if (Number.isFinite(venta) && venta > 0) {
    if (Math.abs(Math.log(l.precioNeto / venta)) < Math.abs(Math.log(conPor / venta))) return { precio: l.precioNeto, factor: 1, nota: null };
  } else if (!conversionCoherenteConLinea(l.linea, conv.factor)) return { precio: l.precioNeto, factor: 1, nota: null };
  return { precio: Math.round(conPor * 100) / 100, factor: conv.factor, nota: `$${Math.round(l.precioNeto).toLocaleString('es-CL')} por ${l.unidad || 'unidad de línea'} × ${conv.factor}` };
}

/** Los 8 controles: la IA propone, el código decide. Puro y determinista. */
export function validarPareoGlobal(ctx: Ctx, respuesta: any): ResultadoPareo {
  const { productos, lineas, cotizaciones, equivalencias } = ctx;
  const prodPorCod = (v: unknown) => productos[Number(String(v ?? '').replace(/\D/g, '')) - 1];
  const linPorCod = new Map(lineas.map(l => [l.codigo.toUpperCase(), l]));
  const lin = (v: unknown) => linPorCod.get(String(v ?? '').trim().toUpperCase());
  const cot = new Map(cotizaciones.map(c => [c.id, c]));
  const descartes: ResultadoPareo['descartes'] = [];
  const alternativas: AlternativaPareo[] = [];

  // 1) EXISTEN · 4) PRECIO REAL · 5) MEDIDAS/MODELO · 6) FAMILIA — por cada asignación propuesta
  type Cand = AsignacionPareo & { orden: number; esAlt?: boolean; modeloExacto?: boolean };
  const cands: Cand[] = [];
  // Una alternativa que propone la IA se valida con las MISMAS reglas y compite por ser la principal (gana la más barata que cumple, regla 2 del prompt):
  // el 1356 mostró que la IA deja de alternativa a Dicran ($13.040) y pone de principal a INGAP ($19.078). Los rechazos de una alternativa no se anotan.
  const evaluar = (a: any, orden: number, esAlt = false) => {
    const descartar = (d: ResultadoPareo['descartes'][number]) => { if (!esAlt) descartes.push(d); };
    const p = prodPorCod(a?.producto), l = lin(a?.linea);
    if (!p || !l) { descartar({ linea: a?.linea, motivo: `producto o línea que no existe (${a?.producto} / ${a?.linea})` }); return; }
    if (l.esFlete && !RE_FLETE.test(p.descripcion)) { descartar({ producto: p.id, linea: l.codigo, motivo: 'una línea de flete no es el precio de un producto' }); return; }
    if (esRepuestoDelProducto(p.descripcion, l.descripcion) && !declaradasEquivalentes(p.descripcion, l.descripcion, equivalencias)) { descartar({ producto: p.id, linea: l.codigo, motivo: 'es un repuesto o accesorio, no el producto' }); return; }
    const c = cot.get(l.cotizacionId)!;
    const pr = precioDeLinea(p, l, c, a?.conversion);
    if (!pr) { descartar({ producto: p.id, linea: l.codigo, motivo: 'la línea no tiene precio' }); return; }
    const avisos: string[] = [];
    let confianza = confianzaDe(a?.confianza);
    if (pr.nota) avisos.push(pr.nota);
    // El precio que dice la IA tiene que ser el de la línea (o la línea × la conversión): si no, manda el de la línea.
    const pIA = Number(a?.precioUnitario);
    if (Number.isFinite(pIA) && pIA > 0 && Math.abs(pIA - pr.precio) > Math.max(2, pr.precio * 0.01)) avisos.push(`la IA dijo $${Math.round(pIA).toLocaleString('es-CL')}; vale el de la línea`);
    // Medidas y modelo (con la medida nominal de tubería pulgada → mm).
    const conf: ConflictoMedible[] = conflictosMedibles(conEquivalenciaNominal(p.descripcion), conEquivalenciaNominal(l.descripcion));
    const mismoModelo = lineaConElMismoModelo(p.descripcion, [l.linea]) === l.linea;
    const graves = conf.filter(x => x.grave);
    if (graves.length && !mismoModelo) { descartar({ producto: p.id, linea: l.codigo, motivo: `otra medida: ${graves.map(g => g.texto).join('; ')}` }); return; }
    if (graves.length) { confianza = 'revisar'; avisos.push(`mismo modelo pero ${graves.map(g => g.texto).join('; ')}`); }
    // Regla 7 del prompt, en código: si la IA misma duda («revisar») y el producto nombra OTRO modelo, no se asigna
    // (Kimi en el 1356 llenaba con la línea más cara un martillo, un clorador y un pozómetro marcándolos «revisar»).
    const otroModelo = conf.find(x => x.clase === 'modelo');
    if (otroModelo && !mismoModelo && confianzaDe(a?.confianza) === 'revisar') { descartar({ producto: p.id, linea: l.codigo, motivo: `la IA dudó y es otro modelo: ${otroModelo.texto}` }); return; }
    for (const x of conf.filter(x => !x.grave)) { avisos.push(x.texto); if (x.clase === 'modelo') confianza = peor(confianza, 'media'); }
    const fam = choqueDeFamilia(p.descripcion, l.descripcion, equivalencias);
    if (fam) { descartar({ producto: p.id, linea: l.codigo, motivo: `otra familia: ${fam}` }); return; }
    // Coherencia de texto: con 141 productos en una llamada la IA a veces se corre de código (HST 300 → una copla de $3.436, una motobomba → una brida).
    // Si el producto y la línea no comparten casi nada y la línea no trae el modelo que nombra el producto, no es una equivalencia: es un código mal puesto.
    const parecido = puntajeLineaProducto(l.linea, { id: p.id, descripcion: p.descripcion, cantidad: p.cantidad }, undefined, { penalizar: false }).puntaje;
    if (parecido < UMBRAL_PARECIDO && !mismoModelo && !declaradasEquivalentes(p.descripcion, l.descripcion, equivalencias)) { descartar({ producto: p.id, linea: l.codigo, motivo: `no se parecen (código mal puesto): «${corto(l.descripcion, 40)}»` }); return; }
    // Cantidad en unidades del producto (por defecto, lo que pide el producto).
    const qIA = Number(a?.cantidad);
    const cantidad = Number.isFinite(qIA) && qIA > 0 ? qIA : (p.cantidad ?? 1);
    cands.push({ productoId: p.id, linea: l.codigo, cotizacionId: l.cotizacionId, cantidad, factor: pr.factor, precioUnitarioClp: pr.precio, confianza, motivo: String(a?.motivo || ''), avisos, orden, esAlt, modeloExacto: mismoModelo });
  };
  (Array.isArray(respuesta?.asignaciones) ? respuesta.asignaciones : []).forEach((a: any, orden: number) => evaluar(a, orden));
  (Array.isArray(respuesta?.alternativas) ? respuesta.alternativas : []).forEach((a: any, orden: number) => evaluar({ ...a, confianza: 'media', cantidad: undefined }, 1000 + orden, true));

  // 3) UN PRINCIPAL POR PRODUCTO: si una línea trae EL MODELO que nombra el producto, esa va primero (regla 5); si no, la más barata que cumple
  // (a igual precio, la de mejor confianza). Las asignaciones y las alternativas de la IA compiten juntas; las otras pasan a alternativa.
  const porProducto = new Map<number, Cand[]>();
  for (const x of cands) porProducto.set(x.productoId, [...(porProducto.get(x.productoId) ?? []), x]);
  let principales: Cand[] = [];
  for (const [, lista] of porProducto) {
    // Varias líneas IGUALES que juntas cubren la cantidad (no pasa con la IA, pero se respeta): se quedan; si no, una sola.
    const orden = [...lista].sort((a, b) => Number(!!b.modeloExacto) - Number(!!a.modeloExacto) || a.precioUnitarioClp - b.precioUnitarioClp || RANGO[b.confianza] - RANGO[a.confianza] || Number(!!a.esAlt) - Number(!!b.esAlt) || a.orden - b.orden);
    principales.push(orden[0]);
    for (const o of orden.slice(1)) alternativas.push({ productoId: o.productoId, linea: o.linea, cotizacionId: o.cotizacionId, precioUnitarioClp: o.precioUnitarioClp, motivo: 'otra línea que también lo cubre (más cara)' });
  }

  // 2) CANTIDAD: lo repartido de una línea no puede pasar lo cotizado. Si se pasa: primero se prueba leer la cantidad en la unidad de la línea
  // (100 «m» de un producto «R/100» cuando la línea es de 400 m y ya hay 300 m asignados a otro), y si igual no alcanza, salen las de menor confianza.
  const consumo = (x: Cand) => x.cantidad * x.factor;
  // Se prueban dos salidas y se queda la que deja la línea MÁS LLENA (que calce con lo cotizado es la señal más fuerte): en el 1356, 300 m de d20
  // con «1/2" × 3 rollos» + una «tubería lisa» de 3 m que sobraba → sacar la tubería lisa (300 de 300), no leer los rollos en metros (6 de 300).
  const quitarPorConfianza = (usan: Cand[], tope: number) => {
    let total = usan.reduce((s, x) => s + consumo(x), 0);
    const fuera: Cand[] = [];
    for (const x of [...usan].sort((a, b) => RANGO[a.confianza] - RANGO[b.confianza] || b.orden - a.orden)) {
      if (total <= tope + 1e-6) break;
      fuera.push(x); total -= consumo(x);
    }
    return { fuera, total };
  };
  for (const l of lineas) {
    const tope = l.cantidad ?? Infinity;
    const usan = principales.filter(x => x.linea === l.codigo);
    if (usan.reduce((s, x) => s + consumo(x), 0) <= tope + 1e-6) continue;
    // Salida B: solo sacar las de menor confianza.
    const soloQuitar = quitarPorConfianza(usan, tope);
    // Salida A: leer primero en la unidad de la línea (100 «m» de un producto «R/100» cuando la línea es de 400 m), y después sacar.
    const leidas = new Map<Cand, Cand>();
    const conA = usan.map(x => ({ ...x }));
    conA.forEach((y, i) => leidas.set(usan[i], y));
    for (const y of conA.filter(y => y.factor > 1).sort((a, b) => b.cantidad * b.factor - a.cantidad * a.factor)) {
      if (conA.reduce((s, z) => s + consumo(z), 0) <= tope + 1e-6) break;
      const l0 = l.precioNeto ?? y.precioUnitarioClp / y.factor;
      y.avisos = [...y.avisos.filter(a => !a.includes(' × ')), `la cantidad se leyó en ${l.unidad || 'la unidad de la línea'} (la línea no alcanza para ${y.cantidad} × ${y.factor})`];
      y.factor = 1; y.precioUnitarioClp = l0; y.confianza = peor(y.confianza, 'media');
    }
    const conLeer = quitarPorConfianza(conA, tope);
    const usarA = conLeer.total > soloQuitar.total + 1e-6 || (Math.abs(conLeer.total - soloQuitar.total) <= 1e-6 && conLeer.fuera.length < soloQuitar.fuera.length);
    const fuera = usarA ? conLeer.fuera : soloQuitar.fuera;
    if (usarA) principales = principales.map(x => leidas.get(x) ?? x);
    for (const x of fuera) {
      principales = principales.filter(y => y.productoId !== x.productoId || y.linea !== x.linea);
      alternativas.push({ productoId: x.productoId, linea: x.linea, cotizacionId: x.cotizacionId, precioUnitarioClp: x.precioUnitarioClp, motivo: `la línea no alcanza: cotiza ${l.cantidad} y ya se repartieron` });
      descartes.push({ producto: x.productoId, linea: x.linea, motivo: `cantidad: la línea ${l.codigo} cotiza ${l.cantidad} y se repartía más` });
    }
  }
  // Un producto cuya principal salió por cantidad toma la siguiente candidata que sí cabe en su línea.
  for (const [id, lista] of porProducto) {
    if (principales.some(x => x.productoId === id)) continue;
    for (const o of [...lista].sort((a, b) => a.precioUnitarioClp - b.precioUnitarioClp || a.orden - b.orden)) {
      const tope = lineas.find(l => l.codigo === o.linea)?.cantidad ?? Infinity;
      const usado = principales.filter(x => x.linea === o.linea).reduce((s, x) => s + consumo(x), 0);
      if (usado + consumo(o) <= tope + 1e-6) { principales.push(o); break; }
    }
  }
  // Un producto que recibe menos de lo que pide: se avisa.
  for (const x of principales) {
    const p = productos.find(q => q.id === x.productoId)!;
    if (p.cantidad != null && x.cantidad < p.cantidad - 1e-6) { x.avisos.push(`cubre ${x.cantidad} de ${p.cantidad}`); x.confianza = peor(x.confianza, 'media'); }
  }

  // Alternativas que propone la IA (validadas igual: existen, precio de la línea, sin choque grave ni de familia).
  for (const a of Array.isArray(respuesta?.alternativas) ? respuesta.alternativas : []) {
    const p = prodPorCod(a?.producto), l = lin(a?.linea);
    if (!p || !l || l.esFlete) continue;
    if (esRepuestoDelProducto(p.descripcion, l.descripcion) && !declaradasEquivalentes(p.descripcion, l.descripcion, equivalencias)) continue;
    if (principales.some(x => x.productoId === p.id && x.linea === l.codigo) || alternativas.some(x => x.productoId === p.id && x.linea === l.codigo)) continue;
    const pr = precioDeLinea(p, l, cot.get(l.cotizacionId)!, a?.conversion);
    if (!pr) continue;
    const graves = conflictosMedibles(conEquivalenciaNominal(p.descripcion), conEquivalenciaNominal(l.descripcion)).filter(x => x.grave);
    if (graves.length || choqueDeFamilia(p.descripcion, l.descripcion, equivalencias)) continue;
    alternativas.push({ productoId: p.id, linea: l.codigo, cotizacionId: l.cotizacionId, precioUnitarioClp: pr.precio, motivo: String(a?.motivo || 'alternativa') });
  }

  // Cargos aparte (flete, instalación) que propone la IA: solo líneas reales.
  const cargos: ResultadoPareo['cargos'] = [];
  for (const g of Array.isArray(respuesta?.cargosAparte) ? respuesta.cargosAparte : []) {
    const l = lin(g?.linea);
    if (!l || principales.some(x => x.linea === l.codigo)) continue;
    cargos.push({ linea: l.codigo, concepto: String(g?.concepto || 'cargo'), monto: l.totalNeto ?? 0 });
  }
  for (const l of lineas) if (l.esFlete && !cargos.some(g => g.linea === l.codigo) && !principales.some(x => x.linea === l.codigo)) cargos.push({ linea: l.codigo, concepto: 'flete', monto: l.totalNeto ?? 0 });

  // 8) TODA LÍNEA CON DESTINO: lo que no se repartió de cada línea queda como sobrante (con el motivo de la IA si lo dio).
  const motivoSobrante = new Map<string, string>();
  for (const s of Array.isArray(respuesta?.sobrantes) ? respuesta.sobrantes : []) { const l = lin(s?.linea); if (l) motivoSobrante.set(l.codigo, String(s?.motivo || '')); }
  const sobrantes: ResultadoPareo['sobrantes'] = [];
  for (const l of lineas) {
    if (cargos.some(g => g.linea === l.codigo)) continue;
    const usado = principales.filter(x => x.linea === l.codigo).reduce((s, x) => s + consumo(x), 0);
    const resto = (l.cantidad ?? (usado > 0 ? usado : 1)) - usado;
    if (resto > 1e-6) sobrantes.push({ linea: l.codigo, cantidad: Math.round(resto * 1000) / 1000, motivo: motivoSobrante.get(l.codigo) || (usado > 0 ? 'sobra de lo cotizado' : alternativas.some(a => a.linea === l.codigo) ? 'solo queda como alternativa' : 'ningún producto la usa') });
  }

  // 7) CUADRE POR COTIZACIÓN: lo leído suma el neto del documento (±0,5 %), y asignado + sobrante + cargos = lo leído.
  const cuadres: CuadrePareo[] = cotizaciones.map(c => {
    const ls = lineas.filter(l => l.cotizacionId === c.id);
    const sumaLineas = ls.reduce((s, l) => s + (l.totalNeto ?? 0), 0);
    const tc = c.moneda && c.moneda !== 'CLP' && c.tipo_cambio_usado ? Number(c.tipo_cambio_usado) : 1;
    const netoDocumento = c.precio_total != null && Number(c.precio_total) > 0 ? Number(c.precio_total) * tc : null;
    // el total del documento puede venir sin el flete aparte: se compara con y sin él
    const flete = c.flete_monto != null ? Number(c.flete_monto) : 0;
    const dif = netoDocumento == null ? null : [sumaLineas - netoDocumento, sumaLineas - flete - netoDocumento].reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a));
    const precioDe = (cod: string) => ls.find(l => l.codigo === cod)?.precioNeto ?? 0;
    const asignado = principales.filter(x => x.cotizacionId === c.id).reduce((s, x) => s + x.cantidad * x.factor * precioDe(x.linea), 0);
    const sobrante = sobrantes.filter(s => ls.some(l => l.codigo === s.linea)).reduce((s, x) => s + x.cantidad * precioDe(x.linea), 0);
    const cargosC = cargos.filter(g => ls.some(l => l.codigo === g.linea)).reduce((s, g) => s + g.monto, 0);
    return { cotizacionId: c.id, proveedor: String(c.proveedor_nombre || ''), sumaLineas: Math.round(sumaLineas), netoDocumento: netoDocumento == null ? null : Math.round(netoDocumento), diferenciaLectura: dif == null ? null : Math.round(dif), cuadraLectura: dif == null ? null : Math.abs(dif) <= Math.max(2, (netoDocumento ?? 0) * 0.005), asignado: Math.round(asignado), sobrante: Math.round(sobrante), cargos: Math.round(cargosC) };
  });

  const conAsig = new Set(principales.map(x => x.productoId));
  return {
    lineas,
    asignaciones: principales.map(({ orden, ...x }) => x),
    alternativas: alternativas.filter(a => !principales.some(x => x.productoId === a.productoId && x.linea === a.linea)),
    sobrantes, cargos,
    sinCotizacion: productos.filter(p => !conAsig.has(p.id)).map(p => p.id),
    descartes, cuadres,
  };
}

// ─── Orquestación ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Tope de la entrada en una sola llamada (caracteres). Más que esto se parte en grupos de líneas con sus productos candidatos. */
export const TOPE_ENTRADA = 60_000;

/** Grupos independientes: líneas que comparten productos candidatos van juntas (union-find), y cada grupo lleva solo sus candidatos. */
export function gruposDePareo(productos: ProductoPareo[], lineas: LineaPareo[]): Array<{ productos: ProductoPareo[]; lineas: LineaPareo[] }> {
  const para = productos.map(p => ({ id: p.id, descripcion: p.descripcion, cantidad: p.cantidad }));
  const cand = lineas.map(l => productosCandidatos([l.linea], para, { porLinea: 15, minimo: 6 }));
  const padre = lineas.map((_, i) => i);
  const raiz = (i: number): number => (padre[i] === i ? i : (padre[i] = raiz(padre[i])));
  const dueño = new Map<number, number>();
  cand.forEach((s, i) => { for (const id of s) { const j = dueño.get(id); if (j == null) dueño.set(id, i); else padre[raiz(i)] = raiz(j); } });
  const grupos = new Map<number, { ids: Set<number>; lineas: LineaPareo[] }>();
  lineas.forEach((l, i) => { const r = raiz(i); const g = grupos.get(r) ?? { ids: new Set<number>(), lineas: [] }; g.lineas.push(l); for (const id of cand[i]) g.ids.add(id); grupos.set(r, g); });
  return [...grupos.values()].map(g => ({ productos: productos.filter(p => g.ids.has(p.id)), lineas: g.lineas }));
}

export interface EntradaPareo { productos: ProductoPareo[]; cotizaciones: CotizacionPareo[]; llamarIA: LlamarIA; equivalencias?: EquivalenciaFamilia[]; topeEntrada?: number; lineasPorTanda?: number; concurrencia?: number }

// ── Tandas ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Con 141 productos y ~55 cotizaciones una sola llamada pide una respuesta de 20–24 mil tokens: se corta, tarda 3–4 min y la IA se salta filas distintas
// en cada corrida (1356, Koslan: 0 de 2 dosificadoras y 0 de 14 Pedrollo asignadas, sin que el código descartara nada). Por eso, si hay más de una tanda de
// líneas, se pregunta POR COTIZACIÓN, en trozos de pocas líneas y solo con los productos que se le parecen. Cada tanda es una respuesta corta que no se cansa;
// el código junta todo y sigue decidiendo igual (un principal por producto, el resto alternativas). Una línea que la IA no nombra en ninguna parte se
// vuelve a preguntar sola, y si aun así queda sin respuesta se informa (sinRespuesta), no se pierde en silencio.
export const LINEAS_POR_TANDA = 8;
export const CONCURRENCIA_TANDAS = 4;

/** Tandas: líneas de UNA cotización (en el orden del documento, de a `porTanda`) con los productos candidatos de esas líneas. */
export function tandasDePareo(productos: ProductoPareo[], lineas: LineaPareo[], porTanda = LINEAS_POR_TANDA): Array<{ productos: ProductoPareo[]; lineas: LineaPareo[] }> {
  const para = productos.map(p => ({ id: p.id, descripcion: p.descripcion, cantidad: p.cantidad }));
  const porCot = new Map<number, LineaPareo[]>();
  for (const l of lineas) porCot.set(l.cotizacionId, [...(porCot.get(l.cotizacionId) ?? []), l]);
  const out: Array<{ productos: ProductoPareo[]; lineas: LineaPareo[] }> = [];
  for (const ls of porCot.values()) {
    for (let i = 0; i < ls.length; i += porTanda) {
      const trozo = ls.slice(i, i + porTanda);
      const ids = productosCandidatos(trozo.map(l => l.linea), para, { porLinea: 20, minimo: 8 });
      const prods = productos.filter(p => ids.has(p.id));
      if (prods.length > 0) out.push({ productos: prods, lineas: trozo });   // sin candidatos = líneas sin precio (títulos, totales): no hay qué preguntar
    }
  }
  return out;
}

async function enParalelo<T>(tareas: Array<() => Promise<T>>, concurrencia: number): Promise<T[]> {
  const out: T[] = new Array(tareas.length);
  let sig = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrencia, tareas.length)) }, async () => {
    while (sig < tareas.length) { const i = sig++; out[i] = await tareas[i](); }
  }));
  return out;
}

/** Pareo global de un negocio: una llamada si cabe; si no, tandas por cotización con reintento de lo que la IA no nombró. Devuelve lo validado por el código. */
export async function parearNegocio(e: EntradaPareo): Promise<ResultadoPareo & { llamadas: number; entradaChars: number; sinRespuesta: string[] }> {
  const equivalencias = e.equivalencias ?? [];
  const lineas = lineasDelNegocio(e.cotizaciones);
  const entrada = armarEntrada(e.productos, lineas, e.cotizaciones, equivalencias);
  const tope = e.topeEntrada ?? TOPE_ENTRADA;
  const porTanda = e.lineasPorTanda ?? LINEAS_POR_TANDA;
  let llamadas = 0;
  type Resp = { asignaciones: any[]; alternativas: any[]; sobrantes: any[]; cargosAparte: any[]; cortada?: boolean };
  const pedir = async (prods: ProductoPareo[], lins: LineaPareo[]): Promise<Resp> => {
    llamadas++;
    // Los códigos P/L son LOCALES a la entrada: se traducen de vuelta a los globales.
    const user = armarEntrada(prods, lins, e.cotizaciones, equivalencias);
    const r = await e.llamarIA(SYS_PAREO_GLOBAL, user);
    const j: any = parseJsonIA(String(r.content ?? '')) || {};
    const pMap = (v: unknown) => { const p = prods[Number(String(v ?? '').replace(/\D/g, '')) - 1]; return p ? `P${e.productos.indexOf(p) + 1}` : v; };
    // Las líneas se numeran con su código GLOBAL en armarEntrada: no se traducen. (Antes se leían como posición dentro del grupo y se cruzaban:
    // el plan B por grupos asignaba la HST 300 a una línea cualquiera; no se había probado hasta el 1356.)
    const lMap = (v: unknown) => v;
    const tr = (arr: any) => (Array.isArray(arr) ? arr.map((x: any) => ({ ...x, producto: x?.producto != null ? pMap(x.producto) : undefined, linea: x?.linea != null ? lMap(x.linea) : undefined })) : []);
    return { asignaciones: tr(j.asignaciones), alternativas: tr(j.alternativas), sobrantes: tr(j.sobrantes), cargosAparte: tr(j.cargosAparte), cortada: r.finishReason === 'length' || !Array.isArray(j.asignaciones) };
  };
  const juntar = (rs: Resp[]): Resp => ({ asignaciones: rs.flatMap(r => r.asignaciones), alternativas: rs.flatMap(r => r.alternativas), sobrantes: rs.flatMap(r => r.sobrantes), cargosAparte: rs.flatMap(r => r.cargosAparte) });
  /** Una tanda; si la respuesta se corta, se parte a la mitad hasta que cabe. */
  const tanda = async (prods: ProductoPareo[], lins: LineaPareo[]): Promise<Resp> => {
    const r = await pedir(prods, lins);
    if (!r.cortada || lins.length <= 1) return r;
    const m = Math.ceil(lins.length / 2);
    return juntar([await tanda(prods, lins.slice(0, m)), await tanda(prods, lins.slice(m))]);
  };
  const nombradas = (r: Resp) => new Set([...r.asignaciones, ...r.alternativas, ...r.sobrantes, ...r.cargosAparte].map((x: any) => String(x?.linea ?? '').trim().toUpperCase()));

  let respuesta: Resp;
  let sinRespuesta: string[] = [];
  if (lineas.length <= porTanda && entrada.length <= tope) {
    const r = await pedir(e.productos, lineas);
    respuesta = r.cortada && lineas.length > 1 ? juntar(await Promise.all(gruposDePareo(e.productos, lineas).map(g => pedir(g.productos, g.lineas)))) : r;
  } else {
    const tandas = tandasDePareo(e.productos, lineas, porTanda);
    const conc = e.concurrencia ?? CONCURRENCIA_TANDAS;
    const rs = await enParalelo(tandas.map(t => () => tanda(t.productos, t.lineas)), conc);
    // Lo que la IA no nombró en ninguna parte se pregunta de nuevo, de a pocas y solas.
    const faltan: Array<{ productos: ProductoPareo[]; lineas: LineaPareo[] }> = [];
    tandas.forEach((t, i) => {
      const dichas = nombradas(rs[i]);
      const f = t.lineas.filter(l => !l.esFlete && l.precioNeto != null && l.precioNeto > 0 && !dichas.has(l.codigo.toUpperCase()));
      for (let k = 0; k < f.length; k += 3) faltan.push({ productos: t.productos, lineas: f.slice(k, k + 3) });
    });
    const rs2 = await enParalelo(faltan.map(t => () => tanda(t.productos, t.lineas)), conc);
    const dichas2 = nombradas(juntar(rs2));
    sinRespuesta = faltan.flatMap(t => t.lineas).map(l => l.codigo).filter(c => !dichas2.has(c.toUpperCase()));
    respuesta = juntar([...rs, ...rs2]);
  }
  const v = validarPareoGlobal({ productos: e.productos, lineas, cotizaciones: e.cotizaciones, equivalencias }, respuesta);
  return { ...v, llamadas, entradaChars: entrada.length, sinRespuesta };
}

// ─── Plan de escritura (puro: decide QUÉ cambia en las asignaciones guardadas; la capa de BD solo lo ejecuta) ──────────────────────────
export interface ItemGuardado { cotizacionId: number; productoId: number; precioBase: number | null }
export interface EntradaPlan {
  resultado: ResultadoPareo;
  /** subestado de cada producto: solo PENDIENTE/COTIZANDO se toca (lo ya aprobado, comprado o entregado no se mueve) */
  productos: Array<{ id: number; subestado: string }>;
  itemsGuardados: ItemGuardado[];
  /** cotizaciones que una persona ya tocó (asignación manual o adicionales propios): el agente no las rehace */
  cotizacionesDeUnaPersona: Set<number>;
  /** ¿el documento todavía respalda este precio guardado para este producto? (misma regla del motor por cotización) */
  respaldado: (it: ItemGuardado) => boolean;
  /** quitar lo guardado que el pareo ya no sostiene. El pareo automático NO quita (solo agrega o cambia); el botón «Corregir pareo» sí. */
  quitar?: boolean;
  /** cotización → % de las que llevan el descuento SOBRE EL TOTAL (su precio_base va a precio de lista) */
  descuentoSobreTotal?: Map<number, number>;
}
export interface PlanPareo {
  escribir: Array<{ cotizacionId: number; productoId: number; precio: number; cumple: 'CUMPLE' | 'INFERIOR_NEGOCIABLE'; detalle: string | null }>;
  quitar: Array<{ cotizacionId: number; productoId: number }>;
  saltados: Array<{ cotizacionId?: number; productoId?: number; motivo: string }>;
  /** guardados sin respaldo del documento que la IA no repitió: se dejan (la IA se salta filas distintas en cada corrida) y se avisan */
  sinRespaldo: Array<{ cotizacionId: number; productoId: number }>;
}
const SE_PUEDE_MOVER = new Set(['PENDIENTE', 'COTIZANDO']);

export function planificarEscrituraPareo(e: EntradaPlan): PlanPareo {
  const plan: PlanPareo = { escribir: [], quitar: [], saltados: [], sinRespaldo: [] };
  // Una respuesta vacía o rota de la IA no borra lo que había.
  if (e.resultado.asignaciones.length === 0) { plan.saltados.push({ motivo: 'la IA no asignó nada: no se cambia nada' }); return plan; }
  const movible = new Set(e.productos.filter(p => SE_PUEDE_MOVER.has(p.subestado)).map(p => p.id));
  const clave = (c: number, p: number) => `${c}:${p}`;
  const guardado = new Map(e.itemsGuardados.map(i => [clave(i.cotizacionId, i.productoId), i]));
  const asignados = new Set(e.resultado.asignaciones.map(a => clave(a.cotizacionId, a.productoId)));
  const alternativas = new Set(e.resultado.alternativas.map(a => clave(a.cotizacionId, a.productoId)));

  for (const a of e.resultado.asignaciones) {
    if (e.cotizacionesDeUnaPersona.has(a.cotizacionId)) { plan.saltados.push({ cotizacionId: a.cotizacionId, productoId: a.productoId, motivo: 'una persona ya tocó esta cotización' }); continue; }
    if (!movible.has(a.productoId)) { plan.saltados.push({ cotizacionId: a.cotizacionId, productoId: a.productoId, motivo: 'el producto ya avanzó (aprobado, comprado o fuera)' }); continue; }
    const previo = guardado.get(clave(a.cotizacionId, a.productoId));
    const precio = precioBaseAGuardar(a.precioUnitarioClp, e.descuentoSobreTotal?.get(a.cotizacionId));
    if (previo?.precioBase != null && Math.abs(previo.precioBase - precio) < 0.5) continue;   // ya está igual: no se pisa el veredicto del auditor
    const p = e.resultado.lineas.find(l => l.codigo === a.linea);
    const partes = [a.confianza === 'alta' ? '' : a.motivo, ...a.avisos].filter(Boolean);
    plan.escribir.push({
      cotizacionId: a.cotizacionId, productoId: a.productoId, precio,
      cumple: a.confianza === 'alta' && a.avisos.length === 0 ? 'CUMPLE' : 'INFERIOR_NEGOCIABLE',
      detalle: partes.length ? `Pareo global (${a.confianza}${p ? ', ' + p.codigo : ''}): ${partes.join(' · ')}`.slice(0, 480) : null,
    });
  }
  // Lo guardado que el pareo ya no sostiene. Solo se QUITA con evidencia: el código rechazó justo ese par (cotización + producto) por medida, familia o modelo.
  // Que la IA no lo repitiera NO alcanza (se salta filas distintas en cada corrida), ni que el producto tenga otra línea principal: cada cotización es una
  // opción de la comparación de precios y el pareo solo elige una principal. Lo demás se deja y se avisa en sinRespaldo.
  const cotDeLinea = new Map(e.resultado.lineas.map(l => [l.codigo, l.cotizacionId]));
  const rechazados = new Set(e.resultado.descartes.filter(d => d.producto != null && d.linea != null && /medida|familia|modelo/.test(d.motivo)).map(d => clave(cotDeLinea.get(d.linea!) ?? -1, d.producto!)));
  for (const it of e.quitar ? e.itemsGuardados : []) {
    const k = clave(it.cotizacionId, it.productoId);
    if (asignados.has(k) || alternativas.has(k) || e.cotizacionesDeUnaPersona.has(it.cotizacionId) || !movible.has(it.productoId)) continue;
    if (it.precioBase == null || !(it.precioBase > 0) || e.respaldado(it)) continue;
    if (rechazados.has(k)) plan.quitar.push({ cotizacionId: it.cotizacionId, productoId: it.productoId });
    else plan.sinRespaldo.push({ cotizacionId: it.cotizacionId, productoId: it.productoId });
  }
  return plan;
}

// ── Reparación de unidad ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Un precio guardado que es EXACTAMENTE el de una línea × k (k entero ≥ 2), donde la línea NO alcanza para leer la cantidad del producto en «paquetes de k»
// pero SÍ para leerla en la unidad de la línea, es una conversión de rollo/caja mal aplicada por el motor anterior (1356: «Tubería HDPE 63 mm (R/100)»,
// cantidad 100, quedó a $239.000 = $2.390/m × 100 y la cotización trae 400 m). Se devuelve el precio de la línea.
export interface ReparacionUnidad { cotizacionId: number; productoId: number; precioAnterior: number; precio: number; motivo: string }
export function reparacionesDeUnidad(e: {
  itemsGuardados: ItemGuardado[]; lineas: LineaPareo[]; productos: ProductoPareo[];
  /** no se repara: cotizaciones de una persona o productos que ya avanzaron */
  excluir?: (it: ItemGuardado) => boolean;
}): ReparacionUnidad[] {
  const out: ReparacionUnidad[] = [];
  for (const it of e.itemsGuardados) {
    if (it.precioBase == null || !(it.precioBase > 0) || e.excluir?.(it)) continue;
    const p = e.productos.find(x => x.id === it.productoId);
    if (!p || !(p.cantidad != null && p.cantidad > 0)) continue;
    const candidatas = e.lineas.filter(l => l.cotizacionId === it.cotizacionId && !l.esFlete && l.precioNeto != null && l.precioNeto > 0 && l.cantidad != null);
    // Solo con un envase que el PRODUCTO declara («R/100», «unidades de 100 m», «(50 m)») y una línea por metro: sin eso, un precio que casualmente es
    // múltiplo del de otra línea (un medidor × 56) no se toca.
    const declarados = new Set([...String(p.descripcion).matchAll(/\br\s*\/\s*(\d+)|(\d+)\s*m(?![a-z0-9²³])/gi)].map(m => Number(m[1] ?? m[2])).filter(n => n > 1));
    if (declarados.size === 0) continue;
    let mejor: { l: LineaPareo; k: number; puntaje: number } | null = null;
    for (const l of candidatas) {
      if (!/^(mts?|mtr|m|metros?|ml)\.?$/i.test(String(l.unidad || '').trim())) continue;
      const razon = it.precioBase / l.precioNeto!;
      const k = Math.round(razon);
      if (!declarados.has(k) || Math.abs(razon - k) > Math.max(0.005 * k, 0.01)) continue;
      // La línea alcanza para la cantidad en SU unidad, pero no para la cantidad × k.
      if (l.cantidad! + 1e-6 < p.cantidad || l.cantidad! + 1e-6 >= p.cantidad * k) continue;
      const puntaje = puntajeLineaProducto(l.linea, { id: p.id, descripcion: p.descripcion, cantidad: p.cantidad }, undefined, { penalizar: false }).puntaje;
      if (puntaje < UMBRAL_PARECIDO) continue;
      if (!mejor || puntaje > mejor.puntaje) mejor = { l, k, puntaje };
    }
    if (mejor) out.push({ cotizacionId: it.cotizacionId, productoId: it.productoId, precioAnterior: it.precioBase, precio: mejor.l.precioNeto!,
      motivo: `Precio corregido: $${Math.round(it.precioBase).toLocaleString('es-CL')} era $${Math.round(mejor.l.precioNeto!).toLocaleString('es-CL')} por ${mejor.l.unidad || 'unidad de la línea'} × ${mejor.k}; la línea cotiza ${mejor.l.cantidad} y se pide ${p.cantidad}` });
  }
  return out;
}
