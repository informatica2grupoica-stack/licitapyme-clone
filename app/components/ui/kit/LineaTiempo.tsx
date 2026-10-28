'use client';

// Línea de tiempo horizontal (skill licitank-ui): hitos en orden, los cumplidos con ✓ en teal,
// el próximo marcado con cuánto falta, y una barra que se llena hasta hoy. Con muchos hitos
// se desplaza de lado en vez de apretar las etiquetas.
import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { IconCheck as Check } from '@tabler/icons-react';
import { EASE_LK, NORMAL } from './movimiento';

const TZ = 'America/Santiago';

export function LineaTiempo({ hitos }: { hitos: { etiqueta: string; t: number }[] }) {
  const reducido = useReducedMotion();
  const [ahora] = useState(() => Date.now());
  const orden = [...hitos].sort((a, b) => a.t - b.t);
  const n = orden.length;
  if (n === 0) return null;
  const ultimoPasado = orden.reduce((k, h, i) => (h.t <= ahora ? i : k), -1);
  const avance = n > 1 ? Math.max(0, ultimoPasado) / (n - 1) * 100 : 0;
  const dia0 = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  const cuando = (t: number) => { const x = Math.round((dia0(t) - dia0(ahora)) / 86400000); return x === 0 ? 'hoy' : x === 1 ? 'mañana' : `en ${x} días`; };

  return (
    <div className="overflow-x-auto -mx-2 px-2 pb-1">
      <ol className="relative grid pt-1" style={{ gridTemplateColumns: `repeat(${n}, minmax(104px, 1fr))` }}>
        <span aria-hidden className="absolute top-[13px] h-0.5 rounded-full bg-slate-200 dark:bg-slate-700"
          style={{ left: `calc(100% / ${2 * n})`, right: `calc(100% / ${2 * n})` }}>
          <motion.span className="block h-full rounded-full bg-marca" initial={reducido ? false : { width: 0 }}
            animate={{ width: `${avance}%` }} transition={{ duration: 0.9, delay: 0.1, ease: EASE_LK }} />
        </span>
        {orden.map((h, i) => {
          const pasado = i <= ultimoPasado;
          const proximo = i === ultimoPasado + 1;
          return (
            <motion.li key={h.etiqueta + h.t} className="relative flex flex-col items-center text-center px-1.5"
              initial={reducido ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: NORMAL, delay: 0.05 + i * 0.04, ease: EASE_LK }}>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center ring-4 ring-white dark:ring-slate-900 ${
                pasado ? 'bg-marca text-white' : proximo ? 'bg-white border-2 border-marca dark:bg-slate-900' : 'bg-white border-2 border-slate-300 dark:bg-slate-900 dark:border-slate-600'}`}>
                {pasado ? <Check size={13} stroke={3} /> : proximo ? <span className="w-2 h-2 rounded-full bg-marca" /> : null}
              </span>
              <span className={`mt-2.5 text-xs leading-snug line-clamp-2 ${pasado ? 'text-tinta-2 dark:text-slate-400' : 'font-medium text-tinta dark:text-slate-100'}`}>{h.etiqueta}</span>
              <span className="mt-1 text-[11px] tabular-nums text-tinta-2 dark:text-slate-400">
                {new Date(h.t).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', timeZone: TZ })} · {new Date(h.t).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: TZ })}
              </span>
              {proximo && <span className="mt-0.5 text-[11px] font-medium text-marca">{cuando(h.t)}</span>}
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}
