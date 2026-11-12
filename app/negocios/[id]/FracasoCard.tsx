'use client';

// ESTADO DE FRACASO (spec §14.6) — doble registro deliberadamente separado: el encargado declara
// SU motivo, el jefe de ventas dictamina el motivo REAL tras un análisis independiente. Es una acción
// seria: el formulario se ve siempre en la pestaña, pero declarar pide una confirmación explícita.
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { useCompras } from '@/app/compras/[negocioId]/ComprasContext';
import { IconAlertOctagon as AlertOctagon, IconLoader2 as Loader2, IconCircleCheck as CheckCircle2 } from '@tabler/icons-react';

// Causas habituales: solo rellenan el motivo (el texto sigue siendo libre).
const CAUSAS = ['El proveedor no puede despachar', 'Sin stock y sin alternativa', 'Producto descontinuado', 'El cliente canceló o no recibe', 'Plazo de entrega vencido', 'Problema con el pago o la factura'];

interface Fracaso {
  motivoDeclarado: string; declaradoPorNombre: string | null; declaradoAt: string;
  dictamenJefeVentas: string | null; dictaminadoPorNombre: string | null; dictaminadoAt: string | null;
}

const SUPERFICIE = 'bg-white border border-linea rounded-2xl shadow-tarjeta dark:bg-slate-900 dark:border-slate-800';
const ROTULO = 'text-[11px] text-tinta-2/80 dark:text-slate-400';

export function FracasoCard({ negocioId, puedeOperar, esJefeDeVentas }: { negocioId: number; puedeOperar: boolean; esJefeDeVentas: boolean }) {
  const toast = useToast();
  const { recargar: recargarCompartido } = useCompras();
  const [fracaso, setFracaso] = useState<Fracaso | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmando, setConfirmando] = useState(false);
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
      setFracaso(data.fracaso); setMotivo(''); setConfirmando(false);
      recargarCompartido();
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
      recargarCompartido();
      toast.success('Dictamen registrado');
    } catch (e: any) {
      toast.error('No se pudo dictaminar', e.message);
    } finally {
      setGuardando(false);
    }
  };

  if (loading) return null;

  // Sin registro y sin permiso: se dice claro, en vez de dejar la pestaña casi vacía.
  if (!fracaso && !puedeOperar) {
    return <div className={SUPERFICIE + ' px-5 py-8 text-center text-xs text-tinta-2 dark:text-slate-400'}>Este proyecto no tiene un registro de fracaso.</div>;
  }

  const campo = 'w-full text-[12.5px] text-tinta dark:text-slate-100 bg-white dark:bg-slate-950 border border-linea dark:border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-marca';

  return (
    <div className={SUPERFICIE + ' overflow-hidden'} data-testid="fracaso">
      <div className="px-5 pt-4">
        <p className="flex items-center gap-2 text-[12.5px] font-medium text-tinta-2 dark:text-slate-300">
          <AlertOctagon size={15} className="text-slate-400" /> {fracaso ? 'Proyecto declarado como no entregable' : 'Si el proyecto no se puede entregar'}
        </p>
        <p className="mt-1 text-xs text-tinta-2 dark:text-slate-400 max-w-2xl">Se hace en dos pasos separados: el encargado declara el motivo y el jefe de ventas dictamina la causa real tras revisar qué se hizo y qué no.</p>
      </div>
      <div className="p-5 space-y-4">
        {!fracaso ? (
          <div className="space-y-3">
            <p className="text-[13px] font-medium text-tinta dark:text-slate-100">¿Por qué no se puede entregar?</p>
            <div className="flex flex-wrap gap-2">
              {CAUSAS.map(c => (
                <button key={c} type="button" onClick={() => setMotivo(m => (m.trim() ? m : c + '. '))}
                  className="text-xs text-tinta-2 dark:text-slate-300 border border-linea dark:border-slate-700 rounded-lg px-3 py-1.5 hover:border-marca hover:text-marca transition-colors duration-150">{c}</button>
              ))}
            </div>
            <textarea rows={3} value={motivo} onChange={e => { setMotivo(e.target.value); setConfirmando(false); }} placeholder="Explica el motivo: qué pasó, con quién se habló y cuándo…" className={campo} />
            {confirmando ? (
              <div className="flex items-center gap-4 flex-wrap border-t border-linea/80 dark:border-slate-800 pt-3">
                <p className="text-xs text-tinta dark:text-slate-100 flex-1 min-w-[200px]">Esto deja registrado el fracaso del proyecto y queda pendiente el dictamen del jefe de ventas. ¿Confirmas?</p>
                <button onClick={declarar} disabled={guardando} className="text-xs font-medium text-white bg-urgente hover:opacity-90 disabled:opacity-50 px-3.5 py-2 rounded-lg">
                  {guardando ? <Loader2 size={13} className="animate-spin" /> : 'Sí, declarar fracaso'}
                </button>
                <button onClick={() => setConfirmando(false)} className="text-xs font-medium text-tinta-2 hover:text-tinta dark:text-slate-400">Cancelar</button>
              </div>
            ) : (
              <button onClick={() => setConfirmando(true)} disabled={!motivo.trim()} className="text-xs font-medium text-white bg-urgente hover:opacity-90 disabled:opacity-40 px-3.5 py-2 rounded-lg">Declarar que no se puede entregar</button>
            )}
          </div>
        ) : (
          <>
            <div>
              <p className={ROTULO}>1 · Motivo declarado por {fracaso.declaradoPorNombre}</p>
              <p className="mt-0.5 text-[13px] text-tinta dark:text-slate-100">{fracaso.motivoDeclarado}</p>
            </div>
            {fracaso.dictamenJefeVentas ? (
              <div className="border-t border-linea/80 dark:border-slate-800 pt-4">
                <p className={ROTULO + ' flex items-center gap-1.5'}><CheckCircle2 size={12} className="text-exito" /> 2 · Dictamen del jefe de ventas — {fracaso.dictaminadoPorNombre}</p>
                <p className="mt-0.5 text-[13px] text-tinta dark:text-slate-100">{fracaso.dictamenJefeVentas}</p>
              </div>
            ) : esJefeDeVentas ? (
              <div className="space-y-2 border-t border-linea/80 dark:border-slate-800 pt-4">
                <p className="text-xs text-tinta-2 dark:text-slate-400">2 · Análisis independiente: revisa el histórico de tareas realizadas y no realizadas antes de dictaminar.</p>
                <textarea rows={3} value={dictamen} onChange={e => setDictamen(e.target.value)} placeholder="Dictamen — el motivo real…" className={campo} />
                <button onClick={dictaminarAccion} disabled={!dictamen.trim() || guardando} className="text-xs font-medium text-white bg-marca hover:bg-marca-fuerte disabled:opacity-50 px-3.5 py-2 rounded-lg">
                  {guardando ? <Loader2 size={13} className="animate-spin" /> : 'Registrar dictamen'}
                </button>
              </div>
            ) : (
              <p className="text-xs text-tinta-2 dark:text-slate-400 border-t border-linea/80 dark:border-slate-800 pt-4">2 · Pendiente del dictamen del jefe de ventas.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
