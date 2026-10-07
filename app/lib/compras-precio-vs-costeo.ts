// app/lib/compras-precio-vs-costeo.ts
// ¿LA COTIZACIÓN ES MEJOR O PEOR QUE LO COSTEADO? — comparación PURA (sin red ni BD).
//
// Lo que audita Compras en una cotización es el PRECIO contra lo que el asistente costeó al ofertar
// (el costeo es presupuesto, no meta: spec §1.3.2). La comparación técnica contra las bases es otro
// trabajo, del Auditor Técnico con la ficha del producto: una cotización normalmente ni la trae.
//
// Ambos valores son NETOS por unidad. Hasta ±1 % se considera igual (redondeos, centavos de IVA).

export type VeredictoPrecio = 'MEJOR' | 'IGUAL' | 'PEOR' | 'SIN_COMPARAR';

export interface ComparacionPrecio {
  veredicto: VeredictoPrecio;
  /** cotizado − costeado: negativo = más barata que lo costeado. */
  diffMonto: number | null;
  /** diff sobre lo costeado, en % con un decimal. */
  diffPct: number | null;
}

export function compararPrecioConCosteo(cotizadoNeto: number | null | undefined, costeadoNeto: number | null | undefined, tolerancia = 0.01): ComparacionPrecio {
  if (cotizadoNeto == null || costeadoNeto == null || !(cotizadoNeto > 0) || !(costeadoNeto > 0)) return { veredicto: 'SIN_COMPARAR', diffMonto: null, diffPct: null };
  const diffMonto = Math.round(cotizadoNeto - costeadoNeto);
  const ratio = (cotizadoNeto - costeadoNeto) / costeadoNeto;
  const diffPct = Math.round(ratio * 1000) / 10;
  const veredicto: VeredictoPrecio = Math.abs(ratio) <= tolerancia ? 'IGUAL' : ratio < 0 ? 'MEJOR' : 'PEOR';
  return { veredicto, diffMonto, diffPct };
}

const pct = (n: number) => String(n).replace('.', ',');   // en Chile el decimal es coma, y no depende del ICU del servidor
const clp = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString('es-CL')}`;

/** Desde esta diferencia (en %) el precio casi seguro no es comparable: otro producto, otra unidad o mal cargado. */
export const DIFERENCIA_SOSPECHOSA_PCT = 50;

/** Frase para la pantalla: siempre dice cuánto y en qué sentido, o qué falta para poder comparar. */
export function textoComparacionPrecio(c: ComparacionPrecio, cotizadoNeto: number | null, costeadoNeto: number | null): string {
  if (cotizadoNeto == null || !(cotizadoNeto > 0)) return 'Esta cotización no tiene un precio asignado a este producto. Asígnalo en «Asignar productos».';
  if (costeadoNeto == null || !(costeadoNeto > 0)) return 'El costeo no tiene un costo para esta línea, así que no hay contra qué comparar.';
  if (c.veredicto === 'SIN_COMPARAR' || c.diffMonto == null || c.diffPct == null) return 'No se puede comparar el precio de esta cotización con el costeo.';
  const base = `Cotizado ${clp(cotizadoNeto)} neto/u contra ${clp(costeadoNeto)} costeado`;
  const sospecha = Math.abs(c.diffPct) >= DIFERENCIA_SOSPECHOSA_PCT
    ? ' Una diferencia tan grande suele significar que la cotización es de OTRO producto, o que el precio o la unidad están mal cargados: revisa a qué producto está asignada.'
    : '';
  if (c.veredicto === 'IGUAL') return `${base}: prácticamente igual (${c.diffPct > 0 ? '+' : ''}${pct(c.diffPct)} %).`;
  return (c.veredicto === 'MEJOR'
    ? `${base}: es MÁS BARATA, ahorras ${clp(c.diffMonto)} por unidad (${pct(Math.abs(c.diffPct))} % menos).`
    : `${base}: es MÁS CARA, ${clp(c.diffMonto)} por unidad de más (${pct(c.diffPct)} % más). Negocia con el proveedor o pide otra cotización.`) + sospecha;
}

// ── Adicionales de una cotización ──────────────────────────────────────────────────────────────────
// Una cotización suele cotizar el producto "pelado" y lo demás aparte (quemador, bandejas…). El precio que
// se compara es el EFECTIVO: producto + adicionales, todo neto y por unidad del producto.

export interface AdicionalCotizacion { concepto: string; cantidad: number; precioUnitario: number }

export const totalAdicionales = (ads: AdicionalCotizacion[]): number =>
  Math.round(ads.reduce((s, a) => s + (Number.isFinite(a.cantidad) && Number.isFinite(a.precioUnitario) ? a.cantidad * a.precioUnitario : 0), 0));

/** Precio efectivo por unidad del producto. Sin precio base no hay precio efectivo (no se inventa uno solo con los adicionales). */
export function precioEfectivo(base: number | null | undefined, ads: AdicionalCotizacion[]): number | null {
  if (base == null || !Number.isFinite(base)) return null;
  return Math.round(base + totalAdicionales(ads));
}
