'use client';

// Visor de documentos EN EL APP (sin descargar). Los archivos viven en Cloudflare R2
// con Content-Type correcto y sin X-Frame-Options, así que se incrustan directo:
//   - PDF   → <iframe> (visor nativo del navegador)
//   - Imagen→ <img>
//   - Office (Word/Excel/PPT) → visor online de Microsoft (no se puede incrustar nativo)
//   - Otros (zip, etc.) → sin previsualización, se ofrece abrir/descargar
// Se usa desde DocumentosSection, que aparece tanto en el detalle de licitación
// (Radar) como en el detalle de Negocios. La fila de cada documento solo tiene el ojo —
// el resto de acciones (rellenar, separar, enviar al auditor, preguntar a ankIA, eliminar)
// vive acá, en la cabecera, condicionadas a que el padre pase el handler correspondiente
// (undefined = esa acción no aplica a este documento, mismo patrón que en DocumentosSection).

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Download, ExternalLink, FileText, FileQuestion, Loader2,
  Wand2, Scissors, Send, Sparkles, Trash2, Bot, User, AlertCircle,
} from 'lucide-react';
import { RespuestaFormateada } from '@/app/licitacion/[codigo]/utils';

export interface VisorDoc { nombre: string; url: string }

export function extDe(nombre: string, url: string): string {
  const fromName = (nombre.split('.').pop() || '').toLowerCase();
  if (fromName && fromName.length <= 5) return fromName;
  return (url.split('?')[0].split('.').pop() || '').toLowerCase();
}

export type Tipo = 'pdf' | 'img' | 'office' | 'otro';
export function tipoDe(nombre: string, url: string): Tipo {
  const ext = extDe(nombre, url);
  if (ext === 'pdf') return 'pdf';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'img';
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) return 'office';
  return 'otro';
}

export function DocumentViewerModal({
  doc, onClose, codigo, onRellenarAnexo, onSepararAnexo, onEnviarAuditor, onEliminar,
}: {
  doc: VisorDoc | null;
  onClose: () => void;
  // Presente = habilita el botón "Preguntar a ankIA" (panel de chat dentro del mismo visor).
  codigo?: string;
  onRellenarAnexo?: () => void;
  onSepararAnexo?: () => void;
  onEnviarAuditor?: () => void;
  onEliminar?: () => void;
}) {
  const [cargando, setCargando] = useState(true);
  const [mostrarChat, setMostrarChat] = useState(false);

  useEffect(() => {
    if (!doc) return;
    setCargando(true);
    setMostrarChat(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [doc, onClose]);

  if (!doc) return null;
  const tipo = tipoDe(doc.nombre, doc.url);
  // PDF e imágenes se sirven por el proxy con inline=1: fuerza el Content-Type
  // correcto y la previsualización (los archivos en R2 tienen MIME malo de origen).
  const proxyInline = `/api/proxy?url=${encodeURIComponent(doc.url)}&inline=1`;
  // El visor de Office descarga el archivo desde los servidores de Microsoft, así
  // que necesita la URL pública directa (no el proxy local).
  const officeSrc = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(doc.url)}`;

  const contenidoPreview = (
    <>
      {tipo === 'pdf' && cargando && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-slate-500 pointer-events-none">
          <Loader2 size={16} className="animate-spin text-indigo-500" /> Cargando documento…
        </div>
      )}

      {tipo === 'office' && cargando && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-slate-500 pointer-events-none">
          <Loader2 size={16} className="animate-spin text-indigo-500" /> Cargando documento…
        </div>
      )}

      {tipo === 'pdf' && (
        <iframe
          src={`${proxyInline}#zoom=page-width&view=FitH`}
          title={doc.nombre}
          className="w-full h-full border-0"
          onLoad={() => setCargando(false)}
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
          onLoad={() => setCargando(false)}
        />
      )}

      {tipo === 'otro' && (
        <div className="w-full h-full flex flex-col items-center justify-center text-center p-6">
          <div className="w-14 h-14 bg-slate-200 rounded-2xl flex items-center justify-center mb-3">
            <FileQuestion size={26} className="text-slate-400" />
          </div>
          <p className="text-sm font-semibold text-slate-700">Este tipo de archivo no se puede previsualizar</p>
          <p className="text-xs text-slate-400 mt-1 mb-4">Ábrelo en una pestaña nueva o descárgalo.</p>
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
    </>
  );

  // createPortal a body: los contenedores con animación .fade-in (fill-mode both) dejan
  // un transform residual que crea un containing block y confinaba este `fixed` al área
  // de la sección — el PDF no ocupaba toda la pantalla. Portaleado, siempre es fullscreen.
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black/70 backdrop-blur-sm p-0 sm:p-3"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Visor: ${doc.nombre}`}
    >
      <div
        className="flex flex-col w-full max-w-none mx-auto flex-1 min-h-0 bg-white rounded-none sm:rounded-2xl overflow-hidden shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex-shrink-0">
          <FileText size={16} className="text-indigo-600 flex-shrink-0" />
          <p className="flex-1 min-w-0 text-[13px] font-semibold text-slate-800 truncate" title={doc.nombre}>
            {doc.nombre}
          </p>
          {onRellenarAnexo && (
            <button
              type="button" onClick={onRellenarAnexo}
              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
              title="Rellenar anexo con los datos de la empresa"
            >
              <Wand2 size={15} />
            </button>
          )}
          {onSepararAnexo && (
            <button
              type="button" onClick={onSepararAnexo}
              className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
              title="Separar en anexos independientes (si trae varios pegados en un solo Word)"
            >
              <Scissors size={15} />
            </button>
          )}
          {onEnviarAuditor && (
            <button
              type="button" onClick={onEnviarAuditor}
              className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
              title="Enviar al Auditor Técnico"
            >
              <Send size={15} />
            </button>
          )}
          {codigo && (
            <button
              type="button" onClick={() => setMostrarChat(v => !v)}
              className={`p-1.5 rounded-lg transition-colors ${mostrarChat ? 'text-purple-600 bg-purple-100' : 'text-slate-400 hover:text-purple-600 hover:bg-purple-50'}`}
              title="Preguntar a ankIA sobre este documento"
            >
              <Sparkles size={15} />
            </button>
          )}
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
          {onEliminar && (
            <button
              type="button" onClick={onEliminar}
              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              title="Eliminar documento propio"
            >
              <Trash2 size={15} />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            aria-label="Cerrar visor"
          >
            <X size={16} />
          </button>
        </div>

        {/* Cuerpo: con chat, se parte en documento (izquierda, angosto) + chat (derecha) —
            mismo layout que tenía el antiguo DocumentoIAModal, ahora fusionado acá. */}
        {mostrarChat && codigo ? (
          <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
            <div className="relative flex-none h-[38vh] lg:h-auto lg:flex-1 lg:min-h-0 bg-slate-100 lg:border-r border-b lg:border-b-0 border-slate-200">
              {contenidoPreview}
            </div>
            <PanelChatDocumento doc={doc} codigo={codigo} />
          </div>
        ) : (
          <div className="flex-1 min-h-0 bg-slate-100 relative">
            {contenidoPreview}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ─── Panel de chat de ankIA sobre ESTE documento ──────────────────────────────
// El contexto que se manda al modelo es SOLO el texto ya extraído de este documento
// (una fila de documentos_cache) → respuesta rápida, sin releer nada. El sesion_id es
// determinístico ("doc:<nombre>") para restaurar el historial al reabrir el panel.
// Se monta/desmonta con el toggle (no vive oculto con CSS): al reabrir, el historial se
// vuelve a pedir al servidor, que ya lo tiene guardado por sesionId — no se pierde nada.

interface MensajeChat { id: string; tipo: 'pregunta' | 'respuesta' | 'error'; texto: string }

const PREGUNTAS_RAPIDAS = [
  { label: 'Resumen', pregunta: 'Hazme un resumen breve de este documento.' },
  { label: 'Puntos clave', pregunta: '¿Cuáles son los puntos clave de este documento?' },
  { label: 'Requisitos', pregunta: '¿Qué requisitos o exigencias establece este documento?' },
  { label: 'Fechas y plazos', pregunta: '¿Qué fechas y plazos relevantes menciona este documento?' },
];

const nuevoId = () => Math.random().toString(36).slice(2);

function PanelChatDocumento({ doc, codigo }: { doc: VisorDoc; codigo: string }) {
  const [mensajes, setMensajes] = useState<MensajeChat[]>([]);
  const [pregunta, setPregunta] = useState('');
  const [cargando, setCargando] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const sesionId = `doc:${doc.nombre}`.slice(0, 64);

  useEffect(() => {
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
  }, [doc.nombre, codigo]);

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
        body: JSON.stringify({ sesionId, pregunta: texto, documento: doc.nombre }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMensajes(prev => [...prev, { id: nuevoId(), tipo: 'respuesta', texto: data.respuesta || 'Sin respuesta.' }]);
    } catch (e: any) {
      setMensajes(prev => [...prev, { id: nuevoId(), tipo: 'error', texto: e?.message || 'Error al consultar a ankIA.' }]);
    } finally {
      setCargando(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="flex flex-col w-full flex-1 lg:flex-none lg:w-[440px] xl:w-[500px] min-h-0 bg-white">
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
            <p className="text-sm font-medium text-slate-600">ankIA</p>
            <p className="text-xs text-slate-400 mt-1 max-w-[260px]">
              Pregúntame sobre este documento. Uso solo su contenido real — elige una pregunta rápida o escribe la tuya.
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
              <div className="max-w-[85%] bg-red-50 border border-red-100 text-red-700 text-[13px] px-3 py-2 rounded-xl rounded-tl-sm flex items-start gap-1.5">
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
  );
}
