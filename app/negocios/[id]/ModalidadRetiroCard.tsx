'use client';

// MODALIDAD DE RETIRO (spec §13.2) — "se define en el primer instante... la define el humano, el
// sistema propone, no decide". Por eso este bloque NUNCA calcula nada: solo registra la elección.
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { Select } from '@/app/components/ui/Select';
import { Truck, Loader2 } from 'lucide-react';

type Modalidad = 'INTERNA' | 'EXTERNA' | 'MIXTA';
const MODALIDAD_LABEL: Record<Modalidad, string> = { INTERNA: 'Interna', EXTERNA: 'Externa', MIXTA: 'Mixta' };

export function ModalidadRetiroCard({ negocioId, puedeOperar }: { negocioId: number; puedeOperar: boolean }) {
  const toast = useToast();
  const [modalidad, setModalidad] = useState<Modalidad | null>(null);
  const [definidaPorNombre, setDefinidaPorNombre] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/compras/${negocioId}/modalidad-retiro`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar');
      setModalidad(data.modalidad); setDefinidaPorNombre(data.definidaPorNombre);
    } catch { /* no bloquea el resto de la pantalla */ }
    finally { setLoading(false); }
  }, [negocioId]);

  useEffect(() => { cargar(); }, [cargar]);

  const definir = async (v: string) => {
    setGuardando(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/modalidad-retiro`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modalidad: v }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo definir');
      setModalidad(data.modalidad); setDefinidaPorNombre(data.definidaPorNombre);
    } catch (e: any) {
      toast.error('No se pudo definir la modalidad', e.message);
    } finally {
      setGuardando(false);
    }
  };

  if (loading) return null;

  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-3.5 flex items-center justify-between gap-3 flex-wrap">
      <div>
        <p className="text-[11px] font-bold text-zinc-400 uppercase flex items-center gap-1.5"><Truck size={13} /> Modalidad de retiro</p>
        {modalidad && definidaPorNombre && <p className="text-[10.5px] text-zinc-400 mt-0.5">Definida por {definidaPorNombre}</p>}
      </div>
      {puedeOperar ? (
        <div className="flex items-center gap-2">
          {guardando && <Loader2 size={13} className="animate-spin text-zinc-400" />}
          <Select value={modalidad || ''} onChange={definir} placeholder="Elegir modalidad…" minWidth={140}
            options={(Object.keys(MODALIDAD_LABEL) as Modalidad[]).map(m => ({ value: m, label: MODALIDAD_LABEL[m] }))} />
        </div>
      ) : (
        <span className="text-[12px] font-semibold text-zinc-700">{modalidad ? MODALIDAD_LABEL[modalidad] : 'Sin definir'}</span>
      )}
    </div>
  );
}
