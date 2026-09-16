'use client';

// TAREAS (§5) — checklist de validación y plazos administrativos. Extraído de ComprasSection.tsx
// (11-sep-2026) para vivir en su propia página (/compras/[negocioId]/tareas). Consume `tareas` y
// `recargar()` del contexto compartido; el resto (qué campo mostrar, abrir/cerrar el registro de
// una tarea) es estado propio de esta pantalla.
import { useState } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { useCompras, fmtFecha, type Tarea } from './ComprasContext';
import { IconLoader2 as Loader2, IconCircleCheck as CheckCircle2, IconPlayerPlay as PlayCircle, IconCircle as Circle, IconFlag as Flag, IconCalendar as Calendar, IconClipboardList as ClipboardList, IconDeviceFloppy as Save, IconPlus as Plus, IconX as X } from '@tabler/icons-react';

const SI_NO = ['Sí', 'No'] as const;
const CATEGORIA_LABEL: Record<string, string> = { VALIDACION: 'Validación', ADMINISTRATIVO: 'Plazos administrativos', MANUAL: 'Tareas propias del proyecto' };

function BadgeEstadoTarea({ estado, vencida }: { estado: Tarea['estado']; vencida: boolean }) {
  if (estado === 'HECHA') return <span className="inline-flex items-center gap-1 text-[10.5px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full"><CheckCircle2 size={11} /> Hecha</span>;
  if (estado === 'EN_CURSO') return <span className="inline-flex items-center gap-1 text-[10.5px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded-full"><PlayCircle size={11} /> En curso</span>;
  return (
    <span className={`inline-flex items-center gap-1 text-[10.5px] font-bold px-1.5 py-0.5 rounded-full border ${
      vencida ? 'text-rose-700 bg-rose-50 border-rose-200' : 'text-zinc-500 bg-zinc-50 border-zinc-200'
    }`}>
      <Circle size={11} /> {vencida ? 'Vencida' : 'Pendiente'}
    </span>
  );
}

export function TareasComprasCard() {
  const toast = useToast();
  const { negocioId, tareas, puedeOperar, recargar } = useCompras();

  const [guardandoTarea, setGuardandoTarea] = useState<number | null>(null);
  const [tareaAbierta, setTareaAbierta] = useState<number | null>(null);
  const [registroBorrador, setRegistroBorrador] = useState<Record<string, string>>({});
  const [hallazgoBorrador, setHallazgoBorrador] = useState(false);
  const [guardandoRegistro, setGuardandoRegistro] = useState(false);
  const [formNuevaTarea, setFormNuevaTarea] = useState(false);
  const [tituloNuevaTarea, setTituloNuevaTarea] = useState('');
  const [creandoTarea, setCreandoTarea] = useState(false);

  const siguienteEstado = (estado: Tarea['estado']): Tarea['estado'] =>
    estado === 'PENDIENTE' ? 'EN_CURSO' : estado === 'EN_CURSO' ? 'HECHA' : 'PENDIENTE';

  const cambiarEstado = async (tareaId: number, estado: Tarea['estado']) => {
    setGuardandoTarea(tareaId);
    try {
      const res = await fetch(`/api/compras/tarea/${tareaId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo actualizar');
      await recargar();
    } catch (e: any) {
      toast.error('No se pudo actualizar la tarea', e.message);
    } finally {
      setGuardandoTarea(null);
    }
  };

  const alternarRegistro = (t: Tarea) => {
    if (tareaAbierta === t.id) { setTareaAbierta(null); return; }
    setTareaAbierta(t.id);
    setRegistroBorrador({ ...(t.registro || {}) });
    setHallazgoBorrador(t.hallazgo);
  };

  const guardarRegistro = async (t: Tarea, cerrar: boolean) => {
    setGuardandoRegistro(true);
    try {
      const res = await fetch(`/api/compras/tarea/${t.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registro: registroBorrador,
          hallazgo: hallazgoBorrador,
          ...(cerrar ? { estado: 'HECHA' } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo guardar');
      if (cerrar) setTareaAbierta(null);
      await recargar();
    } catch (e: any) {
      toast.error('No se pudo guardar el registro', e.message);
    } finally {
      setGuardandoRegistro(false);
    }
  };

  const crearTareaManual = async () => {
    if (!tituloNuevaTarea.trim()) return;
    setCreandoTarea(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/tarea`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titulo: tituloNuevaTarea.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo crear la tarea');
      setTituloNuevaTarea('');
      setFormNuevaTarea(false);
      await recargar();
    } catch (e: any) {
      toast.error('No se pudo crear la tarea', e.message);
    } finally {
      setCreandoTarea(false);
    }
  };

  const porCategoria: Record<string, Tarea[]> = {};
  for (const t of tareas) (porCategoria[t.categoria] ||= []).push(t);

  return (
    <div className="space-y-3">
      {(['VALIDACION', 'ADMINISTRATIVO', 'MANUAL'] as const).map(cat => {
        const items = porCategoria[cat];
        if (!items || items.length === 0) return null;
        return (
          <div key={cat} className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
            <p className="px-4 py-2.5 text-[11px] font-bold text-zinc-500 uppercase bg-zinc-50 border-b border-zinc-100">{CATEGORIA_LABEL[cat] || cat}</p>
            <div className="divide-y divide-zinc-100">
              {items.map(t => (
                <div key={t.id} className="px-4 py-3 flex items-start gap-3">
                  <button
                    onClick={() => puedeOperar && cambiarEstado(t.id, siguienteEstado(t.estado))}
                    disabled={!puedeOperar || guardandoTarea === t.id}
                    title="Cambiar estado"
                    className="mt-0.5 flex-shrink-0 disabled:cursor-default"
                  >
                    {guardandoTarea === t.id ? <Loader2 size={16} className="animate-spin text-zinc-400" /> :
                      t.estado === 'HECHA' ? <CheckCircle2 size={17} className="text-emerald-500" /> :
                      t.estado === 'EN_CURSO' ? <PlayCircle size={17} className="text-indigo-500" /> :
                      <Circle size={17} className={t.vencida ? 'text-rose-400' : 'text-zinc-300'} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`text-[13px] font-semibold ${t.estado === 'HECHA' ? 'text-zinc-400 line-through' : 'text-zinc-800'}`}>{t.titulo}</p>
                      <BadgeEstadoTarea estado={t.estado} vencida={t.vencida} />
                      {t.hallazgo && (
                        <span className="inline-flex items-center gap-1 text-[10.5px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                          <Flag size={11} /> Con hallazgo
                        </span>
                      )}
                    </div>
                    {t.descripcion && <p className="text-[11.5px] text-zinc-500 mt-0.5">{t.descripcion}</p>}
                    <div className="flex items-center gap-3 mt-1 text-[10.5px] text-zinc-400">
                      {t.responsableNombre && <span>{t.responsableNombre}</span>}
                      {t.plazoAt && <span className="flex items-center gap-0.5"><Calendar size={10} /> {fmtFecha(t.plazoAt)}</span>}
                      {(t.campos.length > 0 || t.registro) && puedeOperar && (
                        <button onClick={() => alternarRegistro(t)}
                          className="flex items-center gap-0.5 text-[10.5px] font-semibold text-teal-700 hover:text-teal-800">
                          <ClipboardList size={11} /> {tareaAbierta === t.id ? 'Cerrar' : t.registro ? 'Ver / editar registro' : 'Registrar lo que se hizo'}
                        </button>
                      )}
                    </div>

                    {t.registro && tareaAbierta !== t.id && (
                      <div className="mt-1.5 bg-zinc-50 border border-zinc-100 rounded-lg px-2.5 py-1.5 space-y-0.5">
                        {Object.entries(t.registro).map(([k, v]) => (
                          <p key={k} className="text-[11px] text-zinc-600">
                            <span className="text-zinc-400">{t.campos.find(c => c.clave === k)?.etiqueta || k}: </span>{v}
                          </p>
                        ))}
                        {t.registroAt && <p className="text-[10px] text-zinc-400 pt-0.5">Anotado {fmtFecha(t.registroAt)}</p>}
                      </div>
                    )}

                    {tareaAbierta === t.id && (
                      <div className="mt-2 border border-zinc-200 rounded-lg p-2.5 space-y-2 bg-zinc-50/60">
                        {t.campos.map(c => (
                          <label key={c.clave} className="block text-[11px] font-semibold text-zinc-500">
                            {c.etiqueta}
                            {c.tipo === 'si_no' ? (
                              <div className="mt-0.5 flex gap-1.5">
                                {SI_NO.map(op => (
                                  <button key={op} type="button"
                                    onClick={() => setRegistroBorrador(b => ({ ...b, [c.clave]: b[c.clave] === op ? '' : op }))}
                                    className={`text-[12px] font-semibold px-2.5 py-1 rounded-lg border transition-colors ${
                                      registroBorrador[c.clave] !== op
                                        ? 'bg-white border-zinc-200 text-zinc-500 hover:border-zinc-300'
                                        : op === SI_NO[0]
                                          ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                                          : 'bg-rose-50 border-rose-300 text-rose-700'
                                    }`}>{op}</button>
                                ))}
                              </div>
                            ) : c.tipo === 'parrafo' ? (
                              <textarea rows={2} value={registroBorrador[c.clave] || ''} placeholder={c.placeholder}
                                onChange={e => setRegistroBorrador(b => ({ ...b, [c.clave]: e.target.value }))}
                                className="mt-0.5 w-full text-[12.5px] font-normal text-zinc-800 bg-white border border-zinc-200 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-teal-500 outline-none" />
                            ) : (
                              <input value={registroBorrador[c.clave] || ''} placeholder={c.placeholder}
                                onChange={e => setRegistroBorrador(b => ({ ...b, [c.clave]: e.target.value }))}
                                className="mt-0.5 w-full text-[12.5px] font-normal text-zinc-800 bg-white border border-zinc-200 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-teal-500 outline-none" />
                            )}
                          </label>
                        ))}
                        {t.campos.length === 0 && (
                          <label className="block text-[11px] font-semibold text-zinc-500">
                            Qué se hizo
                            <textarea rows={2} value={registroBorrador.observaciones || ''}
                              onChange={e => setRegistroBorrador(b => ({ ...b, observaciones: e.target.value }))}
                              className="mt-0.5 w-full text-[12.5px] font-normal text-zinc-800 bg-white border border-zinc-200 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-teal-500 outline-none" />
                          </label>
                        )}

                        <label className="flex items-start gap-2 text-[11.5px] text-zinc-700 pt-0.5">
                          <input type="checkbox" checked={hallazgoBorrador} onChange={e => setHallazgoBorrador(e.target.checked)}
                            className="mt-0.5 accent-amber-600" />
                          <span>
                            <span className="font-semibold">Levantar hallazgo.</span>
                            <span className="text-zinc-400"> Se hizo la tarea, pero lo que se encontró no es lo esperado (sin stock, no cumple, plazo incompatible...).</span>
                          </span>
                        </label>

                        <div className="flex items-center gap-2 pt-0.5">
                          <button onClick={() => guardarRegistro(t, false)} disabled={guardandoRegistro}
                            className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-zinc-600 bg-white border border-zinc-200 hover:bg-zinc-50 disabled:opacity-50 px-2.5 py-1.5 rounded-lg transition-colors">
                            {guardandoRegistro ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Guardar
                          </button>
                          {t.estado !== 'HECHA' && (
                            <button onClick={() => guardarRegistro(t, true)} disabled={guardandoRegistro}
                              className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-2.5 py-1.5 rounded-lg transition-colors">
                              <CheckCircle2 size={13} /> Guardar y dar por hecha
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {puedeOperar && (
        <div className="bg-white rounded-xl border border-zinc-200 p-3">
          {formNuevaTarea ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus value={tituloNuevaTarea} onChange={e => setTituloNuevaTarea(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && crearTareaManual()}
                placeholder="Título de la tarea…"
                className="flex-1 text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 focus:ring-1 focus:ring-teal-500 outline-none"
              />
              <button onClick={crearTareaManual} disabled={!tituloNuevaTarea.trim() || creandoTarea}
                className="text-[12px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-3 py-1.5 rounded-lg">
                {creandoTarea ? <Loader2 size={13} className="animate-spin" /> : 'Crear'}
              </button>
              <button onClick={() => { setFormNuevaTarea(false); setTituloNuevaTarea(''); }} className="text-zinc-400 hover:text-zinc-600"><X size={16} /></button>
            </div>
          ) : (
            <button onClick={() => setFormNuevaTarea(true)} className="flex items-center gap-1.5 text-[12px] font-semibold text-teal-700 hover:text-teal-800">
              <Plus size={14} /> Agregar tarea propia del proyecto
            </button>
          )}
        </div>
      )}
    </div>
  );
}
