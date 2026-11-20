'use client';

// Torta con leyenda (skill licitank-ui). Un gráfico solo sirve si se entiende QUÉ mide: por eso lleva título y
// descripción fuera (en la tarjeta que lo contiene), el total al centro y una leyenda con cantidad y % de cada tajada.
// Interactiva: al pasar el mouse por una tajada o por su fila de la leyenda se resalta (la otra se atenúa) y el centro
// muestra ese valor; si se pasa `onElegir`, el clic filtra (y vuelve a tocar para quitar).
import { useState } from 'react';

export interface TajadaDona { clave: string; etiqueta: string; valor: number; color: string }

export function Dona({ tajadas, centroValor, centroTexto, elegido, onElegir, descripcion, formato }: {
  tajadas: TajadaDona[];
  centroValor: string;
  centroTexto: string;
  elegido?: string;
  onElegir?: (clave: string) => void;
  /** Lectura del gráfico para lectores de pantalla. */
  descripcion: string;
  /** Cómo mostrar cada valor (p. ej. montos «$12,4 MM»). Por defecto, el número tal cual. */
  formato?: (n: number) => string;
}) {
  const fmt = formato ?? ((n: number) => String(n));
  const [sobre, setSobre] = useState<string | null>(null);
  const R = 52, C = 2 * Math.PI * R;
  const visibles = tajadas.filter(t => t.valor > 0);
  const total = visibles.reduce((s, t) => s + t.valor, 0);
  const arcos = visibles.map((t, i) => ({
    t,
    largo: total ? (t.valor / total) * C : 0,
    // Donde empieza cada tajada = suma de las anteriores.
    desde: visibles.slice(0, i).reduce((s, x) => s + (total ? (x.valor / total) * C : 0), 0),
  }));
  const foco = sobre ?? (elegido || null);
  const enFoco = foco ? visibles.find(t => t.clave === foco) : undefined;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="relative h-[132px] w-[132px] flex-shrink-0">
        <svg viewBox="0 0 132 132" className="h-full w-full -rotate-90" role="img" aria-label={descripcion}>
          <circle cx="66" cy="66" r={R} fill="none" strokeWidth="16" className="stroke-slate-100 dark:stroke-slate-800" />
          {arcos.map(({ t, largo, desde }) => (
            <circle key={t.clave} cx="66" cy="66" r={R} fill="none" stroke={t.color}
              strokeWidth={sobre === t.clave ? 21 : 16}
              strokeDasharray={`${Math.max(largo - (arcos.length > 1 ? 1.5 : 0), 0)} ${C}`}
              strokeDashoffset={-desde}
              opacity={foco && foco !== t.clave ? 0.25 : 1}
              className={`transition-[opacity,stroke-width] duration-150 ${onElegir ? 'cursor-pointer' : ''}`}
              onMouseEnter={() => setSobre(t.clave)} onMouseLeave={() => setSobre(null)}
              onClick={() => onElegir?.(elegido === t.clave ? '' : t.clave)}>
              <title>{`${t.etiqueta}: ${fmt(t.valor)}`}</title>
            </circle>
          ))}
        </svg>
        {/* El hueco del anillo mide ~88 px: px-7 deja el texto dentro aunque el nombre sea largo. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-7 text-center">
          <span className={`${(enFoco ? fmt(enFoco.valor) : centroValor).length > 6 ? 'text-[15px]' : 'text-[22px]'} font-semibold leading-none tracking-tight tabular-nums text-tinta dark:text-slate-50`}
            style={enFoco ? { color: enFoco.color } : undefined}>
            {enFoco ? fmt(enFoco.valor) : centroValor}
          </span>
          <span className="mt-1 line-clamp-2 break-words text-[10.5px] leading-tight text-tinta-2 dark:text-slate-400">
            {enFoco ? enFoco.etiqueta : centroTexto}
          </span>
        </div>
      </div>
      <ul className="min-w-[180px] max-w-md flex-1 space-y-0.5">
        {visibles.map(t => {
          const fila = (
            <>
              <span aria-hidden style={{ backgroundColor: t.color }} className="h-2 w-2 flex-shrink-0 rounded-full" />
              <span className="flex-1 truncate text-tinta dark:text-slate-100">{t.etiqueta}</span>
              <span className="font-semibold tabular-nums text-tinta dark:text-slate-100">{fmt(t.valor)}</span>
              <span className="w-10 text-right text-xs tabular-nums text-tinta-2 dark:text-slate-400">{Math.round((t.valor / total) * 100)} %</span>
            </>
          );
          const resaltada = foco === t.clave;
          const base = `flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[13px] transition-colors ${resaltada ? 'bg-slate-50 dark:bg-slate-800' : ''}`;
          return (
            <li key={t.clave} onMouseEnter={() => setSobre(t.clave)} onMouseLeave={() => setSobre(null)}>
              {onElegir ? (
                <button type="button" onClick={() => onElegir(elegido === t.clave ? '' : t.clave)} aria-pressed={elegido === t.clave}
                  className={`${base} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60`}>
                  {fila}
                </button>
              ) : (
                <div className={base}>{fila}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
