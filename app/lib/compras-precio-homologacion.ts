// app/lib/compras-precio-homologacion.ts
// PRECIO QUE SE GUARDA PARA CADA PRODUCTO AL HOMOLOGAR UNA COTIZACIÓN (pura, con pruebas).
//
// BUG REAL (24-sep-2026, negocio #994, proforma de PanTai): la factura solo trae luminancímetros,
// pero la IA también devolvió "calibración" (sin precio propio, "no incluye"). La cuenta hacía
// `Number(it.precioUnitarioAsignado)` y Number(null) es 0 — así que la calibración quedó guardada
// con precio $0. Ese $0 se mostró como "PanTai: $0" en el cuadro comparativo y armó un "espacio de
// negociación" falso de $0 a $1.304.770. Un producto sin precio propio NO tiene precio $0: tiene
// "sin precio".
export interface EntradaPrecioIA {
  /** Lo que devolvió la IA en `precioUnitarioAsignado`: número, null, texto… lo que sea. */
  precioUnitarioAsignado: unknown;
  /** Tipo de cambio congelado al registrar la cotización; null si el documento venía en CLP. */
  tipoCambio: number | null;
  /** Precio unitario CLP de la cotización completa (cabecera). */
  precioClpCotizacion: number | null;
  /** Cuántos productos asignó la IA a ESTA cotización. */
  totalItemsAsignados: number;
}

/** Precio CLP a guardar, o null = "sin precio".
 *  · precio propio (>0): se convierte con el tipo de cambio si el documento no era CLP;
 *  · sin precio propio y la cotización cubre UN solo producto: el precio de la cabecera es el de ese
 *    producto (caso de siempre: "precio único");
 *  · sin precio propio y la cotización cubre VARIOS: null. Copiarle el precio de la cabecera a un
 *    producto que el documento no precia sería inventar. */
export function precioClpDeItemIA(e: EntradaPrecioIA): number | null {
  const bruto = e.precioUnitarioAsignado;
  const propio = bruto == null || bruto === '' || typeof bruto === 'boolean' ? NaN : Number(bruto);
  if (Number.isFinite(propio) && propio > 0) {
    const clp = e.tipoCambio ? Math.round(propio * e.tipoCambio) : propio;
    return Number.isFinite(clp) ? clp : null;
  }
  if (e.totalItemsAsignados <= 1) {
    const c = e.precioClpCotizacion;
    return c != null && Number.isFinite(c) ? c : null;
  }
  return null;
}
