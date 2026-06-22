// app/licitacion/[codigo]/sections/PostulacionSection.tsx
'use client';

import { Send, CheckCircle, Clock, FileText, Rocket } from 'lucide-react';
import { AlertBanner, SectionHeader } from '../utils';

const ETAPAS = [
  { icon: <FileText size={16} />, label: 'Preparación', desc: 'Reúne los documentos requeridos y redacta tu propuesta técnica y económica.' },
  { icon: <Send size={16} />, label: 'Presentación', desc: 'Sube tu oferta en el portal de Mercado Público antes de la fecha de cierre.' },
  { icon: <Clock size={16} />, label: 'Evaluación', desc: 'El organismo evalúa las ofertas según los criterios publicados.' },
  { icon: <CheckCircle size={16} />, label: 'Resultado', desc: 'Se notifica la adjudicación o declaración de desierta.' },
];

export function PostulacionSection() {
  return (
    <div className="space-y-4 fade-in">
      <SectionHeader
        icon={<Send size={18} />}
        title="Postulación"
        subtitle="Seguimiento del estado de tu oferta"
      />

      <AlertBanner tipo="info" titulo="Próximamente">
        Estamos construyendo el seguimiento de postulaciones: podrás registrar el estado de tu oferta,
        adjuntar tu propuesta y recibir alertas sobre el resultado del proceso.
      </AlertBanner>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Banner */}
        <div className="px-6 py-8 text-center border-b border-slate-100">
          <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Rocket size={28} className="text-indigo-400" />
          </div>
          <h3 className="text-[15px] font-bold text-slate-800 mb-1.5">Seguimiento de postulación</h3>
          <p className="text-[13px] text-slate-500 max-w-sm mx-auto leading-relaxed">
            Pronto podrás marcar esta licitación como &quot;En preparación&quot;, &quot;Enviada&quot; o &quot;Adjudicada&quot; y llevar
            un registro de tu proceso de postulación.
          </p>
        </div>

        {/* Etapas del proceso */}
        <div className="p-6">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Proceso de postulación</p>
          <div className="relative">
            <div className="absolute left-4 top-4 bottom-4 w-px bg-slate-100" />
            <div className="space-y-4">
              {ETAPAS.map((etapa, i) => (
                <div key={i} className="flex gap-4 pl-10 relative">
                  <div className="absolute left-0 top-0 w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                    {etapa.icon}
                  </div>
                  <div className="pb-1">
                    <p className="text-[13px] font-semibold text-slate-700">{etapa.label}</p>
                    <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{etapa.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
