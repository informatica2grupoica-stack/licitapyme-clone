// app/lib/obuma-facturas-enlace.ts
// Lee `compra_oc_facturada_tipo_dcto` de una OC de Obuma: la lista de facturas enlazadas a la OC.
// Obuma la escribe en DOS formatos (visto en vivo, nov-2026): ",33#101006" y ",T33 # 7280216"
// (con «T» delante y espacios). Antes solo se leía el primero y la OC 4035 (ELECTROCOM, negocio 1154)
// quedaba FACTURADA en Obuma pero «sin factura» en Licitank; con «T33 » Obuma responde 0 resultados.
// Se toma tipo y folio como números, venga como venga, y se cuenta cada par una vez
// (la OC 4020 trae la misma factura en los dos formatos: ",T33 # 5039,33#5039").

export function paresFacturaDeOc(crudo: unknown): { tipoDcto: string; folioDte: string }[] {
  const vistos = new Set<string>();
  const pares: { tipoDcto: string; folioDte: string }[] = [];
  for (const m of String(crudo ?? '').matchAll(/(\d+)\s*#\s*(\d+)/g)) {
    const k = `${m[1]}#${m[2]}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    pares.push({ tipoDcto: m[1], folioDte: m[2] });
  }
  return pares;
}

/** Tipo de documento 914 del SII = Declaración de Ingreso (DIN) de una importación. Obuma lo enlaza a la OC igual que una factura
 *  (`,914#2850014688`), pero NO lo entrega por `comprasDte` (OC 3811, negocio 256): el número del DIN sale solo de este enlace. */
export const TIPO_DOC_DIN = '914';

export function dinesDeOc(crudo: unknown): string[] {
  return paresFacturaDeOc(crudo).filter(p => p.tipoDcto === TIPO_DOC_DIN).map(p => p.folioDte);
}
