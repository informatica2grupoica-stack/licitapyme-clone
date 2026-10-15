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

/** Lleva a la pestaña indicada del paso actual y, si hay producto, desplaza la pantalla hasta él (con reintentos: la pestaña recién se monta). */
export function enfocarProducto(pestana: string | null, productoId: number | null) {
  if (typeof window === 'undefined') return;
  if (pestana) [80, 400].forEach(ms => setTimeout(() => window.dispatchEvent(new CustomEvent('compras:pestana', { detail: { clave: pestana } })), ms));
  if (!productoId) return;
  let intentos = 0;
  const buscar = () => {
    const el = document.querySelector(`[data-testid="ficha-producto-${productoId}"], [data-producto-id="${productoId}"]`) as HTMLElement | null;
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('ring-2', 'ring-amber-400'); setTimeout(() => el.classList.remove('ring-2', 'ring-amber-400'), 4000); return; }
    if (++intentos < 12) setTimeout(buscar, 300);
  };
  setTimeout(buscar, 300);
}
