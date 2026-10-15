'use client';

// Menú «Más acciones» para filas de tabla: la acción principal queda visible en la fila y las secundarias o peligrosas
// (renunciar, eliminar…) van aquí, diferenciadas en rojo. Teclado: Enter/Espacio abre, Esc cierra, clic fuera cierra.
// El menú se dibuja en un portal con posición fija: las tablas con scroll propio (overflow) lo recortaban.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconDots as Dots } from '@tabler/icons-react';

export interface AccionMenu { label: string; onClick: () => void; peligro?: boolean; disabled?: boolean }

const ANCHO = 190;

export function MenuAcciones({ acciones, etiqueta = 'Más acciones', texto }: { acciones: AccionMenu[]; etiqueta?: string; texto?: string }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const botonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const abierto = pos != null;

  const alternar = () => {
    if (abierto) { setPos(null); return; }
    const r = botonRef.current?.getBoundingClientRect();
    if (!r) return;
    const alto = acciones.length * 34 + 8;
    const abajo = r.bottom + 4 + alto <= window.innerHeight;
    setPos({ top: abajo ? r.bottom + 4 : Math.max(8, r.top - 4 - alto), left: Math.max(8, Math.min(r.right - ANCHO, window.innerWidth - ANCHO - 8)) });
  };

  useEffect(() => {
    if (!abierto) return;
    const cerrar = () => setPos(null);
    const fuera = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || botonRef.current?.contains(t)) return;
      cerrar();
    };
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') { cerrar(); botonRef.current?.focus(); } };
    document.addEventListener('mousedown', fuera); document.addEventListener('keydown', tecla);
    window.addEventListener('scroll', cerrar, true); window.addEventListener('resize', cerrar);
    return () => {
      document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', tecla);
      window.removeEventListener('scroll', cerrar, true); window.removeEventListener('resize', cerrar);
    };
  }, [abierto]);

  if (acciones.length === 0) return null;
  return (
    <>
      <button ref={botonRef} type="button" onClick={alternar} aria-haspopup="menu" aria-expanded={abierto} aria-label={etiqueta} title={etiqueta}
        className={`inline-flex items-center gap-1 rounded-md text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-teal-500 outline-none transition-colors ${texto ? 'px-2 py-1 text-[11.5px] font-semibold' : 'p-1 text-zinc-400'}`}>
        {texto}<Dots size={16} />
      </button>
      {abierto && pos && createPortal(
        <div ref={menuRef} role="menu" style={{ position: 'fixed', top: pos.top, left: pos.left, width: ANCHO }}
          className="z-[200] bg-white border border-zinc-200 rounded-lg shadow-lg py-1">
          {acciones.map(a => (
            <button key={a.label} type="button" role="menuitem" disabled={a.disabled} onClick={() => { setPos(null); a.onClick(); }}
              className={`w-full text-left px-3 py-1.5 text-[12.5px] font-medium disabled:opacity-50 ${a.peligro ? 'text-rose-600 hover:bg-rose-50' : 'text-zinc-700 hover:bg-zinc-50'}`}>
              {a.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
