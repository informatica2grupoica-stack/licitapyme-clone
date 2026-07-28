'use client';

// Ficha de especificación de un KPI/medidor: qué mide, cómo se calcula (desde/hasta EXACTO) y
// de qué tabla sale. Antes esto solo vivía en el código — un perfil que ve "Mediana triage: 4d"
// no tenía forma de saber si son días desde la asignación hasta la viabilidad, hasta un cambio
// de estado, o qué. El ícono ⓘ es SIEMPRE visible (no como un title nativo, que nadie ve venir)
// y al tocarlo muestra la especificación completa.
//
// PORTALEADO a <body> (mismo patrón que MultiSelect/Tooltip): evita que una tarjeta con
// overflow-hidden recorte la ficha.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

export interface EspecificacionMetrica {
  mide: string;      // qué representa el número, en una frase — sin jerga técnica
  calculo: string;   // la lógica EXACTA: desde qué evento hasta cuál, con qué regla
  fuente?: string;   // tabla(s)/columna(s) de origen, para quien sí quiera el detalle técnico
  nota?: string;      // aviso o gotcha conocido (ej. "no cuenta las descartadas")
}

const ANCHO = 300;
const MARGEN = 10;

export function MetricInfo({ spec, tono = 'claro' }: { spec: EspecificacionMetrica; tono?: 'claro' | 'oscuro' }) {
  const [open, setOpen] = useState(false);
  const [montado, setMontado] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMontado(true); }, []);

  const recalcular = useCallback(() => {
    const b = btnRef.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    const espacioDerecha = window.innerWidth - r.left;
    const left = espacioDerecha < ANCHO + MARGEN
      ? Math.max(MARGEN, r.right - ANCHO)
      : Math.min(r.left, window.innerWidth - ANCHO - MARGEN);
    const espacioAbajo = window.innerHeight - r.bottom;
    const top = espacioAbajo < 180 ? Math.max(MARGEN, r.top - 8) : r.bottom + 6;
    setCoords({ left, top });
  }, []);

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
      if (btnRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', cerrar);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', cerrar); document.removeEventListener('keydown', escape); };
  }, [open]);

  return (
    <>
      <button ref={btnRef} type="button"
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen(o => !o); }}
        className={`inline-flex items-center justify-center w-4 h-4 rounded-full flex-shrink-0 transition-colors ${
          tono === 'oscuro'
            ? `${open ? 'text-white bg-white/20' : 'text-white/40 hover:text-white hover:bg-white/15'}`
            : `${open ? 'text-indigo-600 bg-indigo-50' : 'text-slate-300 hover:text-indigo-500 hover:bg-indigo-50'}`
        }`}
        aria-label="Cómo se mide esto">
        <Info size={12.5} />
      </button>
      {montado && open && coords && createPortal(
        <div ref={popRef}
          className="fixed z-[300] bg-slate-900 text-white rounded-xl shadow-2xl ring-1 ring-white/10 p-3.5"
          style={{ left: coords.left, top: coords.top, width: ANCHO }}>
          <p className="font-bold text-white text-[12px] mb-2 flex items-center gap-1.5 uppercase tracking-wide">
            <Info size={12} className="text-indigo-300" /> Cómo se mide
          </p>
          <dl className="space-y-2 text-[12.5px] leading-relaxed">
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-wide text-indigo-300 mb-0.5">Mide</dt>
              <dd className="text-slate-200">{spec.mide}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-wide text-indigo-300 mb-0.5">Cálculo exacto</dt>
              <dd className="text-slate-200">{spec.calculo}</dd>
            </div>
            {spec.fuente && (
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-wide text-indigo-300 mb-0.5">Fuente</dt>
                <dd className="text-slate-400 font-mono text-[11px] break-words">{spec.fuente}</dd>
              </div>
            )}
          </dl>
          {spec.nota && (
            <p className="mt-2.5 pt-2.5 border-t border-white/10 text-amber-300 text-[11.5px] leading-snug">{spec.nota}</p>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
