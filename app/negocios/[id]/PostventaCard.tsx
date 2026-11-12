'use client';

// POSTVENTA (spec §17.1) — los compromisos ya vienen del resumen ejecutivo (paquete de traspaso);
// acá solo se marcan como resueltos. "El servicio técnico no interviene en el módulo" — esto es
// solo la lista de seguimiento del encargado de compras/entrega.
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { useCompras } from '@/app/compras/[negocioId]/ComprasContext';
import { DocumentViewerModal, type VisorDoc } from '@/app/components/DocumentViewerModal';
import { MiniaturaDoc, urlInline } from './MiniaturaDoc';
import { IconShieldCheck as ShieldCheck, IconLoader2 as Loader2, IconCircleCheck as CheckCircle2, IconCircle as Circle } from '@tabler/icons-react';

interface Compromiso { titulo: string; descripcion: string | null; resuelto: boolean; resueltoPorNombre: string | null }
interface DeDocumento { titulo: string; texto: string; fuente: string; fuenteUrl: string | null; clave: string; textoLeido: string; corregido: boolean; corregidoPor: string | null }
interface Garantia { titulo: string; descripcion: string | null }

// Caché de la sesión: la pestaña sale al instante al volver y se refresca por detrás.
const CACHE_PV = new Map<number, any>();

export function PostventaCard({ negocioId, puedeOperar }: { negocioId: number; puedeOperar: boolean }) {
  const toast = useToast();
  const { recargar: recargarCompartido } = useCompras();
  const [compromisos, setCompromisos] = useState<Compromiso[]>(CACHE_PV.get(negocioId)?.compromisos || []);
  const [garantias, setGarantias] = useState<Garantia[]>(CACHE_PV.get(negocioId)?.garantias || []);
  const [deDocs, setDeDocs] = useState<DeDocumento[]>(CACHE_PV.get(negocioId)?.deDocumentos || []);
  const [visor, setVisor] = useState<VisorDoc | null>(null);
  const [editando, setEditando] = useState<{ clave: string; texto: string } | null>(null);
  const [loading, setLoading] = useState(!CACHE_PV.has(negocioId));

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/compras/${negocioId}/postventa`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar');
      CACHE_PV.set(negocioId, data);
      setCompromisos(data.compromisos || []); setGarantias(data.garantias || []); setDeDocs(data.deDocumentos || []);
    } catch (e: any) {
      toast.error('No se pudo cargar la postventa', e.message);
    } finally {
      setLoading(false);
    }
  }, [negocioId]);

  useEffect(() => { cargar(); }, [cargar]);

  // Corregir lo que se leyó del documento (texto vacío = volver a lo que dice el documento).
  const corregir = async (clave: string, texto: string) => {
    try {
      const res = await fetch(`/api/compras/${negocioId}/postventa`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'corregir', clave, texto }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo guardar');
      setEditando(null);
      await cargar();
    } catch (e: any) {
      toast.error('No se pudo guardar la corrección', e.message);
    }
  };

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
      <DocumentViewerModal doc={visor} onClose={() => setVisor(null)} />
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
          <p className="px-4 py-2.5 text-[11px] font-bold text-zinc-500 uppercase bg-zinc-50 border-b border-zinc-100">Lo que dicen las bases y nuestra oferta · leído de los documentos, se puede corregir</p>
          <div className="px-4 py-3 border-b border-zinc-100">
            <p className="text-[11px] text-zinc-500 mb-2">Documentos de donde se leyó (pincha para verlos):</p>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {Array.from(new Map(deDocs.filter(d => d.fuenteUrl).map(d => [d.fuente, d])).values()).map(d => (
                <MiniaturaDoc key={d.fuente} src={urlInline(d.fuenteUrl!)} titulo={d.fuente.replace(/\.pdf$/i, '')} onAbrir={() => setVisor({ nombre: d.fuente, url: d.fuenteUrl! })} />
              ))}
            </div>
          </div>
          <div className="divide-y divide-zinc-100">
            {deDocs.map(d => (
              <div key={d.clave} className="px-4 py-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[12.5px] font-semibold text-zinc-800">{d.titulo}</p>
                  {d.corregido && <span className="text-[10px] font-bold text-sky-700 bg-sky-50 border border-sky-200 px-1.5 py-0.5 rounded-full">Corregido{d.corregidoPor ? ` por ${d.corregidoPor}` : ''}</span>}
                </div>
                {editando?.clave === d.clave ? (
                  <div className="mt-1.5">
                    <textarea value={editando.texto} onChange={e => setEditando({ clave: d.clave, texto: e.target.value })} rows={3}
                      className="w-full text-[12px] text-zinc-800 border border-zinc-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-teal-500" />
                    <div className="flex gap-3 mt-1.5 text-[11.5px] font-semibold">
                      <button type="button" onClick={() => corregir(d.clave, editando.texto)} className="text-teal-700 hover:text-teal-900">Guardar</button>
                      <button type="button" onClick={() => setEditando(null)} className="text-zinc-500 hover:text-zinc-700">Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <p className="text-[12px] text-zinc-600">{d.texto}</p>
                )}
                <div className="flex gap-3 mt-1 text-[11px] flex-wrap">
                  {d.fuenteUrl
                    ? <button type="button" onClick={() => setVisor({ nombre: d.fuente, url: d.fuenteUrl! })} className="text-teal-700 hover:text-teal-900 font-medium">Ver en {d.fuente}</button>
                    : <span className="text-zinc-400">Fuente: {d.fuente}</span>}
                  {puedeOperar && editando?.clave !== d.clave && <button type="button" onClick={() => setEditando({ clave: d.clave, texto: d.texto })} className="text-zinc-500 hover:text-zinc-800 font-medium">Corregir</button>}
                  {puedeOperar && d.corregido && <button type="button" onClick={() => corregir(d.clave, '')} className="text-zinc-400 hover:text-zinc-700">Volver a lo que dice el documento</button>}
                </div>
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
  const c0 = CACHE_PV.get(negocioId);
  const [hay, setHay] = useState(!!c0 && ((c0.compromisos?.length || 0) + (c0.garantias?.length || 0) + (c0.deDocumentos?.length || 0) > 0));
  useEffect(() => {
    let vivo = true;
    fetch(`/api/compras/${negocioId}/postventa`).then(r => r.json()).then(d => {
      if (d?.success) CACHE_PV.set(negocioId, d);
      if (vivo) setHay(!!d?.success && ((d.compromisos?.length || 0) + (d.garantias?.length || 0) + (d.deDocumentos?.length || 0) > 0));
    }).catch(() => {});
    return () => { vivo = false; };
  }, [negocioId]);
  return hay;
}
