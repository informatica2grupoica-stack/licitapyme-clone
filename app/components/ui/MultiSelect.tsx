'use client';

// Filtro de SELECCIÓN MÚLTIPLE reutilizable en toda la app (radar, negocios, analizadas,
// descartadas, historial…). Dropdown con checkboxes: permite marcar varias opciones a la vez.
// Cierra al hacer clic fuera. Soporta un punto de color por opción (p.ej. por usuario/estado).
//
// PORTALEADO a <body> (mismo patrón que Select.tsx y Tooltip.tsx): cualquier panel de filtros
// dentro de un modal con overflow-hidden o scroll interno recortaba el dropdown. Se posiciona en
// coordenadas FIJAS medidas del botón (getBoundingClientRect) y se recalcula en scroll/resize
// mientras está abierto.
import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

export interface MultiSelectOption {
  value: string;
  label: string;
  color?: string;   // punto de color opcional (usuarios, estados, semáforo…)
  count?: number;   // contador opcional a la derecha
}

const MARGEN_VIEWPORT = 8;

export function MultiSelect({
  label, options, selected, onChange, icon, minWidth = 210, align = 'left',
}: {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  icon?: React.ReactNode;
  minWidth?: number;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [montado, setMontado] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMontado(true); }, []);

  const recalcular = useCallback(() => {
    const btn = wrapRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const width = Math.max(minWidth, r.width);
    const espacioAbajo = window.innerHeight - r.bottom - MARGEN_VIEWPORT;
    const maxHeight = Math.max(120, Math.min(288, espacioAbajo));
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
    window.addEventListener('scroll', onScrollResize, true);
    window.addEventListener('resize', onScrollResize);
    return () => {
      window.removeEventListener('scroll', onScrollResize, true);
      window.removeEventListener('resize', onScrollResize);
    };
  }, [open, recalcular]);

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

  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);
  const n = selected.length;

  return (
    <div className="relative" ref={wrapRef}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 px-3 py-2 border rounded-lg text-[13px] outline-none transition-colors ${
          n ? 'border-indigo-300 bg-indigo-50 text-indigo-700 font-semibold' : 'border-slate-200 text-slate-600 hover:border-slate-400'
        }`}>
        {icon && <span className={n ? 'text-indigo-500' : 'text-slate-400'}>{icon}</span>}
        {label}
        {n > 0 && <span className="text-[11px] font-bold bg-indigo-600 text-white rounded-full px-1.5 leading-5">{n}</span>}
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {montado && open && coords && createPortal(
        <div ref={dropRef}
          className="fixed z-[200] overflow-auto bg-white border border-slate-200 rounded-lg shadow-lg p-1"
          style={{ left: coords.left, top: coords.top, width: coords.width, maxHeight: coords.maxHeight }}>
          {options.length === 0 ? (
            <p className="text-xs text-slate-400 px-2 py-1.5">Sin opciones</p>
          ) : options.map(o => {
            const on = selected.includes(o.value);
            return (
              <button key={o.value} type="button" onClick={() => toggle(o.value)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50 text-[13px] text-left">
                <span className={`w-4 h-4 flex-shrink-0 rounded border flex items-center justify-center ${on ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300'}`}>
                  {on && <Check size={11} className="text-white" />}
                </span>
                {o.color && <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: o.color }} />}
                <span className="text-slate-700 flex-1 truncate">{o.label}</span>
                {o.count != null && <span className="text-[11px] font-semibold text-slate-400 tabular-nums">{o.count}</span>}
              </button>
            );
          })}
          {n > 0 && (
            <button type="button" onClick={() => onChange([])}
              className="w-full text-left text-[11px] text-red-500 hover:bg-red-50 rounded-md px-2 py-1.5 mt-0.5">
              Limpiar selección
            </button>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
