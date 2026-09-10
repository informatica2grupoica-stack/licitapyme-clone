'use client';

// ENTREGA DEL PROYECTO Y ACTA (spec §16). Único documento oficial que genera el módulo. Secuencia:
// verificación → números de OBUMA (nota de venta / guía) → generar acta → aprobar → firmar acta y
// guía → cierre (§16.7, cuando ambas firmas existen).
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { Select } from '@/app/components/ui/Select';
import { Banner } from '@/app/components/ui/Banner';
import {
  PackageCheck, Loader2, CheckCircle2, XCircle, FileSignature, Plus, X, Trash2,
} from 'lucide-react';

type Modalidad = 'TOTAL' | 'PARCIAL';
interface FirmaDatos { nombre: string; rut: string; cargo: string; recinto: string; fecha: string }
interface Punto { id: number; direccion: string; comuna: string | null; contactoNombre: string | null; contactoTelefono: string | null }
interface Entrega {
  modalidad: Modalidad; modalidadMotivo: string | null; notaVentaNumero: string | null; guiaDespachoNumero: string | null;
  verificacionConforme: boolean | null; verificacionPorNombre: string | null;
  actaGeneradaAt: string | null; actaAprobadaPorNombre: string | null; actaAprobadaAt: string | null;
  actaConformidad: string | null; actaFirma: FirmaDatos | null; guiaFirma: FirmaDatos | null; guiaTimbre: boolean;
  cerradaAt: string | null; puntos: Punto[];
}

const firmaVacia: FirmaDatos = { nombre: '', rut: '', cargo: '', recinto: '', fecha: '' };

function FormFirma({ onGuardar, guardando }: { onGuardar: (f: FirmaDatos, extra?: Record<string, unknown>) => void; guardando: boolean }) {
  const [f, setF] = useState<FirmaDatos>(firmaVacia);
  return (
    <div className="grid grid-cols-2 gap-2">
      <input value={f.nombre} onChange={e => setF(v => ({ ...v, nombre: e.target.value }))} placeholder="Nombre"
        className="text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
      <input value={f.rut} onChange={e => setF(v => ({ ...v, rut: e.target.value }))} placeholder="RUT"
        className="text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
      <input value={f.cargo} onChange={e => setF(v => ({ ...v, cargo: e.target.value }))} placeholder="Cargo"
        className="text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
      <input value={f.recinto} onChange={e => setF(v => ({ ...v, recinto: e.target.value }))} placeholder="Recinto de recepción"
        className="text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
      <input type="date" value={f.fecha} onChange={e => setF(v => ({ ...v, fecha: e.target.value }))}
        className="text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500 col-span-2" />
      <button onClick={() => onGuardar(f)} disabled={guardando || !f.nombre || !f.rut || !f.cargo || !f.recinto || !f.fecha}
        className="col-span-2 text-[11.5px] font-semibold text-white bg-zinc-800 hover:bg-zinc-900 disabled:opacity-50 px-2.5 py-1.5 rounded-lg">
        {guardando ? <Loader2 size={13} className="animate-spin mx-auto" /> : 'Guardar firma'}
      </button>
    </div>
  );
}

// `puedeVerificar`: además del encargado (`puedeOperar`), el perfil "bodega" (§2.2) puede marcar
// Conforme/No conforme (§16.4) aunque no sea el encargado del negocio. El resto de la tarjeta
// (modalidad, puntos de entrega, acta, firmas) sigue exclusivo de `puedeOperar` — bodega no genera
// ni firma nada, solo constata que el producto llegó bien.
export function EntregaCard({ negocioId, puedeOperar, puedeVerificar = false }: { negocioId: number; puedeOperar: boolean; puedeVerificar?: boolean }) {
  const toast = useToast();
  const [entrega, setEntrega] = useState<Entrega | null>(null);
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [formPunto, setFormPunto] = useState(false);
  const [punto, setPunto] = useState({ direccion: '', comuna: '', contactoNombre: '', contactoTelefono: '' });
  const [numeros, setNumeros] = useState({ notaVentaNumero: '', guiaDespachoNumero: '' });
  const [firmandoActa, setFirmandoActa] = useState(false);
  const [firmandoGuia, setFirmandoGuia] = useState(false);
  const [conformidad, setConformidad] = useState<'CONFORME' | 'NO_CONFORME'>('CONFORME');

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/compras/${negocioId}/entrega`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar');
      setEntrega(data.entrega);
      setNumeros({ notaVentaNumero: data.entrega.notaVentaNumero || '', guiaDespachoNumero: data.entrega.guiaDespachoNumero || '' });
    } catch (e: any) {
      toast.error('No se pudo cargar la entrega', e.message);
    } finally {
      setLoading(false);
    }
  }, [negocioId]);

  useEffect(() => { cargar(); }, [cargar]);

  const accion = async (body: Record<string, unknown>) => {
    setGuardando(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/entrega`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo actualizar');
      setEntrega(data.entrega);
      return true;
    } catch (e: any) {
      toast.error('No se pudo actualizar', e.message);
      return false;
    } finally {
      setGuardando(false);
    }
  };

  if (loading || !entrega) return <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>;

  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-zinc-50 border-b border-zinc-100">
        <p className="text-[12.5px] font-bold text-zinc-700 flex items-center gap-1.5">
          <PackageCheck size={14} /> Entrega del proyecto
          {entrega.cerradaAt && <span className="text-[10.5px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">Cerrada</span>}
        </p>
      </div>

      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={entrega.modalidad} disabled={!puedeOperar} minWidth={140}
            onChange={v => { if (v === 'PARCIAL') { const motivo = window.prompt('Motivo (excepcional, a petición del cliente — spec §16.2):'); if (!motivo?.trim()) return; accion({ accion: 'modalidad', modalidad: v, motivo }); } else accion({ accion: 'modalidad', modalidad: v }); }}
            options={[{ value: 'TOTAL', label: 'Entrega total' }, { value: 'PARCIAL', label: 'Entrega parcial' }]} />
          {entrega.modalidadMotivo && <span className="text-[11px] text-zinc-400">{entrega.modalidadMotivo}</span>}
        </div>

        {/* Puntos de entrega múltiples (§16.2) */}
        <div>
          <div className="flex items-center justify-between">
            <p className="text-[10.5px] font-bold text-zinc-400 uppercase">Puntos de entrega</p>
            {puedeOperar && <button onClick={() => setFormPunto(v => !v)} className="text-[11px] font-semibold text-teal-700 hover:text-teal-800 flex items-center gap-0.5"><Plus size={11} /> Agregar</button>}
          </div>
          {entrega.puntos.map(p => (
            <div key={p.id} className="flex items-center justify-between gap-2 bg-zinc-50 rounded-lg px-2 py-1 mt-1">
              <span className="text-[11.5px] text-zinc-600">{p.direccion}{p.comuna && `, ${p.comuna}`}</span>
              {puedeOperar && <button onClick={() => accion({ accion: 'punto_quitar', puntoId: p.id })} className="text-zinc-400 hover:text-rose-600"><Trash2 size={12} /></button>}
            </div>
          ))}
          {formPunto && (
            <div className="mt-1.5 space-y-1.5">
              <input value={punto.direccion} onChange={e => setPunto(f => ({ ...f, direccion: e.target.value }))} placeholder="Dirección"
                className="w-full text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <div className="flex items-center gap-1.5">
                <button onClick={async () => { if (await accion({ accion: 'punto_agregar', ...punto })) { setPunto({ direccion: '', comuna: '', contactoNombre: '', contactoTelefono: '' }); setFormPunto(false); } }}
                  disabled={!punto.direccion.trim()} className="text-[11px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-2.5 py-1 rounded-lg">Guardar</button>
                <button onClick={() => setFormPunto(false)} className="text-zinc-400 hover:text-zinc-600"><X size={14} /></button>
              </div>
            </div>
          )}
        </div>

        {/* Verificación (§16.4) */}
        <div className="flex items-center gap-2">
          <p className="text-[10.5px] font-bold text-zinc-400 uppercase">Verificación</p>
          {entrega.verificacionConforme != null ? (
            <span className={`text-[10.5px] font-bold px-1.5 py-0.5 rounded-full border ${entrega.verificacionConforme ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-rose-700 bg-rose-50 border-rose-200'}`}>
              {entrega.verificacionConforme ? 'Conforme' : 'No conforme'} — {entrega.verificacionPorNombre}
            </span>
          ) : (puedeOperar || puedeVerificar) ? (
            <div className="flex items-center gap-1.5">
              <button onClick={() => accion({ accion: 'verificacion', conforme: true })} className="flex items-center gap-1 text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 px-2 py-1 rounded-lg"><CheckCircle2 size={11} /> Conforme</button>
              <button onClick={() => accion({ accion: 'verificacion', conforme: false })} className="flex items-center gap-1 text-[11px] font-semibold text-white bg-rose-600 hover:bg-rose-700 px-2 py-1 rounded-lg"><XCircle size={11} /> No conforme</button>
            </div>
          ) : <span className="text-[11px] text-zinc-400">Pendiente</span>}
        </div>

        {/* Números de OBUMA (§16.4/§17.2 — el módulo solo los registra) */}
        <div className="grid grid-cols-2 gap-2">
          <input value={numeros.notaVentaNumero} onChange={e => setNumeros(f => ({ ...f, notaVentaNumero: e.target.value }))}
            onBlur={() => numeros.notaVentaNumero && accion({ accion: 'numeros', notaVentaNumero: numeros.notaVentaNumero })}
            placeholder="N° nota de venta (OBUMA)" disabled={!puedeOperar}
            className="text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
          <input value={numeros.guiaDespachoNumero} onChange={e => setNumeros(f => ({ ...f, guiaDespachoNumero: e.target.value }))}
            onBlur={() => numeros.guiaDespachoNumero && accion({ accion: 'numeros', guiaDespachoNumero: numeros.guiaDespachoNumero })}
            placeholder="N° guía de despacho (OBUMA)" disabled={!puedeOperar}
            className="text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
        </div>

        {/* Acta de entrega (§16.5) */}
        <div className="pt-2 border-t border-zinc-100 space-y-2">
          <p className="text-[10.5px] font-bold text-zinc-400 uppercase flex items-center gap-1"><FileSignature size={11} /> Acta de entrega</p>
          {!entrega.actaGeneradaAt ? (
            puedeOperar && <button onClick={() => accion({ accion: 'generar_acta' })} disabled={guardando} className="text-[11.5px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-2.5 py-1.5 rounded-lg">Generar acta</button>
          ) : !entrega.actaAprobadaAt ? (
            <>
              <Banner variante="info">Acta generada {entrega.actaGeneradaAt}.</Banner>
              {puedeOperar && <button onClick={() => accion({ accion: 'aprobar_acta' })} disabled={guardando} className="text-[11.5px] font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 px-2.5 py-1.5 rounded-lg">Aprobar acta (encargado de compras)</button>}
            </>
          ) : !entrega.actaFirma ? (
            <>
              <Banner variante="info">Acta aprobada por {entrega.actaAprobadaPorNombre} — lista para firmarse.</Banner>
              {puedeOperar && (
                <div className="space-y-1.5">
                  <Select value={conformidad} onChange={v => setConformidad(v as any)} minWidth={140}
                    options={[{ value: 'CONFORME', label: 'Conforme' }, { value: 'NO_CONFORME', label: 'No conforme' }]} />
                  <FormFirma guardando={guardando} onGuardar={f => accion({ accion: 'firmar_acta', firma: f, conformidad })} />
                </div>
              )}
            </>
          ) : (
            <p className="text-[11.5px] text-zinc-600">Firmado por <b>{entrega.actaFirma.nombre}</b> ({entrega.actaFirma.cargo}) — {entrega.actaConformidad === 'CONFORME' ? 'Conforme' : 'No conforme'}, {entrega.actaFirma.fecha}</p>
          )}
        </div>

        {/* Firma de la guía (§16.6) */}
        <div className="pt-2 border-t border-zinc-100 space-y-2">
          <p className="text-[10.5px] font-bold text-zinc-400 uppercase">Firma de la guía de despacho</p>
          {!entrega.guiaFirma ? (
            puedeOperar && <FormFirma guardando={guardando} onGuardar={f => accion({ accion: 'firmar_guia', firma: f, timbre: false })} />
          ) : (
            <p className="text-[11.5px] text-zinc-600">Firmada por <b>{entrega.guiaFirma.nombre}</b> ({entrega.guiaFirma.cargo}) — {entrega.guiaFirma.fecha}{entrega.guiaTimbre && ' · con timbre'}</p>
          )}
        </div>

        {entrega.cerradaAt && <Banner variante="success">Ciclo de entrega cerrado {entrega.cerradaAt} (spec §16.7).</Banner>}
      </div>
    </div>
  );
}
