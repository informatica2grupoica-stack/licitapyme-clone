'use client';
// Cierra un modal con la tecla Esc (los modales de Compras solo cerraban con el clic de afuera o la «X»: quien navega con teclado quedaba atrapado).
// Va al principio del componente, antes de cualquier return, como todo hook.
import { useEffect } from 'react';

export function useCerrarConEsc(cerrar: () => void, activo = true) {
  useEffect(() => {
    if (!activo) return;
    const alTeclear = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar(); };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [cerrar, activo]);
}
