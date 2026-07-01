'use client';

// Modal GRANDE de IA por documento: el documento se PREVISUALIZA a la izquierda
// (mismo motor que DocumentViewerModal: PDF/imagen por proxy inline, Office por el visor
// de Microsoft) y el chat va a la derecha. Así se pregunta viendo el documento.
//
// El contexto que se manda al modelo es SOLO el texto ya extraído de ESTE documento
// (una fila de documentos_cache) → respuesta rápida, sin releer nada. El sesion_id es
// determinístico ("doc:<nombre>") para restaurar el historial al reabrir el modal.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Bot, User, Send, Loader2, AlertCircle, Sparkles,
  Download, ExternalLink, FileQuestion,
} from 'lucide-react';
import { RespuestaFormateada, getFileIcon } from '@/app/licitacion/[codigo]/utils';
import { tipoDe } from '@/app/components/DocumentViewerModal';

interface MensajeChat {
  id: string;
  tipo: 'pregunta' | 'respuesta' | 'error';
  texto: string;
}

const PREGUNTAS_RAPIDAS = [
  { label: 'Resumen', pregunta: 'Hazme un resumen breve de este documento.' },
  { label: 'Puntos clave', pregunta: '¿Cuáles son los puntos clave de este documento?' },
  { label: 'Requisitos', pregunta: '¿Qué requisitos o exigencias establece este documento?' },
  { label: 'Fechas y plazos', pregunta: '¿Qué fechas y plazos relevantes menciona este documento?' },
];

const nuevoId = () => Math.random().toString(36).slice(2);

export function DocumentoIAModal({
  doc,
  codigo,
  onClose,
}: {
  doc: { nombre: string; url: string } | null;
  codigo: string;
  onClose: () => void;
}) {
  const [mensajes, setMensajes] = useState<MensajeChat[]>([]);
  const [pregunta, setPregunta] = useState('');
  const [cargando, setCargando] = useState(false);
  const [cargandoDoc, setCargandoDoc] = useState(true);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // sesion_id determinístico por documento (≤64 chars = límite de la columna).
  const sesionId = doc ? `doc:${doc.nombre}`.slice(0, 64) : '';

  // Escape / scroll-lock (mismo patrón que DocumentViewerModal).
  useEffect(() => {
    if (!doc) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [doc, onClose]);

  // Al abrir: restaurar historial de ESTE documento + resetear la previsualización.
  useEffect(() => {
    if (!doc) { setMensajes([]); setPregunta(''); return; }
    setCargandoDoc(true);
    let vivo = true;
    (async () => {
      try {
        const res = await fetch(`/api/licitacion/${encodeURIComponent(codigo)}/chat?sesionId=${encodeURIComponent(sesionId)}`);
        const data = await res.json();
        if (!vivo) return;
        const previos: MensajeChat[] = (data.mensajes || []).map((m: any) => ({
          id: nuevoId(),
          tipo: m.rol === 'usuario' ? 'pregunta' : 'respuesta',
          texto: m.mensaje,
        }));
        setMensajes(previos);
      } catch { /* sin historial */ }
      setTimeout(() => inputRef.current?.focus(), 50);
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.nombre, codigo]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensajes, cargando]);

  const enviar = async (q?: string) => {
    const texto = (q ?? pregunta).trim();
    if (!texto || cargando || !doc) return;
    setPregunta('');
    setMensajes(prev => [...prev, { id: nuevoId(), tipo: 'pregunta', texto }]);
    setCargando(true);
    try {
      const res = await fetch(`/api/licitacion/${encodeURIComponent(codigo)}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sesionId, pregunta: texto, documento: doc.nombre }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMensajes(prev => [...prev, { id: nuevoId(), tipo: 'respuesta', texto: data.respuesta || 'Sin respuesta.' }]);
    } catch (e: any) {
      setMensajes(prev => [...prev, { id: nuevoId(), tipo: 'error', texto: e?.message || 'Error al consultar la IA.' }]);
    } finally {
      setCargando(false);
      inputRef.current?.focus();
    }
  };

  // doc es null en el primer render (y durante SSR) → early return, así createPortal
  // solo se ejecuta en cliente cuando el modal se abre (document.body ya existe).
  if (!doc) return null;

  const tipo = tipoDe(doc.nombre, doc.url);
  // PDF/imágenes por el proxy con inline=1 (fuerza Content-Type y previsualización).
  const proxyInline = `/api/proxy?url=${encodeURIComponent(doc.url)}&inline=1`;
  // Office lo renderiza el visor online de Microsoft (necesita la URL pública directa).
  const officeSrc = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(doc.url)}`;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black/70 backdrop-blur-sm p-2 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Chat IA: ${doc.nombre}`}
    >
      <div
        className="flex flex-col w-full max-w-[95rem] mx-auto flex-1 min-h-0 bg-white rounded-2xl overflow-hidden shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-200 bg-gradient-to-r from-purple-50 to-indigo-50 flex-shrink-0">
          <div className="p-1.5 bg-purple-600 rounded-lg flex-shrink-0">
            <Bot size={14} className="text-white" />
          </div>
          <p className="flex-1 min-w-0 text-[13px] font-semibold text-slate-800 truncate" title={doc.nombre}>
            <span className="mr-1">{getFileIcon(doc.nombre)}</span>{doc.nombre}
          </p>
          <a
            href={doc.url} target="_blank" rel="noopener noreferrer"
            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
            title="Abrir en pestaña nueva"
          >
            <ExternalLink size={15} />
          </a>
          <a
            href={doc.url} download={doc.nombre}
            className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
            title="Descargar"
          >
            <Download size={15} />
          </a>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>
        </div>

        {/* Cuerpo: documento (izquierda) + chat (derecha) */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
          {/* ── Previsualización del documento ── */}
          <div className="relative flex-1 min-h-[240px] lg:min-h-0 bg-slate-100 lg:border-r border-slate-200">
            {(tipo === 'pdf' || tipo === 'office') && cargandoDoc && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-slate-500 pointer-events-none">
                <Loader2 size={16} className="animate-spin text-indigo-500" /> Cargando documento…
              </div>
            )}

            {tipo === 'pdf' && (
              <iframe
                src={`${proxyInline}#zoom=page-width&view=FitH`}
                title={doc.nombre}
                className="w-full h-full border-0"
                onLoad={() => setCargandoDoc(false)}
              />
            )}

            {tipo === 'img' && (
              <div className="w-full h-full overflow-auto flex items-center justify-center p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={proxyInline} alt={doc.nombre} className="max-w-full max-h-full object-contain" />
              </div>
            )}

            {tipo === 'office' && (
              <iframe
                src={officeSrc}
                title={doc.nombre}
                className="w-full h-full border-0"
                onLoad={() => setCargandoDoc(false)}
              />
            )}

            {tipo === 'otro' && (
              <div className="w-full h-full flex flex-col items-center justify-center text-center p-6">
                <div className="w-14 h-14 bg-slate-200 rounded-2xl flex items-center justify-center mb-3">
                  <FileQuestion size={26} className="text-slate-400" />
                </div>
                <p className="text-sm font-semibold text-slate-700">Este tipo de archivo no se puede previsualizar</p>
                <p className="text-xs text-slate-400 mt-1 mb-4">Puedes preguntarle a la IA igual, o abrirlo/descargarlo.</p>
                <div className="flex items-center gap-2">
                  <a href={doc.url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold rounded-lg transition-colors">
                    <ExternalLink size={14} /> Abrir
                  </a>
                  <a href={doc.url} download={doc.nombre}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-[13px] font-semibold rounded-lg transition-colors">
                    <Download size={14} /> Descargar
                  </a>
                </div>
              </div>
            )}
          </div>

          {/* ── Chat ── */}
          <div className="flex flex-col w-full lg:w-[440px] xl:w-[500px] flex-shrink-0 min-h-0 bg-white">
            {/* Chips de preguntas rápidas */}
            <div className="flex gap-1.5 flex-wrap px-3 py-2.5 border-b border-slate-100 flex-shrink-0">
              {PREGUNTAS_RAPIDAS.map(p => (
                <button
                  key={p.label}
                  onClick={() => enviar(p.pregunta)}
                  disabled={cargando}
                  className="flex items-center gap-1 text-xs px-2.5 py-1 bg-slate-100 hover:bg-purple-100 hover:text-purple-700 text-slate-600 rounded-full transition-colors disabled:opacity-50"
                >
                  <Sparkles size={10} /> {p.label}
                </button>
              ))}
            </div>

            {/* Mensajes */}
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
              {mensajes.length === 0 && !cargando && (
                <div className="flex flex-col items-center justify-center h-full py-10 text-center">
                  <div className="w-11 h-11 bg-purple-50 rounded-full flex items-center justify-center mb-3">
                    <Bot size={18} className="text-purple-400" />
                  </div>
                  <p className="text-sm font-medium text-slate-600">Pregúntame sobre este documento</p>
                  <p className="text-xs text-slate-400 mt-1 max-w-[260px]">
                    Uso solo el contenido de este documento. Elige una pregunta rápida o escribe la tuya.
                  </p>
                </div>
              )}

              {mensajes.map(msg => (
                <div key={msg.id} className={`flex gap-2 ${msg.tipo === 'pregunta' ? 'flex-row-reverse' : 'flex-row'}`}>
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
                    <div className="max-w-[92%] bg-white border border-slate-100 px-3.5 py-3 rounded-xl rounded-tl-sm shadow-sm">
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
                  <div className="bg-white border border-slate-100 px-4 py-3 rounded-xl rounded-tl-sm shadow-sm">
                    <div className="flex gap-1.5 items-center">
                      <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce [animation-delay:0ms]" />
                      <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce [animation-delay:150ms]" />
                      <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce [animation-delay:300ms]" />
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <div className="border-t border-slate-100 p-3 flex-shrink-0 bg-white">
              <div className="flex gap-2 items-center">
                <input
                  ref={inputRef}
                  value={pregunta}
                  onChange={e => setPregunta(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
                  placeholder="Escribe tu pregunta…"
                  disabled={cargando}
                  className="flex-1 text-sm border border-slate-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-400"
                />
                <button
                  onClick={() => enviar()}
                  disabled={cargando || !pregunta.trim()}
                  className="flex-shrink-0 p-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-300 text-white rounded-xl transition-colors"
                >
                  {cargando ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
