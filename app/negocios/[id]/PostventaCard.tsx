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

const SUPERFICIE = 'bg-white border border-linea rounded-2xl shadow-tarjeta dark:bg-slate-900 dark:border-slate-800';

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
    <div className="@container space-y-3" data-testid="postventa">
      <DocumentViewerModal doc={visor} onClose={() => setVisor(null)} />
      {garantias.length > 0 && (
        <div className="grid gap-3 @2xl:grid-cols-2">
          {garantias.map((g, i) => {
            const meses = g.descripcion?.match(/(\d+)\s*meses/i)?.[1];
            const v = g.descripcion?.match(/vence\s+(\d{2})-(\d{2})-(\d{4})/i);
            const vence = v ? new Date(Number(v[3]), Number(v[2]) - 1, Number(v[1])) : null;
            const dias = vence ? Math.ceil((vence.getTime() - Date.now()) / 86400000) : null;
            return (
              <section key={`g-${i}`} className={SUPERFICIE + ' p-5'}>
                <p className="flex items-center gap-2 text-[12.5px] font-medium text-tinta-2 dark:text-slate-300"><ShieldCheck size={15} className="text-slate-400" />{g.titulo}</p>
                {meses && <p className="mt-2 text-[30px] leading-none font-semibold tracking-tight tabular-nums text-tinta dark:text-slate-50">{meses} meses</p>}
                <p className="mt-2 text-xs text-tinta-2 dark:text-slate-400">{g.descripcion}</p>
                {dias != null && (
                  <p className="mt-3 pt-3 border-t border-linea/80 dark:border-slate-800 text-[13px] font-medium text-tinta dark:text-slate-100">
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden className={`w-1.5 h-1.5 rounded-full ${dias < 0 ? 'bg-slate-400' : dias <= 30 ? 'bg-alerta' : 'bg-exito'}`} />
                      {dias < 0 ? 'Vencida' : `Vigente · quedan ${dias} días`}
                    </span>
                  </p>
                )}
              </section>
            );
          })}
        </div>
      )}
      {deDocs.length > 0 && (
        <section className={SUPERFICIE + ' overflow-hidden'}>
          <div className="px-5 pt-4">
            <p className="text-[12.5px] font-medium text-tinta-2 dark:text-slate-300">Lo que dicen las bases y nuestra oferta</p>
            <p className="mt-1 text-xs text-tinta-2 dark:text-slate-400">Leído de los documentos. Si algo está mal, se corrige aquí.</p>
          </div>
          <div className="px-5 py-4 flex gap-3 overflow-x-auto">
            {Array.from(new Map(deDocs.filter(d => d.fuenteUrl).map(d => [d.fuente, d])).values()).map(d => (
              <MiniaturaDoc key={d.fuente} src={urlInline(d.fuenteUrl!)} titulo={d.fuente.replace(/\.pdf$/i, '')} onAbrir={() => setVisor({ nombre: d.fuente, url: d.fuenteUrl! })} />
            ))}
          </div>
          <div className="divide-y divide-linea/70 dark:divide-slate-800 border-t border-linea/80 dark:border-slate-800">
            {deDocs.map(d => (
              <div key={d.clave} className="px-5 py-3">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <p className="text-[13px] font-medium text-tinta dark:text-slate-100">{d.titulo}</p>
                  {d.corregido && <span className="text-xs text-marca">Corregido{d.corregidoPor ? ` por ${d.corregidoPor}` : ''}</span>}
                </div>
                {editando?.clave === d.clave ? (
                  <div className="mt-1.5">
                    <textarea value={editando.texto} onChange={e => setEditando({ clave: d.clave, texto: e.target.value })} rows={3}
                      className="w-full text-[12.5px] text-tinta dark:text-slate-100 bg-white dark:bg-slate-950 border border-linea dark:border-slate-700 rounded-lg px-3 py-2 focus:outline-none focus:border-marca" />
                    <div className="flex gap-4 mt-1.5 text-xs font-medium">
                      <button type="button" onClick={() => corregir(d.clave, editando.texto)} className="text-marca hover:text-marca-fuerte">Guardar</button>
                      <button type="button" onClick={() => setEditando(null)} className="text-tinta-2 hover:text-tinta dark:text-slate-400">Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-0.5 text-xs text-tinta-2 dark:text-slate-400">{d.texto}</p>
                )}
                <div className="flex gap-4 mt-1.5 text-xs flex-wrap">
                  {d.fuenteUrl
                    ? <button type="button" onClick={() => setVisor({ nombre: d.fuente, url: d.fuenteUrl! })} className="text-marca hover:text-marca-fuerte font-medium">Ver en el documento</button>
                    : <span className="text-tinta-3 dark:text-slate-500">Fuente: {d.fuente}</span>}
                  {puedeOperar && editando?.clave !== d.clave && <button type="button" onClick={() => setEditando({ clave: d.clave, texto: d.texto })} className="text-tinta-2 hover:text-tinta dark:text-slate-400 font-medium">Corregir</button>}
                  {puedeOperar && d.corregido && <button type="button" onClick={() => corregir(d.clave, '')} className="text-tinta-3 hover:text-tinta-2 dark:text-slate-500">Volver a lo que dice el documento</button>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {compromisos.length > 0 && (
        <section className={SUPERFICIE + ' overflow-hidden'}>
          <div className="px-5 pt-4 pb-3 flex items-baseline justify-between gap-3">
            <p className="text-[12.5px] font-medium text-tinta-2 dark:text-slate-300">Compromisos después de entregar</p>
            <p className="text-xs text-tinta-2 dark:text-slate-400 tabular-nums">{pendientes === 0 ? 'Todos cumplidos' : `${pendientes} pendiente${pendientes === 1 ? '' : 's'}`}</p>
          </div>
          <div className="divide-y divide-linea/70 dark:divide-slate-800 border-t border-linea/80 dark:border-slate-800">
            {compromisos.map(c => (
              <div key={c.titulo} className="px-5 py-3 flex items-start gap-3">
                <button onClick={() => puedeOperar && alternar(c.titulo, c.resuelto)} disabled={!puedeOperar} className="flex-shrink-0 mt-0.5" aria-label={c.resuelto ? 'Marcar como pendiente' : 'Marcar como cumplido'}>
                  {c.resuelto ? <CheckCircle2 size={17} className="text-exito" /> : <Circle size={17} className="text-slate-300 dark:text-slate-600" />}
                </button>
                <div>
                  <p className={`text-[13px] ${c.resuelto ? 'text-tinta-3 dark:text-slate-500 line-through' : 'text-tinta dark:text-slate-100'}`}>{c.titulo}</p>
                  {c.descripcion && <p className="text-xs text-tinta-2 dark:text-slate-400">{c.descripcion}</p>}
                  {c.resuelto && c.resueltoPorNombre && <p className="text-xs text-tinta-3 dark:text-slate-500">Cumplido por {c.resueltoPorNombre}</p>}
                </div>
              </div>
            ))}
          </div>
        </section>
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
