'use client';

// DASHBOARD DE COMPRAS (spec §18.5) — cuellos de botella y estadística de gestión, "solo para
// jefatura" (§2.4/§18.6). La spec lo marca "fuera de alcance" para la Fase 1, pero pedía que el
// modelo de datos lo soportara después — como ya lo soporta (cada tarea trae creado_at/cerrado_at/
// responsable desde el día uno), esto es la vista que faltaba sobre datos que ya existían.
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import { StatCard } from '@/app/components/ui/StatCard';
import { ChartCard } from '@/app/components/ui/ChartCard';
import { Banner } from '@/app/components/ui/Banner';
import {
  ShoppingCart, Loader2, AlertTriangle, Clock, FileWarning, Timer, Zap, UserCheck, ListChecks,
} from 'lucide-react';

interface CuelloBotella { clave: string; titulo: string; total: number; hechas: number; vencidas: number; horasPromedioCierre: number | null }
interface RankingEncargado { id: number; nombre: string; tareasCerradas: number; tareasVencidasAbiertas: number; horasPromedioCierre: number | null }
interface Dashboard {
  negociosActivos: number; negociosUrgentes: number; relojesVencidos: number; incidenciasAbiertas: number;
  slaAsignacion: { promedioHoras: number | null; automaticas: number; manuales: number; total: number };
  cuellosBotella: CuelloBotella[]; ranking: RankingEncargado[]; generadoAt: string;
}

const fmtHoras = (h: number | null) => {
  if (h == null) return '—';
  if (h < 24) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} d`;
};

export default function CompraDashboardPage() {
  const router = useRouter();
  const { usuario, cargando: cargandoSesion } = useSession();
  const toast = useToast();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const esAdmin = usuario?.rol === 'admin';
  const esJefatura = esAdmin || !!usuario?.permisos?.aprobar_comercial;

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/compras/dashboard');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar el dashboard');
      setDashboard(data.dashboard);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (cargandoSesion) return;
    if (!esJefatura) { router.replace('/compras'); return; }
    cargar();
  }, [cargandoSesion, esJefatura, router, cargar]);

  if (cargandoSesion || !esJefatura) {
    return (
      <AppLayout breadcrumb={[{ label: 'Compras', href: '/compras' }]}>
        <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="w-6 h-6 animate-spin text-zinc-400" /></div>
      </AppLayout>
    );
  }

  const maxHoras = Math.max(1, ...(dashboard?.cuellosBotella || []).map(c => c.horasPromedioCierre ?? 0));
  const maxCerradas = Math.max(1, ...(dashboard?.ranking || []).map(r => r.tareasCerradas));

  return (
    <AppLayout breadcrumb={[{ label: 'Compras', href: '/compras' }, { label: 'Dashboard' }]}>
      <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
        <div>
          <h1 className="text-[17px] font-bold text-zinc-900 flex items-center gap-2">
            <ShoppingCart size={18} className="text-teal-600" /> Dashboard de Compras
          </h1>
          <p className="text-[12.5px] text-zinc-500 mt-0.5">
            Cuellos de botella y estadística de gestión (spec §18) — solo jefatura. Nadie ve acá su propio tiempo, es una foto del equipo.
          </p>
        </div>

        {loading && <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>}
        {error && <Banner variante="error" accion={{ label: 'Reintentar', onClick: cargar }}>{error}</Banner>}

        {dashboard && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard icon={<ShoppingCart size={20} />} label="Negocios en Compras" value={dashboard.negociosActivos} color="teal" />
              <StatCard icon={<Zap size={20} />} label="Urgentes" value={dashboard.negociosUrgentes} color="rose" />
              <StatCard icon={<Clock size={20} />} label="Relojes vencidos" value={dashboard.relojesVencidos} color="rose" />
              <StatCard icon={<AlertTriangle size={20} />} label="Incidencias abiertas" value={dashboard.incidenciasAbiertas} color="amber" />
            </div>

            <ChartCard title="Asignación (§3.3 — SLA de 3h hábiles)" icon={<Timer size={15} />}
              sub={`${dashboard.slaAsignacion.total} negocio(s) asignado(s) · ${dashboard.slaAsignacion.automaticas} por fallback automático · ${dashboard.slaAsignacion.manuales} manual(es)`}>
              <p className="text-[24px] font-black text-zinc-900">{fmtHoras(dashboard.slaAsignacion.promedioHoras)}</p>
              <p className="text-[11.5px] text-zinc-400">promedio real desde que se gana hasta que hay encargado (tope: 3h hábiles)</p>
            </ChartCard>

            <ChartCard title="Cuellos de botella por tipo de tarea" icon={<ListChecks size={15} />}
              sub="Tiempo promedio de creación a cierre, solo entre las que ya se cerraron. Ordenado de la más lenta a la más rápida.">
              {dashboard.cuellosBotella.length === 0 ? (
                <p className="text-[12px] text-zinc-400 py-4 text-center">Todavía no hay tareas cerradas para medir.</p>
              ) : (
                <div className="space-y-2.5">
                  {dashboard.cuellosBotella.map(c => (
                    <div key={c.clave}>
                      <div className="flex items-center justify-between gap-2 text-[12px] mb-1">
                        <span className="font-semibold text-zinc-700 truncate">{c.titulo}</span>
                        <span className="flex-shrink-0 text-zinc-500">
                          {fmtHoras(c.horasPromedioCierre)} · {c.hechas}/{c.total} hechas
                          {c.vencidas > 0 && <span className="text-rose-600 font-semibold"> · {c.vencidas} vencida{c.vencidas === 1 ? '' : 's'}</span>}
                        </span>
                      </div>
                      <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
                        <div className="h-full bg-teal-500 rounded-full" style={{ width: `${Math.max(3, ((c.horasPromedioCierre ?? 0) / maxHoras) * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ChartCard>

            <ChartCard title="Por encargado" icon={<UserCheck size={15} />}
              sub="Tareas cerradas y vencidas abiertas hoy, por quien las tenía asignadas — atribución a quien tenía la tarea en el momento (spec §18.4).">
              {dashboard.ranking.length === 0 ? (
                <p className="text-[12px] text-zinc-400 py-4 text-center">Todavía no hay tareas con responsable.</p>
              ) : (
                <div className="space-y-2.5">
                  {dashboard.ranking.map(r => (
                    <div key={r.id}>
                      <div className="flex items-center justify-between gap-2 text-[12px] mb-1">
                        <span className="font-semibold text-zinc-700 truncate">{r.nombre}</span>
                        <span className="flex-shrink-0 text-zinc-500">
                          {r.tareasCerradas} cerrada{r.tareasCerradas === 1 ? '' : 's'} · promedio {fmtHoras(r.horasPromedioCierre)}
                          {r.tareasVencidasAbiertas > 0 && <span className="text-rose-600 font-semibold"> · {r.tareasVencidasAbiertas} vencida{r.tareasVencidasAbiertas === 1 ? '' : 's'} hoy</span>}
                        </span>
                      </div>
                      <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.max(3, (r.tareasCerradas / maxCerradas) * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ChartCard>

            {dashboard.incidenciasAbiertas === 0 && dashboard.relojesVencidos === 0 && (
              <div className="flex items-center gap-2 text-[12px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                <FileWarning size={14} /> Sin relojes vencidos ni incidencias abiertas ahora mismo.
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
