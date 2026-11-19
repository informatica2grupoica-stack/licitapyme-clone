// app/lib/compras-cotizacion-specs-core.ts
// COTIZACIÓN CON ESPECIFICACIONES TÉCNICAS → FICHA (funciones PURAS, sin red ni BD, con pruebas).
//
// Problema (18-nov-2026): una cotización con precios Y características técnicas («Potencia: 2000 W», «Material: acero inox»…) solo servía
// para el precio; el motor de fichas la rechazaba porque «una cotización no es ficha» y la parte técnica nunca llegaba a Fichas técnicas.
// Regla nueva: si la cotización trae especificaciones, esos productos TAMBIÉN se tratan como ficha (con el proveedor de la cotización).
// Regla de siempre: solo se toma lo que el documento dice; ante la duda, no se inventa nada y se avisa.
import type { ProductoLector, SalidaLector } from '@/app/lib/auditor-lector';

/** Mínimo de características distintas con valor para considerar que un producto trae «ficha». Menos que esto es solo la descripción de la línea. */
export const MIN_ESPECIFICACIONES = 3;

const norm = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

/** Características que dicen algo del producto (no vacías, no condiciones comerciales disfrazadas de característica). */
const COMERCIAL = /^(precio|valor|total|neto|iva|subtotal|descuento|flete|despacho|plazo|validez|forma de pago|condicion(?:es)? de pago|garantia|cantidad|cant|unidad de venta|moneda|vigencia|entrega|lugar de entrega|vendedor|cotizacion|n[°º]? ?cotizacion)\b/;
export function especificacionesDe(p: Pick<ProductoLector, 'caracteristicas'> | undefined): Array<{ nombre: string; valor: string }> {
  const vistos = new Set<string>();
  const out: Array<{ nombre: string; valor: string }> = [];
  for (const c of p?.caracteristicas || []) {
    const nombre = String(c.nombre ?? '').replace(/\s+/g, ' ').trim();
    const valor = [c.valor, c.unidad].filter(x => x != null && String(x).trim()).join(' ').replace(/\s+/g, ' ').trim();
    if (!valor || valor.length > 400) continue;
    if (COMERCIAL.test(norm(nombre))) continue;
    const k = `${norm(nombre)}|${norm(valor)}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push({ nombre, valor });
  }
  return out;
}

/** ¿Este producto de la cotización trae especificaciones técnicas suficientes para valer como ficha? */
export function productoTraeEspecificaciones(p: ProductoLector | undefined, minimo = MIN_ESPECIFICACIONES): boolean {
  if (!p) return false;
  const n = especificacionesDe(p).length;
  // Además de las características sueltas, dimensiones/peso/normas/accesorios del bloque `producto` cuentan como datos técnicos.
  const x = p.producto;
  const extra = x ? [x.peso, x.largo, x.ancho, x.alto].filter(v => v && String(v).trim()).length + (x.normas?.length ? 1 : 0) + (x.accesorios_estandar?.length ? 1 : 0) : 0;
  return n + extra >= minimo;
}

/** Cuántos productos del documento trae especificaciones (para decidir si vale la pena rutearlo como ficha). */
export function productosConEspecificaciones(salida: SalidaLector | undefined | null, minimo = MIN_ESPECIFICACIONES): number[] {
  const out: number[] = [];
  (salida?.productos || []).forEach((p, i) => { if (productoTraeEspecificaciones(p, minimo)) out.push(i); });
  return out;
}

// ── Filtro BARATO antes de gastar una lectura de IA ────────────────────────────────────────────────
// La cotización ya se leyó (texto completo). Antes de pasar el documento por el Lector (otra llamada de IA), se mira si el TEXTO
// huele a especificaciones: líneas «Nombre: valor» con unidades o palabras técnicas. Es permisivo a propósito (falso positivo = una
// lectura de más; falso negativo = una ficha que no llega), y el Lector decide al final con `productosConEspecificaciones`.
const PALABRAS_TECNICAS = /\b(caracter[ií]sticas?|especificaci[oó]n(?:es)?|ficha t[eé]cnica|datos t[eé]cnicos|detalle t[eé]cnico|dimensiones?|medidas?|material(?:es)?|capacidad|potencia|voltaje|tensi[oó]n|frecuencia|peso|largo|ancho|alto|espesor|di[aá]metro|densidad|color|acabado|certificaci[oó]n|norma|garant[ií]a del fabricante|consumo|rendimiento|resoluci[oó]n|pantalla|bater[ií]a|autonom[ií]a|velocidad|presi[oó]n|caudal|temperatura|composici[oó]n|tejido|gramaje|talla|specifications?|features|power|voltage|capacity|weight|length|width|height|thickness|diameter|speed|pressure|flow|dimensions?|size|frequency|battery|warranty|certification|standards?|resolution|display)\b/gi;
const UNIDADES = /\b\d+(?:[.,]\d+)?\s?(?:mm|cm|inch|inches|lbs?|mt|mts|m|kg|kgs|gr|g|lt|lts|l|ml|w|kw|hp|v|volts?|hz|a|amp|mah|ah|bar|psi|rpm|db|lux|lm|°c|ºc|grados|pulg|pulgadas|"|plazas?|nudos?|hilos?|micras?|gsm|g\/m2|litros?|watts?)\b/gi;

export function pareceTenerEspecificaciones(texto: string | null | undefined): boolean {
  const t = String(texto ?? '');
  if (t.length < 80) return false;
  const palabras = new Set((t.match(PALABRAS_TECNICAS) || []).map(x => norm(x)));
  const unidades = (t.match(UNIDADES) || []).length + (t.match(/\b\d+(?:[.,]\d+)?\s?[x×]\s?\d+(?:[.,]\d+)?\b/gi) || []).length;   // «150 x 200» también es una medida
  const pares = (t.match(/^[^\n:|]{2,40}\s*[:|]\s*\S[^\n]{0,120}$/gm) || []).length;   // «Potencia: 2000 W» / «Material | acero»
  // Tres señales distintas de «hay datos técnicos»: palabras técnicas distintas, medidas con unidad y renglones nombre:valor.
  if (palabras.size >= 3 && (unidades >= 2 || pares >= 3)) return true;
  if (palabras.size >= 2 && unidades >= 3) return true;   // prosa: «tela de 300 g/m2, medidas 150 x 200 cm, color azul…»
  if (palabras.size >= 5) return true;
  return unidades >= 6 && pares >= 3;
}

// ── Qué hacer con cada producto de la cotización ───────────────────────────────────────────────────
export type DestinoProductoCotizacion = 'ficha' | 'solo_precio';
/** Para mostrar/registrar: por qué un producto de la cotización fue o no fue a fichas. */
export function destinoDeProducto(p: ProductoLector | undefined, minimo = MIN_ESPECIFICACIONES): { destino: DestinoProductoCotizacion; motivo: string } {
  if (productoTraeEspecificaciones(p, minimo)) return { destino: 'ficha', motivo: `Trae ${especificacionesDe(p).length} características técnicas: va también a Fichas técnicas.` };
  return { destino: 'solo_precio', motivo: 'La cotización no trae especificaciones técnicas de este producto (solo su descripción y precio): sirve para el precio.' };
}

/** Nombre de proveedor limpio y utilizable (no el provisorio «(por completar) …» ni «(proveedor del catálogo)»). */
export function proveedorUtilizable(nombre: string | null | undefined): string | null {
  const n = String(nombre ?? '').trim();
  if (!n || /^\(/.test(n)) return null;
  return n.slice(0, 200);
}

// ── «Este documento no es una cotización: es una ficha técnica» ────────────────────────────────────
/** Palabras de un documento de VENTA. Basta una para NO tratarlo como ficha (una cotización que además trae specs sigue siendo cotización;
 *  decir «es una ficha» de una cotización real es peor que no avisar). */
const PALABRAS_DE_COTIZACION = /\b(cotizaci[oó]n|presupuesto|proforma|oferta|sub ?total|neto|total|i\.?v\.?a\.?|precio|p\. ?unit|forma de pago|condiciones de pago|validez|vigencia|despacho|flete|r\.?u\.?t\.?|factura|orden de compra|quotation|invoice|price)\b/i;
const MONTO = /(\$|US\$|USD|€|EUR|CLP)\s?\d/i;

/** true si el texto leído de un documento es una FICHA TÉCNICA y no una cotización: trae especificaciones (potencia, voltaje, garantía…) y
 *  ningún rastro de venta (ni un monto, ni «total», «IVA», «cotización», «RUT»…). Puro y barato: sirve al leer el archivo y en la fila. */
export function pareceFichaTecnicaSinCotizacion(texto: string | null | undefined): boolean {
  const t = String(texto ?? '');
  if (t.trim().length < 80) return false;
  if (MONTO.test(t) || PALABRAS_DE_COTIZACION.test(t)) return false;
  return pareceTenerEspecificaciones(t);
}

/** Marca que queda en las notas cuando una persona ya contestó la pregunta «¿es una ficha técnica?» (sí o no): el aviso no vuelve a salir. */
export const MARCA_FICHA_VALIDADA = 'Ficha técnica revisada:';
/** El documento parece una ficha técnica Y nadie ha contestado todavía la pregunta: es lo que se le pregunta al equipo. */
export function fichaPorValidar(texto: string | null | undefined, notas: string | null | undefined): boolean {
  return !String(notas ?? '').includes(MARCA_FICHA_VALIDADA) && pareceFichaTecnicaSinCotizacion(texto);
}
/** Las notas de la cotización después de contestar: sin el aviso «Ficha técnica: …» y con la marca de revisada. */
export function notasTrasValidarFicha(notas: string | null | undefined, esFicha: boolean): string {
  const resto = String(notas ?? '').split(' · ').filter(t => t.trim() && !t.startsWith('Ficha técnica:') && !t.startsWith(MARCA_FICHA_VALIDADA));
  return [...resto, `${MARCA_FICHA_VALIDADA} ${esFicha ? 'sí, es una ficha (pasada a Fichas técnicas).' : 'no, es otro documento.'}`].join(' · ');
}
