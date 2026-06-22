// app/licitacion/[codigo]/sections/FechasSection.tsx
'use client';

import { Calendar, Check, Clock } from 'lucide-react';
import { formatDateTime, SectionHeader } from '../utils';

export interface FechaItem {
  label: string;
  fecha?: string | null;
}

export function FechasSection({ fechas }: { fechas: FechaItem[] }) {
  const now = new Date();
  const proxima = fechas.find(f => f.fecha && new Date(f.fecha) > now);

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Calendar size={18} />}
        title="Fechas"
        subtitle="Cronograma del proceso de licitación"
        badge={fechas.length > 0 && (
          <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs rounded-full font-semibold">{fechas.length}</span>
        )}
      />

      {fechas.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-10 text-center fade-in">
          <Calendar size={28} className="text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-600 mb-1">Sin fechas informadas</p>
          <p className="text-xs text-slate-400">Mercado Público no informó un cronograma para esta licitación.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden fade-in">
          {proxima && (
            <div className="px-5 py-3 bg-indigo-50 border-b border-indigo-100 flex items-center gap-2">
              <Clock size={13} className="text-indigo-500 flex-shrink-0" />
              <span className="text-xs text-indigo-700 font-medium">
                Próxima fecha: <strong>{proxima.label}</strong> · {formatDateTime(proxima.fecha)}
              </span>
            </div>
          )}
          <div className="p-5">
            <div className="relative">
              <div className="absolute left-2.5 top-0 bottom-0 w-px bg-slate-200" />
              <div className="space-y-5">
                {fechas.map((f, i) => {
                  if (!f.fecha) return null;
                  const d = new Date(f.fecha);
                  const pasada = d < now;
                  const esSiguiente = f === proxima;
                  return (
                    <div key={i} className="flex gap-4 pl-8 relative slide-in-up" style={{ animationDelay: `${i * 40}ms` }}>
                      <div className={`absolute left-0 top-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                        pasada
                          ? 'bg-indigo-600 border-indigo-600'
                          : esSiguiente
                          ? 'bg-white border-indigo-400 ring-2 ring-indigo-100'
                          : 'bg-white border-slate-300'
                      }`}>
                        {pasada && <Check size={10} className="text-white" />}
                        {esSiguiente && <span className="w-2 h-2 rounded-full bg-indigo-400" />}
                      </div>
                      <div>
                        <p className={`text-[11px] font-bold uppercase tracking-wider mb-0.5 ${
                          pasada ? 'text-slate-400' : esSiguiente ? 'text-indigo-600' : 'text-slate-500'
                        }`}>{f.label}</p>
                        <p className={`text-[13px] font-medium ${pasada ? 'text-slate-500' : 'text-slate-800'}`}>
                          {formatDateTime(f.fecha)}
                        </p>
                        {pasada && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full mt-0.5">
                            <Check size={8} /> Completado
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
