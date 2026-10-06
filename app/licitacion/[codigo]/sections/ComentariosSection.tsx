// app/licitacion/[codigo]/sections/ComentariosSection.tsx
'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { IconMessage as MessageSquare, IconSend as Send, IconLoader2 as Loader2, IconTrash as Trash2, IconCornerDownRight as Reply, IconChevronDown as ChevronDown } from '@tabler/icons-react';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import { formatDateTime } from '../utils';
import { ESTADOS_PIPELINE, getEstadoPipeline, puedeCambiarEstadoPipeline } from '@/app/lib/pipeline';

interface Comentario {
  id: number;
  comentario: string;
  created_at: string;
  usuario_id: number;
  usuario_nombre: string;
  usuario_email: string;
  usuario_rol?: string | null;
  origen?: 'licitacion' | 'negocio';
  pipeline_estado?: string | null;
  // Hilos (migration-138): id del comentario al que responde; null = comentario de primer nivel.
  padre_id?: number | null;
}

const clave = (origen: string | undefined, id: number) => `${origen || 'licitacion'}:${id}`;

function AvatarInicial({ nombre, email, tam = 'md' }: { nombre?: string; email?: string; tam?: 'md' | 'sm' }) {
  const text = nombre || email || '?';
  const letra = text.charAt(0).toUpperCase();
  const colores = ['bg-indigo-500', 'bg-violet-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500'];
  const idx = text.charCodeAt(0) % colores.length;
  return (
    <div className={`${tam === 'sm' ? 'w-7 h-7 text-[11px]' : 'w-9 h-9 text-[13px]'} rounded-full ${colores[idx]} flex items-center justify-center flex-shrink-0 text-white font-bold`}>
      {letra}
    </div>
  );
}

function Aparece({ i = 0, children }: { i?: number; children: React.ReactNode }) {
  const reducido = useReducedMotion();
  return (
    <motion.div initial={reducido ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(i, 8) * 0.05, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </motion.div>
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
  // Hilo: comentario al que se está respondiendo, su texto, y los hilos que el usuario plegó.
  const [respondiendoA, setRespondiendoA] = useState<string | null>(null);
  const [textoRespuesta, setTextoRespuesta] = useState('');
  const [enviandoRespuesta, setEnviandoRespuesta] = useState(false);
  const [plegados, setPlegados] = useState<Set<string>>(new Set());
  // Los perfiles externos no comentan ni responden (la API también lo rechaza).
  const puedeComentar = !!usuario && usuario.rol !== 'externo';

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

  // Hilos: comentarios de primer nivel en orden cronológico, cada uno con sus respuestas. Una respuesta
  // cuyo comentario original ya no existe se muestra como comentario normal (no se pierde).
  const { raices, respuestas, nRespuestas } = useMemo(() => {
    const existentes = new Set(comentarios.map(c => clave(c.origen, c.id)));
    const esRespuesta = (c: Comentario) => !!c.padre_id && existentes.has(clave(c.origen, c.padre_id));
    const mapa = new Map<string, Comentario[]>();
    for (const c of comentarios.filter(esRespuesta)) {
      const k = clave(c.origen, c.padre_id as number);
      mapa.set(k, [...(mapa.get(k) || []), c]);
    }
    return { raices: comentarios.filter(c => !esRespuesta(c)), respuestas: mapa, nRespuestas: comentarios.filter(esRespuesta).length };
  }, [comentarios]);

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

  // Responder un comentario: va siempre al endpoint de la licitación, que guarda la respuesta en la
  // misma tabla del comentario original (el origen viaja con la fila).
  const handleResponder = async (padre: Comentario) => {
    if (!textoRespuesta.trim() || !usuario) return;
    setEnviandoRespuesta(true);
    try {
      const res = await fetch(`/api/licitacion-comentarios/${encodeURIComponent(codigoDecoded)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comentario: textoRespuesta.trim(), padre_id: padre.id, origen: padre.origen || 'licitacion' }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTextoRespuesta('');
        setRespondiendoA(null);
        setPlegados(prev => { const n = new Set(prev); n.delete(clave(padre.origen, padre.id)); return n; });
        toastSuccess('Respuesta agregada');
        cargar();
      } else {
        toastError('No se pudo responder', data.error || 'Inténtalo de nuevo');
      }
    } catch {
      toastError('Error de red', 'No se pudo conectar con el servidor');
    } finally {
      setEnviandoRespuesta(false);
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
        // Al borrar un comentario también se borran sus respuestas (lo hace la API).
        setComentarios(prev => prev.filter(c => !(clave(c.origen, c.id) === clave(origen, id) || (c.padre_id && clave(c.origen, c.padre_id) === clave(origen, id)))));
        toastSuccess('Comentario eliminado');
      } else {
        toastError('Error', data.error || 'No se pudo eliminar el comentario');
      }
    } catch {
      toastError('Error de red', 'No se pudo conectar con el servidor');
    }
  };

  const puedeEliminar = (c: Comentario) => !!usuario && (usuario.id === c.usuario_id || usuario.rol === 'admin');
  const AutorLinea = ({ c }: { c: Comentario }) => (
    <div className="flex items-center gap-2 min-w-0 flex-wrap">
      <p className="text-[13px] font-bold text-slate-900 truncate">{c.usuario_nombre || c.usuario_email}</p>
      {c.usuario_rol === 'admin' && <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded-md bg-violet-100 text-violet-700">Admin</span>}
      {c.pipeline_estado && (() => {
        const info = getEstadoPipeline(c.pipeline_estado);
        if (!info) return null;
        return (
          <span style={{ backgroundColor: info.color + '18', color: info.color, borderColor: info.color + '50' }}
            className="inline-flex items-center gap-1 text-[10.5px] px-1.5 py-px rounded-full font-bold border flex-shrink-0">
            <span style={{ backgroundColor: info.color }} className="w-1.5 h-1.5 rounded-full flex-shrink-0" />{info.label}
          </span>
        );
      })()}
      <span className="text-[11.5px] text-slate-400">{formatDateTime(c.created_at)}</span>
    </div>
  );

  return (
    <div className="space-y-4 fade-in">
      <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-4">
          <h3 className="flex items-center gap-2.5 text-[17px] font-black text-slate-900">
            <span className="w-9 h-9 rounded-xl bg-violet-100 text-violet-600 flex items-center justify-center"><MessageSquare size={18} /></span>
            Comentarios
          </h3>
          {raices.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] font-bold px-2.5 py-1 rounded-full bg-violet-100 text-violet-700">{raices.length} {raices.length === 1 ? 'comentario' : 'comentarios'}</span>
              {nRespuestas > 0 && <span className="text-[12px] font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">{nRespuestas} {nRespuestas === 1 ? 'respuesta' : 'respuestas'}</span>}
            </div>
          )}
        </div>

        {/* Composer */}
        {puedeComentar && (
          <div className="px-5 pb-5">
            <div className="flex gap-3">
              <AvatarInicial nombre={usuario?.nombre ?? undefined} email={usuario?.email} />
              <div className="flex-1 min-w-0">
                {negocioId && onEstadoChanged && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    <button
                      type="button"
                      onClick={() => setPipelineSel(null)}
                      className={`text-[10.5px] px-2 py-0.5 rounded-full border font-semibold transition-all ${
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
                          className={`text-[10.5px] px-2 py-0.5 rounded-full border font-semibold transition-all ${
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
                    : 'Escribe un comentario para tu equipo...'}
                  rows={2}
                  className="w-full px-3.5 py-2.5 border border-slate-200 bg-white rounded-xl text-[14px] resize-none focus:ring-2 focus:ring-violet-100 focus:border-violet-400 outline-none transition-shadow"
                />
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[11px] text-slate-400">Ctrl+Enter para enviar</span>
                  <button
                    onClick={handleEnviar}
                    disabled={enviando || !texto.trim()}
                    className="flex items-center gap-1.5 px-4 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 text-white text-[12.5px] font-semibold rounded-lg transition-colors"
                  >
                    {enviando ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    {enviando ? 'Enviando...' : 'Enviar'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Lista de hilos */}
        <div className="border-t border-slate-100 px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-8 gap-2 text-sm text-slate-500">
              <Loader2 size={15} className="animate-spin text-violet-500" /> Cargando comentarios...
            </div>
          ) : raices.length === 0 ? (
            <div className="text-center py-10">
              <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <MessageSquare size={18} className="text-slate-300" />
              </div>
              <p className="text-[14px] text-slate-600 font-bold">Sin comentarios aún</p>
              <p className="text-[12.5px] text-slate-400 mt-1">Sé el primero en comentar sobre esta licitación</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {raices.map((c, i) => {
                const k = clave(c.origen, c.id);
                const hijos = respuestas.get(k) || [];
                const plegado = plegados.has(k);
                const respondiendo = respondiendoA === k;
                return (
                  <Aparece key={k} i={i}>
                    <article className="py-4 first:pt-1 last:pb-1">
                      <div className="flex gap-3">
                        <AvatarInicial nombre={c.usuario_nombre} email={c.usuario_email} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <AutorLinea c={c} />
                            {puedeEliminar(c) && (
                              <button onClick={() => handleEliminar(c.id, c.origen)} title={hijos.length > 0 ? 'Eliminar (también borra sus respuestas)' : 'Eliminar'} aria-label="Eliminar comentario"
                                className="text-slate-300 hover:text-red-500 transition-colors p-1 rounded flex-shrink-0"><Trash2 size={14} /></button>
                            )}
                          </div>
                          <p className="text-[14px] text-slate-700 leading-relaxed whitespace-pre-line mt-1">{c.comentario}</p>
                          <div className="flex items-center gap-3 mt-2">
                            {puedeComentar && (
                              <button type="button" onClick={() => { setRespondiendoA(respondiendo ? null : k); setTextoRespuesta(''); }}
                                className="inline-flex items-center gap-1 text-[12px] font-semibold text-violet-700 hover:text-violet-900">
                                <Reply size={14} /> Responder
                              </button>
                            )}
                            {hijos.length > 0 && (
                              <button type="button" onClick={() => setPlegados(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; })}
                                className="inline-flex items-center gap-1 text-[12px] font-semibold text-slate-500 hover:text-slate-700">
                                <ChevronDown size={14} className={`transition-transform ${plegado ? '-rotate-90' : ''}`} />
                                {plegado ? `Ver ${hijos.length} ${hijos.length === 1 ? 'respuesta' : 'respuestas'}` : `${hijos.length} ${hijos.length === 1 ? 'respuesta' : 'respuestas'}`}
                              </button>
                            )}
                          </div>

                          {/* Respuestas del hilo */}
                          <AnimatePresence initial={false}>
                            {hijos.length > 0 && !plegado && (
                              <motion.div key="resp" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: 'easeOut' }} className="overflow-hidden">
                                <div className="mt-3 space-y-3">
                                  {hijos.map(r => (
                                    <div key={clave(r.origen, r.id)} className="flex gap-2.5 rounded-xl bg-slate-50 px-3.5 py-3">
                                      <AvatarInicial nombre={r.usuario_nombre} email={r.usuario_email} tam="sm" />
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-start justify-between gap-2">
                                          <AutorLinea c={r} />
                                          {puedeEliminar(r) && (
                                            <button onClick={() => handleEliminar(r.id, r.origen)} title="Eliminar respuesta" aria-label="Eliminar respuesta"
                                              className="text-slate-300 hover:text-red-500 transition-colors p-1 rounded flex-shrink-0"><Trash2 size={13} /></button>
                                          )}
                                        </div>
                                        <p className="text-[13.5px] text-slate-700 leading-relaxed whitespace-pre-line mt-0.5">{r.comentario}</p>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>

                          {/* Cuadro para responder */}
                          <AnimatePresence initial={false}>
                            {respondiendo && (
                              <motion.div key="resp-form" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: 'easeOut' }} className="overflow-hidden">
                                <div className="mt-3 flex gap-2.5">
                                  <AvatarInicial nombre={usuario?.nombre ?? undefined} email={usuario?.email} tam="sm" />
                                  <div className="flex-1 min-w-0">
                                    <textarea
                                      autoFocus
                                      value={textoRespuesta}
                                      onChange={e => setTextoRespuesta(e.target.value)}
                                      onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleResponder(c); if (e.key === 'Escape') setRespondiendoA(null); }}
                                      placeholder={`Responde a ${c.usuario_nombre || c.usuario_email}...`}
                                      aria-label="Escribe tu respuesta"
                                      rows={2}
                                      className="w-full px-3.5 py-2.5 border border-slate-200 bg-white rounded-xl text-[13.5px] resize-none focus:ring-2 focus:ring-violet-100 focus:border-violet-400 outline-none transition-shadow"
                                    />
                                    <div className="flex items-center justify-end gap-2 mt-2">
                                      <button type="button" onClick={() => setRespondiendoA(null)} className="px-3 py-1.5 text-[12.5px] font-semibold text-slate-500 hover:text-slate-700">Cancelar</button>
                                      <button type="button" onClick={() => handleResponder(c)} disabled={enviandoRespuesta || !textoRespuesta.trim()}
                                        className="flex items-center gap-1.5 px-4 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 text-white text-[12.5px] font-semibold rounded-lg transition-colors">
                                        {enviandoRespuesta ? <Loader2 size={13} className="animate-spin" /> : <Reply size={13} />}
                                        {enviandoRespuesta ? 'Enviando...' : 'Responder'}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </div>
                    </article>
                  </Aparece>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
