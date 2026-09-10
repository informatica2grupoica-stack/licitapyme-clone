'use client';

// RUTA DE IMPORTACIÓN Y COSTEO ATERRIZADO (spec §12). Solo se muestra completo cuando el origen es
// IMPORTACION: "la cotización FOB no es el costo del producto" — acá se suma flete internacional +
// aduana + logística local, prorrateados POR UNIDAD, para saber el costo real puesto en bodega.
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { Select } from '@/app/components/ui/Select';
import { Banner } from '@/app/components/ui/Banner';
import { Ship, Loader2, Save } from 'lucide-react';

type Origen = 'LOCAL' | 'IMPORTACION';
interface Embarque { fleteInternacional: number | null; costosAduana: number | null; costoLogisticoLocal: number | null; notas: string | null }
interface ItemAterrizado { productoId: number; descripcion: string; proveedor: string | null; cantidad: number | null; precioUnitarioFob: number | null; costoUnitarioAterrizado: number | null; subtotalAterrizado: number | null }
interface CostoAterrizado { items: ItemAterrizado[]; totalUnidades: number; extraPorUnidad: number; totalAterrizado: number; totalFob: number }

const fmtCLP = (n: number | null) => n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

export function ImportacionCard({ negocioId, puedeOperar }: { negocioId: number; puedeOperar: boolean }) {
  const toast = useToast();
  const [origen, setOrigen] = useState<Origen | null>(null);
  const [embarque, setEmbarque] = useState<Embarque | null>(null);
  const [costoAterrizado, setCostoAterrizado] = useState<CostoAterrizado | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ fleteInternacional: '', costosAduana: '', costoLogisticoLocal: '', notas: '' });
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/compras/${negocioId}/importacion`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar');
      setOrigen(data.origen?.origen || null);
      setEmbarque(data.embarque);
      setCostoAterrizado(data.costoAterrizado);
      if (data.embarque) setForm({
        fleteInternacional: data.embarque.fleteInternacional != null ? String(data.embarque.fleteInternacional) : '',
        costosAduana: data.embarque.costosAduana != null ? String(data.embarque.costosAduana) : '',
        costoLogisticoLocal: data.embarque.costoLogisticoLocal != null ? String(data.embarque.costoLogisticoLocal) : '',
        notas: data.embarque.notas || '',
      });
    } catch (e: any) {
      toast.error('No se pudo cargar la ruta de importación', e.message);
    } finally {
      setLoading(false);
    }
  }, [negocioId]);

  useEffect(() => { cargar(); }, [cargar]);

  const definirOrigen = async (v: string) => {
    try {
      const res = await fetch(`/api/compras/${negocioId}/importacion`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'origen', origen: v }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo definir');
      setOrigen(data.origen?.origen || null); setCostoAterrizado(data.costoAterrizado);
    } catch (e: any) {
      toast.error('No se pudo definir el origen', e.message);
    }
  };

  const guardarEmbarque = async () => {
    setGuardando(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/importacion`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'embarque', ...form }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo guardar');
      toast.success('Datos del embarque guardados');
      setEmbarque(data.embarque); setCostoAterrizado(data.costoAterrizado);
    } catch (e: any) {
      toast.error('No se pudo guardar', e.message);
    } finally {
      setGuardando(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>;

  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-zinc-50 border-b border-zinc-100">
        <p className="text-[12.5px] font-bold text-zinc-700 flex items-center gap-1.5"><Ship size={14} /> Ruta de importación</p>
        <Select value={origen || ''} onChange={definirOrigen} disabled={!puedeOperar} placeholder="Clasificar origen…" minWidth={150}
          options={[{ value: 'LOCAL', label: 'Compra local' }, { value: 'IMPORTACION', label: 'Importación' }]} />
      </div>

      {origen === 'IMPORTACION' && (
        <div className="p-4 space-y-3">
          <Banner variante="info">Comunicación asincrónica con el proveedor (no telefónica) — toda la decisión se toma sobre datos técnicos formales: proforma invoice + ficha técnica (spec §12.2).</Banner>

          <p className="text-[10.5px] font-bold text-zinc-400 uppercase">Datos del embarque</p>
          <div className="grid grid-cols-3 gap-2">
            <label className="text-[11px] font-semibold text-zinc-500">
              Flete internacional (global)
              <input inputMode="numeric" value={form.fleteInternacional} onChange={e => setForm(f => ({ ...f, fleteInternacional: e.target.value }))} disabled={!puedeOperar}
                className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
            </label>
            <label className="text-[11px] font-semibold text-zinc-500">
              Costos de aduana
              <input inputMode="numeric" value={form.costosAduana} onChange={e => setForm(f => ({ ...f, costosAduana: e.target.value }))} disabled={!puedeOperar}
                className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
            </label>
            <label className="text-[11px] font-semibold text-zinc-500">
              Logística local (desaduanaje + traslado)
              <input inputMode="numeric" value={form.costoLogisticoLocal} onChange={e => setForm(f => ({ ...f, costoLogisticoLocal: e.target.value }))} disabled={!puedeOperar}
                className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
            </label>
          </div>
          {puedeOperar && (
            <button onClick={guardarEmbarque} disabled={guardando} className="flex items-center gap-1.5 text-[12px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-3 py-1.5 rounded-lg">
              {guardando ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Guardar
            </button>
          )}

          {costoAterrizado ? (
            <div className="pt-2 border-t border-zinc-100">
              <p className="text-[10.5px] font-bold text-zinc-400 uppercase mb-1.5">Costo aterrizado (§12.3) — prorrateo ${Math.round(costoAterrizado.extraPorUnidad).toLocaleString('es-CL')} por unidad</p>
              <div className="space-y-1">
                {costoAterrizado.items.map(it => (
                  <div key={it.productoId} className="flex items-center justify-between gap-2 bg-zinc-50 rounded-lg px-2.5 py-1.5">
                    <span className="text-[11.5px] text-zinc-600 truncate">{it.descripcion}</span>
                    <span className="text-[11.5px] font-semibold text-zinc-800 flex-shrink-0">
                      FOB {fmtCLP(it.precioUnitarioFob)} → <b>{fmtCLP(it.costoUnitarioAterrizado)}</b>
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between mt-2 px-1">
                <span className="text-[12px] font-bold text-zinc-700">Total aterrizado</span>
                <span className="text-[14px] font-bold text-zinc-900">{fmtCLP(costoAterrizado.totalAterrizado)}</span>
              </div>
              <p className="text-[10.5px] text-zinc-400 px-1">FOB total {fmtCLP(costoAterrizado.totalFob)} — esta cifra (no el FOB) es la que alimenta el margen y la Compuerta 2 (spec §12.5).</p>
            </div>
          ) : (
            <p className="text-[11px] text-zinc-400">Falta elegir un escenario en el Auditor de Compras y/o completar los datos del embarque para calcular el costo aterrizado.</p>
          )}
        </div>
      )}
    </div>
  );
}
