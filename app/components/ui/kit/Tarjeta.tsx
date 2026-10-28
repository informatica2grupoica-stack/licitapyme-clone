'use client';

// Tarjeta, dato rotulado y estado con punto (skill licitank-ui).
// Una tarjeta = un objeto que se abre. Sin barra de color lateral, sin cajas dentro de cajas.
//
// Uso:
//   <Tarjeta tinte={getEstadoPipeline(id).color} onClick={abrir}>
//     <h3 …>{nombre}</h3>
//     <Datos><Dato rotulo="Etapa"><Estado color={c}>Asignado</Estado></Dato></Datos>
//   </Tarjeta>
// Dentro de <Lista> (Aparecer.tsx) entra escalonada sola.
import { motion } from 'framer-motion';
import { item, transicion } from './movimiento';

const BASE = 'group relative w-full text-left rounded-xl border px-4 py-3.5 shadow-tarjeta '
  + 'transition-[box-shadow,transform,background-color,border-color] duration-150 ease-lk '
  + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60';
const NEUTRA = 'bg-white border-linea dark:bg-slate-900 dark:border-slate-800';
const TEÑIDA = 'bg-[color-mix(in_srgb,var(--tinte)_6%,white)] border-[color-mix(in_srgb,var(--tinte)_24%,white)] '
  + 'dark:bg-[color-mix(in_srgb,var(--tinte)_10%,#0f172a)] dark:border-[color-mix(in_srgb,var(--tinte)_30%,#0f172a)]';
const CLICKEABLE = 'cursor-pointer hover:shadow-tarjeta-hover hover:-translate-y-px';

export function Tarjeta({ children, tinte, onClick, layout, className = '' }: {
  children: React.ReactNode;
  /** true en listas que se filtran o reordenan: la tarjeta se desliza a su nuevo lugar. */
  layout?: boolean;
  /** Color hex de la etapa/categoría: tiñe suave el fondo y el borde. */
  tinte?: string;
  onClick?: () => void;
  className?: string;
}) {
  const clases = `${BASE} ${tinte ? TEÑIDA : NEUTRA} ${onClick ? CLICKEABLE : ''} ${className}`;
  const estilo = tinte ? ({ '--tinte': tinte } as React.CSSProperties) : undefined;
  const mov = { variants: item, layout, exit: { opacity: 0, scale: 0.98, transition: transicion } };
  if (onClick) {
    return (
      <motion.button type="button" {...mov} onClick={onClick} style={estilo} className={clases}>
        {children}
      </motion.button>
    );
  }
  return <motion.div {...mov} style={estilo} className={clases}>{children}</motion.div>;
}

/** Grilla de datos rotulados al pie de la tarjeta. */
export function Datos({ children, columnas = 2 }: { children: React.ReactNode; columnas?: 2 | 3 | 4 }) {
  const cols = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' }[columnas];
  return (
    <dl className={`mt-3 pt-3 border-t border-linea/80 dark:border-slate-800 grid ${cols} gap-x-4 gap-y-2.5`}>
      {children}
    </dl>
  );
}

/** Cada dato dice qué es: rótulo pequeño arriba, valor abajo. Si no hay valor, no se muestra. */
export function Dato({ rotulo, children }: { rotulo: string; children?: React.ReactNode }) {
  if (children === undefined || children === null || children === '') return null;
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-tinta-2/80 dark:text-slate-400">{rotulo}</dt>
      <dd className="mt-0.5 text-[13px] font-medium text-tinta dark:text-slate-100 truncate tabular-nums">{children}</dd>
    </div>
  );
}

/** Estado como texto con punto de color. Reemplaza cualquier pastilla. */
export function Estado({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden style={{ backgroundColor: color }} className="w-1.5 h-1.5 rounded-full flex-shrink-0" />
      {children}
    </span>
  );
}
