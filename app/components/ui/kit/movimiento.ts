// Movimiento del sistema de diseño (skill licitank-ui). Dos duraciones y una curva, las
// mismas que --ease-lk en globals.css. El movimiento explica un cambio; nunca decora.
import type { Transition, Variants } from 'framer-motion';

export const EASE_LK = [0.22, 1, 0.36, 1] as const;
export const RAPIDA = 0.15; // hover, presionar, abrir menú
export const NORMAL = 0.25; // entrar a la pantalla, reacomodar listas

export const transicion: Transition = { duration: NORMAL, ease: EASE_LK };

// Lista que aparece escalonada: el contenedor usa `lista`, cada hijo `item`.
export const lista: Variants = {
  oculto: {},
  visible: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
};
export const item: Variants = {
  oculto: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: transicion },
};
