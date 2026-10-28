'use client';

// Botón del sistema (skill licitank-ui). Tres variantes, dos tamaños. El sólido es teal,
// nunca índigo. Presionar lo hunde 1 px; sin brillos ni degradados.
import { forwardRef } from 'react';

type Variante = 'primario' | 'secundario' | 'fantasma' | 'peligro';

const VARIANTES: Record<Variante, string> = {
  primario:   'bg-marca text-white hover:bg-marca-fuerte shadow-tarjeta',
  secundario: 'bg-white text-tinta border border-linea hover:bg-slate-50 hover:border-slate-300 shadow-tarjeta '
    + 'dark:bg-slate-900 dark:text-slate-100 dark:border-slate-700 dark:hover:bg-slate-800',
  fantasma:   'text-tinta-2 hover:bg-slate-100 hover:text-tinta dark:text-slate-300 dark:hover:bg-slate-800',
  peligro:    'bg-white text-urgente border border-red-200 hover:bg-red-50 dark:bg-slate-900 dark:border-red-900',
};

export const Boton = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: Variante;
  tamano?: 'sm' | 'md';
  icono?: React.ReactNode;
}>(function Boton({ variante = 'secundario', tamano = 'md', icono, className = '', children, ...props }, ref) {
  const tam = tamano === 'sm' ? 'h-8 px-3 text-[13px] gap-1.5' : 'h-9 px-3.5 text-sm gap-2';
  return (
    <button
      ref={ref}
      {...props}
      className={`inline-flex items-center justify-center rounded-lg font-medium whitespace-nowrap
        transition-[background-color,border-color,color,transform] duration-150 ease-lk active:translate-y-px
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 focus-visible:ring-offset-1
        disabled:opacity-50 disabled:pointer-events-none ${tam} ${VARIANTES[variante]} ${className}`}
    >
      {icono}
      {children}
    </button>
  );
});
