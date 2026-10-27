// app/lib/compras-margen-vs-costeo.ts
// MARGEN DEL COSTEO INICIAL vs MARGEN CON LAS COTIZACIONES (27-oct-2026, pedido de Carolina, que supervisa Compras).
// Antes la pantalla solo comparaba COSTOS («Resumen contra lo costeado»: costeado vs cotizado) y no decía cuánto margen tenía la
// licitación ni cuánto pasa a tener. Aquí se calcula, línea por línea y en total, con el MISMO precio de venta en los dos lados:
//   · Venta neta   = precio unitario de venta del costeo × cantidad (sin IVA).
//   · Costo inicial = lo que costeó el asistente (costo estimado neto del costeo).
//   · Costo con cotizaciones = la mejor cotización neta de la línea; si la línea no tiene cotización, se mantiene el costo costeado.
//   · Margen $ = venta − costo.  Margen % = margen / venta (sobre la venta, igual que «% Margen» del cuadro comparativo).
//   · Recargo sobre el costo % = margen / costo (es lo que el costeo llama «margen» al armar el precio: costo × (1 + recargo)).
// Solo entran las líneas que tienen precio de venta Y costo costeado; las demás se cuentan aparte para que nada se pierda en silencio.
// Puro (sin BD): lo usa la pantalla y lo prueban los tests.

export interface EntradaMargen {
  id: number; descripcion: string; cantidad: number;
  /** Precio unitario de venta del costeo (neto). */
  venta: number | null;
  /** Costo unitario costeado (neto). */
  costeo: number | null;
  /** Mejor cotización unitaria (neta); null = sin cotizar. */
  cotizado: number | null;
  proveedor: string | null;
}

export interface LineaMargen {
  id: number; descripcion: string; cantidad: number; cotizada: boolean; proveedor: string | null;
  ventaUnitaria: number; costeoUnitario: number; cotizadoUnitario: number | null;
  venta: number; costoInicial: number; costoNuevo: number;
  margenInicial: number; margenNuevo: number;
  pctInicial: number | null; pctNuevo: number | null;
  /** Variación del margen % en puntos (nuevo − inicial). */
  puntos: number | null;
}

export interface BloqueMargen {
  n: number; venta: number; costoInicial: number; costoNuevo: number;
  margenInicial: number; margenNuevo: number;
  pctInicial: number | null; pctNuevo: number | null; puntos: number | null;
  recargoInicial: number | null; recargoNuevo: number | null;
}

export interface ResumenMargen {
  lineas: LineaMargen[];
  total: BloqueMargen; cotizadas: BloqueMargen; sinCotizar: BloqueMargen;
  /** Líneas con costeo pero sin precio de venta: no entran al margen. */
  sinVenta: number;
  /** Líneas sin costo costeado: no entran al margen. */
  sinCosteo: number;
  /** Líneas que empeoran con la cotización (la mejor cotización es más cara que lo costeado). */
  conMenosMargen: number;
}

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (a: number, b: number) => (b > 0 ? r1((a / b) * 100) : null);

function bloque(ls: LineaMargen[]): BloqueMargen {
  const venta = ls.reduce((s, l) => s + l.venta, 0);
  const costoInicial = ls.reduce((s, l) => s + l.costoInicial, 0);
  const costoNuevo = ls.reduce((s, l) => s + l.costoNuevo, 0);
  const margenInicial = venta - costoInicial, margenNuevo = venta - costoNuevo;
  const pi = pct(margenInicial, venta), pn = pct(margenNuevo, venta);
  return {
    n: ls.length, venta, costoInicial, costoNuevo, margenInicial, margenNuevo,
    pctInicial: pi, pctNuevo: pn, puntos: pi != null && pn != null ? r1(pn - pi) : null,
    recargoInicial: pct(margenInicial, costoInicial), recargoNuevo: pct(margenNuevo, costoNuevo),
  };
}

export function margenCosteoVsCotizaciones(entradas: EntradaMargen[]): ResumenMargen {
  const lineas: LineaMargen[] = [];
  let sinVenta = 0, sinCosteo = 0;
  for (const e of entradas) {
    if (e.costeo == null || !(e.costeo > 0)) { sinCosteo++; continue; }
    if (e.venta == null || !(e.venta > 0)) { sinVenta++; continue; }
    const q = e.cantidad > 0 ? e.cantidad : 1;
    const cotizada = e.cotizado != null && e.cotizado > 0;
    const venta = r0(e.venta * q), costoInicial = r0(e.costeo * q), costoNuevo = cotizada ? r0((e.cotizado as number) * q) : costoInicial;
    const margenInicial = venta - costoInicial, margenNuevo = venta - costoNuevo;
    const pi = pct(margenInicial, venta), pn = pct(margenNuevo, venta);
    lineas.push({
      id: e.id, descripcion: e.descripcion, cantidad: q, cotizada, proveedor: cotizada ? e.proveedor : null,
      ventaUnitaria: e.venta, costeoUnitario: e.costeo, cotizadoUnitario: cotizada ? (e.cotizado as number) : null,
      venta, costoInicial, costoNuevo, margenInicial, margenNuevo, pctInicial: pi, pctNuevo: pn,
      puntos: pi != null && pn != null ? r1(pn - pi) : null,
    });
  }
  return {
    lineas, total: bloque(lineas), cotizadas: bloque(lineas.filter(l => l.cotizada)), sinCotizar: bloque(lineas.filter(l => !l.cotizada)),
    sinVenta, sinCosteo, conMenosMargen: lineas.filter(l => l.cotizada && l.margenNuevo < l.margenInicial).length,
  };
}
