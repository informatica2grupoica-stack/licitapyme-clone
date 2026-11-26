// app/lib/compras-notas-factura.ts
// NOTAS DE CRÉDITO (restan) Y DE DÉBITO (suman) DEL PROYECTO DE OBUMA, ASOCIADAS A LA OC DE SU PROVEEDOR.
// Una factura corregida con notas no cambia en la OC de Obuma (la nota cuelga del proyecto, no de la OC), así que sin esto «lo facturado»
// de una OC anulada seguiría contando entera. Única fuente: la usan el Comparativo y la Auditoría, para que sus cifras no se separen.
// Regla: la nota va a la OC de su proveedor si ese proveedor tiene UNA sola OC con factura en el negocio, o a la OC cuya factura tenga
// el mismo monto (una nota puede venir a nombre de otra razón social: Roco Import / «Lockers Store»). Solo OC con factura enlazada.
import type { DocumentoDelProyecto } from '@/app/lib/compras-proyectos-obuma';

export interface NotaDeOc { tipo: '61' | '56'; folio: string; fecha: string | null; /** Neto con signo: la nota de crédito viene negativa. */ neto: number; /** Total CON IVA, también con signo. */ total: number; proveedor: string | null }

const nombreSimple = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
/** Obuma entrega los documentos como DD-MM-AAAA; las pantallas esperan AAAA-MM-DD. */
const fechaIso = (f: string | null): string | null => { const m = f ? /^(\d{2})-(\d{2})-(\d{4})/.exec(f) : null; return m ? `${m[3]}-${m[2]}-${m[1]}` : f; };
export const netoDeDocumento = (d: DocumentoDelProyecto) => Math.round(d.neto ?? d.total / 1.19);

/** @param ocs OC del negocio con sus facturas ya enlazadas (neto de cada una). Devuelve, por folio de OC, las notas que le tocan. */
export function asociarNotasAOc(
  documentos: DocumentoDelProyecto[],
  ocs: { folio: string; proveedor: string | null; facturasNeto: number[]; ocPropia?: boolean }[],
  /** Facturas de Obuma sin OC en este negocio: una nota de crédito de igual neto y proveedor anula ESA y no le resta nada a ninguna OC. */
  facturasSueltas: { proveedor: string | null; neto: number }[] = [],
): Map<string, NotaDeOc[]> {
  const salida = new Map<string, NotaDeOc[]>();
  const notas = documentos.filter(d => d.proveedorNombre && (d.tipo === '61' || d.tipo === '56'));
  if (!notas.length) return salida;
  const conFactura = ocs.filter(o => !o.ocPropia && o.facturasNeto.length > 0);
  const ocsDelProveedor = new Map<string, number>();
  for (const o of conFactura) ocsDelProveedor.set(nombreSimple(o.proveedor), (ocsDelProveedor.get(nombreSimple(o.proveedor)) ?? 0) + 1);
  const usada = new Set<string>();
  const sueltas = facturasSueltas.map(f => ({ ...f, usada: false }));
  for (const d of notas) {
    if (d.tipo !== '61') continue;
    const s = sueltas.find(x => !x.usada && nombreSimple(x.proveedor) === nombreSimple(d.proveedorNombre) && Math.abs(x.neto - Math.abs(netoDeDocumento(d))) <= 2);
    if (s) { s.usada = true; usada.add(`${d.tipo}|${d.folio}|${d.proveedorNombre}`); }
  }
  for (const o of conFactura) {
    const unica = ocsDelProveedor.get(nombreSimple(o.proveedor)) === 1;
    for (const d of notas) {
      if (usada.has(`${d.tipo}|${d.folio}|${d.proveedorNombre}`)) continue;
      const mismoProv = nombreSimple(d.proveedorNombre) === nombreSimple(o.proveedor);
      const igualAFactura = d.tipo === '61' && o.facturasNeto.some(n => Math.abs(Math.abs(netoDeDocumento(d)) - n) <= 2);
      if (!((mismoProv && (unica || igualAFactura)) || igualAFactura)) continue;
      usada.add(`${d.tipo}|${d.folio}|${d.proveedorNombre}`);
      const lista = salida.get(o.folio) ?? [];
      lista.push({ tipo: d.tipo as '61' | '56', folio: d.folio, fecha: fechaIso(d.fecha), neto: netoDeDocumento(d), total: Math.round(d.total), proveedor: d.proveedorNombre });
      salida.set(o.folio, lista);
    }
  }
  return salida;
}
