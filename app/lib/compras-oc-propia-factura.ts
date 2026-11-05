// app/lib/compras-oc-propia-factura.ts
// ¿Esta factura (XML del SII) corresponde a esta OC propia? Función pura, sin red ni BD (se prueba sola).
// Una OC propia la emite una empresa del grupo que no está en Obuma (Comercial MP) a otra (Inversiones Claro); la factura la emite
// el proveedor y la recibe la empresa de la OC. Se exige que los dos RUT calcen; con eso:
//  - REFERENCIA: la factura cita la OC (referencia tipo 801 «Orden de Compra») con el folio de la OC → se empareja sola.
//  - MONTO: no la cita, pero el neto es el mismo (±1 peso por redondeo) → se ofrece y hay que confirmarla.
//  - NO: no calza; se dice por qué.
import type { FacturaLeida } from '@/app/lib/factura-xml';

export interface OcParaEmparejar { folio: string; proveedorRut: string; empresaRut: string; neto: number }
export interface ResultadoEmparejo { tipo: 'REFERENCIA' | 'MONTO' | 'NO'; motivos: string[] }

/** RUT comparable: sin puntos, guion ni espacios, en mayúscula (76.902.659-2 = 769026592). */
export const rutComparable = (rut: string | null | undefined) => String(rut ?? '').replace(/[^0-9kK]/g, '').toUpperCase().replace(/^0+/, '');
/** Folio comparable: sin espacios ni ceros a la izquierda del número, en mayúscula (MP-2026-0001 = mp 2026 1). */
const folioComparable = (f: string) => f.toUpperCase().replace(/\s+/g, '').split(/[-_/.]/).map(p => /^\d+$/.test(p) ? String(Number(p)) : p).join('-');

const pesos = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;

export function emparejarFacturaConOc(factura: FacturaLeida, oc: OcParaEmparejar): ResultadoEmparejo {
  const motivos: string[] = [];
  if (rutComparable(factura.emisor.rut) !== rutComparable(oc.proveedorRut))
    motivos.push(`La factura la emite ${factura.emisor.razonSocial || 'otra empresa'} (RUT ${factura.emisor.rut || 'sin RUT'}), no el proveedor de la OC (RUT ${oc.proveedorRut}).`);
  if (rutComparable(factura.receptor.rut) !== rutComparable(oc.empresaRut))
    motivos.push(`La factura va a ${factura.receptor.razonSocial || 'otra empresa'} (RUT ${factura.receptor.rut || 'sin RUT'}), no a quien emitió la OC (RUT ${oc.empresaRut}).`);
  if (motivos.length) return { tipo: 'NO', motivos };

  const citaLaOc = factura.referencias.some(r => r.tipoDoc.trim() === '801' && folioComparable(r.folio) === folioComparable(oc.folio));
  if (citaLaOc) return { tipo: 'REFERENCIA', motivos: [`La factura cita la orden de compra ${oc.folio}.`] };

  const neto = factura.totales.neto ?? null;
  if (neto != null && Math.abs(neto - oc.neto) <= 1)
    return { tipo: 'MONTO', motivos: [`La factura no cita la orden de compra ${oc.folio}, pero el neto es el mismo (${pesos(neto)}). Confírmalo antes de emparejar.`] };

  const otras = factura.referencias.filter(r => r.tipoDoc.trim() === '801').map(r => r.folio);
  return {
    tipo: 'NO',
    motivos: [
      otras.length ? `La factura cita otra orden de compra (${otras.join(', ')}), no la ${oc.folio}.` : `La factura no cita la orden de compra ${oc.folio}.`,
      neto == null ? 'La factura no trae monto neto.' : `El neto no coincide: factura ${pesos(neto)}, OC ${pesos(oc.neto)}.`,
    ],
  };
}
