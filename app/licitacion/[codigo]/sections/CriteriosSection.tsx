// app/licitacion/[codigo]/sections/CriteriosSection.tsx
'use client';

import { IconChartBar as BarChart3, IconSparkles as Sparkles } from '@tabler/icons-react';
import { CriterioEvaluacion } from '@/app/types/search.types';
import { AlertBanner, SectionHeader, AnalisisIA, IABadge } from '../utils';
import { DocScanLoader } from '@/app/components/ui/DocScanLoader';
import { CriteriosEvaluacionV4 } from './viabilidad-v4-bloques';

export function CriteriosSection({ criterios, analisisIA, criteriosViabilidad, analizandoIA, onIrAInteligencia }: {
  criterios?: CriterioEvaluacion[];
  analisisIA?: AnalisisIA | null;
  // Criterios del informe de Viabilidad IA. El v3 usa `ponderacion_efectiva` (la ponderación
  // REAL, factor×subfactor); el v2 usaba `ponderacion`. Se aceptan ambas formas.
  criteriosViabilidad?: Array<{ nombre: string; ponderacion?: number; ponderacion_efectiva?: number; ponderacion_nominal?: number; ponderacion_pct?: number; forma_aplicacion?: string; fuente?: string; [k: string]: unknown }>;
  analizandoIA?: boolean;
  onIrAInteligencia: () => void;
}) {
  const criteriosIA = analisisIA?.criteriosEvaluacion;
  // Los criterios del informe de viabilidad se pasan completos (clase, cita, puntaje mínimo…): la vista usa lo que traiga cada uno.
  const criteriosViab = (criteriosViabilidad || []).filter(c => c && c.nombre);

  const tieneCriteriosMP   = !!criterios && criterios.length > 0;
  // La Viabilidad IA es el análisis más reciente y completo (se re-genera en cada re-análisis), así
  // que manda sobre el análisis genérico guardado, que queda viejo.
  const tieneCriteriosViab = !tieneCriteriosMP && criteriosViab.length > 0;
  const tieneCriteriosIA   = !tieneCriteriosMP && !tieneCriteriosViab && !!criteriosIA && criteriosIA.length > 0;

  if (!tieneCriteriosMP && !tieneCriteriosIA && !tieneCriteriosViab) {
    return (
      <div className="space-y-4 fade-in">
        <SectionHeader
          icon={<BarChart3 size={18} />}
          title="Criterios de Evaluación"
          subtitle="Ponderación de la evaluación de ofertas"
        />

        {analizandoIA ? (
          <AlertBanner tipo="info" titulo="Analizando las bases...">
            Estamos revisando los documentos de esta licitación para extraer los criterios de evaluación automáticamente.
          </AlertBanner>
        ) : (
          <AlertBanner tipo="info" titulo="Sin criterios informados">
            Mercado Público no informó los criterios de evaluación de forma estructurada para esta licitación, y el análisis
            automático no encontró criterios en los documentos analizados. Puedes intentar extraerlos preguntándole a ankIA.
          </AlertBanner>
        )}

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-10 text-center">
          {analizandoIA ? (
            <div className="flex justify-center mb-4"><DocScanLoader /></div>
          ) : (
            <div className="w-14 h-14 bg-purple-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <BarChart3 size={24} className="text-purple-400" />
            </div>
          )}
          <h3 className="text-sm font-semibold text-slate-800 mb-1.5">Criterios de evaluación</h3>
          <p className="text-xs text-slate-500 mb-4 max-w-sm mx-auto">
            Analiza las bases de licitación para identificar los criterios de evaluación y su ponderación.
          </p>
          <button
            onClick={onIrAInteligencia}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm"
          >
            <Sparkles size={13} /> Extraer criterios automáticamente
          </button>
        </div>
      </div>
    );
  }

  const criteriosMostrados: object[] = tieneCriteriosMP ? criterios! : tieneCriteriosViab ? criteriosViab : criteriosIA!;
  const esExtraidoIA = tieneCriteriosIA || tieneCriteriosViab;

  return (
    <div className="space-y-4 fade-in">
      {esExtraidoIA && (
        <AlertBanner tipo="info" titulo="Criterios extraídos de las bases">
          <div className="flex items-center gap-2 flex-wrap">
            <span>Mercado Público no informó los criterios de forma estructurada. Estos fueron extraídos automáticamente desde las bases.</span>
            <IABadge />
          </div>
        </AlertBanner>
      )}
      <CriteriosEvaluacionV4 criterios={criteriosMostrados} i={0} />
    </div>
  );
}
