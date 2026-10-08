// Navegación entre pasos del módulo de Compras desde cualquier tarjeta (ej. «Ir a crear proveedor» desde una compra directa).
// El stepper de ComprasChrome escucha 'compras:ir'; la acción pendiente (qué hacer al llegar) se deja en memoria del navegador
// para que la pestaña destino, que recién se monta, la consuma una sola vez.

export type FaseCompras = 'tareas' | 'costeo' | 'aprobacion' | 'compra' | 'entrega' | 'obuma' | 'documentos' | 'actividad';
export interface AccionPendiente { accion: 'crear-proveedor'; rut?: string; nombre?: string }

const g = () => (typeof window !== 'undefined' ? (window as unknown as { __comprasPendiente?: AccionPendiente | null }) : null);

export function irAFase(fase: FaseCompras, pendiente?: AccionPendiente) {
  const w = g(); if (!w) return;
  w.__comprasPendiente = pendiente ?? null;
  window.dispatchEvent(new CustomEvent('compras:ir', { detail: { fase } }));
}

/** Devuelve (y borra) la acción que dejó otro paso; null si no hay. */
export function consumirAccionPendiente(): AccionPendiente | null {
  const w = g(); if (!w) return null;
  const p = w.__comprasPendiente ?? null;
  w.__comprasPendiente = null;
  return p;
}
