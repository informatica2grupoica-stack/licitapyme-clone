'use client';

// ZONA DE INCIDENCIAS (spec §9) — transversal, no secuencial: el proyecto tiene o no tiene
// incidencia, nunca detiene el reloj de entrega. Dos formularios: incidencia normal (defensiva u
// ofensiva simple) y Oportunidad de Mejora (su propio circuito de doble aprobación).
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { Select } from '@/app/components/ui/Select';
import { useCompras } from '@/app/compras/[negocioId]/ComprasContext';
import { IconAlertTriangle as AlertTriangle, IconBulb as Lightbulb, IconLoader2 as Loader2, IconX as X, IconCircleCheck as CheckCircle2, IconClock as Clock, IconSend as Send } from '@tabler/icons-react';

type Naturaleza = 'DEFENSIVA' | 'OFENSIVA';
type Origen = 'MANUAL' | 'AUTOMATICA';

interface Incidencia {
  id: number; productoId: number | null; naturaleza: Naturaleza; origen: Origen;
  tipoClave: string | null; tipoLibre: string | null; tituloTipo: string | null; descripcion: string;
  estado: 'ABIERTA' | 'CERRADA'; abiertaPorNombre: string | null; abiertaAt: string;
  cerradaPorNombre: string | null; cerradaAt: string | null; resolucion: string | null;
  om: {
    ahorroEstimado: number | null; productoAlternativo: string | null;
    aprobadaJefeVentas: boolean; aprobadaJefeVentasPorNombre: string | null; aprobadaJefeVentasAt: string | null;
    planteadaClienteAt: string | null; aprobadaCliente: boolean | null; constancia: string | null;
  } | null;
}
interface TipoCatalogo { clave: string; naturaleza: Naturaleza; titulo: string; descripcion: string | null }
interface Producto { id: number; descripcion: string; subestado: string }

const fmtCLP = (n: number | null) => n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
const fmtFecha = (s: string | null) => { if (!s) return '—'; try { return new Date(s.replace(' ', 'T')).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return s; } };

const SUPERFICIE = 'bg-white border border-linea rounded-2xl shadow-tarjeta dark:bg-slate-900 dark:border-slate-800';

export function IncidenciasCard({ negocioId, puedeOperar, esJefeDeVentas }: { negocioId: number; puedeOperar: boolean; esJefeDeVentas: boolean }) {
  const toast = useToast();
  const { recargar: recargarCompartido } = useCompras();
  const [incidencias, setIncidencias] = useState<Incidencia[]>([]);
  const [tipos, setTipos] = useState<TipoCatalogo[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [loading, setLoading] = useState(true);
  const [formAbierto, setFormAbierto] = useState<'normal' | 'om' | null>(null);
  const [guardando, setGuardando] = useState(false);
  // Cierre de una incidencia: campo en pantalla en vez de window.prompt (el diálogo nativo bloqueaba la página y no se podía probar ni cancelar sin cerrar igual).
  const [cerrandoId, setCerrandoId] = useState<number | null>(null);
  const [textoCierre, setTextoCierre] = useState('');
  const [form, setForm] = useState({ naturaleza: 'DEFENSIVA' as Naturaleza, tipoClave: '', tipoLibre: '', productoId: '', descripcion: '' });
  const [formOm, setFormOm] = useState({ productoId: '', productoAlternativo: '', ahorroEstimado: '', descripcion: '' });
  // Antes: `window.confirm` con "Aceptar = Sí, Cancelar = No" — un clic equivocado invierte la
  // decisión del cliente sobre algo que se modifica de lo ofertado al Estado. Se reemplaza por dos
  // botones explícitos, y la constancia mínima (spec §9.4) pasa a un campo real en vez de un prompt.
  const [respondiendoOmId, setRespondiendoOmId] = useState<number | null>(null);
  const [respuestaConstancia, setRespuestaConstancia] = useState('');

  const cargar = useCallback(async () => {
    try {
      const [rInc, rTip, rProd] = await Promise.all([
        fetch(`/api/compras/${negocioId}/incidencias`), fetch('/api/compras/incidencias/tipos'), fetch(`/api/compras/${negocioId}/productos`),
      ]);
      const [dInc, dTip, dProd] = await Promise.all([rInc.json(), rTip.json(), rProd.json()]);
      if (dInc.success) setIncidencias(dInc.incidencias || []);
      if (dTip.success) setTipos(dTip.tipos || []);
      if (dProd.success) setProductos((dProd.productos || []).filter((p: any) => !['RENUNCIADO', 'NO_ADJUDICADA'].includes(p.subestado)));
    } catch (e: any) {
      toast.error('No se pudieron cargar las incidencias', e.message);
    } finally {
      setLoading(false);
    }
  }, [negocioId]);

  useEffect(() => { cargar(); }, [cargar]);

  const abrir = async () => {
    if (!form.descripcion.trim() || (!form.tipoClave && !form.tipoLibre.trim())) return;
    setGuardando(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/incidencias`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          naturaleza: form.naturaleza, tipoClave: form.tipoClave || null, tipoLibre: form.tipoClave ? null : form.tipoLibre.trim(),
          productoId: form.productoId || null, descripcion: form.descripcion.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo abrir');
      toast.success('Incidencia abierta');
      setForm({ naturaleza: 'DEFENSIVA', tipoClave: '', tipoLibre: '', productoId: '', descripcion: '' });
      setFormAbierto(null);
      setIncidencias(data.incidencias);
      recargarCompartido(); // mueve el badge de "Entrega y Cierre" en el stepper
    } catch (e: any) {
      toast.error('No se pudo abrir la incidencia', e.message);
    } finally {
      setGuardando(false);
    }
  };

  const crearOm = async () => {
    if (!formOm.productoId || !formOm.productoAlternativo.trim()) return;
    setGuardando(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/incidencias/oportunidad-mejora`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productoId: formOm.productoId, productoAlternativo: formOm.productoAlternativo.trim(),
          ahorroEstimado: formOm.ahorroEstimado || null, descripcion: formOm.descripcion.trim() || formOm.productoAlternativo.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo registrar');
      toast.success('Oportunidad de Mejora registrada', 'Pendiente de aprobación del jefe de ventas.');
      setFormOm({ productoId: '', productoAlternativo: '', ahorroEstimado: '', descripcion: '' });
      setFormAbierto(null);
      setIncidencias(data.incidencias);
      recargarCompartido();
    } catch (e: any) {
      toast.error('No se pudo registrar', e.message);
    } finally {
      setGuardando(false);
    }
  };

  const cerrar = async (id: number, resolucion: string | null) => {
    try {
      const res = await fetch(`/api/compras/${negocioId}/incidencias/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resolucion }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cerrar');
      setIncidencias(data.incidencias);
      setCerrandoId(null); setTextoCierre('');
      recargarCompartido();
    } catch (e: any) {
      toast.error('No se pudo cerrar', e.message);
    }
  };

  const accionOm = async (incidenciaId: number, accion: string, extra: Record<string, unknown> = {}): Promise<boolean> => {
    try {
      const res = await fetch(`/api/compras/${negocioId}/incidencias/oportunidad-mejora`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ incidenciaId, accion, ...extra }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo actualizar');
      toast.success('Actualizado');
      setIncidencias(data.incidencias);
      recargarCompartido();
      return true;
    } catch (e: any) {
      toast.error('No se pudo actualizar', e.message);
      return false;
    }
  };

  const responderCliente = async (id: number, aprobada: boolean) => {
    if (!respuestaConstancia.trim()) return;
    const ok = await accionOm(id, 'respuesta_cliente', { aprobada, constancia: respuestaConstancia.trim() });
    if (ok) { setRespondiendoOmId(null); setRespuestaConstancia(''); }
  };

  if (loading) return <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>;

  const abiertas = incidencias.filter(i => i.estado === 'ABIERTA');
  const cerradas = incidencias.filter(i => i.estado === 'CERRADA');
  const campo = 'w-full text-[12.5px] text-tinta dark:text-slate-100 bg-white dark:bg-slate-950 border border-linea dark:border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-marca';
  const btnPrimario = 'text-xs font-medium text-white bg-marca hover:bg-marca-fuerte disabled:opacity-50 px-3.5 py-2 rounded-lg transition-colors duration-150';

  return (
    <div className="@container space-y-3" data-testid="incidencias">
      <section className={SUPERFICIE + ' p-5'}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="flex items-center gap-2 text-[12.5px] font-medium text-tinta-2 dark:text-slate-300"><AlertTriangle size={15} className="text-slate-400" /> Incidencias y oportunidades</p>
            <p className="mt-1 text-xs text-tinta-2 dark:text-slate-400 max-w-2xl">Para dejar escrito un problema con la compra o la entrega, o una forma más barata de cumplir. No es una tarea ni detiene el plazo de entrega.</p>
          </div>
          <p className="text-xs text-tinta-2 dark:text-slate-400 tabular-nums">
            <span className={abiertas.length > 0 ? 'font-medium text-urgente' : ''}>{abiertas.length} abierta{abiertas.length === 1 ? '' : 's'}</span> · {cerradas.length} cerrada{cerradas.length === 1 ? '' : 's'}
          </p>
        </div>
        {puedeOperar && (
          <div className="mt-4 grid gap-3 @2xl:grid-cols-2">
            <button onClick={() => setFormAbierto(formAbierto === 'normal' ? null : 'normal')}
              className={`text-left rounded-xl border p-4 transition-[border-color,box-shadow] duration-150 hover:shadow-tarjeta-hover ${formAbierto === 'normal' ? 'border-marca' : 'border-linea dark:border-slate-700'}`}>
              <span className="flex items-center gap-2 text-[13px] font-medium text-tinta dark:text-slate-100"><AlertTriangle size={15} className="text-slate-400" /> Algo salió mal</span>
              <span className="mt-1 block text-xs text-tinta-2 dark:text-slate-400">Sin stock, producto descontinuado, plazo imposible, el cliente rechazó algo al entregar.</span>
            </button>
            <button onClick={() => setFormAbierto(formAbierto === 'om' ? null : 'om')}
              className={`text-left rounded-xl border p-4 transition-[border-color,box-shadow] duration-150 hover:shadow-tarjeta-hover ${formAbierto === 'om' ? 'border-marca' : 'border-linea dark:border-slate-700'}`}>
              <span className="flex items-center gap-2 text-[13px] font-medium text-tinta dark:text-slate-100"><Lightbulb size={15} className="text-slate-400" /> Encontré algo mejor</span>
              <span className="mt-1 block text-xs text-tinta-2 dark:text-slate-400">Un producto alternativo que cubre lo mismo a menor costo. Lo aprueba el jefe de ventas y luego el cliente.</span>
            </button>
          </div>
        )}

        {formAbierto === 'normal' && (
          <div className="mt-4 pt-4 border-t border-linea/80 dark:border-slate-800 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Select value={form.naturaleza} onChange={v => setForm(f => ({ ...f, naturaleza: v as Naturaleza }))}
                options={[{ value: 'DEFENSIVA', label: 'Defensiva (algo salió mal)' }, { value: 'OFENSIVA', label: 'Ofensiva (otro tipo)' }]} minWidth={200} />
              <Select value={form.productoId} onChange={v => setForm(f => ({ ...f, productoId: v }))} placeholder="Producto afectado (opcional)" minWidth={200}
                options={productos.map(p => ({ value: String(p.id), label: p.descripcion }))} />
            </div>
            <Select value={form.tipoClave} onChange={v => setForm(f => ({ ...f, tipoClave: v, tipoLibre: '' }))} placeholder="Tipo del catálogo…" minWidth={260}
              options={tipos.filter(t => t.naturaleza === form.naturaleza).map(t => ({ value: t.clave, label: t.titulo }))} />
            <input value={form.tipoLibre} onChange={e => setForm(f => ({ ...f, tipoLibre: e.target.value, tipoClave: '' }))} placeholder="…o un tipo que no está en la lista (texto libre)" className={campo} />
            <textarea rows={2} value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Descripción de la incidencia…" className={campo} />
            <div className="flex items-center gap-3">
              <button onClick={abrir} disabled={guardando} className={btnPrimario}>{guardando ? <Loader2 size={13} className="animate-spin" /> : 'Abrir incidencia'}</button>
              <button onClick={() => setFormAbierto(null)} className="text-xs font-medium text-tinta-2 hover:text-tinta dark:text-slate-400">Cancelar</button>
            </div>
          </div>
        )}

        {formAbierto === 'om' && (
          <div className="mt-4 pt-4 border-t border-linea/80 dark:border-slate-800 space-y-2">
            <p className="text-xs text-tinta-2 dark:text-slate-400">Nada salió mal: aparece un producto que cubre la necesidad real a un costo notoriamente menor.</p>
            <Select value={formOm.productoId} onChange={v => setFormOm(f => ({ ...f, productoId: v }))} placeholder="Producto que se mejoraría" minWidth={260}
              options={productos.map(p => ({ value: String(p.id), label: p.descripcion }))} />
            <input value={formOm.productoAlternativo} onChange={e => setFormOm(f => ({ ...f, productoAlternativo: e.target.value }))} placeholder="Producto alternativo propuesto" className={campo} />
            <input inputMode="numeric" value={formOm.ahorroEstimado} onChange={e => setFormOm(f => ({ ...f, ahorroEstimado: e.target.value }))} placeholder="Ahorro estimado (opcional)" className={campo} />
            <textarea rows={2} value={formOm.descripcion} onChange={e => setFormOm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Detalle de la oportunidad…" className={campo} />
            <div className="flex items-center gap-3">
              <button onClick={crearOm} disabled={guardando} className={btnPrimario}>{guardando ? <Loader2 size={13} className="animate-spin" /> : 'Registrar'}</button>
              <button onClick={() => setFormAbierto(null)} className="text-xs font-medium text-tinta-2 hover:text-tinta dark:text-slate-400">Cancelar</button>
            </div>
          </div>
        )}
      </section>

      {incidencias.length === 0 ? (
        <section className={SUPERFICIE + ' px-5 py-10 text-center'}>
          <span className="inline-flex text-exito mb-2"><CheckCircle2 size={22} /></span>
          <p className="text-[13px] font-medium text-tinta dark:text-slate-100">Sin incidencias: el proyecto avanza limpio</p>
          <p className="mt-1 text-xs text-tinta-2 dark:text-slate-400 max-w-md mx-auto">Si algo se complica, regístralo arriba. Queda en la franja roja del negocio, en Actividad y en el tablero de Compras, y se cierra aquí diciendo cómo se resolvió.</p>
        </section>
      ) : (
        <section className={SUPERFICIE + ' overflow-hidden'}>
          <div className="divide-y divide-linea/70 dark:divide-slate-800">
            {[...abiertas, ...cerradas].map(i => (
              <div key={i.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[13px] font-medium text-tinta dark:text-slate-100">
                      <span className="inline-flex items-center gap-1.5">
                        <span aria-hidden className={`w-1.5 h-1.5 rounded-full ${i.estado === 'CERRADA' ? 'bg-exito' : i.naturaleza === 'OFENSIVA' ? 'bg-marca' : 'bg-alerta'}`} />
                        {i.tituloTipo || i.tipoLibre || (i.naturaleza === 'OFENSIVA' ? 'Oportunidad de Mejora' : 'Incidencia')}
                      </span>
                      {i.origen === 'AUTOMATICA' && <span className="text-xs font-normal text-tinta-3 dark:text-slate-500">Automática</span>}
                      {i.estado === 'CERRADA' && <span className="text-xs font-normal text-exito">Cerrada</span>}
                    </p>
                    <p className="mt-1 text-xs text-tinta-2 dark:text-slate-400">{i.descripcion}</p>
                    <p className="mt-1 text-xs text-tinta-3 dark:text-slate-500">Abierta por {i.abiertaPorNombre || 'Sistema'} · {fmtFecha(i.abiertaAt)}</p>
                    {i.resolucion && <p className="mt-2 text-xs text-exito">{i.resolucion}</p>}
                  </div>
                  {i.estado === 'ABIERTA' && puedeOperar && i.naturaleza !== 'OFENSIVA' && (cerrandoId === i.id ? (
                    <div className="flex-shrink-0 w-[260px] space-y-2" data-testid={`incidencia-cierre-${i.id}`}>
                      <input value={textoCierre} onChange={e => setTextoCierre(e.target.value)} placeholder="¿Cómo se resolvió? (opcional)" autoFocus className={campo} />
                      <div className="flex items-center justify-end gap-3">
                        <button onClick={() => { setCerrandoId(null); setTextoCierre(''); }} className="text-xs font-medium text-tinta-2 hover:text-tinta dark:text-slate-400">Cancelar</button>
                        <button onClick={() => cerrar(i.id, textoCierre.trim() || null)} className={btnPrimario}>Confirmar cierre</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => { setCerrandoId(i.id); setTextoCierre(''); }} className="flex-shrink-0 text-xs font-medium text-marca hover:text-marca-fuerte">Cerrar</button>
                  ))}
                </div>

                {i.om && i.estado === 'ABIERTA' && (
                  <div className="mt-3 pt-3 border-t border-linea/80 dark:border-slate-800 space-y-2">
                    <p className="text-[13px] text-tinta dark:text-slate-100"><span className="font-medium">Propuesta:</span> {i.om.productoAlternativo}{i.om.ahorroEstimado != null && ` — ahorro estimado ${fmtCLP(i.om.ahorroEstimado)}`}</p>
                    <div className="flex items-center gap-x-5 gap-y-1 flex-wrap text-xs text-tinta-2 dark:text-slate-400">
                      <span className="inline-flex items-center gap-1.5"><span aria-hidden className={`w-1.5 h-1.5 rounded-full ${i.om.aprobadaJefeVentas ? 'bg-exito' : 'bg-alerta'}`} />
                        {i.om.aprobadaJefeVentas ? `Aprobada por el jefe de ventas (${i.om.aprobadaJefeVentasPorNombre})` : 'Pendiente del jefe de ventas'}</span>
                      {i.om.aprobadaJefeVentas && (
                        <span className="inline-flex items-center gap-1.5"><span aria-hidden className={`w-1.5 h-1.5 rounded-full ${i.om.planteadaClienteAt ? 'bg-marca' : 'bg-slate-300'}`} />
                          {i.om.planteadaClienteAt ? `Planteada al cliente ${fmtFecha(i.om.planteadaClienteAt)}` : 'Sin plantear al cliente'}</span>
                      )}
                    </div>
                    {puedeOperar && (
                      <div className="flex items-center gap-3 pt-1">
                        {!i.om.aprobadaJefeVentas && esJefeDeVentas && (
                          <button onClick={() => accionOm(i.id, 'aprobar_jefe_ventas')} className={btnPrimario + ' inline-flex items-center gap-1.5'}><CheckCircle2 size={13} /> Aprobar (jefe de ventas)</button>
                        )}
                        {i.om.aprobadaJefeVentas && !i.om.planteadaClienteAt && (
                          <button onClick={() => accionOm(i.id, 'plantear_cliente')} className={btnPrimario + ' inline-flex items-center gap-1.5'}><Send size={13} /> Ya se le planteó al cliente</button>
                        )}
                        {i.om.planteadaClienteAt && respondiendoOmId !== i.id && (
                          <button onClick={() => { setRespondiendoOmId(i.id); setRespuestaConstancia(''); }} className={btnPrimario + ' inline-flex items-center gap-1.5'}><Clock size={13} /> Registrar respuesta del cliente</button>
                        )}
                      </div>
                    )}
                    {i.om.planteadaClienteAt && respondiendoOmId === i.id && (
                      <div className="pt-2 space-y-2">
                        <p className="text-xs text-tinta-2 dark:text-slate-400">Constancia mínima: quién autorizó, con quién se habló y cuándo.</p>
                        <textarea rows={2} value={respuestaConstancia} onChange={e => setRespuestaConstancia(e.target.value)}
                          placeholder="Ej: autorizó Juan Pérez (jefe de ventas), hablado con la contraparte técnica el 11-09-2026…" className={campo} />
                        <div className="flex items-center gap-3 flex-wrap">
                          <button onClick={() => responderCliente(i.id, true)} disabled={!respuestaConstancia.trim()} className={btnPrimario + ' inline-flex items-center gap-1.5'}><CheckCircle2 size={13} /> Cliente aprobó</button>
                          <button onClick={() => responderCliente(i.id, false)} disabled={!respuestaConstancia.trim()} className="text-xs font-medium text-white bg-urgente hover:opacity-90 disabled:opacity-50 px-3.5 py-2 rounded-lg inline-flex items-center gap-1.5"><X size={13} /> Cliente rechazó</button>
                          <button onClick={() => setRespondiendoOmId(null)} className="text-xs font-medium text-tinta-2 hover:text-tinta dark:text-slate-400">Cancelar</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
