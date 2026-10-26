'use client';

// Bandeja del EM en el AUDITOR (26-oct-2026): opciones «en aprobación» y requisitos que el asistente complementó, de TODOS los negocios,
// con selección y acciones en lote (aprobar, rechazar con comentario, dar por cumplido). Antes el EM entraba negocio por negocio y línea por línea.
// API: app/api/aprobaciones/auditor/route.ts · lógica: app/lib/auditor-bandeja-em.ts.
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useToast } from '@/app/components/ui/toast';
import { useConfirm } from '@/app/components/ui/confirm';
import { Modal } from '@/app/components/ui/Modal';
import { useRealtime } from '@/app/lib/use-realtime';
import { IconLoader2 as Loader2, IconEye as Eye, IconPaperclip as Clip, IconExternalLink as ExternalLink } from '@tabler/icons-react';
import type { NegocioBandejaEM } from '@/app/lib/auditor-bandeja-em';

const fmtCLP = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
const fecha = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' });
};
const claveO = (negocioId: number, opcionId: number) => `o:${negocioId}:${opcionId}`;
const claveR = (negocioId: number, opcionId: number, n: number) => `r:${negocioId}:${opcionId}:${n}`;

export function BandejaAuditorEM({ onConteo }: { onConteo?: (n: number) => void }) {
  const toast = useToast();
  const confirmar = useConfirm();
  const [negocios, setNegocios] = useState<NegocioBandejaEM[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = useState(false);
  const [rechazo, setRechazo] = useState<{ items: Array<{ negocioId: number; opcionId: number }> } | null>(null);
  const [comentario, setComentario] = useState('');

  const aplicar = useCallback((lista: NegocioBandejaEM[]) => {
    setNegocios(lista);
    onConteo?.(lista.reduce((s, n) => s + n.opciones.length + n.requisitos.length, 0));
    // La selección solo conserva lo que sigue en la bandeja.
    const vivas = new Set(lista.flatMap(n => [...n.opciones.map(o => claveO(n.negocioId, o.opcionId)), ...n.requisitos.map(r => claveR(n.negocioId, r.opcionId, r.n))]));
    setSel(prev => new Set([...prev].filter(k => vivas.has(k))));
  }, [onConteo]);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/aprobaciones/auditor');
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) { setNegocios([]); onConteo?.(0); return; }   // no es EM: la sección no se muestra
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar');
      aplicar(data.negocios || []); setError(null);
    } catch (e: any) { setError(e.message); }
  }, [aplicar, onConteo]);
  useEffect(() => { cargar(); }, [cargar]);
  useRealtime(cargar);

  const enviar = async (body: Record<string, unknown>, ok: string) => {
    setOcupado(true);
    try {
      const res = await fetch('/api/aprobaciones/auditor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo completar');
      aplicar(data.negocios || []);
      if (data.errores?.length) toast.error(`${data.ok} listo${data.ok === 1 ? '' : 's'}, ${data.errores.length} con problema`, data.errores.map((e: any) => e.error).slice(0, 3).join(' · '));
      else toast.success(ok);
    } catch (e: any) { toast.error('No se pudo completar', e.message); }
    finally { setOcupado(false); }
  };

  if (negocios === null) return error ? <p className="text-[13px] text-red-600">{error} <button onClick={cargar} className="underline">Reintentar</button></p> : null;
  const total = negocios.reduce((s, n) => s + n.opciones.length + n.requisitos.length, 0);
  if (total === 0) return null;

  const opcionesSel = negocios.flatMap(n => n.opciones.filter(o => sel.has(claveO(n.negocioId, o.opcionId))).map(o => ({ negocioId: n.negocioId, opcionId: o.opcionId })));
  const requisitosSel = negocios.flatMap(n => n.requisitos.filter(r => sel.has(claveR(n.negocioId, r.opcionId, r.n))).map(r => ({ negocioId: n.negocioId, opcionId: r.opcionId, n: r.n })));
  const alternar = (k: string) => setSel(prev => { const s = new Set(prev); if (s.has(k)) s.delete(k); else s.add(k); return s; });
  const todasOpciones = negocios.flatMap(n => n.opciones.map(o => claveO(n.negocioId, o.opcionId)));
  const todosRequisitos = negocios.flatMap(n => n.requisitos.map(r => claveR(n.negocioId, r.opcionId, r.n)));

  const aprobar = async (items: Array<{ negocioId: number; opcionId: number }>) => {
    const ok = await confirmar({
      titulo: items.length === 1 ? '¿Aprobar esta opción?' : `¿Aprobar ${items.length} opciones?`,
      mensaje: 'Quedan aprobadas como la oferta de su línea. Al asistente le llega el aviso. Si una ya no está en aprobación, se salta y te lo digo.',
      confirmarLabel: items.length === 1 ? 'Aprobar' : `Aprobar ${items.length}`,
    });
    if (ok) await enviar({ accion: 'aprobar', items }, items.length === 1 ? 'Opción aprobada' : `${items.length} opciones aprobadas`);
  };
  const aceptar = async (items: Array<{ negocioId: number; opcionId: number; n: number }>) => {
    const ok = await confirmar({
      titulo: items.length === 1 ? '¿Dar este requisito por cumplido?' : `¿Dar ${items.length} requisitos por cumplidos?`,
      mensaje: 'Queda como cumplido con el complemento del asistente como respaldo, a tu nombre. Después el asistente puede firmar la opción.',
      confirmarLabel: items.length === 1 ? 'Dar por cumplido' : `Dar por cumplidos (${items.length})`,
    });
    if (ok) await enviar({ accion: 'aceptar_requisitos', items, motivo: '' }, items.length === 1 ? 'Requisito dado por cumplido' : `${items.length} requisitos dados por cumplidos`);
  };

  const rotulo = 'text-xs text-slate-500';
  return (
    <section className="space-y-3" aria-label="Opciones del Auditor" data-testid="aprob-seccion-auditor-em">
      <div className="flex items-baseline gap-2 flex-wrap">
        <h2 className="text-[16px] font-medium text-zinc-900 dark:text-zinc-100">Opciones del Auditor</h2>
        <span className="text-[13px] text-slate-600">
          {[negocios.reduce((s, n) => s + n.opciones.length, 0) && `${negocios.reduce((s, n) => s + n.opciones.length, 0)} por aprobar`,
            negocios.reduce((s, n) => s + n.requisitos.length, 0) && `${negocios.reduce((s, n) => s + n.requisitos.length, 0)} requisito(s) complementado(s)`].filter(Boolean).join(' · ')} en {negocios.length} {negocios.length === 1 ? 'licitación' : 'licitaciones'}
        </span>
        <div className="ml-auto flex items-center gap-3 text-[13px]">
          {todasOpciones.length > 1 && <button onClick={() => setSel(prev => new Set([...prev, ...todasOpciones]))} className="font-medium text-teal-700 hover:underline">Elegir todas las opciones</button>}
          {todosRequisitos.length > 1 && <button onClick={() => setSel(prev => new Set([...prev, ...todosRequisitos]))} className="font-medium text-teal-700 hover:underline">Elegir todos los requisitos</button>}
        </div>
      </div>

      {negocios.map(n => (
        <div key={n.negocioId} className="rounded-xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-100 flex items-start gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-slate-600 tabular-nums">{n.licitacionCodigo}{n.asignadoNombre ? ` · ${n.asignadoNombre}` : ''}{n.cierre ? ` · cierra ${fecha(n.cierre)}` : ''}</p>
              <p className="text-[14px] font-medium text-slate-900 leading-snug">{n.licitacionNombre || n.licitacionCodigo}</p>
            </div>
            <Link href={`/negocios/${n.negocioId}?seccion=auditor_compra`} className="inline-flex items-center gap-1 text-[13px] font-medium text-teal-700 hover:underline whitespace-nowrap">
              Abrir en el Auditor <ExternalLink size={13} />
            </Link>
          </div>

          {n.opciones.length > 0 && (
            <div className="px-4 py-3">
              <p className="text-[13px] font-medium text-slate-800 mb-2">Opciones por aprobar · {n.opciones.length}</p>
              <ul className="space-y-2">
                {n.opciones.map(o => {
                  const k = claveO(n.negocioId, o.opcionId);
                  const dif = o.costoNeto != null && o.costeadoNeto ? Math.round(((o.costoNeto - o.costeadoNeto) / o.costeadoNeto) * 1000) / 10 : null;
                  return (
                    <li key={k} className={`rounded-lg border px-3 py-2.5 flex items-start gap-3 ${sel.has(k) ? 'border-teal-300 bg-teal-50/40' : 'border-zinc-200'}`}>
                      <input type="checkbox" checked={sel.has(k)} onChange={() => alternar(k)} className="mt-1 h-4 w-4 accent-teal-700" aria-label="Elegir esta opción" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] text-slate-900"><span className="font-semibold">Línea {o.linea}</span> · {o.producto} <span className="text-slate-600">· {o.proveedor}</span></p>
                        <p className="text-[13px] text-slate-600 truncate" title={o.detalle}>{o.detalle}</p>
                        <dl className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
                          <div><dt className={rotulo}>Costo neto unitario</dt><dd className="text-[13px] font-bold tabular-nums text-slate-900">{fmtCLP(o.costoNeto)}
                            {dif != null && <span className={`ml-1.5 text-xs font-semibold ${dif > 0 ? 'text-red-600' : 'text-emerald-700'}`}>{dif > 0 ? '+' : ''}{dif}% vs costeo</span>}</dd></div>
                          <div><dt className={rotulo}>Técnico</dt><dd className="text-[13px] text-slate-800 tabular-nums">{o.tecnico.total ? `${o.tecnico.cumple} de ${o.tecnico.total} cumplen` : 'sin requisitos'}</dd></div>
                          <div><dt className={rotulo}>Firmada por</dt><dd className="text-[13px] text-slate-800">{o.firmadaPorNombre || '—'}{o.firmadaAt ? <span className="text-slate-500"> · {fecha(o.firmadaAt)}</span> : null}</dd></div>
                        </dl>
                      </div>
                      <div className="flex flex-col gap-1.5 shrink-0">
                        <button disabled={ocupado} onClick={() => aprobar([{ negocioId: n.negocioId, opcionId: o.opcionId }])} className="px-3 py-1.5 rounded-lg bg-teal-700 text-white text-[13px] font-semibold hover:bg-teal-800 disabled:opacity-50">Aprobar</button>
                        <button disabled={ocupado} onClick={() => { setComentario(''); setRechazo({ items: [{ negocioId: n.negocioId, opcionId: o.opcionId }] }); }} className="px-3 py-1.5 rounded-lg border border-zinc-200 text-[13px] font-semibold text-slate-700 hover:bg-zinc-50 disabled:opacity-50">Rechazar…</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {n.requisitos.length > 0 && (
            <div className={`px-4 py-3 ${n.opciones.length ? 'border-t border-zinc-100' : ''}`}>
              <p className="text-[13px] font-medium text-slate-800 mb-2">Requisitos complementados por el asistente · {n.requisitos.length}</p>
              <ul className="space-y-2">
                {n.requisitos.map(r => {
                  const k = claveR(n.negocioId, r.opcionId, r.n);
                  return (
                    <li key={k} className={`rounded-lg border px-3 py-2.5 flex items-start gap-3 ${sel.has(k) ? 'border-teal-300 bg-teal-50/40' : 'border-zinc-200'}`}>
                      <input type="checkbox" checked={sel.has(k)} onChange={() => alternar(k)} className="mt-1 h-4 w-4 accent-teal-700" aria-label="Elegir este requisito" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] text-slate-600"><span className="font-semibold text-slate-800">Línea {r.linea}</span> · {r.producto} · requisito {r.n}</p>
                        <p className="text-[13.5px] text-slate-900 leading-snug">{r.requisito}</p>
                        <p className="mt-1 inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-700">
                          <span aria-hidden className={`w-1.5 h-1.5 rounded-full ${r.estado === 'NO_CUMPLE' ? 'bg-red-600' : 'bg-amber-500'}`} />
                          La IA dijo: {r.estado === 'NO_CUMPLE' ? 'no cumple' : 'falta el dato'}
                          {r.puedeDejarnosFuera && <span className="font-medium text-red-600">· puede dejarnos fuera</span>}
                        </p>
                        {r.citaDocumento && <p className="mt-0.5 text-[13px] italic text-slate-600">Documento: «{r.citaDocumento}»</p>}
                        <ul className="mt-2 space-y-1.5">
                          {r.complementos.map(c => {
                            const esNota = c.url.startsWith('nota:');
                            return (
                              <li key={c.url} className="rounded-md bg-zinc-50 px-2.5 py-1.5 text-[13px] text-slate-700">
                                <span className="flex items-center gap-1.5 text-xs text-slate-500">
                                  {esNota ? <span aria-hidden>💬</span> : <Clip size={12} />}
                                  {esNota ? 'Nota' : c.nombre} · {c.por}{c.at ? ` · ${fecha(c.at)}` : ''}
                                  {!esNota && <a href={c.url} target="_blank" rel="noopener noreferrer" title="Ver el archivo" className="text-teal-700 hover:underline inline-flex items-center gap-0.5"><Eye size={13} /> ver</a>}
                                </span>
                                {c.nota && <span className="block italic">«{c.nota}»</span>}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                      <button disabled={ocupado} onClick={() => aceptar([{ negocioId: n.negocioId, opcionId: r.opcionId, n: r.n }])}
                        className="shrink-0 px-3 py-1.5 rounded-lg bg-teal-700 text-white text-[13px] font-semibold hover:bg-teal-800 disabled:opacity-50">Dar por cumplido</button>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-xs text-slate-500">Si el complemento no alcanza, abre el negocio en el Auditor y pide el dato al proveedor: el requisito sigue abierto mientras no lo des por cumplido.</p>
            </div>
          )}
        </div>
      ))}

      {/* Barra de acciones en lote: aparece al elegir algo y queda fija abajo */}
      {(opcionesSel.length > 0 || requisitosSel.length > 0) && (
        <div className="sticky bottom-3 z-20 rounded-xl border border-zinc-200 bg-white shadow-lg px-4 py-3 flex items-center gap-3 flex-wrap">
          <p className="text-[13.5px] text-slate-800">
            <b className="tabular-nums">{opcionesSel.length + requisitosSel.length}</b> elegido{opcionesSel.length + requisitosSel.length === 1 ? '' : 's'}
            <span className="text-slate-600">{[opcionesSel.length && ` · ${opcionesSel.length} opción(es)`, requisitosSel.length && ` · ${requisitosSel.length} requisito(s)`].filter(Boolean).join('')}</span>
          </p>
          <button onClick={() => setSel(new Set())} className="text-[13px] text-slate-600 underline hover:text-slate-900">Limpiar</button>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            {opcionesSel.length > 0 && <button disabled={ocupado} onClick={() => { setComentario(''); setRechazo({ items: opcionesSel }); }} className="px-3 py-1.5 rounded-lg border border-zinc-200 text-[13px] font-semibold text-slate-700 hover:bg-zinc-50 disabled:opacity-50">Rechazar {opcionesSel.length}…</button>}
            {requisitosSel.length > 0 && <button disabled={ocupado} onClick={() => aceptar(requisitosSel)} className="px-3 py-1.5 rounded-lg bg-teal-700 text-white text-[13px] font-semibold hover:bg-teal-800 disabled:opacity-50">Dar por cumplidos ({requisitosSel.length})</button>}
            {opcionesSel.length > 0 && <button disabled={ocupado} onClick={() => aprobar(opcionesSel)} className="px-3 py-1.5 rounded-lg bg-teal-700 text-white text-[13px] font-semibold hover:bg-teal-800 disabled:opacity-50">{ocupado ? <Loader2 size={14} className="animate-spin" /> : `Aprobar ${opcionesSel.length}`}</button>}
          </div>
        </div>
      )}

      <Modal open={rechazo !== null} onClose={() => setRechazo(null)} size="md"
        title={rechazo && rechazo.items.length > 1 ? `¿Rechazar ${rechazo.items.length} opciones?` : '¿Rechazar esta opción?'}
        footer={<>
          <button onClick={() => setRechazo(null)} className="px-4 py-2 rounded-lg border border-zinc-200 text-[13px] font-semibold text-zinc-700 hover:bg-zinc-50">Cancelar</button>
          <button disabled={!comentario.trim() || ocupado} onClick={async () => { const items = rechazo!.items; setRechazo(null); await enviar({ accion: 'rechazar', items, comentario }, items.length === 1 ? 'Opción devuelta al asistente' : `${items.length} opciones devueltas al asistente`); }}
            className="px-4 py-2 rounded-lg bg-red-600 text-white text-[13px] font-semibold hover:bg-red-700 disabled:opacity-50">Rechazar y devolver</button>
        </>}>
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">Vuelve{rechazo && rechazo.items.length > 1 ? 'n' : ''} al asistente sin firma, con tu comentario. Tendrá que corregir y volver a firmar.</p>
        <label className="block text-[13px] font-medium text-slate-700 mb-1">Comentario para el asistente <span className="font-normal text-slate-500">(obligatorio)</span></label>
        <textarea value={comentario} onChange={e => setComentario(e.target.value)} rows={3} autoFocus className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-teal-500" />
      </Modal>
    </section>
  );
}
