'use client';

// KPI del sistema (skill licitank-ui): rótulo, número grande que sube al cargar, variación
// con texto (nunca solo color) y, si hay serie, una línea chica de tendencia.
import { motion } from 'framer-motion';
import { useContador } from '@/app/lib/use-contador';
import { item } from './movimiento';

function Tendencia({ serie }: { serie: number[] }) {
  const min = Math.min(...serie), max = Math.max(...serie);
  const rango = max - min || 1;
  const pts = serie.map((v, i) => `${(i / (serie.length - 1)) * 100},${28 - ((v - min) / rango) * 24}`).join(' ');
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="w-24 h-8 text-marca/70" aria-hidden>
      <motion.polyline
        points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke"
        strokeLinecap="round" strokeLinejoin="round"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.7, ease: 'easeOut' }}
      />
    </svg>
  );
}

export function Indicador({ rotulo, valor, formato, variacion, detalle, serie }: {
  rotulo: string;
  valor: number;
  formato?: (n: number) => string;
  /** Variación en % contra el periodo anterior (positivo = sube). */
  variacion?: number;
  /** Texto bajo el número: "vs. septiembre", "de 42 postuladas". */
  detalle?: string;
  serie?: number[];
}) {
  const animado = Math.round(useContador(valor));
  const texto = formato ? formato(animado) : new Intl.NumberFormat('es-CL').format(animado);
  const sube = (variacion ?? 0) >= 0;
  return (
    <motion.div variants={item}
      className="rounded-xl border border-linea bg-white px-4 py-3.5 shadow-tarjeta dark:bg-slate-900 dark:border-slate-800">
      <div className="text-[13px] text-tinta-2 dark:text-slate-400">{rotulo}</div>
      <div className="mt-1.5 flex items-end justify-between gap-3">
        <div className="text-[26px] leading-none font-semibold tracking-tight tabular-nums text-tinta dark:text-slate-50">
          {texto}
        </div>
        {serie && serie.length > 1 && <Tendencia serie={serie} />}
      </div>
      {(variacion !== undefined || detalle) && (
        <div className="mt-2 text-xs text-tinta-2 dark:text-slate-400 tabular-nums">
          {variacion !== undefined && (
            <span className={`font-medium ${sube ? 'text-exito' : 'text-urgente'}`}>
              {sube ? '↑' : '↓'} {Math.abs(variacion).toLocaleString('es-CL', { maximumFractionDigits: 1 })}%
            </span>
          )}
          {variacion !== undefined && detalle && ' '}
          {detalle}
        </div>
      )}
    </motion.div>
  );
}
