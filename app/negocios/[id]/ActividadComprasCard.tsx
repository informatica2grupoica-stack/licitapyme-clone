'use client';

// LÍNEA DE TIEMPO del proyecto en Compras — pedido explícito del usuario (11-sep-2026): "saber qué
// se hizo en el día 1, 2, 3... hasta terminar". Lee GET /api/compras/[negocioId]/actividad
// (historial_eventos filtrado a tipo COMPRAS_%, que ya existía — nunca se mostraba en el módulo).
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/app/components/ui/toast';
import {
  Loader2, History, UserPlus, FileText, Wrench, ClipboardCheck, Gauge, PackageCheck,
  Clock, Truck, AlertTriangle, ShoppingCart, XCircle, Link2Off,
} from 'lucide-react';

interface EventoActividad { tipo: string; mensaje: string; actor: string | null; creadoAt: string }

// Ícono + color por PREFIJO del tipo — cubre eventos nuevos sin tener que listar cada tipo exacto.
function estiloDe(tipo: string): { Icon: typeof History; color: string; bg: string } {
  if (tipo === 'RESULTADO_ADJUDICACION' || tipo === 'PROYECTO_GANADO') return { Icon: ShoppingCart, color: 'text-teal-600', bg: 'bg-teal-50' };
  if (tipo === 'COMPRAS_ASIGNADO') return { Icon: UserPlus, color: 'text-indigo-600', bg: 'bg-indigo-50' };
  if (tipo.startsWith('COMPRAS_COTIZACION') || tipo.startsWith('COMPRAS_AGENTE')) return { Icon: FileText, color: 'text-sky-600', bg: 'bg-sky-50' };
  if (tipo.startsWith('COMPRAS_ESCENARIO') || tipo.startsWith('COMPRAS_ORIGEN')) return { Icon: Wrench, color: 'text-violet-600', bg: 'bg-violet-50' };
  if (tipo.startsWith('COMPRAS_APROBACION')) return { Icon: ClipboardCheck, color: 'text-emerald-600', bg: 'bg-emerald-50' };
  if (tipo.startsWith('COMPRAS_SKU')) return { Icon: Gauge, color: 'text-amber-600', bg: 'bg-amber-50' };
  if (tipo.startsWith('COMPRAS_OC_DIFIERE')) return { Icon: AlertTriangle, color: 'text-rose-600', bg: 'bg-rose-50' };
  if (tipo.startsWith('COMPRAS_OC')) return { Icon: PackageCheck, color: 'text-emerald-600', bg: 'bg-emerald-50' };
  if (tipo.startsWith('COMPRAS_RELOJ')) return { Icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50' };
  if (tipo.startsWith('COMPRAS_REPARTO') || tipo.startsWith('COMPRAS_MODALIDAD')) return { Icon: Truck, color: 'text-zinc-600', bg: 'bg-zinc-100' };
  if (tipo.startsWith('COMPRAS_CIERRE_LEGADO')) return { Icon: XCircle, color: 'text-zinc-500', bg: 'bg-zinc-100' };
  if (tipo.includes('DESVINCULADO') || tipo.includes('DESMARCO')) return { Icon: Link2Off, color: 'text-zinc-400', bg: 'bg-zinc-100' };
  if (tipo.startsWith('COMPRAS_PROYECTO_GANADO')) return { Icon: ShoppingCart, color: 'text-teal-600', bg: 'bg-teal-50' };
  return { Icon: History, color: 'text-zinc-500', bg: 'bg-zinc-100' };
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function fmtDia(fecha: string): string {
  const [y, m, d] = fecha.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DIAS[dt.getUTCDay()]} ${d} de ${MESES[m - 1]}`;
}
function fmtHora(s: string): string {
  const hora = s.split(' ')[1] || '';
  return hora.slice(0, 5);
}

export function ActividadComprasCard({ negocioId }: { negocioId: number }) {
  const toast = useToast();
  const [eventos, setEventos] = useState<EventoActividad[]>([]);
  const [loading, setLoading] = useState(true);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/compras/${negocioId}/actividad`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar la actividad');
      setEventos(data.eventos || []);
    } catch (e: any) {
      toast.error('No se pudo cargar la actividad', e.message);
    } finally {
      setLoading(false);
    }
  }, [negocioId, toast]);

  useEffect(() => { cargar(); }, [cargar]);

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>;
  if (eventos.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-zinc-200 p-8 flex flex-col items-center justify-center gap-2 text-center">
        <History size={26} className="text-zinc-300" />
        <p className="text-[13px] font-semibold text-zinc-500">Todavía no hay actividad registrada</p>
      </div>
    );
  }

  // Agrupar por día (más reciente primero) — "qué se hizo el día 1, 2, 3..." pero mostrado del
  // más nuevo al más viejo, como cualquier bitácora.
  const porDia: Record<string, EventoActividad[]> = {};
  for (const e of eventos) (porDia[e.creadoAt.slice(0, 10)] ||= []).push(e);
  const dias = Object.keys(porDia).sort().reverse();
  const primerDia = eventos[0]?.creadoAt.slice(0, 10);

  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-4 sm:p-5 space-y-5">
      {dias.map(dia => {
        const items = [...porDia[dia]].reverse(); // dentro del día, más reciente arriba
        const numeroDia = Math.round((new Date(dia).getTime() - new Date(primerDia).getTime()) / 86_400_000) + 1;
        return (
          <div key={dia}>
            <div className="flex items-center gap-2 mb-2.5">
              <span className="text-[11px] font-bold text-teal-700 bg-teal-50 border border-teal-100 px-2 py-0.5 rounded-full flex-shrink-0">Día {numeroDia}</span>
              <p className="text-[11.5px] font-semibold text-zinc-500 capitalize">{fmtDia(dia)}</p>
              <div className="flex-1 h-px bg-zinc-100" />
            </div>
            <div className="space-y-0 pl-1">
              {items.map((ev, i) => {
                const { Icon, color, bg } = estiloDe(ev.tipo);
                return (
                  <div key={i} className="flex items-start gap-3 relative">
                    {i < items.length - 1 && <div className="absolute left-[15px] top-8 bottom-0 w-px bg-zinc-100" />}
                    <span className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${bg} ${color} ring-4 ring-white`}>
                      <Icon size={14} />
                    </span>
                    <div className="min-w-0 flex-1 pb-4">
                      <p className="text-[12.5px] text-zinc-700 leading-snug">{ev.mensaje}</p>
                      <p className="text-[10.5px] text-zinc-400 mt-0.5">
                        {fmtHora(ev.creadoAt)}{ev.actor ? ` · ${ev.actor}` : ''}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
