// app/licitacion/[codigo]/sections/InteligenciaSection.tsx
// Sección "Inteligencia": chat IA sobre TODOS los documentos de la licitación (corpus
// completo). Reusa el texto ya extraído (documentos_cache.texto_extraido) cacheado como
// contexto, con historial persistido por sesión. Backend: /api/licitacion/[codigo]/chat
// (Gemini 2.5-flash principal + DeepSeek de respaldo). No re-descarga ni re-OCR-ea.
'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Bot, Upload, MessageSquare, User, Loader2, Send, Brain,
  AlertCircle, ListChecks, DollarSign, Calendar, BarChart3, ShieldCheck, BookOpen,
} from 'lucide-react';
import { DocumentoAdjunto } from '@/app/types/search.types';
import { SectionHeader, RespuestaFormateada } from '../utils';

interface MensajeChat {
  id: string;
  tipo: 'pregunta' | 'respuesta' | 'error';
  texto: string;
}

// Preguntas rápidas sobre el CORPUS completo de la licitación.
const PREGUNTAS_RAPIDAS = [
  { label: 'Resumen ejecutivo', pregunta: 'Hazme un resumen ejecutivo de esta licitación.', icon: <BookOpen size={12} /> },
  { label: 'Criterios de evaluación', pregunta: '¿Cuáles son los criterios de evaluación y sus ponderaciones?', icon: <BarChart3 size={12} /> },
  { label: 'Requisitos', pregunta: '¿Cuáles son todos los requisitos para participar?', icon: <ListChecks size={12} /> },
  { label: 'Plazos y fechas', pregunta: '¿Cuáles son los plazos y fechas clave del proceso?', icon: <Calendar size={12} /> },
  { label: 'Presupuesto', pregunta: '¿Cuál es el presupuesto disponible y las condiciones de pago?', icon: <DollarSign size={12} /> },
  { label: 'Garantías y multas', pregunta: '¿Qué garantías se exigen y qué multas o penalidades aplican?', icon: <ShieldCheck size={12} /> },
];

const SESION_CORPUS = 'corpus';
const nuevoId = () => Math.random().toString(36).slice(2);

export function InteligenciaSection({ codigo, documentosAnalizables, nombreLicitacion }: {
  codigo: string;
  documentosAnalizables: DocumentoAdjunto[];
  nombreLicitacion: string;
}) {
  const [mensajes, setMensajes] = useState<MensajeChat[]>([]);
  const [pregunta, setPregunta] = useState('');
  const [cargando, setCargando] = useState(false);
  const [cargandoHistorial, setCargandoHistorial] = useState(true);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const hayDocs = documentosAnalizables.length > 0;

  // Restaurar historial del corpus al montar.
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const res = await fetch(`/api/licitacion/${encodeURIComponent(codigo)}/chat?sesionId=${SESION_CORPUS}`);
        const data = await res.json();
        if (!vivo) return;
        setMensajes((data.mensajes || []).map((m: any) => ({
          id: nuevoId(),
          tipo: m.rol === 'usuario' ? 'pregunta' : 'respuesta',
          texto: m.mensaje,
        })));
      } catch { /* sin historial */ } finally {
        if (vivo) setCargandoHistorial(false);
      }
    })();
    return () => { vivo = false; };
  }, [codigo]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensajes, cargando]);

  const enviar = async (q?: string) => {
    const texto = (q ?? pregunta).trim();
    if (!texto || cargando) return;
    setPregunta('');
    setMensajes(prev => [...prev, { id: nuevoId(), tipo: 'pregunta', texto }]);
    setCargando(true);
    try {
      const res = await fetch(`/api/licitacion/${encodeURIComponent(codigo)}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sesionId: SESION_CORPUS, pregunta: texto }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMensajes(prev => [...prev, { id: nuevoId(), tipo: 'respuesta', texto: data.respuesta || 'Sin respuesta.' }]);
    } catch (e: any) {
      setMensajes(prev => [...prev, { id: nuevoId(), tipo: 'error', texto: e?.message || 'Error al consultar el asistente.' }]);
    } finally {
      setCargando(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="space-y-4 fade-in">
      <SectionHeader
        icon={<Brain size={18} />}
        title="Inteligencia"
        subtitle="Asistente sobre todos los documentos de la licitación"
      />

      <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-zinc-100 bg-gradient-to-r from-purple-50 to-indigo-50">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-purple-600 rounded-lg">
              <Bot size={13} className="text-white" />
            </div>
            <span className="text-sm font-semibold text-zinc-800">Asistente · Licitación</span>
            <span className="text-xs text-zinc-400 truncate hidden sm:inline">{nombreLicitacion}</span>
            {hayDocs && (
              <span className="ml-auto text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium flex-shrink-0">
                {documentosAnalizables.length} doc{documentosAnalizables.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {/* Chat area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[400px] max-h-[640px]">
          {!hayDocs ? (
            <div className="flex flex-col items-center justify-center h-full py-16 text-center">
              <div className="w-12 h-12 bg-purple-50 rounded-full flex items-center justify-center mb-3">
                <Upload size={18} className="text-purple-400" />
              </div>
              <p className="text-sm font-medium text-zinc-600">Sin documentos aún</p>
              <p className="text-xs text-zinc-400 mt-1 max-w-[260px]">
                Descarga documentos de Mercado Público en la sección &quot;Documentos y Bases&quot; para consultarlos con el asistente
              </p>
            </div>
          ) : cargandoHistorial ? (
            <div className="flex items-center justify-center h-full py-16 text-sm text-zinc-400 gap-2">
              <Loader2 size={14} className="animate-spin" /> Cargando conversación…
            </div>
          ) : mensajes.length === 0 ? (
            <div className="max-w-2xl mx-auto">
              <p className="text-xs text-zinc-400 mb-3 text-center">
                Pregúntame lo que quieras sobre esta licitación. Uso el contenido de todos los documentos procesados.
              </p>
              <p className="text-xs font-medium text-zinc-500 mb-1.5 flex items-center gap-1"><MessageSquare size={10} /> Preguntas rápidas</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {PREGUNTAS_RAPIDAS.map(p => (
                  <button key={p.label} onClick={() => enviar(p.pregunta)}
                    className="flex items-center gap-2 text-left px-3 py-2 text-xs text-zinc-700 bg-zinc-50 hover:bg-purple-50 hover:text-purple-700 border border-zinc-100 hover:border-purple-200 rounded-lg transition-colors">
                    <span className="text-purple-500 flex-shrink-0">{p.icon}</span>
                    <span className="flex-1">{p.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto w-full">
              {mensajes.map(msg => (
                <div key={msg.id} className={`flex gap-2 mb-3 ${msg.tipo === 'pregunta' ? 'flex-row-reverse' : 'flex-row'}`}>
                  {msg.tipo === 'pregunta' ? (
                    <div className="flex-shrink-0 w-7 h-7 bg-blue-600 rounded-full flex items-center justify-center">
                      <User size={13} className="text-white" />
                    </div>
                  ) : (
                    <div className="flex-shrink-0 w-7 h-7 bg-purple-600 rounded-full flex items-center justify-center">
                      <Bot size={13} className="text-white" />
                    </div>
                  )}
                  {msg.tipo === 'pregunta' ? (
                    <div className="max-w-[85%] bg-blue-600 text-white text-sm px-3 py-2 rounded-xl rounded-tr-sm">{msg.texto}</div>
                  ) : msg.tipo === 'error' ? (
                    <div className="max-w-[85%] bg-red-50 border border-red-100 text-red-700 text-xs px-3 py-2 rounded-xl rounded-tl-sm flex items-start gap-1.5">
                      <AlertCircle size={12} className="flex-shrink-0 mt-0.5" /> {msg.texto}
                    </div>
                  ) : (
                    <div className="max-w-[92%] bg-zinc-50 border border-zinc-100 px-3.5 py-3 rounded-xl rounded-tl-sm">
                      <RespuestaFormateada texto={msg.texto} />
                    </div>
                  )}
                </div>
              ))}
              {cargando && (
                <div className="flex gap-2">
                  <div className="flex-shrink-0 w-7 h-7 bg-purple-600 rounded-full flex items-center justify-center">
                    <Bot size={13} className="text-white" />
                  </div>
                  <div className="bg-zinc-50 border border-zinc-100 px-4 py-3 rounded-xl rounded-tl-sm">
                    <div className="flex gap-1.5 items-center">
                      <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce [animation-delay:0ms]" />
                      <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce [animation-delay:150ms]" />
                      <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce [animation-delay:300ms]" />
                      <span className="text-xs text-zinc-500 ml-1">Pensando…</span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          )}
        </div>

        {/* Input */}
        {hayDocs && !cargandoHistorial && (
          <div className="border-t border-zinc-100 p-3">
            <div className="max-w-3xl mx-auto w-full">
              {mensajes.length > 0 && (
                <div className="flex gap-1 mb-2 flex-wrap">
                  {PREGUNTAS_RAPIDAS.slice(0, 4).map(p => (
                    <button key={p.label} onClick={() => enviar(p.pregunta)} disabled={cargando}
                      className="text-xs px-2.5 py-1 bg-zinc-100 hover:bg-purple-100 hover:text-purple-700 text-zinc-600 rounded-full transition-colors disabled:opacity-50 flex items-center gap-1">
                      {p.icon}<span className="hidden sm:inline">{p.label}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-2 items-end">
                <textarea
                  ref={inputRef} value={pregunta} onChange={e => setPregunta(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
                  placeholder="Escribe tu pregunta..." rows={2} disabled={cargando}
                  className="flex-1 text-sm border border-zinc-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none disabled:bg-zinc-50 disabled:text-zinc-400"
                />
                <button onClick={() => enviar()} disabled={cargando || !pregunta.trim()}
                  className="flex-shrink-0 p-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-zinc-300 text-white rounded-xl transition-colors">
                  {cargando ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                </button>
              </div>
              <p className="text-xs text-zinc-400 mt-1 text-center">Enter para enviar · Shift+Enter nueva línea</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
