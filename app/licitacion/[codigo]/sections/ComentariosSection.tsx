// app/licitacion/[codigo]/sections/ComentariosSection.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { MessageSquare, Send, Loader2, Trash2, User } from 'lucide-react';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import { formatDateTime, SectionHeader } from '../utils';
import { ESTADOS_PIPELINE, getEstadoPipeline, puedeCambiarEstadoPipeline } from '@/app/lib/pipeline';

interface Comentario {
  id: number;
  comentario: string;
  created_at: string;
  usuario_id: number;
  usuario_nombre: string;
  usuario_email: string;
  origen?: 'licitacion' | 'negocio';
  pipeline_estado?: string | null;
}

function AvatarInicial({ nombre, email }: { nombre?: string; email?: string }) {
  const text = nombre || email || '?';
  const letra = text.charAt(0).toUpperCase();
  const colores = ['bg-indigo-500', 'bg-violet-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500'];
  const idx = text.charCodeAt(0) % colores.length;
  return (
    <div className={`w-8 h-8 rounded-full ${colores[idx]} flex items-center justify-center flex-shrink-0 text-white text-xs font-bold`}>
      {letra}
    </div>
  );
}

interface ComentariosSectionProps {
  codigoDecoded: string;
  // Si se provee (vista /negocios/[id]), el composer postea a /api/negocios/{id}/comentarios,
  // lo que habilita además los chips para cambiar de etapa al comentar. Sin esto, se postea a
  // /api/licitacion-comentarios/{codigo} (comentario "suelto", sin negocio asociado todavía).
  negocioId?: number;
  estadoActual?: string | null;
  isAdmin?: boolean;
  onEstadoChanged?: (estadoId: string) => void;
}

export function ComentariosSection({ codigoDecoded, negocioId, estadoActual, isAdmin, onEstadoChanged }: ComentariosSectionProps) {
  const { usuario } = useSession();
  const { success: toastSuccess, error: toastError } = useToast();
  const [comentarios, setComentarios] = useState<Comentario[]>([]);
  const [loading, setLoading] = useState(true);
  const [texto, setTexto] = useState('');
  const [pipelineSel, setPipelineSel] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const cargar = useCallback(async () => {
    if (!usuario) { setLoading(false); return; }
    try {
      // Siempre se lee de licitacion-comentarios: fusiona comentarios_licitacion +
      // comentarios_negocio en un solo hilo, para que ambas vistas muestren lo mismo.
      const res = await fetch(`/api/licitacion-comentarios/${encodeURIComponent(codigoDecoded)}`);
      const data = await res.json();
      if (data.success) setComentarios(data.comentarios || []);
    } catch { /* silencioso */ }
    finally { setLoading(false); }
  }, [codigoDecoded, usuario]);

  useEffect(() => { cargar(); }, [cargar]);

  const handleEnviar = async () => {
    if (!texto.trim() || !usuario) return;
    setEnviando(true);
    try {
      const endpoint = negocioId
        ? `/api/negocios/${negocioId}/comentarios`
        : `/api/licitacion-comentarios/${encodeURIComponent(codigoDecoded)}`;
      const body = negocioId
        ? { comentario: texto.trim(), pipeline_estado: pipelineSel || null }
        : { comentario: texto.trim() };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTexto('');
        if (data.nuevo_estado) {
          onEstadoChanged?.(data.nuevo_estado);
          const info = getEstadoPipeline(data.nuevo_estado);
          toastSuccess(`Estado actualizado: ${info?.label ?? data.nuevo_estado}`);
        } else {
          toastSuccess('Comentario agregado');
        }
        setPipelineSel(null);
        cargar();
      } else {
        toastError('Error', data.error || 'No se pudo agregar el comentario');
      }
    } catch {
      toastError('Error de red', 'No se pudo conectar con el servidor');
    } finally {
      setEnviando(false);
    }
  };

  const handleEliminar = async (id: number, origen?: 'licitacion' | 'negocio') => {
    if (!usuario) return;
    try {
      const res = await fetch(`/api/licitacion-comentarios/${encodeURIComponent(codigoDecoded)}?comentarioId=${id}&origen=${origen || 'licitacion'}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        setComentarios(prev => prev.filter(c => c.id !== id));
        toastSuccess('Comentario eliminado');
      } else {
        toastError('Error', data.error || 'No se pudo eliminar el comentario');
      }
    } catch {
      toastError('Error de red', 'No se pudo conectar con el servidor');
    }
  };

  return (
    <div className="space-y-4 fade-in">
      <SectionHeader
        icon={<MessageSquare size={18} />}
        title="Comentarios"
        subtitle="Notas internas del equipo sobre esta licitación"
        badge={comentarios.length > 0
          ? <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs rounded-full font-semibold">{comentarios.length}</span>
          : undefined}
      />

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Composer */}
        {usuario && (
          <div className="p-4 border-b border-slate-100 bg-slate-50">
            <div className="flex gap-3">
              <AvatarInicial nombre={usuario.nombre ?? undefined} email={usuario.email} />
              <div className="flex-1">
                {negocioId && onEstadoChanged && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    <button
                      type="button"
                      onClick={() => setPipelineSel(null)}
                      className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold transition-all ${
                        pipelineSel === null
                          ? 'bg-slate-800 text-white border-slate-800'
                          : 'border-slate-200 text-slate-400 hover:border-slate-400 hover:text-slate-600'
                      }`}
                    >
                      Sin cambio de etapa
                    </button>
                    {ESTADOS_PIPELINE.map(est => {
                      const sel = pipelineSel === est.id;
                      const chequeo = puedeCambiarEstadoPipeline(estadoActual, est.id, !!isAdmin);
                      return (
                        <button
                          key={est.id}
                          type="button"
                          disabled={!chequeo.permitido}
                          title={chequeo.permitido ? undefined : chequeo.motivo}
                          onClick={() => { if (!chequeo.permitido) return; setPipelineSel(sel ? null : est.id); }}
                          style={sel ? { backgroundColor: est.color + '20', color: est.color, borderColor: est.color + '60' } : {}}
                          className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold transition-all ${
                            sel ? '' : 'border-slate-200 text-slate-500 hover:border-slate-400'
                          } ${chequeo.permitido ? '' : 'opacity-40 cursor-not-allowed hover:border-slate-200'}`}
                        >
                          {sel && '✓ '}{est.label}
                        </button>
                      );
                    })}
                  </div>
                )}
                <textarea
                  value={texto}
                  onChange={e => setTexto(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleEnviar(); }}
                  placeholder={pipelineSel
                    ? `Comentario al pasar a "${getEstadoPipeline(pipelineSel)?.label}"...`
                    : 'Escribe un comentario para tu equipo...'
                  }
                  rows={2}
                  className="w-full px-3 py-2.5 border border-slate-200 bg-white rounded-xl text-sm resize-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-shadow"
                />
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] text-slate-400">Ctrl+Enter para enviar</span>
                  <button
                    onClick={handleEnviar}
                    disabled={enviando || !texto.trim()}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-xs font-semibold rounded-lg transition-colors"
                  >
                    {enviando ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                    {enviando ? 'Enviando...' : 'Enviar'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Lista */}
        <div className="p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8 gap-2 text-sm text-slate-500">
              <Loader2 size={15} className="animate-spin text-indigo-500" /> Cargando comentarios...
            </div>
          ) : comentarios.length === 0 ? (
            <div className="text-center py-10">
              <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <MessageSquare size={18} className="text-slate-300" />
              </div>
              <p className="text-sm text-slate-500 font-semibold">Sin comentarios aún</p>
              <p className="text-xs text-slate-400 mt-1">Sé el primero en comentar sobre esta licitación</p>
            </div>
          ) : (
            <div className="space-y-4">
              {comentarios.map((c, i) => (
                <div key={c.id} className="flex gap-3 slide-in-up" style={{ animationDelay: `${i * 40}ms` }}>
                  <AvatarInicial nombre={c.usuario_nombre} email={c.usuario_email} />
                  <div className="flex-1 min-w-0">
                    <div className="bg-slate-50 rounded-xl rounded-tl-sm px-3.5 py-3 border border-slate-100">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <p className="text-[12px] font-semibold text-slate-800 truncate">{c.usuario_nombre || c.usuario_email}</p>
                          {c.pipeline_estado && (() => {
                            const info = getEstadoPipeline(c.pipeline_estado);
                            if (!info) return null;
                            return (
                              <span
                                style={{ backgroundColor: info.color + '18', color: info.color, borderColor: info.color + '50' }}
                                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-px rounded-full font-bold border flex-shrink-0"
                              >
                                <span style={{ backgroundColor: info.color }} className="w-1.5 h-1.5 rounded-full flex-shrink-0" />
                                {info.label}
                              </span>
                            );
                          })()}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-[11px] text-slate-400">{formatDateTime(c.created_at)}</span>
                          {usuario && (usuario.id === c.usuario_id || usuario.rol === 'admin') && (
                            <button onClick={() => handleEliminar(c.id, c.origen)} title="Eliminar"
                              className="text-slate-300 hover:text-red-500 transition-colors p-0.5 rounded">
                              <Trash2 size={11} />
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-[13px] text-slate-700 leading-relaxed whitespace-pre-line">{c.comentario}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
