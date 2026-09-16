'use client';

// DASHBOARD DE COMPRAS (spec §18.5) — cuellos de botella y estadística de gestión, "solo para
// jefatura" (§2.4/§18.6). La spec lo marca "fuera de alcance" para la Fase 1, pero pedía que el
// modelo de datos lo soportara después — como ya lo soporta (cada tarea trae creado_at/cerrado_at/
// responsable desde el día uno), esto es la vista que faltaba sobre datos que ya existían.
//
// Cada tarjeta trae su ficha "Cómo se mide" (ícono ⓘ, componente MetricInfo — el mismo que ya usan
// el resto de los dashboards de la app): de qué tabla/columna sale el número y el cálculo exacto.
// Pedido explícito del usuario (11-sep-2026): "cada cosa que tenga el dashboard debe estar
// explicado de dónde saca el dato, cómo lo mide" — antes las 4 tarjetas de arriba no tenían nada.
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import { StatCard } from '@/app/components/ui/StatCard';
import { ChartCard } from '@/app/components/ui/ChartCard';
import { Banner } from '@/app/components/ui/Banner';
import { MetricInfo } from '@/app/components/ui/MetricInfo';
import { useRealtime } from '@/app/lib/use-realtime';
import { IconShoppingCart as ShoppingCart, IconLoader2 as Loader2, IconAlertTriangle as AlertTriangle, IconClock as Clock, IconFileAlert as FileWarning, IconHourglass as Timer, IconBolt as Zap, IconUserCheck as UserCheck, IconListCheck as ListChecks, IconArrowLeft as ArrowLeft, IconUserX as UserX, IconPackage as PackageCheck, IconPackageOff as PackageX, IconCircleX as XCircle, IconCalendarWeek as CalendarDays } from '@tabler/icons-react';

interface CuelloBotella { clave: string; titulo: string; total: number; hechas: number; vencidas: number; horasPromedioCierre: number | null }
interface RankingEncargado { id: number; nombre: string; tareasCerradas: number; tareasVencidasAbiertas: number; horasPromedioCierre: number | null }
interface GanadoPorMes { mes: string; n: number }
interface Dashboard {
  negociosActivos: number; negociosUrgentes: number; relojesVencidos: number; incidenciasAbiertas: number;
  sinAsignar: number; cierreLegado: { entregadas: number; noRealizadas: number };
  ordenesCompra: { conOc: number; sinOc: number }; ganadosPorMes: GanadoPorMes[];
  slaAsignacion: { promedioHoras: number | null; automaticas: number; manuales: number; total: number };
  cuellosBotella: CuelloBotella[]; ranking: RankingEncargado[]; generadoAt: string;
}

const fmtHoras = (h: number | null) => {
  if (h == null) return '—';
  if (h < 24) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} d`;
};
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fmtMes = (m: string) => { const [y, mo] = m.split('-'); return `${MESES_CORTOS[Number(mo) - 1]} ${y.slice(2)}`; };

export default function CompraDashboardPage() {
  const router = useRouter();
  const { usuario, cargando: cargandoSesion } = useSession();
  const toast = useToast();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // "Ser admin" ya no alcanza solo (pedido explícito, 10-sep-2026) — mismo criterio que el backend
  // (app/api/compras/dashboard/route.ts).
  const esJefatura = !!usuario?.permisos?.compras_todo || !!usuario?.permisos?.aprobar_comercial;

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

  // Tiempo real (11-sep-2026): mismo bus SSE que el resto de los tableros — se refresca solo
  // cuando llega/se acepta una OC (publicarCambio('compras') en app/lib/compras.ts).
  useRealtime(cargar);

  if (cargandoSesion || !esJefatura) {
    return (
      <AppLayout breadcrumb={[{ label: 'Compras', href: '/compras' }]}>
        <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="w-6 h-6 animate-spin text-zinc-400" /></div>
      </AppLayout>
    );
  }

  const maxHoras = Math.max(1, ...(dashboard?.cuellosBotella || []).map(c => c.horasPromedioCierre ?? 0));
  const maxCerradas = Math.max(1, ...(dashboard?.ranking || []).map(r => r.tareasCerradas));
  const maxGanados = Math.max(1, ...(dashboard?.ganadosPorMes || []).map(g => g.n));

  return (
    <AppLayout breadcrumb={[{ label: 'Compras', href: '/compras' }, { label: 'Dashboard' }]}>
      <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <Link href="/compras"
              className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-zinc-500 hover:text-teal-700 mb-1.5 transition-colors">
              <ArrowLeft size={12} /> Volver a Compras
            </Link>
            <h1 className="text-[17px] font-bold text-zinc-900 flex items-center gap-2">
              <ShoppingCart size={18} className="text-teal-600" /> Dashboard de Compras
            </h1>
            <p className="text-[12.5px] text-zinc-500 mt-0.5">
              Cuellos de botella y estadística de gestión (spec §18) — solo jefatura. Nadie ve acá su propio tiempo, es una foto del equipo.
            </p>
          </div>
        </div>

        {loading && <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>}
        {error && <Banner variante="error" accion={{ label: 'Reintentar', onClick: cargar }}>{error}</Banner>}

        {dashboard && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard icon={<ShoppingCart size={20} />} label="Negocios en Compras" value={dashboard.negociosActivos} color="teal"
                spec={{ mide: 'Cuántos negocios ganados están hoy en el módulo de Compras.', calculo: 'Cuenta todas las filas de compras_asignacion — un negocio entra acá apenas se gana la licitación.', fuente: 'compras_asignacion (COUNT *)' }} />
              <StatCard icon={<Zap size={20} />} label="Urgentes" value={dashboard.negociosUrgentes} color="rose"
                spec={{ mide: 'Negocios con la "Cadena de Urgencia" activa (§3.7/§15.2).', calculo: 'El plazo de entrega OFERTADO es menor a 3 días — se calcula una vez al abrir Compras y queda fijo, no es una cuenta regresiva desde hoy.', fuente: 'compras_asignacion.urgente' }} />
              <StatCard icon={<Clock size={20} />} label="Relojes vencidos" value={dashboard.relojesVencidos} color="rose"
                spec={{ mide: 'Negocios cuyo plazo de entrega comprometido ya pasó, sin marcar "entregado con multa".', calculo: 'fecha_limite (o prorroga_fecha_limite si la hay) es anterior a hoy, y entrega_con_multa = 0.', fuente: 'compras_reloj' }} />
              <StatCard icon={<AlertTriangle size={20} />} label="Incidencias abiertas" value={dashboard.incidenciasAbiertas} color="amber"
                spec={{ mide: 'Incidencias del proyecto (§9) que todavía nadie cerró.', calculo: 'Cuenta filas con estado = ABIERTA.', fuente: 'compras_incidencia' }} />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard icon={<UserX size={20} />} label="Sin encargado" value={dashboard.sinAsignar} color="amber"
                spec={{ mide: 'Negocios que todavía no tienen encargado de Compras.', calculo: 'compras_asignacion.asignado_a está vacío — al pasar las 3h hábiles del SLA se asignan solos por carga.', fuente: 'compras_asignacion.asignado_a IS NULL' }} />
              <StatCard icon={<PackageCheck size={20} />} label="Con orden de compra" value={dashboard.ordenesCompra.conOc} color="emerald"
                spec={{ mide: 'Negocios a los que ya les llegó la OC del cliente.', calculo: 'compras_asignacion.oc_numero tiene un valor — llega sola desde Mercado Público o se anota a mano.', fuente: 'compras_asignacion.oc_numero' }} />
              <StatCard icon={<PackageX size={20} />} label="Sin orden de compra" value={dashboard.ordenesCompra.sinOc} color="slate"
                spec={{ mide: 'Negocios que todavía esperan que el organismo emita la OC.', calculo: 'compras_asignacion.oc_numero está vacío.', fuente: 'compras_asignacion.oc_numero IS NULL' }} />
              <StatCard icon={<XCircle size={20} />} label="No realizadas (histórico)" value={dashboard.cierreLegado.noRealizadas} color="slate"
                spec={{ mide: 'Negocios del backlog histórico marcados como "no se concretó" (no pasaron por el flujo completo de Fracaso).', calculo: 'compras_asignacion.cierre_legado = NO_REALIZADA — marca rápida para limpiar historial, distinta de una declaración de fracaso real.', fuente: 'compras_asignacion.cierre_legado' }} />
            </div>

            <ChartCard title="Asignación (§3.3 — SLA de 3h hábiles)" icon={<Timer size={15} />}
              accion={<MetricInfo spec={{ mide: 'Cuánto tarda en la práctica que un negocio ganado tenga encargado de Compras.', calculo: 'Promedio de horas entre ganado_at y asignado_at, de todos los negocios ya asignados (manual o por fallback automático). El SLA es 3h hábiles; esto es lo que pasa REALMENTE, no el tope.', fuente: 'compras_asignacion (ganado_at, asignado_at, asignado_por)' }} />}
              sub={`${dashboard.slaAsignacion.total} negocio(s) asignado(s) · ${dashboard.slaAsignacion.automaticas} por fallback automático · ${dashboard.slaAsignacion.manuales} manual(es)`}>
              <p className="text-[24px] font-black text-zinc-900">{fmtHoras(dashboard.slaAsignacion.promedioHoras)}</p>
              <p className="text-[11.5px] text-zinc-400">promedio real desde que se gana hasta que hay encargado (tope: 3h hábiles)</p>
            </ChartCard>

            <ChartCard title="Ganados por mes" icon={<CalendarDays size={15} />}
              accion={<MetricInfo spec={{ mide: 'De qué mes viene cada negocio que hoy está en Compras.', calculo: 'Agrupa por el mes de ganado_at — la fecha REAL de adjudicación (no cuándo entró al sistema ni la fecha de su orden de compra, que varía según las bases de cada organismo).', fuente: 'compras_asignacion.ganado_at' }} />}
              sub="Fecha real de adjudicación — la misma que ordena el calendario de /compras.">
              {dashboard.ganadosPorMes.length === 0 ? (
                <p className="text-[12px] text-zinc-400 py-4 text-center">Todavía no hay negocios en Compras.</p>
              ) : (
                <div className="flex items-end gap-2 h-28 pt-2">
                  {dashboard.ganadosPorMes.map(g => (
                    <div key={g.mes} className="flex-1 flex flex-col items-center justify-end gap-1 h-full" title={`${g.n} negocio(s)`}>
                      <span className="text-[10px] font-bold text-zinc-500 tabular-nums">{g.n}</span>
                      <div className="w-full bg-teal-500 rounded-t-md" style={{ height: `${Math.max(4, (g.n / maxGanados) * 100)}%` }} />
                      <span className="text-[9.5px] text-zinc-400 capitalize">{fmtMes(g.mes)}</span>
                    </div>
                  ))}
                </div>
              )}
            </ChartCard>

            <ChartCard title="Cuellos de botella por tipo de tarea" icon={<ListChecks size={15} />}
              accion={<MetricInfo spec={{ mide: 'Qué tareas del checklist de Compras toman más tiempo en cerrarse.', calculo: 'Para cada tipo de tarea (compras_tarea_catalogo), promedio de horas entre creado_at y cerrado_at — solo entre las que ya se marcaron HECHA. Ordenado de la más lenta a la más rápida.', fuente: 'compras_tarea (creado_at, cerrado_at, catalogo_clave)' }} />}
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
              accion={<MetricInfo spec={{ mide: 'Carga de trabajo cerrada por cada encargado de Compras.', calculo: 'Tareas con estado HECHA, agrupadas por responsable_id — se atribuye a quien tenía la tarea asignada en el momento, no a quien la creó. "Vencidas hoy" son tareas SIN cerrar cuyo plazo_at ya pasó.', fuente: 'compras_tarea (responsable_id, estado, plazo_at)' }} />}
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
