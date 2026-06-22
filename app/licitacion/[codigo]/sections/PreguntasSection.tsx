// app/licitacion/[codigo]/sections/PreguntasSection.tsx
'use client';

import { HelpCircle, ExternalLink, MessageCircle } from 'lucide-react';
import { AlertBanner, SectionHeader } from '../utils';

export function PreguntasSection({ mpUrl }: { mpUrl: string }) {
  return (
    <div className="space-y-4 fade-in">
      <SectionHeader
        icon={<HelpCircle size={18} />}
        title="Preguntas Licitación"
        subtitle="Foro de preguntas y respuestas del proceso"
      />

      <AlertBanner tipo="info" titulo="Foro no disponible vía API">
        Mercado Público no expone públicamente el foro de preguntas y respuestas a través de su API.
        Por ahora puedes revisar las preguntas directamente en el sitio de Mercado Público.
      </AlertBanner>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-10 text-center">
          <div className="w-14 h-14 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <MessageCircle size={24} className="text-indigo-400" />
          </div>
          <h3 className="text-[15px] font-bold text-slate-800 mb-1.5">Preguntas y respuestas</h3>
          <p className="text-[13px] text-slate-500 mb-5 max-w-sm mx-auto leading-relaxed">
            Estamos trabajando para traer el historial de preguntas de los proveedores directamente a esta sección.
            Mientras tanto, revísalas en el portal oficial.
          </p>
          <a href={mpUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold rounded-xl transition-colors shadow-sm">
            <ExternalLink size={13} /> Ver en Mercado Público
          </a>
        </div>
      </div>
    </div>
  );
}
