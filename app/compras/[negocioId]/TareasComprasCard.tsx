'use client';

// TAREAS (§5) — checklist de validación y plazos administrativos. Extraído de ComprasSection.tsx
// (11-sep-2026) para vivir en su propia página (/compras/[negocioId]/tareas). Consume `tareas` y
// `recargar()` del contexto compartido; el resto (qué campo mostrar, abrir/cerrar el registro de
// una tarea) es estado propio de esta pantalla.
import { useRef, useState } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { useCompras, fmtFecha, type Tarea } from './ComprasContext';
import { IconLoader2 as Loader2, IconCircleCheck as CheckCircle2, IconPlayerPlay as PlayCircle, IconCircle as Circle, IconFlag as Flag, IconCalendar as Calendar, IconClipboardList as ClipboardList, IconDeviceFloppy as Save, IconPlus as Plus, IconX as X } from '@tabler/icons-react';

const SI_NO = ['Sí', 'No'] as const;
const CATEGORIA_LABEL: Record<string, string> = { VALIDACION: 'Validación', ADMINISTRATIVO: 'Plazos administrativos', ENTREGA: 'Entrega y cierre', MANUAL: 'Tareas propias del proyecto' };

function BadgeEstadoTarea({ estado, vencida }: { estado: Tarea['estado']; vencida: boolean }) {
  if (estado === 'HECHA') return <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><CheckCircle2 size={11} /> Hecha</span>;
  if (estado === 'EN_CURSO') return <span className="inline-flex items-center gap-1 text-xs font-medium text-teal-700"><PlayCircle size={11} /> En curso</span>;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-1.5 py-0.5 rounded-full border ${
      vencida ? 'text-rose-700 bg-rose-50 border-rose-200' : 'text-tinta-2 dark:text-slate-400 bg-slate-50 dark:bg-slate-950/40 border-linea dark:border-slate-800'
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
  const [sugiriendo, setSugiriendo] = useState(false);
  const [avisosSugerencia, setAvisosSugerencia] = useState<string[]>([]);
  // Vista: por defecto lo PENDIENTE (lo que hay que hacer); las hechas quedan a un clic y con su registro plegado.
  const [filtro, setFiltro] = useState<'pendientes' | 'hechas' | 'todas' | null>(null);
  const [registrosVisibles, setRegistrosVisibles] = useState<Set<number>>(new Set());
  // Borradores sin guardar de cada tarea: al abrir otra tarea no se pierde lo escrito (13-nov-2026, 4152-22-LE26).
  const borradores = useRef(new Map<number, { registro: Record<string, string>; hallazgo: boolean }>());

  // Validación técnica real: trae lo que el Auditor Técnico ya comprobó. Solo rellena los campos
  // VACÍOS del borrador (lo que la persona ya escribió no se pisa) y no guarda nada por sí solo.
  const rellenarDesdeAuditorTecnico = async () => {
    setSugiriendo(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/validacion-tecnica-sugerida`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo armar la sugerencia');
      if (!data.hayDatos) { setAvisosSugerencia(data.avisos || []); toast.info('El Auditor Técnico no tiene datos para pre-rellenar'); return; }
      setRegistroBorrador(b => {
        const n = { ...b };
        for (const [k, v] of Object.entries<string>(data.registro)) if (!(n[k] || '').trim()) n[k] = v;
        return n;
      });
      setAvisosSugerencia(data.avisos || []);
      toast.success('Pre-rellenado desde el Auditor Técnico', 'Revisa cada campo y guarda: no se guardó nada todavía.');
    } catch (e: any) {
      toast.error('No se pudo pre-rellenar', e.message);
    } finally { setSugiriendo(false); }
  };

  const siguienteEstado = (estado: Tarea['estado']): Tarea['estado'] =>
    estado === 'PENDIENTE' ? 'EN_CURSO' : estado === 'EN_CURSO' ? 'HECHA' : 'PENDIENTE';

  const cambiarEstado = async (tareaId: number, estado: Tarea['estado']) => {
    // Volver a PENDIENTE desde el ciclo = reabrir una tarea HECHA: el servidor pide el motivo y lo deja en la bitácora.
    let notaCierre: string | undefined;
    if (estado === 'PENDIENTE') {
      const motivo = window.prompt('¿Por qué se reabre esta tarea?');
      if (!motivo?.trim()) return;
      notaCierre = motivo.trim();
    }
    setGuardandoTarea(tareaId);
    try {
      const res = await fetch(`/api/compras/tarea/${tareaId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado, ...(notaCierre ? { notaCierre } : {}) }),
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
    if (tareaAbierta !== null) borradores.current.set(tareaAbierta, { registro: registroBorrador, hallazgo: hallazgoBorrador });
    if (tareaAbierta === t.id) { setTareaAbierta(null); return; }
    setTareaAbierta(t.id);
    setAvisosSugerencia([]);
    const guardado = borradores.current.get(t.id);
    setRegistroBorrador(guardado ? { ...guardado.registro } : { ...(t.registro || {}) });
    setHallazgoBorrador(guardado ? guardado.hallazgo : t.hallazgo);
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
      borradores.current.delete(t.id);
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

  const nHechas = tareas.filter(t => t.estado === 'HECHA').length;
  const nPendientes = tareas.length - nHechas;
  const vista = filtro ?? (nPendientes > 0 ? 'pendientes' : 'todas');
  const visible = (t: Tarea) => vista === 'todas' || (vista === 'hechas' ? t.estado === 'HECHA' : t.estado !== 'HECHA');
  const porCategoria: Record<string, Tarea[]> = {};
  for (const t of tareas) (porCategoria[t.categoria] ||= []).push(t);
  const alternarRegistroVisible = (id: number) => setRegistrosVisibles(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 flex-wrap" role="tablist" aria-label="Filtrar tareas">
        {([['pendientes', 'Por hacer', nPendientes], ['hechas', 'Hechas', nHechas], ['todas', 'Todas', tareas.length]] as const).map(([k, label, n]) => (
          <button key={k} type="button" role="tab" aria-selected={vista === k} onClick={() => setFiltro(k)}
            className={`text-[12px] font-semibold px-3 py-1 rounded-full border transition-colors ${vista === k ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white dark:bg-slate-900 border-linea dark:border-slate-800 text-tinta-2 dark:text-slate-400 hover:border-zinc-300'}`}>
            {label} <span className={vista === k ? 'text-teal-100' : 'text-tinta-2'}>{n}</span>
          </button>
        ))}
      </div>
      {vista === 'pendientes' && nPendientes === 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-[12.5px] text-emerald-800"><b>Todo al día.</b> No quedan tareas por hacer. Revisa las hechas con el filtro «Hechas».</div>
      )}
      {(['VALIDACION', 'ADMINISTRATIVO', 'ENTREGA', 'MANUAL'] as const).map(cat => {
        const todas = porCategoria[cat];
        const items = todas?.filter(visible);
        if (!items || items.length === 0) return null;
        const hechasCat = todas.filter(t => t.estado === 'HECHA').length;
        return (
          <div key={cat} className="bg-white dark:bg-slate-900 rounded-xl border border-linea dark:border-slate-800 overflow-hidden">
            <p className="px-4 py-2.5 text-xs font-semibold text-tinta-2 dark:text-slate-400 bg-slate-50 dark:bg-slate-950/40 border-b border-linea dark:border-slate-800 flex items-center justify-between"><span>{CATEGORIA_LABEL[cat] || cat}</span><span className="font-semibold normal-case text-tinta-2">{hechasCat} de {todas.length} hechas</span></p>
            <div className="divide-y divide-linea dark:divide-slate-800">
              {items.map(t => (
                <div key={t.id} className="px-4 py-3 flex items-start gap-3">
                  <button
                    onClick={() => puedeOperar && cambiarEstado(t.id, siguienteEstado(t.estado))}
                    disabled={!puedeOperar || guardandoTarea === t.id}
                    title="Cambiar estado"
                    className="mt-0.5 flex-shrink-0 disabled:cursor-default"
                  >
                    {guardandoTarea === t.id ? <Loader2 size={16} className="animate-spin text-tinta-2" /> :
                      t.estado === 'HECHA' ? <CheckCircle2 size={17} className="text-emerald-500" /> :
                      t.estado === 'EN_CURSO' ? <PlayCircle size={17} className="text-teal-500" /> :
                      <Circle size={17} className={t.vencida ? 'text-rose-400' : 'text-tinta-2'} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`text-[13px] font-semibold ${t.estado === 'HECHA' ? 'text-tinta-2 line-through' : 'text-tinta dark:text-slate-100'}`}>{t.titulo}</p>
                      <BadgeEstadoTarea estado={t.estado} vencida={t.vencida} />
                      {t.hallazgo && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700">
                          <Flag size={11} /> Con hallazgo
                        </span>
                      )}
                    </div>
                    {t.descripcion && <p className="text-[12.5px] text-tinta-2 dark:text-slate-400 mt-0.5">{t.descripcion.replace(/\s*\((?:spec\s*)?§[^)]*\)/gi, '')}</p>}
                    <div className="flex items-center gap-3 mt-1 text-xs text-tinta-2">
                      {t.responsableNombre && <span>{t.responsableNombre}</span>}
                      {t.plazoAt && <span className="flex items-center gap-0.5"><Calendar size={10} /> {fmtFecha(t.plazoAt)}</span>}
                      {(t.campos.length > 0 || t.registro) && puedeOperar && (
                        <button onClick={() => alternarRegistro(t)}
                          className="flex items-center gap-0.5 text-xs font-semibold text-teal-700 hover:text-teal-800">
                          <ClipboardList size={11} /> {tareaAbierta === t.id ? 'Cerrar' : t.registro ? 'Ver / editar registro' : 'Registrar lo que se hizo'}
                        </button>
                      )}
                    </div>

                    {t.registro && tareaAbierta !== t.id && t.estado === 'HECHA' && !registrosVisibles.has(t.id) && (
                      <button type="button" onClick={() => alternarRegistroVisible(t.id)} className="mt-1 text-xs font-semibold text-tinta-2 dark:text-slate-400 hover:text-tinta">
                        Ver lo que se anotó ({Object.keys(t.registro).length} campos)
                      </button>
                    )}
                    {t.registro && tareaAbierta !== t.id && (t.estado !== 'HECHA' || registrosVisibles.has(t.id)) && (
                      <div className="mt-1.5 bg-slate-50 dark:bg-slate-950/40 border border-linea dark:border-slate-800 rounded-lg px-2.5 py-1.5 space-y-0.5">
                        {Object.entries(t.registro).map(([k, v]) => (
                          <p key={k} className="text-xs text-tinta-2 dark:text-slate-400">
                            <span className="text-tinta-2">{t.campos.find(c => c.clave === k)?.etiqueta || k}: </span>{v}
                          </p>
                        ))}
                        {t.registroAt && <p className="text-xs text-tinta-2 pt-0.5">Anotado {fmtFecha(t.registroAt)}</p>}
                        {t.estado === 'HECHA' && <button type="button" onClick={() => alternarRegistroVisible(t.id)} className="text-xs font-semibold text-tinta-2 dark:text-slate-400 hover:text-tinta">Ocultar</button>}
                      </div>
                    )}

                    {tareaAbierta === t.id && (
                      <div className="mt-2 border border-linea dark:border-slate-800 rounded-lg p-2.5 space-y-2 bg-slate-50">
                        {t.catalogoClave === 'validacion_tecnica_real' && (
                          <div className="space-y-1.5">
                            <button type="button" onClick={rellenarDesdeAuditorTecnico} disabled={sugiriendo}
                              title="Trae producto, ficha, fuente y veredictos de lo que el Auditor Técnico ya comprobó. No guarda nada: tú revisas y guardas."
                              className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 bg-teal-50 border border-teal-200 hover:bg-teal-100 disabled:opacity-50 px-2.5 py-1 rounded-lg">
                              {sugiriendo ? <Loader2 size={12} className="animate-spin" /> : <ClipboardList size={12} />} Rellenar desde el Auditor Técnico
                            </button>
                            {avisosSugerencia.length > 0 && (
                              <ul className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 list-disc pl-5 space-y-0.5">
                                {avisosSugerencia.map(a => <li key={a}>{a}</li>)}
                              </ul>
                            )}
                          </div>
                        )}
                        {t.campos.map(c => (
                          <label key={c.clave} className="block text-xs font-semibold text-tinta-2 dark:text-slate-400">
                            {c.etiqueta}
                            {c.tipo === 'si_no' ? (
                              <div className="mt-0.5 flex gap-1.5">
                                {SI_NO.map(op => (
                                  <button key={op} type="button"
                                    onClick={() => setRegistroBorrador(b => ({ ...b, [c.clave]: b[c.clave] === op ? '' : op }))}
                                    className={`text-[12px] font-semibold px-2.5 py-1 rounded-lg border transition-colors ${
                                      registroBorrador[c.clave] !== op
                                        ? 'bg-white dark:bg-slate-900 border-linea dark:border-slate-800 text-tinta-2 dark:text-slate-400 hover:border-zinc-300'
                                        : op === SI_NO[0]
                                          ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                                          : 'bg-rose-50 border-rose-300 text-rose-700'
                                    }`}>{op}</button>
                                ))}
                              </div>
                            ) : c.tipo === 'parrafo' ? (
                              <textarea rows={2} value={registroBorrador[c.clave] || ''} placeholder={c.placeholder}
                                onChange={e => setRegistroBorrador(b => ({ ...b, [c.clave]: e.target.value }))}
                                className="mt-0.5 w-full text-[12.5px] font-normal text-tinta dark:text-slate-100 bg-white dark:bg-slate-900 border border-linea dark:border-slate-800 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-teal-500 outline-none" />
                            ) : (
                              <input value={registroBorrador[c.clave] || ''} placeholder={c.placeholder}
                                onChange={e => setRegistroBorrador(b => ({ ...b, [c.clave]: e.target.value }))}
                                className="mt-0.5 w-full text-[12.5px] font-normal text-tinta dark:text-slate-100 bg-white dark:bg-slate-900 border border-linea dark:border-slate-800 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-teal-500 outline-none" />
                            )}
                          </label>
                        ))}
                        {t.campos.length === 0 && (
                          <label className="block text-xs font-semibold text-tinta-2 dark:text-slate-400">
                            Qué se hizo
                            <textarea rows={2} value={registroBorrador.observaciones || ''}
                              onChange={e => setRegistroBorrador(b => ({ ...b, observaciones: e.target.value }))}
                              className="mt-0.5 w-full text-[12.5px] font-normal text-tinta dark:text-slate-100 bg-white dark:bg-slate-900 border border-linea dark:border-slate-800 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-teal-500 outline-none" />
                          </label>
                        )}

                        <label className="flex items-start gap-2 text-xs text-tinta dark:text-slate-200 pt-0.5">
                          <input type="checkbox" checked={hallazgoBorrador} onChange={e => setHallazgoBorrador(e.target.checked)}
                            className="mt-0.5 accent-amber-600" />
                          <span>
                            <span className="font-semibold">Levantar hallazgo.</span>
                            <span className="text-tinta-2"> Se hizo la tarea, pero lo que se encontró no es lo esperado (sin stock, no cumple, plazo incompatible...).</span>
                          </span>
                        </label>

                        <div className="flex items-center gap-2 pt-0.5">
                          <button onClick={() => guardarRegistro(t, false)} disabled={guardandoRegistro}
                            className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-tinta-2 dark:text-slate-400 bg-white dark:bg-slate-900 border border-linea dark:border-slate-800 hover:bg-slate-50 disabled:opacity-50 px-2.5 py-1.5 rounded-lg transition-colors">
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
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-linea dark:border-slate-800 p-3">
          {formNuevaTarea ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus value={tituloNuevaTarea} onChange={e => setTituloNuevaTarea(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && crearTareaManual()}
                placeholder="Título de la tarea…"
                className="flex-1 text-[12.5px] border border-linea dark:border-slate-800 rounded-lg px-2.5 py-1.5 focus:ring-1 focus:ring-teal-500 outline-none"
              />
              <button onClick={crearTareaManual} disabled={!tituloNuevaTarea.trim() || creandoTarea}
                className="text-[12px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-3 py-1.5 rounded-lg">
                {creandoTarea ? <Loader2 size={13} className="animate-spin" /> : 'Crear'}
              </button>
              <button onClick={() => { setFormNuevaTarea(false); setTituloNuevaTarea(''); }} className="text-tinta-2 hover:text-zinc-600"><X size={16} /></button>
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
