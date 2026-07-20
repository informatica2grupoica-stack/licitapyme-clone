'use client';

// SELECT moderno de una sola opción — reemplaza los <select> nativos de la app.
// Mismo lenguaje visual que MultiSelect (botón + dropdown con check, punto de color
// opcional, contador opcional). Navegable con teclado: ↑/↓ mueven, Enter elige,
// Escape cierra. Cierra al hacer clic fuera.
//
// PORTALEADO a <body> a propósito (mismo patrón que Tooltip.tsx): cualquier modal con
// overflow-hidden o un contenedor con scroll interno RECORTABA el dropdown — el caso real que lo
// disparó fue el popup "Postular" (monto + empresa) y "Descartar" en negocios/[id], donde la
// lista de empresas/motivos quedaba cortada y sin scroll utilizable. Antes de parchar cada modal
// uno por uno, se corrige el componente compartido: así ningún modal futuro puede reproducir el
// mismo bug. Se posiciona en coordenadas FIJAS medidas del botón (getBoundingClientRect) y se
// recalcula en scroll/resize mientras está abierto para no quedar desalineado.
//
// Uso:
//   <Select value={orden} onChange={setOrden} icon={<ArrowUpDown size={13} />}
//     options={[{ value: 'recientes', label: 'Más recientes' }, …]} />
import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  color?: string;       // punto de color opcional (usuarios, estados…)
  count?: number;       // contador opcional a la derecha
  description?: string; // línea secundaria opcional
}

const MARGEN_VIEWPORT = 8; // separación mínima al borde inferior de la ventana

export function Select({
  value, onChange, options, placeholder = 'Seleccionar…', icon,
  minWidth = 180, align = 'left', className = '', buttonClassName = '', disabled = false,
}: {
  value: string | null | undefined;
  onChange: (next: string) => void;
  options: SelectOption[];
  placeholder?: string;
  icon?: React.ReactNode;
  minWidth?: number;
  align?: 'left' | 'right';
  className?: string;
  buttonClassName?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [foco, setFoco] = useState(-1);
  const [montado, setMontado] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);   // botón (ancla)
  const dropRef = useRef<HTMLDivElement>(null);   // dropdown portaleado
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMontado(true); }, []);

  // Recalcula la posición FIJA del dropdown desde el botón. minWidth vs ancho real del botón
  // (el mayor manda, igual que antes). maxHeight se acota al espacio real hasta el borde inferior
  // de la ventana — ya no hay contenedor que lo recorte, así que hay que respetar el viewport.
  const recalcular = useCallback(() => {
    const btn = wrapRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const width = Math.max(minWidth, r.width);
    const espacioAbajo = window.innerHeight - r.bottom - MARGEN_VIEWPORT;
    const maxHeight = Math.max(120, Math.min(288, espacioAbajo)); // 288px = max-h-72 original
    setCoords({
      left: align === 'right' ? r.right - width : r.left,
      top: r.bottom + 4,
      width,
      maxHeight,
    });
  }, [minWidth, align]);

  useEffect(() => {
    if (!open) return;
    recalcular();
    const onScrollResize = () => recalcular();
    // capture:true para escuchar el scroll de CUALQUIER ancestro (el body de un modal, no solo window).
    window.addEventListener('scroll', onScrollResize, true);
    window.addEventListener('resize', onScrollResize);
    return () => {
      window.removeEventListener('scroll', onScrollResize, true);
      window.removeEventListener('resize', onScrollResize);
    };
  }, [open, recalcular]);

  // Clic fuera: revisa TANTO el botón como el dropdown portaleado (viven en ramas del DOM distintas).
  useEffect(() => {
    if (!open) return;
    const cerrar = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (dropRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', cerrar);
    return () => document.removeEventListener('mousedown', cerrar);
  }, [open]);

  // Al abrir, el foco parte en la opción seleccionada y se hace visible.
  useEffect(() => {
    if (!open) return;
    const idx = options.findIndex(o => o.value === value);
    setFoco(idx >= 0 ? idx : 0);
    requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLElement>('[data-activo="1"]')?.scrollIntoView({ block: 'nearest' });
    });
  }, [open, options, value]);

  const elegir = (v: string) => { onChange(v); setOpen(false); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setFoco(f => Math.min(options.length - 1, f + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFoco(f => Math.max(0, f - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (options[foco]) elegir(options[foco].value); }
    else if (e.key === 'Tab') setOpen(false);
  };

  const sel = options.find(o => o.value === value) || null;

  return (
    <div className={`relative ${className}`} ref={wrapRef} onKeyDown={onKeyDown}>
      <button type="button" onClick={() => !disabled && setOpen(o => !o)} disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open}
        className={`flex items-center gap-1.5 px-3 py-2 border rounded-lg text-[13px] outline-none transition-colors w-full
          focus-visible:ring-2 focus-visible:ring-indigo-500/25
          ${disabled ? 'opacity-50 cursor-not-allowed border-slate-200 text-slate-400'
            : 'border-slate-200 text-slate-700 hover:border-slate-400 bg-white'} ${buttonClassName}`}>
        {icon && <span className="text-slate-400 flex-shrink-0">{icon}</span>}
        {sel?.color && <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: sel.color }} />}
        <span className={`flex-1 text-left truncate ${sel ? '' : 'text-slate-400'}`}>{sel?.label ?? placeholder}</span>
        <ChevronDown size={12} className={`flex-shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {montado && open && coords && createPortal(
        <div ref={dropRef} role="listbox"
          className="fixed z-[200] overflow-auto bg-white border border-slate-200 rounded-lg shadow-lg p-1 scale-in"
          style={{ left: coords.left, top: coords.top, width: coords.width, maxHeight: coords.maxHeight }}>
          <div ref={listRef}>
            {options.length === 0 ? (
              <p className="text-xs text-slate-400 px-2 py-1.5">Sin opciones</p>
            ) : options.map((o, i) => {
              const on = o.value === value;
              return (
                <button key={o.value} type="button" role="option" aria-selected={on}
                  data-activo={on ? '1' : undefined}
                  onClick={() => elegir(o.value)}
                  onMouseEnter={() => setFoco(i)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] text-left transition-colors
                    ${i === foco ? 'bg-slate-100' : ''} ${on ? 'font-semibold' : ''}`}>
                  {o.color && <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: o.color }} />}
                  <span className="text-slate-700 flex-1 min-w-0">
                    <span className="block truncate">{o.label}</span>
                    {o.description && <span className="block text-[11px] font-normal text-slate-400 truncate">{o.description}</span>}
                  </span>
                  {o.count != null && <span className="text-[11px] font-semibold text-slate-400 tabular-nums">{o.count}</span>}
                  {on && <Check size={13} className="text-indigo-600 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
