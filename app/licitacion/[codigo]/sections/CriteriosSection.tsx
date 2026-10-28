// app/licitacion/[codigo]/sections/CriteriosSection.tsx
'use client';

// Criterios de evaluación (pestaña dentro de Resumen, en /negocios/[id] y /licitacion/[codigo]).
// Estilo bento (skill licitank-ui): reparto del puntaje en una barra, «dónde se gana» destacado y
// una tarjeta por criterio con su peso en anillo. La pestaña Viabilidad sigue usando CriteriosEvaluacionV4.
import { motion, useReducedMotion } from 'framer-motion';
import { IconChartBar as BarChart3, IconFileSearch as FileSearch, IconTrophy as Trophy, IconAlertTriangle as AlertTriangle } from '@tabler/icons-react';
import { CriterioEvaluacion } from '@/app/types/search.types';
import { AnalisisIA, IABadge } from '../utils';
import { DocScanLoader } from '@/app/components/ui/DocScanLoader';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Vacio } from '@/app/components/ui/kit/Estructura';
import { EASE_LK } from '@/app/components/ui/kit/movimiento';
import { CLASE } from './viabilidad-v4-bloques';
import { Cita, mayus, oracion } from './viabilidad-v4-comun';

/* eslint-disable @typescript-eslint/no-explicit-any */
const SERIE = ['#0f766e', '#475569', '#d97706', '#0891b2', '#16a34a', '#ea580c', '#db2777', '#78716c'];
const BLOQUE = 'bg-white border border-linea rounded-2xl shadow-tarjeta p-5 dark:bg-slate-900 dark:border-slate-800';
const pondDe = (c: any) => Number(c.ponderacion_efectiva) || Number(c.ponderacion_nominal) || Number(c.ponderacion) || Number(c.ponderacion_pct) || 0;
const claseDe = (c: any) => CLASE[String(c?.clase || '').toUpperCase()];

function Anillo({ pond, color }: { pond: number; color: string }) {
  const reducido = useReducedMotion();
  return (
    <span className="relative w-12 h-12 flex-shrink-0">
      <svg viewBox="0 0 36 36" className="w-12 h-12 -rotate-90" aria-hidden>
        <circle cx="18" cy="18" r="15" fill="none" strokeWidth="3.5" className="stroke-slate-100 dark:stroke-slate-800" />
        <motion.circle cx="18" cy="18" r="15" fill="none" strokeWidth="3.5" strokeLinecap="round" stroke={color}
          initial={reducido ? false : { pathLength: 0 }} animate={{ pathLength: Math.min(100, pond) / 100 }}
          transition={{ duration: 0.8, delay: 0.1, ease: EASE_LK }} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[12px] font-semibold tabular-nums text-tinta dark:text-slate-100">{Math.round(pond)}%</span>
    </span>
  );
}

export function CriteriosSection({ criterios, analisisIA, criteriosViabilidad, analizandoIA, onIrAInteligencia }: {
  criterios?: CriterioEvaluacion[];
  analisisIA?: AnalisisIA | null;
  // Criterios del informe de Viabilidad IA. El v3 usa `ponderacion_efectiva` (la ponderación
  // REAL, factor×subfactor); el v2 usaba `ponderacion`. Se aceptan ambas formas.
  criteriosViabilidad?: Array<{ nombre: string; ponderacion?: number; ponderacion_efectiva?: number; ponderacion_nominal?: number; ponderacion_pct?: number; forma_aplicacion?: string; fuente?: string; [k: string]: unknown }>;
  analizandoIA?: boolean;
  onIrAInteligencia: () => void;
}) {
  const reducido = useReducedMotion();
  const criteriosIA = analisisIA?.criteriosEvaluacion;
  // Los criterios del informe de viabilidad se pasan completos (clase, cita, puntaje mínimo…): la vista usa lo que traiga cada uno.
  const criteriosViab = (criteriosViabilidad || []).filter(c => c && c.nombre);

  const tieneCriteriosMP   = !!criterios && criterios.length > 0;
  // La Viabilidad IA es el análisis más reciente y completo (se re-genera en cada re-análisis), así
  // que manda sobre el análisis genérico guardado, que queda viejo.
  const tieneCriteriosViab = !tieneCriteriosMP && criteriosViab.length > 0;
  const tieneCriteriosIA   = !tieneCriteriosMP && !tieneCriteriosViab && !!criteriosIA && criteriosIA.length > 0;

  if (!tieneCriteriosMP && !tieneCriteriosIA && !tieneCriteriosViab) {
    if (analizandoIA) {
      return (
        <div className={`${BLOQUE} text-center py-10`}>
          <div className="flex justify-center mb-4"><DocScanLoader /></div>
          <p className="text-sm font-medium text-tinta dark:text-slate-100">Analizando las bases…</p>
          <p className="mt-1 text-[13px] text-tinta-2 dark:text-slate-400">Estamos buscando los criterios de evaluación en los documentos de esta licitación.</p>
        </div>
      );
    }
    return (
      <Vacio icono={<BarChart3 size={28} stroke={1.5} />} titulo="Sin criterios informados"
        texto="Mercado Público no informó los criterios de forma estructurada y el análisis automático no los encontró en los documentos."
        accion={<Boton variante="primario" tamano="sm" icono={<FileSearch size={15} />} onClick={onIrAInteligencia}>Extraer criterios de las bases</Boton>} />
    );
  }

  const lista: any[] = tieneCriteriosMP ? criterios! : tieneCriteriosViab ? criteriosViab : criteriosIA!;
  const esExtraidoIA = tieneCriteriosIA || tieneCriteriosViab;
  const ordenados = [...lista].sort((a, b) => pondDe(b) - pondDe(a));
  const suma = ordenados.reduce((a, c) => a + pondDe(c), 0);
  const sumaValida = Math.round(suma) === 100;
  const critLey = ordenados.find(c => claseDe(c)?.ley);

  return (
    <div className="space-y-3">
      {/* ── Reparto del puntaje ── */}
      <section className={BLOQUE}>
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-[15px] font-semibold text-tinta dark:text-slate-100">Reparto del puntaje</h3>
            <p className="text-xs text-tinta-2 dark:text-slate-400 mt-0.5">Mientras más alto el porcentaje, más pesa en la decisión.</p>
          </div>
          <div className="flex items-center gap-3">
            {esExtraidoIA && <span className="inline-flex items-center gap-1.5 text-xs text-tinta-2 dark:text-slate-400" title="Mercado Público no informó los criterios de forma estructurada; se extrajeron de las bases.">Extraídos de las bases <IABadge /></span>}
            <span className={`text-[13px] font-medium tabular-nums ${sumaValida ? 'text-exito' : 'text-alerta'}`}>
              Suma {Math.round(suma)} %{sumaValida ? ' ✓' : ' · revisar las bases'}
            </span>
          </div>
        </div>
        <div className="flex h-3 rounded-full overflow-hidden bg-slate-100 dark:bg-slate-800 gap-0.5" aria-hidden>
          {ordenados.map((c, i) => (
            <motion.span key={i} className="h-full" style={{ background: SERIE[i % SERIE.length] }}
              initial={reducido ? false : { width: 0 }} animate={{ width: `${pondDe(c) / Math.max(100, suma) * 100}%` }}
              transition={{ duration: 0.7, delay: i * 0.05, ease: EASE_LK }} />
          ))}
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
          {ordenados.map((c, i) => (
            <li key={i} className="inline-flex items-center gap-1.5 text-xs text-tinta-2 dark:text-slate-400">
              <span aria-hidden className="w-2 h-2 rounded-sm" style={{ background: SERIE[i % SERIE.length] }} />
              {oracion(c.nombre)} <span className="font-semibold tabular-nums text-tinta dark:text-slate-100">{pondDe(c)} %</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Dónde se gana (criterio que se decide por mejor valor) ── */}
      {critLey && (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 flex items-start gap-3 dark:bg-emerald-950/30 dark:border-emerald-900">
          <span className="w-9 h-9 rounded-xl bg-white text-exito flex items-center justify-center flex-shrink-0 shadow-tarjeta dark:bg-slate-900"><Trophy size={18} /></span>
          <div className="min-w-0">
            <p className="text-[13px] text-emerald-800 dark:text-emerald-300">{claseDe(critLey).label} · dónde se gana</p>
            <p className="mt-0.5 text-[15px] font-semibold text-tinta dark:text-slate-50">{oracion(critLey.nombre)} · {pondDe(critLey)} %</p>
            <p className="mt-1 text-[13px] text-tinta-2 dark:text-slate-300">{claseDe(critLey).tip}</p>
          </div>
        </section>
      )}

      {/* ── Un bloque por criterio ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {ordenados.map((c, i) => {
          const cl = claseDe(c);
          const detalle = c.forma_aplicacion || c.descripcion || c.fuente;
          return (
            <motion.section key={i} className={`${BLOQUE} flex flex-col gap-3`}
              initial={reducido ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: Math.min(i, 10) * 0.04, ease: EASE_LK }}>
              <div className="flex items-start gap-3">
                <Anillo pond={pondDe(c)} color={SERIE[i % SERIE.length]} />
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className="text-[14px] font-semibold text-tinta dark:text-slate-100 leading-snug">{oracion(c.nombre)}</p>
                  <div className="mt-1 flex items-center gap-x-3 gap-y-1 flex-wrap text-xs text-tinta-2 dark:text-slate-400">
                    {cl && <span className="inline-flex items-center gap-1.5 cursor-help" title={cl.tip}><span aria-hidden className={`w-1.5 h-1.5 rounded-full ${cl.ley ? 'bg-exito' : 'bg-slate-400'}`} />{cl.label}</span>}
                    {!cl && c.tipo && <span>{mayus(String(c.tipo).toLowerCase())}</span>}
                    {c.tramo_max_puntaje?.borde_comodo && <span title="Valor que da el máximo puntaje con menos riesgo">Valor cómodo: <span className="font-medium text-tinta dark:text-slate-200">{c.tramo_max_puntaje.borde_comodo}</span></span>}
                  </div>
                </div>
              </div>
              {cl && <p className="text-[13px] text-tinta-2 dark:text-slate-300 leading-snug"><span className="font-medium text-tinta dark:text-slate-100">{cl.ley ? 'Cómo se gana: ' : 'Cómo puntúa: '}</span>{cl.tip}</p>}
              {detalle && <p className="text-xs text-tinta-2 dark:text-slate-400 leading-relaxed whitespace-pre-line">{mayus(detalle)}</p>}
              {c.puntaje_minimo?.valor && (
                <p className="flex items-start gap-1.5 text-[13px] text-urgente"><AlertTriangle size={15} className="flex-shrink-0 mt-px" />Puntaje mínimo: {c.puntaje_minimo.valor} {c.puntaje_minimo.unidad || ''} — {c.puntaje_minimo.consecuencia}</p>
              )}
              {c.cita && <div className="mt-auto"><Cita cita={c.cita} /></div>}
            </motion.section>
          );
        })}
      </div>
    </div>
  );
}
