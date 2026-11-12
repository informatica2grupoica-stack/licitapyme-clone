'use client';

// POSTVENTA (spec §17.1) — los compromisos ya vienen del resumen ejecutivo (paquete de traspaso);
// acá solo se marcan como resueltos. "El servicio técnico no interviene en el módulo" — esto es
// solo la lista de seguimiento del encargado de compras/entrega.
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { useCompras } from '@/app/compras/[negocioId]/ComprasContext';
import { IconShieldCheck as ShieldCheck, IconLoader2 as Loader2, IconCircleCheck as CheckCircle2, IconCircle as Circle } from '@tabler/icons-react';

interface Compromiso { titulo: string; descripcion: string | null; resuelto: boolean; resueltoPorNombre: string | null }
interface DeDocumento { titulo: string; texto: string; fuente: string }
interface Garantia { titulo: string; descripcion: string | null }

export function PostventaCard({ negocioId, puedeOperar }: { negocioId: number; puedeOperar: boolean }) {
  const toast = useToast();
  const { recargar: recargarCompartido } = useCompras();
  const [compromisos, setCompromisos] = useState<Compromiso[]>([]);
  const [garantias, setGarantias] = useState<Garantia[]>([]);
  const [deDocs, setDeDocs] = useState<DeDocumento[]>([]);
  const [loading, setLoading] = useState(true);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/compras/${negocioId}/postventa`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar');
      setCompromisos(data.compromisos || []); setGarantias(data.garantias || []); setDeDocs(data.deDocumentos || []);
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
      recargarCompartido();
    } catch (e: any) {
      toast.error('No se pudo actualizar', e.message);
    }
  };


  if (loading) return null;
  // Sin garantías ni compromisos la pestaña ni se muestra (ver useHayPostventa); esto es solo por si se abre igual.
  if (compromisos.length === 0 && garantias.length === 0 && deDocs.length === 0) return null;

  const pendientes = compromisos.filter(c => !c.resuelto).length;

  return (
    <div className="space-y-3" data-testid="postventa">
      {garantias.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {garantias.map((g, i) => {
            const meses = g.descripcion?.match(/(\d+)\s*meses/i)?.[1];
            const v = g.descripcion?.match(/vence\s+(\d{2})-(\d{2})-(\d{4})/i);
            const vence = v ? new Date(Number(v[3]), Number(v[2]) - 1, Number(v[1])) : null;
            const dias = vence ? Math.ceil((vence.getTime() - Date.now()) / 86400000) : null;
            return (
              <div key={`g-${i}`} className="bg-white rounded-xl border border-zinc-200 p-4 flex gap-3">
                <div className="flex-shrink-0 h-10 w-10 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center"><ShieldCheck size={20} /></div>
                <div className="min-w-0">
                  <p className="text-[11px] font-bold text-zinc-500 uppercase">{g.titulo}</p>
                  {meses && <p className="text-[20px] font-bold text-zinc-900 leading-tight">{meses} meses</p>}
                  <p className="text-[12px] text-zinc-600 mt-0.5">{g.descripcion}</p>
                  {dias != null && (
                    <p className={`mt-2 inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full border ${dias < 0 ? 'bg-zinc-100 text-zinc-500 border-zinc-200' : dias <= 30 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                      {dias < 0 ? 'Vencida' : `Vigente · quedan ${dias} días`}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {deDocs.length > 0 && (
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <p className="px-4 py-2.5 text-[11px] font-bold text-zinc-500 uppercase bg-zinc-50 border-b border-zinc-100">Lo que dicen las bases y nuestra oferta</p>
          <div className="divide-y divide-zinc-100">
            {deDocs.map((d, i) => (
              <div key={i} className="px-4 py-2.5">
                <p className="text-[12.5px] font-semibold text-zinc-800">{d.titulo}</p>
                <p className="text-[12px] text-zinc-600">{d.texto}</p>
                <p className="text-[10.5px] text-zinc-400 mt-0.5">Fuente: {d.fuente}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {compromisos.length > 0 && (
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <p className="px-4 py-2.5 text-[11px] font-bold text-zinc-500 uppercase bg-zinc-50 border-b border-zinc-100">
            Compromisos después de entregar · {pendientes === 0 ? 'todos cumplidos' : `${pendientes} pendiente${pendientes === 1 ? '' : 's'}`}
          </p>
          <div className="divide-y divide-zinc-100">
            {compromisos.map(c => (
              <div key={c.titulo} className="px-4 py-2.5 flex items-start gap-2">
                <button onClick={() => puedeOperar && alternar(c.titulo, c.resuelto)} disabled={!puedeOperar} className="flex-shrink-0 mt-0.5">
                  {c.resuelto ? <CheckCircle2 size={16} className="text-emerald-500" /> : <Circle size={16} className="text-zinc-300" />}
                </button>
                <div>
                  <p className={`text-[12.5px] ${c.resuelto ? 'text-zinc-400 line-through' : 'text-zinc-800'}`}>{c.titulo}</p>
                  {c.descripcion && <p className="text-[11.5px] text-zinc-500">{c.descripcion}</p>}
                  {c.resuelto && c.resueltoPorNombre && <p className="text-[10.5px] text-zinc-400">Cumplido por {c.resueltoPorNombre}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Para que ComprasChrome oculte la pestaña cuando el negocio no tiene nada que cumplir después de entregar.
export function useHayPostventa(negocioId: number): boolean {
  const [hay, setHay] = useState(false);
  useEffect(() => {
    let vivo = true;
    fetch(`/api/compras/${negocioId}/postventa`).then(r => r.json()).then(d => {
      if (vivo) setHay(!!d?.success && ((d.compromisos?.length || 0) + (d.garantias?.length || 0) + (d.deDocumentos?.length || 0) > 0));
    }).catch(() => {});
    return () => { vivo = false; };
  }, [negocioId]);
  return hay;
}
