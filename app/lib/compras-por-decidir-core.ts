// app/lib/compras-por-decidir-core.ts
// «POR DECIDIR» — núcleo PURO (sin BD ni IA). Detecta las líneas de cotización que parecen servir para un producto pero que el pareo no asigna porque son de
// OTRO modelo o marca (la Aqua HC151+ de Koslan frente a la ProMinent BETA que piden las bases). Esa equivalencia la decide una persona: aquí solo se arma el
// caso para que decida rápido (lo pedido y lo ofrecido lado a lado, qué cambia y cuánto se ahorra).
import { conflictosMedibles, puntajeLineaProducto } from '@/app/lib/compras-cotizacion-emparejar';
import { conEquivalenciaNominal, choqueDeFamilia, type LineaPareo, type ProductoPareo } from '@/app/lib/compras-pareo-global-core';

export type Decision = 'SI_SIRVE' | 'NO_SIRVE' | 'SOLO_AQUI';

export interface CasoPorDecidir {
  /** estable entre corridas: cotización + producto + texto de la línea */
  clave: string;
  cotizacionId: number; proveedor: string;
  lineaTexto: string; lineaCantidad: number | null; lineaUnidad: string | null; precioNeto: number;
  productoId: number; productoDescripcion: string; productoCantidad: number | null;
  /** el mejor precio que el producto ya tiene en otra cotización, si lo hay */
  precioActual: number | null; proveedorActual: string | null;
  /** precioActual − precioNeto (positivo = conviene); null si el producto aún no tiene precio */
  ahorro: number | null;
  puntaje: number;
  /** lo que cambia entre lo pedido y lo ofrecido, en palabras */
  diferencias: string[];
}

export interface EntradaPorDecidir {
  productos: Array<ProductoPareo & { subestado: string }>;
  lineas: LineaPareo[];
  /** asignaciones ya guardadas */
  itemsGuardados: Array<{ cotizacionId: number; productoId: number; precioBase: number | null }>;
  proveedorDe?: (cotizacionId: number) => string;
  /** claves ya decididas (sirve, no sirve, solo aquí): no se vuelven a ofrecer */
  decididas: Set<string>;
  umbral?: number;
}

export const UMBRAL_POR_DECIDIR = 0.25;
const SE_PUEDE_MOVER = new Set(['PENDIENTE', 'COTIZANDO']);

export const claveCaso = (cotizacionId: number, productoId: number, lineaTexto: string) =>
  `${cotizacionId}:${productoId}:${String(lineaTexto).toLowerCase().replace(/[^a-z0-9áéíóúñ]+/g, ' ').trim().slice(0, 80)}`;

/** ¿La línea ya es el precio de algún producto de su cotización? (mismo precio neto guardado) */
const yaAsignada = (l: LineaPareo, items: EntradaPorDecidir['itemsGuardados']) =>
  items.some(i => i.cotizacionId === l.cotizacionId && i.precioBase != null && l.precioNeto != null && Math.abs(i.precioBase - l.precioNeto) <= Math.max(2, l.precioNeto * 0.01));

export function detectarPorDecidir(e: EntradaPorDecidir): CasoPorDecidir[] {
  const umbral = e.umbral ?? UMBRAL_POR_DECIDIR;
  const movibles = e.productos.filter(p => SE_PUEDE_MOVER.has(p.subestado));
  const mejorPorProducto = new Map<number, { precio: number; cotizacionId: number }>();
  for (const i of e.itemsGuardados) {
    if (i.precioBase == null || !(i.precioBase > 0)) continue;
    const m = mejorPorProducto.get(i.productoId);
    if (!m || i.precioBase < m.precio) mejorPorProducto.set(i.productoId, { precio: i.precioBase, cotizacionId: i.cotizacionId });
  }
  const out: CasoPorDecidir[] = [];
  for (const l of e.lineas) {
    if (l.esFlete || l.precioNeto == null || !(l.precioNeto > 0) || yaAsignada(l, e.itemsGuardados)) continue;
    let mejor: { p: (typeof movibles)[number]; puntaje: number } | null = null;
    for (const p of movibles) {
      const { puntaje, choca } = puntajeLineaProducto(l.linea, { id: p.id, descripcion: p.descripcion, cantidad: p.cantidad }, undefined, { penalizar: false });
      if (choca || puntaje < umbral) continue;
      if (choqueDeFamilia(p.descripcion, l.descripcion)) continue;   // diésel ≠ gasolina, sumergible ≠ centrífuga…: eso no es una equivalencia que se decida
      if (!mejor || puntaje > mejor.puntaje) mejor = { p, puntaje };
    }
    if (!mejor) continue;
    const clave = claveCaso(l.cotizacionId, mejor.p.id, l.descripcion);
    if (e.decididas.has(clave)) continue;
    // El producto ya tiene esta cotización asignada con otra línea del mismo proveedor: no se ofrece (ya hay una opción de este proveedor).
    if (e.itemsGuardados.some(i => i.cotizacionId === l.cotizacionId && i.productoId === mejor!.p.id)) continue;
    const actual = mejorPorProducto.get(mejor.p.id) ?? null;
    const ahorro = actual ? Math.round(actual.precio - l.precioNeto) : null;
    // Solo vale la pena decidir si el producto no tiene precio o si esta línea es más barata que la mejor que ya tiene.
    if (ahorro != null && ahorro <= 0) continue;
    const diferencias = conflictosMedibles(conEquivalenciaNominal(mejor.p.descripcion), conEquivalenciaNominal(l.descripcion)).map(c => c.texto);
    out.push({
      clave, cotizacionId: l.cotizacionId, proveedor: e.proveedorDe?.(l.cotizacionId) ?? l.proveedor,
      lineaTexto: l.descripcion, lineaCantidad: l.cantidad, lineaUnidad: l.unidad, precioNeto: Math.round(l.precioNeto),
      productoId: mejor.p.id, productoDescripcion: mejor.p.descripcion, productoCantidad: mejor.p.cantidad,
      precioActual: actual ? Math.round(actual.precio) : null, proveedorActual: actual ? (e.proveedorDe?.(actual.cotizacionId) ?? null) : null,
      ahorro, puntaje: Math.round(mejor.puntaje * 100) / 100, diferencias,
    });
  }
  // Primero lo que más ahorra; después lo que no tiene precio; dentro de cada grupo, lo más parecido.
  return out.sort((a, b) => (b.ahorro ?? -1) - (a.ahorro ?? -1) || b.puntaje - a.puntaje);
}

/** Modelo para la equivalencia de la empresa: el primer código con letras y números («HC151+», «6SR27-10»); si no hay, las 3 primeras palabras. */
export function patronDeLinea(lineaTexto: string): string {
  const t = String(lineaTexto).replace(/^\s*\d+\s+/, '').trim();
  const cod = t.match(/\b(?=[A-Z0-9+\-/.]*[A-Z])(?=[A-Z0-9+\-/.]*\d)[A-Z0-9][A-Z0-9+\-/.]{2,}/i);
  if (cod) return cod[0].replace(/[.,;]+$/, '').slice(0, 120);
  return t.split(/\s+/).slice(0, 3).join(' ').slice(0, 120);
}
