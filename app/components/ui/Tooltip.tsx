'use client';

// Tooltip flotante para el sidebar colapsado (y cualquier icono suelto).
//
// PORTALEADO a <body> a propósito: el <nav> del sidebar tiene overflow-y-auto, así que un
// tooltip renderizado dentro se recortaría contra su borde. Se posiciona en coordenadas fijas
// medidas del ancla (getBoundingClientRect) en el momento de abrirlo.
//
// Solo aparece en escritorio (>=1024px): en móvil el sidebar nunca se colapsa y no hay hover
// real — un tooltip ahí solo estorbaría al tocar.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';

export function Tooltip({ label, children, disabled = false }: {
  label: string;
  children: React.ReactNode;
  disabled?: boolean;   // true = se comporta como un envoltorio transparente (sidebar expandido)
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);
  const [montado, setMontado] = useState(false);

  // createPortal necesita document: solo tras montar en el cliente.
  useEffect(() => { setMontado(true); }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const abrir = useCallback(() => {
    if (disabled || !ref.current) return;
    if (!window.matchMedia('(min-width: 1024px)').matches) return;
    const r = ref.current.getBoundingClientRect();
    // Pequeño retardo: al recorrer el menú de arriba abajo no se dispara uno por cada icono.
    timer.current = setTimeout(() => setCoords({ x: r.right + 10, y: r.top + r.height / 2 }), 60);
  }, [disabled]);

  const cerrar = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setCoords(null);
  }, []);

  // Al colapsar/expandir, cualquier tooltip abierto queda apuntando a una posición vieja.
  useEffect(() => { if (disabled) cerrar(); }, [disabled, cerrar]);

  return (
    <>
      <span ref={ref} onMouseEnter={abrir} onMouseLeave={cerrar} onFocus={abrir} onBlur={cerrar}>
        {children}
      </span>
      {montado && createPortal(
        <AnimatePresence>
          {coords && (
            <motion.div
              role="tooltip"
              initial={{ opacity: 0, x: -8, scale: 0.94 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: -6, scale: 0.96, transition: { duration: 0.12 } }}
              transition={{ type: 'spring', stiffness: 520, damping: 32, mass: 0.6 }}
              style={{ position: 'fixed', left: coords.x, top: coords.y, translateY: '-50%', zIndex: 80 }}
              className="pointer-events-none select-none whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5
                         text-[12.5px] font-semibold text-white shadow-xl ring-1 ring-white/10"
            >
              {/* Punta: un cuadrado rotado pegado al borde izquierdo. */}
              <span className="absolute left-[-3px] top-1/2 -translate-y-1/2 h-2 w-2 rotate-45 rounded-[2px] bg-slate-900" />
              {label}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
