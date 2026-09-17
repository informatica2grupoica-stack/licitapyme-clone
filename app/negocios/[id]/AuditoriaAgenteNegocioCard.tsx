'use client';

// AUDITORÍA COMPLETA DEL NEGOCIO CON IA — pedido explícito del usuario (15-sep-2026): "tiene que
// leer todos estos documentos la IA para poder ver todo el área de compras desde tareas a entrega
// y cierre... sería tareas, costeo y auditoría, aprobación y sku, compra importación y logística,
// entrega y cierre". A diferencia de AuditorComprasCard (que audita UN formulario de cotización a
// medio llenar), este botón revisa de punta a punta TODO lo cargado en las 5 pestañas contra los
// documentos reales del proyecto, en una sola pasada — mismo motor de citas verificadas.
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { useCompras } from '@/app/compras/[negocioId]/ComprasContext';
import { IconRobot as Bot, IconLoader2 as Loader2, IconX as X, IconAlertTriangle as AlertTriangle, IconEye as Eye, IconListCheck as ListChecks, IconRefresh as RefreshCw } from '@tabler/icons-react';

type Area = 'tareas' | 'costeo' | 'aprobacion' | 'compra' | 'entrega' | 'general';
interface AlertaAgente { area: Area; mensaje: string; gravedad: 'info' | 'aviso' | 'critico'; documento: string | null; citaTextual: string | null; citaVerificada: boolean }
interface FuenteDocumento { nombre: string; url: string | null }

const AREA_LABEL: Record<Area, string> = {
  tareas: 'Tareas', costeo: 'Costeo y Auditoría', aprobacion: 'Aprobación y SKU',
  compra: 'Compra, Importación y Logística', entrega: 'Entrega y Cierre', general: 'General',
};

const fmtFechaHora = (iso: string) => new Date(iso).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function AuditoriaAgenteNegocioCard({ negocioId }: { negocioId: number }) {
  const toast = useToast();
  const { recargar: recargarCompartido } = useCompras();
  const [estado, setEstado] = useState<
    { tipo: 'idle' } | { tipo: 'cargando' } | { tipo: 'auditando' } | { tipo: 'error'; mensaje: string } |
    { tipo: 'listo'; resumen: string; alertas: AlertaAgente[]; fuentes: FuenteDocumento[]; usoHoy: { llamadas: number; tope: number; agotado: boolean }; creadoAt?: string }
  >({ tipo: 'idle' });
  const [abierto, setAbierto] = useState(false);

  // La última auditoría GUARDADA se carga sola al entrar (pedido explícito, 15-sep-2026: "no lo
  // pasamos a la base de datos que es lo que podemos hacer") — sin gastar una revisión nueva.
  const cargarUltima = useCallback(async () => {
    setEstado({ tipo: 'cargando' });
    try {
      const res = await fetch(`/api/compras/${negocioId}/agente-documentos/negocio`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error);
      if (data.ultima) {
        setEstado({ tipo: 'listo', resumen: data.ultima.resumen, alertas: data.ultima.alertas || [], fuentes: data.ultima.fuentes || [], usoHoy: data.ultima.usoHoy, creadoAt: data.ultima.creadoAt });
        setAbierto(true);
      } else {
        setEstado({ tipo: 'idle' });
      }
    } catch {
      setEstado({ tipo: 'idle' }); // sin auditoría previa todavía no es un error — botón queda disponible igual
    }
  }, [negocioId]);

  useEffect(() => { cargarUltima(); }, [cargarUltima]);

  const auditar = async () => {
    setAbierto(true);
    setEstado({ tipo: 'auditando' });
    try {
      const res = await fetch(`/api/compras/${negocioId}/agente-documentos/negocio`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'El agente no pudo auditar el negocio.');
      setEstado({ tipo: 'listo', resumen: data.resumen || '', alertas: data.alertas || [], fuentes: data.fuentes || [], usoHoy: data.usoHoy, creadoAt: new Date().toISOString() });
      recargarCompartido();
    } catch (e: any) {
      setEstado({ tipo: 'error', mensaje: e.message });
      toast.error('No se pudo auditar el negocio', e.message);
    }
  };

  const urlDeFuente = (nombre: string | null, fuentes: FuenteDocumento[]) => nombre ? fuentes.find(f => f.nombre === nombre)?.url ?? null : null;

  return (
    <div className="bg-white rounded-xl border border-indigo-200 overflow-hidden">
      <button onClick={auditar} disabled={estado.tipo === 'auditando' || estado.tipo === 'cargando'}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 bg-indigo-50/50 hover:bg-indigo-50 transition-colors disabled:opacity-70">
        <span className="flex items-center gap-1.5 text-[12.5px] font-bold text-indigo-800">
          {estado.tipo === 'auditando' || estado.tipo === 'cargando' ? <Loader2 size={14} className="animate-spin" /> : estado.tipo === 'listo' ? <RefreshCw size={14} /> : <Bot size={14} />}
          {estado.tipo === 'listo' ? 'Volver a auditar este negocio' : 'Auditar este negocio completo con IA'}
        </span>
        <span className="text-[10.5px] text-indigo-500">
          {estado.tipo === 'listo' ? `${estado.creadoAt ? `Última: ${fmtFechaHora(estado.creadoAt)} · ` : ''}${estado.usoHoy.llamadas}/${estado.usoHoy.tope} hoy` : 'Tareas, Costeo, Aprobación, Compra y Entrega — de una sola vez'}
        </span>
      </button>

      {abierto && (
        <div className="border-t border-indigo-100 p-3 space-y-2">
          <div className="flex justify-end">
            <button onClick={() => setAbierto(false)} className="text-zinc-400 hover:text-zinc-600"><X size={14} /></button>
          </div>
          {estado.tipo === 'auditando' && (
            <p className="text-[11px] text-zinc-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Leyendo documentos y revisando las 5 pestañas — puede tardar hasta un minuto…</p>
          )}
          {estado.tipo === 'error' && (
            <p className="text-[10.5px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">{estado.mensaje}</p>
          )}
          {estado.tipo === 'listo' && (() => {
            const porArea = new Map<Area, AlertaAgente[]>();
            for (const a of estado.alertas) { const arr = porArea.get(a.area) || []; arr.push(a); porArea.set(a.area, arr); }
            return (
              <div className="space-y-3">
                <p className="text-[11px] text-indigo-800 bg-indigo-50/50 border border-indigo-100 rounded-lg px-2.5 py-1.5">{estado.resumen}</p>
                {estado.alertas.length === 0 && (
                  <p className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5">
                    <ListChecks size={12} /> Sin hallazgos — todo lo revisado calza.
                  </p>
                )}
                {[...porArea.entries()].map(([area, alertas]) => (
                  <div key={area}>
                    <p className="text-[10px] font-bold text-zinc-400 uppercase mb-1">{AREA_LABEL[area]}</p>
                    <div className="space-y-1">
                      {alertas.map((a, i) => {
                        const url = urlDeFuente(a.documento, estado.fuentes);
                        return (
                          <div key={i} className={`text-[10.5px] rounded-lg px-2 py-1 border ${
                            a.gravedad === 'critico' ? 'text-rose-700 bg-rose-50 border-rose-200' :
                            a.gravedad === 'aviso' ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-zinc-600 bg-white border-zinc-200'}`}>
                            <p className="flex items-start gap-1"><AlertTriangle size={11} className="flex-shrink-0 mt-0.5" /> {a.mensaje}</p>
                            {(a.documento || a.citaTextual) && (
                              <div className="mt-1 flex items-start gap-1 text-[9.5px] text-zinc-500">
                                {a.citaTextual && <span className="italic">"{a.citaTextual}"</span>}
                                {a.documento && (
                                  <span className={`flex-shrink-0 font-semibold ${a.citaVerificada ? 'text-emerald-600' : 'text-amber-600'}`}>
                                    — {a.documento}{a.citaVerificada ? ' ✓' : ' (cita sin verificar)'}
                                  </span>
                                )}
                                {url && (
                                  <a href={url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0 text-indigo-600 hover:text-indigo-700" title="Ver documento">
                                    <Eye size={11} />
                                  </a>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {estado.fuentes.length > 0 && (
                  <p className="text-[9.5px] text-zinc-400 flex items-center gap-1 flex-wrap">
                    Fuentes leídas:
                    {estado.fuentes.map((f, i) => (
                      <span key={i} className="inline-flex items-center gap-0.5">
                        {f.nombre}
                        {f.url && <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:text-indigo-700" title="Ver documento"><Eye size={10} /></a>}
                        {i < estado.fuentes.length - 1 && ','}
                      </span>
                    ))}
                  </p>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
