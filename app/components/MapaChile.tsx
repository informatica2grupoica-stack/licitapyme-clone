'use client';

// Mapa real de Chile (16 regiones) con la lista de regiones al lado y cuántos fleteros cubre cada una.
// Mapa y lista son clicables y se resaltan juntos. Contornos: © colaboradores de OpenStreetMap (ver chile-mapa-datos.ts).
import { useState } from 'react';
import { REGIONES } from '@/app/lib/chile-regiones';
import { MAPA_CHILE_ALTO, MAPA_CHILE_ANCHO, MAPA_CHILE_REGIONES } from '@/app/lib/chile-mapa-datos';

export function MapaChile({ conteo, seleccion, onElegir }: {
  conteo: Record<string, number>; seleccion: string[]; onElegir: (key: string) => void;
}) {
  const [sobre, setSobre] = useState<string | null>(null);
  const elegidas = new Set(seleccion);
  const relleno = (key: string) => elegidas.has(key) ? '#0f766e' : sobre === key ? '#2dd4bf' : (conteo[key] ?? 0) > 0 ? '#99f6e4' : '#e5e7eb';

  return (
    <div className="flex h-full gap-4">
      <svg viewBox={`0 0 ${MAPA_CHILE_ANCHO} ${MAPA_CHILE_ALTO}`} role="group" aria-label="Mapa de Chile por regiones"
        className="h-full w-auto flex-shrink-0 select-none" preserveAspectRatio="xMidYMid meet">
        {MAPA_CHILE_REGIONES.map(({ key, d }) => {
          const r = REGIONES.find(x => x.key === key)!;
          const n = conteo[key] ?? 0;
          return (
            <path key={key} d={d} fill={relleno(key)} stroke="#ffffff" strokeWidth={0.7} strokeLinejoin="round"
              className="cursor-pointer outline-none" style={{ transition: 'fill 150ms ease-out' }}
              role="button" tabIndex={0} aria-pressed={elegidas.has(key)} aria-label={`${r.nombreLargo}: ${n} fletero${n === 1 ? '' : 's'}`}
              onClick={() => onElegir(key)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onElegir(key); } }}
              onMouseEnter={() => setSobre(key)} onMouseLeave={() => setSobre(null)} onFocus={() => setSobre(key)} onBlur={() => setSobre(null)}>
              <title>{`${r.nombreLargo} — ${n} fletero${n === 1 ? '' : 's'}`}</title>
            </path>
          );
        })}
      </svg>

      <ul className="flex min-w-0 flex-1 flex-col justify-between py-1">
        {REGIONES.map(r => {
          const n = conteo[r.key] ?? 0;
          const activa = elegidas.has(r.key);
          return (
            <li key={r.key}>
              <button type="button" onClick={() => onElegir(r.key)} aria-pressed={activa}
                onMouseEnter={() => setSobre(r.key)} onMouseLeave={() => setSobre(null)} onFocus={() => setSobre(r.key)} onBlur={() => setSobre(null)}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[12px] leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 ${activa ? 'bg-marca/10 font-semibold text-marca' : sobre === r.key ? 'bg-slate-100 text-tinta dark:bg-slate-800' : 'text-tinta-2 dark:text-slate-300'}`}>
                <span className="min-w-0">{r.nombreLargo}</span>
                <span className={`flex-shrink-0 tabular-nums ${n > 0 ? 'font-semibold text-tinta dark:text-slate-100' : 'text-tinta-3'}`}>{n}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
