'use client';

// Filtro de SELECCIÓN MÚLTIPLE reutilizable en toda la app (radar, negocios, analizadas,
// descartadas, historial…). Dropdown con checkboxes: permite marcar varias opciones a la vez.
// Cierra al hacer clic fuera. Soporta un punto de color por opción (p.ej. por usuario/estado).
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface MultiSelectOption {
  value: string;
  label: string;
  color?: string;   // punto de color opcional (usuarios, estados, semáforo…)
  count?: number;   // contador opcional a la derecha
}

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
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const cerrar = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', cerrar);
    return () => document.removeEventListener('mousedown', cerrar);
  }, [open]);

  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);
  const n = selected.length;

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 px-3 py-2 border rounded-lg text-[13px] outline-none transition-colors ${
          n ? 'border-indigo-300 bg-indigo-50 text-indigo-700 font-semibold' : 'border-slate-200 text-slate-600 hover:border-slate-400'
        }`}>
        {icon && <span className={n ? 'text-indigo-500' : 'text-slate-400'}>{icon}</span>}
        {label}
        {n > 0 && <span className="text-[11px] font-bold bg-indigo-600 text-white rounded-full px-1.5 leading-5">{n}</span>}
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className={`absolute z-40 mt-1 max-h-72 overflow-auto bg-white border border-slate-200 rounded-lg shadow-lg p-1 ${align === 'right' ? 'right-0' : 'left-0'}`}
          style={{ minWidth }}>
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
        </div>
      )}
    </div>
  );
}
