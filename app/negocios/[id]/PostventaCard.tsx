'use client';

// POSTVENTA (spec §17.1) — los compromisos ya vienen del resumen ejecutivo (paquete de traspaso);
// acá solo se marcan como resueltos. "El servicio técnico no interviene en el módulo" — esto es
// solo la lista de seguimiento del encargado de compras/entrega.
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { ShieldCheck, Loader2, CheckCircle2, Circle } from 'lucide-react';

interface Compromiso { titulo: string; descripcion: string | null; resuelto: boolean; resueltoPorNombre: string | null }
interface Garantia { titulo: string; descripcion: string | null }

export function PostventaCard({ negocioId, puedeOperar }: { negocioId: number; puedeOperar: boolean }) {
  const toast = useToast();
  const [compromisos, setCompromisos] = useState<Compromiso[]>([]);
  const [garantias, setGarantias] = useState<Garantia[]>([]);
  const [loading, setLoading] = useState(true);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/compras/${negocioId}/postventa`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar');
      setCompromisos(data.compromisos || []); setGarantias(data.garantias || []);
    } catch (e: any) {
      toast.error('No se pudo cargar la postventa', e.message);
    } finally {
      setLoading(false);
    }
  }, [negocioId]);

  useEffect(() => { cargar(); }, [cargar]);

  const alternar = async (titulo: string, resuelto: boolean) => {
    try {
      const res = await fetch(`/api/compras/${negocioId}/postventa`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ compromisoTexto: titulo, resuelto: !resuelto }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo actualizar');
      await cargar();
    } catch (e: any) {
      toast.error('No se pudo actualizar', e.message);
    }
  };

  if (loading) return null;
  if (compromisos.length === 0 && garantias.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
      <p className="px-4 py-2.5 text-[11px] font-bold text-zinc-500 uppercase bg-zinc-50 border-b border-zinc-100 flex items-center gap-1.5"><ShieldCheck size={13} /> Postventa y garantías</p>
      <div className="divide-y divide-zinc-100">
        {garantias.map((g, i) => (
          <div key={`g-${i}`} className="px-4 py-2 flex items-center gap-2">
            <span className="text-[9.5px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">Garantía</span>
            <span className="text-[12px] text-zinc-700">{g.titulo}</span>
          </div>
        ))}
        {compromisos.map(c => (
          <div key={c.titulo} className="px-4 py-2 flex items-center gap-2">
            <button onClick={() => puedeOperar && alternar(c.titulo, c.resuelto)} disabled={!puedeOperar} className="flex-shrink-0">
              {c.resuelto ? <CheckCircle2 size={15} className="text-emerald-500" /> : <Circle size={15} className="text-zinc-300" />}
            </button>
            <span className={`text-[12px] ${c.resuelto ? 'text-zinc-400 line-through' : 'text-zinc-700'}`}>{c.titulo}</span>
            {c.resuelto && c.resueltoPorNombre && <span className="text-[10.5px] text-zinc-400">— {c.resueltoPorNombre}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
