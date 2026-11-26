// app/lib/obuma-factura-neto.ts
// Neto («costo») de una factura de compra, sin base de datos ni red para poder probarlo.
//
// Dividir el total por 1,19 solo sirve cuando TODO es afecto a IVA. Una factura de combustible trae además el impuesto específico, que va
// exento de IVA (OC 4058: neto 35.810 + impuesto 7.537 + IVA 6.804 = 50.151; ÷ 1,19 daba 42.144 y no 43.347). Para el proyecto el costo
// es total − IVA, igual que `netoDeCompra` de la OC; así OC y factura cuadran con o sin impuesto.

export interface FacturaParaNeto { total: number | null; iva?: number | null }
export interface OcParaNeto { total: number | null; iva: number | null }

export function netoDeFactura(f: FacturaParaNeto, oc?: OcParaNeto | null): number {
  const total = f.total ?? 0;
  if (f.iva != null) return Math.round(total - f.iva);                       // el IVA que dice la propia factura (Obuma: dte_total_iva)
  // Facturas guardadas antes de leer el IVA: si valen lo mismo que la OC (±$1), la OC ya dice cuánto IVA lleva.
  if (oc && oc.total != null && oc.iva != null && Math.abs(total - oc.total) <= 1) return Math.round(oc.total - oc.iva);
  return Math.round(total / 1.19);
}
