'use client';

// Pestañas/segmentos con indicador que se desliza a la opción activa (skill licitank-ui).
// `id` distingue varios grupos en la misma pantalla (layoutId compartido).
import { motion } from 'framer-motion';
import { RAPIDA, EASE_LK } from './movimiento';

export function Pestanas<T extends string>({ id, opciones, valor, onCambio }: {
  id: string;
  opciones: { valor: T; etiqueta: string; contador?: number }[];
  valor: T;
  onCambio: (v: T) => void;
}) {
  return (
    <div role="tablist" className="inline-flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800/70">
      {opciones.map(o => {
        const activa = o.valor === valor;
        return (
          <button key={o.valor} role="tab" aria-selected={activa} type="button" onClick={() => onCambio(o.valor)}
            className={`relative h-8 px-3 rounded-md text-[13px] font-medium transition-colors duration-150
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60
              ${activa ? 'text-tinta dark:text-slate-50' : 'text-tinta-2 hover:text-tinta dark:text-slate-400 dark:hover:text-slate-200'}`}>
            {activa && (
              <motion.span layoutId={`pestana-${id}`} transition={{ duration: RAPIDA * 1.6, ease: EASE_LK }}
                className="absolute inset-0 rounded-md bg-white shadow-tarjeta dark:bg-slate-900" />
            )}
            <span className="relative inline-flex items-center gap-1.5">
              {o.etiqueta}
              {o.contador !== undefined && <span className="text-xs font-semibold tabular-nums text-tinta-3">{o.contador}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
