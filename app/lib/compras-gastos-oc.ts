// app/lib/compras-gastos-oc.ts
// Gastos extra que YA tienen su orden de compra en Obuma (caso real 387-55-LE26: transporte y armado
// a Los Muermos, OC 4015 por $1.400.000 neto, hecha directo en Obuma sin pasar por Licitank).
// Pura (sin base de datos) para poder probarla. Detecta, entre las OC vigentes de la licitación, las
// líneas que son un GASTO (transporte, flete, armado…) y que todavía no tienen un gasto anotado:
// así al anotar el gasto se enlaza a esa OC en vez de crear otra.

/** Líneas de una OC que son gasto y no producto. */
export const ES_LINEA_DE_GASTO = /transporte|flete|despacho|armado|palletiz|instalaci[oó]n/i;

/** Línea de combustible y línea de su impuesto específico (el impuesto se mira primero: «Impuesto especifico gasolina» dice las dos cosas). */
export const ES_LINEA_IMPUESTO_ESPECIFICO = /impuesto\s+espec[ií]fico/i;
export const ES_LINEA_COMBUSTIBLE = /combustible|gasolina|di[eé]sel|petr[oó]leo|parafina/i;

export interface LineaOcParaGasto { descripcion: string; subtotal: number | null }
export interface OcObumaParaGasto {
  folio: string; proveedor: string | null; estado: string | null; fecha: string | null;
  lineas: LineaOcParaGasto[];
  /** Costo neto de toda la OC (total − IVA: incluye el impuesto específico, esté como línea exenta o en «impuestos adicionales»). */
  netoOc?: number | null;
}
export interface OcPropiaConFlete { folio: string | null; fleteMonto: number }
export interface GastoVinculado { ocObumaFolio: string | null; monto: number }

export interface OcDisponibleParaGasto {
  folio: string; proveedor: string | null; fecha: string | null; descripcion: string; monto: number;
}

const folioClave = (f: string | null | undefined) => String(f ?? '').trim();

/** Líneas de gasto de las OC vigentes que aún no tienen gasto anotado.
 *  · Una OC anulada nunca es gasto.
 *  · El flete de una OC que emitió Licitank (fleteMonto) ya está en el plan de compra: no se ofrece, se contaría dos veces.
 *  · Una línea ya enlazada a un gasto (mismo folio y mismo monto) tampoco se vuelve a ofrecer. */
export function ocsDisponiblesParaGasto(
  ocs: OcObumaParaGasto[], propias: OcPropiaConFlete[], vinculados: GastoVinculado[],
): OcDisponibleParaGasto[] {
  const fletePropio = new Set(propias.filter(p => p.fleteMonto > 0).map(p => `${folioClave(p.folio)}|${Math.round(p.fleteMonto)}`));
  const yaVinculado = new Set(vinculados.filter(v => v.ocObumaFolio).map(v => `${folioClave(v.ocObumaFolio)}|${Math.round(v.monto)}`));
  const out: OcDisponibleParaGasto[] = [];
  for (const oc of ocs) {
    if (/anulad/i.test(oc.estado || '')) continue;
    // OC de combustible (hecha como la 4058: línea afecta + línea «IMPUESTO ESPECIFICO» exenta; o a mano con el impuesto en «impuestos adicionales»):
    // es UN gasto por su costo completo (neto + impuesto), no dos líneas sueltas.
    const esImp = (l: LineaOcParaGasto) => ES_LINEA_IMPUESTO_ESPECIFICO.test(l.descripcion);
    const esComb = (l: LineaOcParaGasto) => !esImp(l) && ES_LINEA_COMBUSTIBLE.test(l.descripcion);
    if (oc.lineas.some(esComb) && oc.lineas.every(l => esComb(l) || esImp(l))) {
      const monto = Math.round(oc.netoOc ?? oc.lineas.reduce((s, l) => s + (l.subtotal ?? 0), 0));
      const k = `${folioClave(oc.folio)}|${monto}`;
      if (monto > 0 && !yaVinculado.has(k)) out.push({ folio: folioClave(oc.folio), proveedor: oc.proveedor, fecha: oc.fecha, descripcion: 'Combustible + impuesto específico', monto });
      continue;
    }
    for (const l of oc.lineas) {
      const monto = Math.round(l.subtotal ?? 0);
      if (!(monto > 0) || !ES_LINEA_DE_GASTO.test(l.descripcion)) continue;
      const k = `${folioClave(oc.folio)}|${monto}`;
      if (fletePropio.has(k) || yaVinculado.has(k)) continue;
      out.push({ folio: folioClave(oc.folio), proveedor: oc.proveedor, fecha: oc.fecha, descripcion: l.descripcion.replace(/\s+/g, ' ').trim(), monto });
    }
  }
  return out;
}
