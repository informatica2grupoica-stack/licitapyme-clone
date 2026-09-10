'use client';

// ESTADO DE FRACASO (spec §14.6) — doble registro deliberadamente separado: el encargado declara
// SU motivo, el jefe de ventas dictamina el motivo REAL tras un análisis independiente. Colapsado
// por defecto: es una acción rara y seria, no algo que deba competir visualmente con el resto.
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { AlertOctagon, Loader2, ChevronDown, ChevronUp } from 'lucide-react';

interface Fracaso {
  motivoDeclarado: string; declaradoPorNombre: string | null; declaradoAt: string;
  dictamenJefeVentas: string | null; dictaminadoPorNombre: string | null; dictaminadoAt: string | null;
}

export function FracasoCard({ negocioId, puedeOperar, esJefeDeVentas }: { negocioId: number; puedeOperar: boolean; esJefeDeVentas: boolean }) {
  const toast = useToast();
  const [fracaso, setFracaso] = useState<Fracaso | null>(null);
  const [loading, setLoading] = useState(true);
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [dictamen, setDictamen] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/compras/${negocioId}/fracaso`);
      const data = await res.json();
      if (res.ok && data.success) setFracaso(data.fracaso);
    } catch { /* no bloquea el resto de la pantalla */ }
    finally { setLoading(false); }
  }, [negocioId]);

  useEffect(() => { cargar(); }, [cargar]);

  const declarar = async () => {
    if (!motivo.trim()) return;
    setGuardando(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/fracaso`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ motivo: motivo.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo declarar');
      setFracaso(data.fracaso); setMotivo('');
    } catch (e: any) {
      toast.error('No se pudo declarar el fracaso', e.message);
    } finally {
      setGuardando(false);
    }
  };

  const dictaminarAccion = async () => {
    if (!dictamen.trim()) return;
    setGuardando(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/fracaso`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dictamen: dictamen.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo dictaminar');
      setFracaso(data.fracaso); setDictamen('');
      toast.success('Dictamen registrado');
    } catch (e: any) {
      toast.error('No se pudo dictaminar', e.message);
    } finally {
      setGuardando(false);
    }
  };

  if (loading) return null;
  if (!abierto && !fracaso) {
    return puedeOperar ? (
      <button onClick={() => setAbierto(true)} className="text-[11px] font-semibold text-zinc-400 hover:text-rose-600 flex items-center gap-1 px-1">
        <AlertOctagon size={12} /> Este proyecto no se pudo entregar…
      </button>
    ) : null;
  }

  return (
    <div className="bg-white rounded-xl border border-rose-200 overflow-hidden">
      <button onClick={() => setAbierto(v => !v)} className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-rose-50 border-b border-rose-100">
        <p className="text-[12.5px] font-bold text-rose-800 flex items-center gap-1.5"><AlertOctagon size={14} /> Estado de fracaso</p>
        {abierto ? <ChevronUp size={15} className="text-rose-400" /> : <ChevronDown size={15} className="text-rose-400" />}
      </button>
      {abierto && (
        <div className="p-4 space-y-3">
          {!fracaso ? (
            puedeOperar && (
              <div className="space-y-2">
                <p className="text-[11.5px] text-zinc-500">El encargado de entrega verifica que no se puede entregar y declara los motivos (spec §14.6).</p>
                <textarea rows={2} value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Motivo declarado…"
                  className="w-full text-[12px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-rose-500" />
                <button onClick={declarar} disabled={!motivo.trim() || guardando} className="text-[12px] font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 px-3 py-1.5 rounded-lg">
                  {guardando ? <Loader2 size={13} className="animate-spin" /> : 'Declarar fracaso'}
                </button>
              </div>
            )
          ) : (
            <>
              <div className="bg-zinc-50 rounded-lg p-2.5">
                <p className="text-[10px] font-bold text-zinc-400 uppercase">Declarado por {fracaso.declaradoPorNombre}</p>
                <p className="text-[12px] text-zinc-700 mt-0.5">{fracaso.motivoDeclarado}</p>
              </div>
              {fracaso.dictamenJefeVentas ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                  <p className="text-[10px] font-bold text-amber-600 uppercase">Dictamen del jefe de ventas — {fracaso.dictaminadoPorNombre}</p>
                  <p className="text-[12px] text-amber-800 mt-0.5">{fracaso.dictamenJefeVentas}</p>
                </div>
              ) : esJefeDeVentas ? (
                <div className="space-y-2">
                  <p className="text-[11.5px] text-zinc-500">Análisis independiente: revisa el histórico de tareas realizadas y no realizadas antes de dictaminar (spec §18.5).</p>
                  <textarea rows={2} value={dictamen} onChange={e => setDictamen(e.target.value)} placeholder="Dictamen — el motivo real…"
                    className="w-full text-[12px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-amber-500" />
                  <button onClick={dictaminarAccion} disabled={!dictamen.trim() || guardando} className="text-[12px] font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 px-3 py-1.5 rounded-lg">
                    {guardando ? <Loader2 size={13} className="animate-spin" /> : 'Registrar dictamen'}
                  </button>
                </div>
              ) : (
                <p className="text-[11px] text-zinc-400">Pendiente de dictamen del jefe de ventas.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
