'use client';

// ZONA DE INCIDENCIAS (spec §9) — transversal, no secuencial: el proyecto tiene o no tiene
// incidencia, nunca detiene el reloj de entrega. Dos formularios: incidencia normal (defensiva u
// ofensiva simple) y Oportunidad de Mejora (su propio circuito de doble aprobación).
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { Select } from '@/app/components/ui/Select';
import {
  AlertTriangle, Sparkles, Loader2, Plus, X, CheckCircle2, Clock, Send,
} from 'lucide-react';

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

export function IncidenciasCard({ negocioId, puedeOperar, esJefeDeVentas }: { negocioId: number; puedeOperar: boolean; esJefeDeVentas: boolean }) {
  const toast = useToast();
  const [incidencias, setIncidencias] = useState<Incidencia[]>([]);
  const [tipos, setTipos] = useState<TipoCatalogo[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [loading, setLoading] = useState(true);
  const [formAbierto, setFormAbierto] = useState<'normal' | 'om' | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [form, setForm] = useState({ naturaleza: 'DEFENSIVA' as Naturaleza, tipoClave: '', tipoLibre: '', productoId: '', descripcion: '' });
  const [formOm, setFormOm] = useState({ productoId: '', productoAlternativo: '', ahorroEstimado: '', descripcion: '' });

  const cargar = useCallback(async () => {
    try {
      const [rInc, rTip, rProd] = await Promise.all([
        fetch(`/api/compras/${negocioId}/incidencias`), fetch('/api/compras/incidencias/tipos'), fetch(`/api/compras/${negocioId}/productos`),
      ]);
      const [dInc, dTip, dProd] = await Promise.all([rInc.json(), rTip.json(), rProd.json()]);
      if (dInc.success) setIncidencias(dInc.incidencias || []);
      if (dTip.success) setTipos(dTip.tipos || []);
      if (dProd.success) setProductos((dProd.productos || []).filter((p: any) => p.subestado !== 'RENUNCIADO'));
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
    } catch (e: any) {
      toast.error('No se pudo registrar', e.message);
    } finally {
      setGuardando(false);
    }
  };

  const cerrar = async (id: number) => {
    const resolucion = window.prompt('¿Cómo se resolvió? (opcional)');
    try {
      const res = await fetch(`/api/compras/${negocioId}/incidencias/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resolucion }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cerrar');
      setIncidencias(data.incidencias);
    } catch (e: any) {
      toast.error('No se pudo cerrar', e.message);
    }
  };

  const accionOm = async (incidenciaId: number, accion: string, extra: Record<string, unknown> = {}) => {
    try {
      const res = await fetch(`/api/compras/${negocioId}/incidencias/oportunidad-mejora`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ incidenciaId, accion, ...extra }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo actualizar');
      toast.success('Actualizado');
      setIncidencias(data.incidencias);
    } catch (e: any) {
      toast.error('No se pudo actualizar', e.message);
    }
  };

  const responderCliente = (id: number) => {
    const constancia = window.prompt('Constancia mínima — quién autorizó, con quién se habló y cuándo (spec §9.4):');
    if (!constancia?.trim()) return;
    const aprobada = window.confirm('¿El cliente APROBÓ la Oportunidad de Mejora? Aceptar = Sí, Cancelar = No.');
    accionOm(id, 'respuesta_cliente', { aprobada, constancia });
  };

  if (loading) return <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>;

  const abiertas = incidencias.filter(i => i.estado === 'ABIERTA');
  const cerradas = incidencias.filter(i => i.estado === 'CERRADA');

  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-zinc-50 border-b border-zinc-100">
        <p className="text-[12.5px] font-bold text-zinc-700 flex items-center gap-1.5">
          <AlertTriangle size={14} /> Incidencias {abiertas.length > 0 && <span className="text-[10.5px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-full">{abiertas.length} abierta(s)</span>}
        </p>
        {puedeOperar && (
          <div className="flex items-center gap-2">
            <button onClick={() => setFormAbierto(formAbierto === 'normal' ? null : 'normal')} className="flex items-center gap-1 text-[11.5px] font-semibold text-zinc-600 hover:text-zinc-800">
              <Plus size={13} /> Incidencia
            </button>
            <button onClick={() => setFormAbierto(formAbierto === 'om' ? null : 'om')} className="flex items-center gap-1 text-[11.5px] font-semibold text-teal-700 hover:text-teal-800">
              <Sparkles size={13} /> Oportunidad de Mejora
            </button>
          </div>
        )}
      </div>

      {formAbierto === 'normal' && (
        <div className="border-b border-zinc-100 px-4 py-3 space-y-2 bg-zinc-50/60">
          <div className="grid grid-cols-2 gap-2">
            <Select value={form.naturaleza} onChange={v => setForm(f => ({ ...f, naturaleza: v as Naturaleza }))}
              options={[{ value: 'DEFENSIVA', label: 'Defensiva (algo salió mal)' }, { value: 'OFENSIVA', label: 'Ofensiva (otro tipo)' }]} minWidth={200} />
            <Select value={form.productoId} onChange={v => setForm(f => ({ ...f, productoId: v }))} placeholder="Producto afectado (opcional)" minWidth={200}
              options={productos.map(p => ({ value: String(p.id), label: p.descripcion }))} />
          </div>
          <Select value={form.tipoClave} onChange={v => setForm(f => ({ ...f, tipoClave: v, tipoLibre: '' }))} placeholder="Tipo del catálogo…" minWidth={260}
            options={tipos.filter(t => t.naturaleza === form.naturaleza).map(t => ({ value: t.clave, label: t.titulo }))} />
          <input value={form.tipoLibre} onChange={e => setForm(f => ({ ...f, tipoLibre: e.target.value, tipoClave: '' }))}
            placeholder="…o un tipo que no está en la lista (texto libre)"
            className="w-full text-[12px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
          <textarea rows={2} value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
            placeholder="Descripción de la incidencia…" className="w-full text-[12px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
          <div className="flex items-center gap-2">
            <button onClick={abrir} disabled={guardando} className="text-[12px] font-semibold text-white bg-zinc-800 hover:bg-zinc-900 disabled:opacity-50 px-3 py-1.5 rounded-lg">
              {guardando ? <Loader2 size={13} className="animate-spin" /> : 'Abrir incidencia'}
            </button>
            <button onClick={() => setFormAbierto(null)} className="text-zinc-400 hover:text-zinc-600"><X size={16} /></button>
          </div>
        </div>
      )}

      {formAbierto === 'om' && (
        <div className="border-b border-zinc-100 px-4 py-3 space-y-2 bg-teal-50/40">
          <p className="text-[11px] text-zinc-500">Nada salió mal: aparece un producto que cubre la necesidad real a un costo notoriamente menor (spec §9.4).</p>
          <Select value={formOm.productoId} onChange={v => setFormOm(f => ({ ...f, productoId: v }))} placeholder="Producto que se mejoraría" minWidth={260}
            options={productos.map(p => ({ value: String(p.id), label: p.descripcion }))} />
          <input value={formOm.productoAlternativo} onChange={e => setFormOm(f => ({ ...f, productoAlternativo: e.target.value }))}
            placeholder="Producto alternativo propuesto" className="w-full text-[12px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
          <input inputMode="numeric" value={formOm.ahorroEstimado} onChange={e => setFormOm(f => ({ ...f, ahorroEstimado: e.target.value }))}
            placeholder="Ahorro estimado (opcional)" className="w-full text-[12px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
          <textarea rows={2} value={formOm.descripcion} onChange={e => setFormOm(f => ({ ...f, descripcion: e.target.value }))}
            placeholder="Detalle de la oportunidad…" className="w-full text-[12px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
          <div className="flex items-center gap-2">
            <button onClick={crearOm} disabled={guardando} className="text-[12px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-3 py-1.5 rounded-lg">
              {guardando ? <Loader2 size={13} className="animate-spin" /> : 'Registrar'}
            </button>
            <button onClick={() => setFormAbierto(null)} className="text-zinc-400 hover:text-zinc-600"><X size={16} /></button>
          </div>
        </div>
      )}

      {incidencias.length === 0 ? (
        <p className="px-4 py-8 text-center text-[12px] text-zinc-400">Sin incidencias — el proyecto avanza limpio.</p>
      ) : (
        <div className="divide-y divide-zinc-100">
          {[...abiertas, ...cerradas].map(i => (
            <div key={i.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${i.naturaleza === 'OFENSIVA' ? 'text-teal-700 bg-teal-50 border-teal-200' : 'text-amber-700 bg-amber-50 border-amber-200'}`}>
                      {i.tituloTipo || i.tipoLibre || (i.naturaleza === 'OFENSIVA' ? 'Oportunidad de Mejora' : 'Incidencia')}
                    </span>
                    {i.origen === 'AUTOMATICA' && <span className="text-[9.5px] font-bold text-zinc-400 bg-zinc-100 px-1.5 py-0.5 rounded-full">Automática</span>}
                    {i.estado === 'CERRADA' && <span className="text-[9.5px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full flex items-center gap-0.5"><CheckCircle2 size={9} /> Cerrada</span>}
                  </div>
                  <p className="text-[12px] text-zinc-700 mt-1">{i.descripcion}</p>
                  <p className="text-[10.5px] text-zinc-400 mt-0.5">Abierta por {i.abiertaPorNombre || 'Sistema'} · {fmtFecha(i.abiertaAt)}</p>
                  {i.resolucion && <p className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-2 py-1 mt-1.5">{i.resolucion}</p>}
                </div>
                {i.estado === 'ABIERTA' && puedeOperar && i.naturaleza !== 'OFENSIVA' && (
                  <button onClick={() => cerrar(i.id)} className="flex-shrink-0 text-[11px] font-semibold text-zinc-500 hover:text-zinc-700">Cerrar</button>
                )}
              </div>

              {i.om && i.estado === 'ABIERTA' && (
                <div className="mt-2 bg-zinc-50 border border-zinc-100 rounded-lg p-2.5 space-y-1.5">
                  <p className="text-[11.5px] text-zinc-700"><b>Propuesta:</b> {i.om.productoAlternativo}{i.om.ahorroEstimado != null && ` — ahorro estimado ${fmtCLP(i.om.ahorroEstimado)}`}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full border ${i.om.aprobadaJefeVentas ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-amber-700 bg-amber-50 border-amber-200'}`}>
                      {i.om.aprobadaJefeVentas ? `Aprobada por jefe de ventas (${i.om.aprobadaJefeVentasPorNombre})` : 'Pendiente jefe de ventas'}
                    </span>
                    {i.om.aprobadaJefeVentas && (
                      <span className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full border ${i.om.planteadaClienteAt ? 'text-teal-700 bg-teal-50 border-teal-200' : 'text-zinc-400 bg-zinc-100 border-zinc-200'}`}>
                        {i.om.planteadaClienteAt ? `Planteada al cliente ${fmtFecha(i.om.planteadaClienteAt)}` : 'Sin plantear al cliente'}
                      </span>
                    )}
                  </div>
                  {puedeOperar && (
                    <div className="flex items-center gap-2 pt-0.5">
                      {!i.om.aprobadaJefeVentas && esJefeDeVentas && (
                        <button onClick={() => accionOm(i.id, 'aprobar_jefe_ventas')} className="flex items-center gap-1 text-[11px] font-semibold text-white bg-amber-600 hover:bg-amber-700 px-2.5 py-1.5 rounded-lg">
                          <CheckCircle2 size={12} /> Aprobar (jefe de ventas)
                        </button>
                      )}
                      {i.om.aprobadaJefeVentas && !i.om.planteadaClienteAt && (
                        <button onClick={() => accionOm(i.id, 'plantear_cliente')} className="flex items-center gap-1 text-[11px] font-semibold text-white bg-teal-600 hover:bg-teal-700 px-2.5 py-1.5 rounded-lg">
                          <Send size={12} /> Ya se le planteó al cliente
                        </button>
                      )}
                      {i.om.planteadaClienteAt && (
                        <button onClick={() => responderCliente(i.id)} className="flex items-center gap-1 text-[11px] font-semibold text-white bg-zinc-800 hover:bg-zinc-900 px-2.5 py-1.5 rounded-lg">
                          <Clock size={12} /> Registrar respuesta del cliente
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
