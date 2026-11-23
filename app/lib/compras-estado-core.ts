// app/lib/compras-estado-core.ts
// Estado de la compra de cada licitación ganada (pedido del dueño, 23-nov-2026). Sin base de datos: lo usan servidor y pantallas.
//   Abierta → En proceso → Entregada → Cerrada → Pagada   (o Cancelada, siempre con motivo)
// Entregada NO es cerrada: se cierra (pestaña «Cerradas») al estar facturada al cliente. Cerrada todavía NO es pagada: pasa a «Pagadas»
// solo cuando alguien confirma el pago con el botón «Marcar pagada» (pedido del dueño, 23-nov-2026).
// Mientras esté Abierta, el encargado no puede hacer nada más: primero la pasa a En proceso.
export type EstadoCompra = 'ABIERTA' | 'EN_PROCESO' | 'ENTREGADA' | 'CERRADA' | 'PAGADA' | 'CANCELADA';

export const ETIQUETA_ESTADO_COMPRA: Record<EstadoCompra, string> = {
  ABIERTA: 'Abierta', EN_PROCESO: 'En proceso', ENTREGADA: 'Entregada', CERRADA: 'Cerrada', PAGADA: 'Pagada', CANCELADA: 'Cancelada',
};

export const MIN_MOTIVO_CANCELACION = 15;

/** Lo que manda es el cierre ya existente (cierre «ENTREGADA» = Cerrada, y Pagada solo si la columna lo confirma; cancelada = «NO_REALIZADA» u «OC_CANCELADA»); la columna cuenta para lo abierto. */
export function estadoCompraEfectivo(cierreLegado: string | null | undefined, columna: string | null | undefined): EstadoCompra {
  if (cierreLegado === 'ENTREGADA') return columna === 'PAGADA' ? 'PAGADA' : 'CERRADA';
  if (cierreLegado === 'NO_REALIZADA' || cierreLegado === 'OC_CANCELADA') return 'CANCELADA';
  if (columna === 'EN_PROCESO' || columna === 'ENTREGADA') return columna;
  return 'ABIERTA';
}

const SIGUIENTE: Partial<Record<EstadoCompra, EstadoCompra>> = { ABIERTA: 'EN_PROCESO', EN_PROCESO: 'ENTREGADA', ENTREGADA: 'CERRADA', CERRADA: 'PAGADA' };
export const siguienteEstadoCompra = (e: EstadoCompra): EstadoCompra | null => SIGUIENTE[e] ?? null;
export const puedeCancelarseDesde = (e: EstadoCompra): boolean => e === 'ABIERTA' || e === 'EN_PROCESO' || e === 'ENTREGADA';
