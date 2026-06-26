// app/licitacion/[codigo]/sections/CriteriosSection.tsx
'use client';

import { BarChart3, Sparkles, Loader2 } from 'lucide-react';
import { CriterioEvaluacion } from '@/app/types/search.types';
import { AlertBanner, SectionHeader, AnalisisIA, IABadge } from '../utils';

const COLORS = [
  'bg-indigo-500', 'bg-violet-500', 'bg-cyan-500', 'bg-emerald-500',
  'bg-amber-500', 'bg-rose-500', 'bg-blue-500', 'bg-teal-500',
];
const TEXT_COLORS = [
  'text-indigo-600', 'text-violet-600', 'text-cyan-600', 'text-emerald-600',
  'text-amber-600', 'text-rose-600', 'text-blue-600', 'text-teal-600',
];

export function CriteriosSection({ criterios, analisisIA, criteriosViabilidad, analizandoIA, onIrAInteligencia }: {
  criterios?: CriterioEvaluacion[];
  analisisIA?: AnalisisIA | null;
  // Criterios del informe de Viabilidad IA v2.0 (forma: ponderacion + forma_aplicacion + fuente).
  criteriosViabilidad?: Array<{ nombre: string; ponderacion?: number; ponderacion_pct?: number; forma_aplicacion?: string; fuente?: string }>;
  analizandoIA?: boolean;
  onIrAInteligencia: () => void;
}) {
  const criteriosIA = analisisIA?.criteriosEvaluacion;
  // Normalizamos los criterios del informe de viabilidad al shape común. La descripción
  // prioriza la FORMA DE APLICACIÓN (lo valioso del v2.0) y cae a la fuente si no hay.
  const criteriosViab: CriterioEvaluacion[] = (criteriosViabilidad || [])
    .filter(c => c && c.nombre)
    .map(c => ({ nombre: c.nombre, ponderacion: Number(c.ponderacion ?? c.ponderacion_pct) || 0, descripcion: c.forma_aplicacion || c.fuente }));

  const tieneCriteriosMP   = !!criterios && criterios.length > 0;
  const tieneCriteriosIA   = !tieneCriteriosMP && !!criteriosIA && criteriosIA.length > 0;
  const tieneCriteriosViab = !tieneCriteriosMP && !tieneCriteriosIA && criteriosViab.length > 0;

  if (!tieneCriteriosMP && !tieneCriteriosIA && !tieneCriteriosViab) {
    return (
      <div className="space-y-4 fade-in">
        <SectionHeader
          icon={<BarChart3 size={18} />}
          title="Criterios de Evaluación"
          subtitle="Ponderación de la evaluación de ofertas"
        />

        {analizandoIA ? (
          <AlertBanner tipo="info" titulo="Analizando bases con IA...">
            Estamos revisando los documentos de esta licitación para extraer los criterios de evaluación automáticamente.
          </AlertBanner>
        ) : (
          <AlertBanner tipo="info" titulo="Sin criterios informados">
            Mercado Público no informó los criterios de evaluación de forma estructurada para esta licitación, y la IA
            no encontró criterios en los documentos analizados. Puedes intentar extraerlos manualmente desde Inteligencia.
          </AlertBanner>
        )}

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-10 text-center">
          <div className="w-14 h-14 bg-purple-50 rounded-full flex items-center justify-center mx-auto mb-4">
            {analizandoIA
              ? <Loader2 size={24} className="text-purple-400 animate-spin" />
              : <BarChart3 size={24} className="text-purple-400" />}
          </div>
          <h3 className="text-sm font-semibold text-slate-800 mb-1.5">Criterios de evaluación</h3>
          <p className="text-xs text-slate-500 mb-4 max-w-sm mx-auto">
            Analiza las bases de licitación con IA para identificar los criterios de evaluación y su ponderación.
          </p>
          <button
            onClick={onIrAInteligencia}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm"
          >
            <Sparkles size={13} /> Extraer criterios con IA
          </button>
        </div>
      </div>
    );
  }

  const criteriosMostrados = tieneCriteriosMP ? criterios!
    : tieneCriteriosIA ? criteriosIA!
    : criteriosViab;
  const esExtraidoIA = tieneCriteriosIA || tieneCriteriosViab;
  const total = criteriosMostrados.reduce((acc, c) => acc + (c.ponderacion || 0), 0) || 100;

  return (
    <div className="space-y-4 fade-in">
      <SectionHeader
        icon={<BarChart3 size={18} />}
        title="Criterios de Evaluación"
        subtitle="Ponderación de la evaluación de ofertas"
        badge={<span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs rounded-full font-semibold">{criteriosMostrados.length}</span>}
      />

      {esExtraidoIA && (
        <AlertBanner tipo="info" titulo="Criterios extraídos por IA">
          <div className="flex items-center gap-2 flex-wrap">
            <span>Mercado Público no informó los criterios de forma estructurada. Estos fueron extraídos automáticamente desde las bases.</span>
            <IABadge />
          </div>
        </AlertBanner>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        {/* Barra apilada */}
        <div className="flex w-full h-3 rounded-full overflow-hidden bg-slate-100 mb-5">
          {criteriosMostrados.map((c, i) => (
            <div
              key={i}
              className={`${COLORS[i % COLORS.length]} h-full transition-all slide-in-up`}
              style={{ width: `${((c.ponderacion || 0) / total) * 100}%`, animationDelay: `${i * 60}ms` }}
              title={`${c.nombre}: ${c.ponderacion}%`}
            />
          ))}
        </div>

        {/* Leyenda */}
        <div className="space-y-3">
          {criteriosMostrados.map((c, i) => (
            <div key={i} className="flex items-start gap-3 slide-in-up" style={{ animationDelay: `${i * 60}ms` }}>
              <span className={`w-3 h-3 rounded-full flex-shrink-0 mt-0.5 ${COLORS[i % COLORS.length]}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <p className="text-[13px] font-semibold text-slate-800">{c.nombre}</p>
                  <p className={`text-[13px] font-bold flex-shrink-0 tabular-nums ${TEXT_COLORS[i % TEXT_COLORS.length]}`}>
                    {c.ponderacion}%
                  </p>
                </div>
                {/* Progress bar per criterion */}
                <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${COLORS[i % COLORS.length]} opacity-60 rounded-full`}
                    style={{ width: `${((c.ponderacion || 0) / total) * 100}%` }}
                  />
                </div>
                {c.descripcion && <p className="text-xs text-slate-500 mt-1">{c.descripcion}</p>}
              </div>
            </div>
          ))}
        </div>

        {/* Total */}
        <div className="mt-4 pt-3 border-t border-slate-100 flex justify-between items-center">
          <span className="text-xs text-slate-400 font-medium">Total ponderación</span>
          <span className={`text-sm font-bold tabular-nums ${total === 100 ? 'text-emerald-600' : 'text-amber-600'}`}>
            {total}%
            {total !== 100 && <span className="text-[10px] ml-1 font-normal">(revisar)</span>}
          </span>
        </div>
      </div>
    </div>
  );
}
