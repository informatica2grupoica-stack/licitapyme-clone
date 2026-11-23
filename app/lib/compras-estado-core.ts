// app/lib/compras-estado-core.ts
// Estado de la compra de cada licitación ganada (pedido del dueño, 23-nov-2026). Sin base de datos: lo usan servidor y pantallas.
//   Abierta → En proceso → Entregada → Pagada   (o Cancelada, siempre con motivo)
// Entregada NO es cerrada: la licitación se cierra (pestaña «Cerradas») cuando está facturada al cliente y pagada.
// Mientras esté Abierta, el encargado no puede hacer nada más: primero la pasa a En proceso.
export type EstadoCompra = 'ABIERTA' | 'EN_PROCESO' | 'ENTREGADA' | 'PAGADA' | 'CANCELADA';

export const ETIQUETA_ESTADO_COMPRA: Record<EstadoCompra, string> = {
  ABIERTA: 'Abierta', EN_PROCESO: 'En proceso', ENTREGADA: 'Entregada', PAGADA: 'Pagada', CANCELADA: 'Cancelada',
};

export const MIN_MOTIVO_CANCELACION = 15;

/** Lo que manda es el cierre ya existente (pagada = cierre «ENTREGADA»; cancelada = «NO_REALIZADA» u «OC_CANCELADA»); la columna solo cuenta para lo abierto. */
export function estadoCompraEfectivo(cierreLegado: string | null | undefined, columna: string | null | undefined): EstadoCompra {
  if (cierreLegado === 'ENTREGADA') return 'PAGADA';
  if (cierreLegado === 'NO_REALIZADA' || cierreLegado === 'OC_CANCELADA') return 'CANCELADA';
  if (columna === 'EN_PROCESO' || columna === 'ENTREGADA') return columna;
  return 'ABIERTA';
}

const SIGUIENTE: Partial<Record<EstadoCompra, EstadoCompra>> = { ABIERTA: 'EN_PROCESO', EN_PROCESO: 'ENTREGADA', ENTREGADA: 'PAGADA' };
export const siguienteEstadoCompra = (e: EstadoCompra): EstadoCompra | null => SIGUIENTE[e] ?? null;
export const puedeCancelarseDesde = (e: EstadoCompra): boolean => e === 'ABIERTA' || e === 'EN_PROCESO' || e === 'ENTREGADA';
