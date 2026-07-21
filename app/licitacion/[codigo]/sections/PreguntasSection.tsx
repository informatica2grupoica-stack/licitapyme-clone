// app/licitacion/[codigo]/sections/PreguntasSection.tsx
'use client';

import { useState } from 'react';
import { HelpCircle, ExternalLink, MessageCircle, Loader2, RefreshCw, Calendar } from 'lucide-react';
import { useToast } from '@/app/components/ui/toast';
import { formatDateTime, SectionHeader, AlertBanner, InfoRow } from '../utils';

interface PreguntaRespuesta {
  numero: number | null;
  fechaPregunta: string | null;
  pregunta: string;
  fechaRespuesta: string | null;
  respuesta: string | null;
}

interface ForoPreguntas {
  fechaInicioPreguntas: string | null;
  fechaFinPreguntas: string | null;
  fechaPublicacionRespuestas: string | null;
  preguntas: PreguntaRespuesta[];
}

// Fechas del foro vienen en formato "DD-MM-YYYY HH:mm:ss" (texto del portal de MP, no ISO) —
// formatDateTime espera un Date parseable, así que se muestran tal cual llegan.

export function PreguntasSection({ codigoDecoded, mpUrl }: { codigoDecoded: string; mpUrl: string }) {
  const { error: toastError } = useToast();
  const [estado, setEstado] = useState<'idle' | 'cargando' | 'ok' | 'error'>('idle');
  const [foro, setForo] = useState<ForoPreguntas | null>(null);

  const cargar = async () => {
    setEstado('cargando');
    try {
      const res = await fetch(`/api/licitacion-preguntas/${encodeURIComponent(codigoDecoded)}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || data.error) {
        toastError('Error', data.error || 'No se pudo traer el foro de preguntas');
        setEstado('error');
        return;
      }
      setForo(data);
      setEstado('ok');
    } catch {
      toastError('Error de red', 'No se pudo conectar con el servidor');
      setEstado('error');
    }
  };

  return (
    <div className="space-y-4 fade-in">
      <SectionHeader
        icon={<HelpCircle size={18} />}
        title="Preguntas Licitación"
        subtitle="Foro de preguntas y respuestas del proceso (traído en vivo desde Mercado Público)"
        badge={foro && foro.preguntas.length > 0
          ? <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs rounded-full font-semibold">{foro.preguntas.length}</span>
          : undefined}
        action={estado === 'ok'
          ? <button onClick={cargar} disabled={(estado as string) === 'cargando'}
              className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-500 hover:text-indigo-600 transition-colors">
              <RefreshCw size={13} /> Actualizar
            </button>
          : undefined}
      />

      {estado === 'idle' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-10 text-center">
            <div className="w-14 h-14 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <MessageCircle size={24} className="text-indigo-400" />
            </div>
            <h3 className="text-[15px] font-bold text-slate-800 mb-1.5">Preguntas y respuestas</h3>
            <p className="text-[13px] text-slate-500 mb-5 max-w-sm mx-auto leading-relaxed">
              Se trae en vivo desde el portal de Mercado Público (no es instantáneo, toma unos segundos).
            </p>
            <button onClick={cargar}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold rounded-xl transition-colors shadow-sm">
              <HelpCircle size={13} /> Cargar preguntas y respuestas
            </button>
          </div>
        </div>
      )}

      {estado === 'cargando' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-6 py-10 text-center">
          <Loader2 size={22} className="animate-spin text-indigo-500 mx-auto mb-3" />
          <p className="text-[13px] text-slate-500">Consultando Mercado Público en vivo…</p>
        </div>
      )}

      {estado === 'error' && (
        <AlertBanner tipo="danger" titulo="No se pudo traer el foro">
          Reintenta en unos minutos, o revísalo directo en el portal.
          <a href={mpUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 mt-3 text-[12.5px] font-semibold text-indigo-600 hover:text-indigo-700">
            <ExternalLink size={12} /> Ver en Mercado Público
          </a>
        </AlertBanner>
      )}

      {estado === 'ok' && foro && (
        <>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
              <Calendar size={14} className="text-slate-400" />
              <p className="text-[12px] font-bold text-slate-500 uppercase tracking-wide">Plazos del foro</p>
            </div>
            <div className="px-5">
              <InfoRow label="Inicio de preguntas" value={foro.fechaInicioPreguntas} />
              <InfoRow label="Término de preguntas" value={foro.fechaFinPreguntas} />
              <InfoRow label="Publicación de respuestas" value={foro.fechaPublicacionRespuestas} />
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4">
              {foro.preguntas.length === 0 ? (
                <div className="text-center py-10">
                  <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <MessageCircle size={18} className="text-slate-300" />
                  </div>
                  <p className="text-sm text-slate-500 font-semibold">Ningún proveedor ha realizado preguntas</p>
                </div>
              ) : (
                <div className="space-y-5">
                  {foro.preguntas.map((p, i) => (
                    <div key={i} className="border border-slate-100 rounded-xl overflow-hidden slide-in-up" style={{ animationDelay: `${i * 40}ms` }}>
                      <div className="px-4 py-3 bg-indigo-50/50 border-b border-slate-100">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-[11px] font-bold text-indigo-600 uppercase tracking-wide">
                            {p.numero ? `Pregunta ${p.numero}` : 'Pregunta'}
                          </span>
                          {p.fechaPregunta && <span className="text-[11px] text-slate-400">{p.fechaPregunta}</span>}
                        </div>
                        <p className="text-[13px] text-slate-800 leading-relaxed whitespace-pre-line">{p.pregunta}</p>
                      </div>
                      {p.respuesta ? (
                        <div className="px-4 py-3">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-[11px] font-bold text-emerald-600 uppercase tracking-wide">Respuesta</span>
                            {p.fechaRespuesta && <span className="text-[11px] text-slate-400">{p.fechaRespuesta}</span>}
                          </div>
                          <p className="text-[13px] text-slate-700 leading-relaxed whitespace-pre-line">{p.respuesta}</p>
                        </div>
                      ) : (
                        <div className="px-4 py-3">
                          <span className="text-[12px] text-amber-600 font-medium">Sin responder aún</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="text-center">
            <a href={mpUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[12px] text-slate-400 hover:text-indigo-600 transition-colors">
              <ExternalLink size={11} /> Ver ficha completa en Mercado Público
            </a>
          </div>
        </>
      )}
    </div>
  );
}
