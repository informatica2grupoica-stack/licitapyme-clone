'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useRealtime } from '@/app/lib/use-realtime';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import {
  Search, Building2, Users, Wallet, CalendarClock, ArrowUpRight, Layers3, UserPlus,
  Gauge, ListChecks, TriangleAlert, Clock4, ChevronRight, FolderClock,
  Loader2, UsersRound, Ban,
} from 'lucide-react';
import { colorUsuario, inicialesUsuario } from '@/app/lib/user-color';
import { getEstadoPipeline, ESTADOS_PIPELINE } from '@/app/lib/pipeline';
import { AnaliticaGestion } from '@/app/components/AnaliticaGestion';

interface DashData {
  success: boolean; rol: string;
  admin: null | {
    usuarios: { total: number; activos: number; nuevosSemana: number; ultimosAccesos: any[] };
    radar: { totalLicitaciones: number; sinAsignar: number };
    viabilidad: { semaforo: string; n: number }[];
    prefiltro: { decision: string; n: number }[];
    pipeline: { etapa: string; n: number }[];
    montoPipeline: number;
    porDia: { dia: string; n: number }[];
    porPerfil: { id: number; nombre: string | null; email: string; total: number; monto: number; descartadas: number; pipeline: { etapa: string; n: number }[] }[];
  };
  usuario: {
    asignadas: number; montoAsignadas: number;
    pipeline: { etapa: string; n: number }[];
    proximosCierres: { codigo: string; nombre: string; organismo: string; cierre: string; monto: number | null }[];
  };
  favoritosRecientes: any[];
}

const fmtMonto = (n: number) =>
  n >= 1_000_000_000 ? `$${(n / 1_000_000_000).toFixed(1)}B`
  : n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(0)}M`
  : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
const fmtMontoFull = (n?: number | null) =>
  n ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n) : '—';
const fmtFecha = (f?: string | null) => {
  if (!f) return '—';
  try { return new Date(f).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' }); } catch { return f; }
};
const diasAl = (f?: string | null) => f ? Math.ceil((new Date(f).getTime() - Date.now()) / 86400000) : null;

const SEMAFORO: Record<string, { label: string; color: string }> = {
  VERDE:     { label: 'Viable',     color: '#0d9488' },
  AMARILLO:  { label: 'Media-alta', color: '#ca8a04' },
  NARANJA:   { label: 'Media',      color: '#ea580c' },
  ROJO:      { label: 'Baja',       color: '#ef4444' },
  ROJO_DURO: { label: 'Descartar',  color: '#b91c1c' },
};
const PREFILTRO: Record<string, { label: string; color: string }> = {
  PASA:            { label: 'Pasa',     color: '#0d9488' },
  REVISION_HUMANA: { label: 'Revisar',  color: '#ca8a04' },
  EXCLUIDO:        { label: 'Excluida', color: '#9ca3af' },
};
// Nombre visible de una etapa del pipeline — resuelto desde la fuente de verdad
// (app/lib/pipeline.ts), tolerante a ids legados vía getEstadoPipeline.
const etapaLabel = (id: string) => getEstadoPipeline(id)?.label || id;
const PIPE_COLORS = ['#4f46e5', '#7c3aed', '#0d9488', '#06b6d4', '#a855f7', '#3b82f6', '#16a34a', '#ef4444'];

function StatCard({ icon, label, value, sub, color = 'indigo', href, hint }: {
  icon: React.ReactNode; label: string; value: string | number; sub?: string; color?: string; href?: string;
  // hint: definición del número al pasar el mouse. Sin esto, un KPI que no cuadra con otra
  // pantalla obliga a leer el SQL para saber qué mide.
  hint?: string;
}) {
  const ICON_BG: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-600', violet: 'bg-violet-50 text-violet-600',
    teal: 'bg-teal-50 text-teal-600', cyan: 'bg-cyan-50 text-cyan-600',
    orange: 'bg-orange-50 text-orange-600',
  };
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 transition-shadow hover:shadow-md" title={hint}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wide mb-1">{label}</p>
          <p className="text-[28px] font-black leading-none tabular-nums text-slate-900">{value}</p>
          {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
        </div>
        <div className={`w-[42px] h-[42px] rounded-xl flex items-center justify-center flex-shrink-0 ${ICON_BG[color] || 'bg-indigo-50 text-indigo-600'}`}>
          {icon}
        </div>
      </div>
      {href && (
        <Link href={href} className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700 mt-3">
          Ver detalle <ArrowUpRight size={12} />
        </Link>
      )}
    </div>
  );
}

function PanelCard({ title, icon, right, children }: { title: string; icon?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
        <div className="flex items-center gap-2">
          {icon}
          <p className="text-sm font-bold text-slate-800">{title}</p>
        </div>
        {right}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

export default function DashboardPage() {
  const { usuario } = useSession();
  const [data, setData] = useState<DashData | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tiempo real: el hook escucha el SSE (evento `cambio` de cualquier usuario + campana
  // propia) y recarga; el intervalo y el refresco al volver a la pestaña son el respaldo.
  const cargar = useCallback(() => {
    fetch('/api/dashboard', { cache: 'no-store' }).then(r => r.json())
      .then(d => { if (d.success) { setData(d); setError(null); } else setError(d.error); })
      .catch(() => setError('Error al cargar el dashboard'))
      .finally(() => setCargando(false));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  useRealtime(cargar, { intervaloMs: 30_000 });

  const hora = new Date().getHours();
  const saludo = hora < 12 ? 'Buenos días' : hora < 18 ? 'Buenas tardes' : 'Buenas noches';
  const nombre = usuario?.nombre?.split(' ')[0] || usuario?.email?.split('@')[0] || '';
  const esAdmin = data?.rol === 'admin' && !!data.admin;

  return (
    <AppLayout>
      <div className="p-5 sm:p-7 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-end justify-between mb-6 gap-4">
          <div>
            <h2 className="text-2xl font-black tracking-tight text-slate-900">{saludo}{nombre ? `, ${nombre}` : ''}</h2>
            <p className="text-sm text-slate-400 capitalize mt-0.5">
              {new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
          {esAdmin && (
            <Link href="/radar" className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl text-sm font-semibold hover:bg-indigo-100 transition-colors border border-indigo-100">
              <Search size={14} /> Ir al radar
            </Link>
          )}
        </div>

        {cargando ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={32} className="animate-spin text-indigo-500" />
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
            <TriangleAlert size={18} /> {error}
          </div>
        ) : data ? (
          esAdmin ? <VistaAdmin data={data} /> : <VistaUsuario data={data} />
        ) : null}
      </div>
    </AppLayout>
  );
}

function VistaAdmin({ data }: { data: DashData }) {
  const a = data.admin!;
  const viabData = a.viabilidad.map(v => ({
    name: SEMAFORO[v.semaforo]?.label || v.semaforo,
    value: v.n,
    color: SEMAFORO[v.semaforo]?.color || '#9ca3af',
  }));
  const prefData = a.prefiltro.map(p => ({
    etapa: PREFILTRO[p.decision]?.label || p.decision,
    n: p.n,
    color: PREFILTRO[p.decision]?.color || '#9ca3af',
  }));
  const pipeData = a.pipeline.map((p, i) => ({ etapa: etapaLabel(p.etapa), n: p.n, color: PIPE_COLORS[i % PIPE_COLORS.length] }));
  const tendencia = a.porDia.map(d => ({ dia: fmtFecha(d.dia), n: Number(d.n) }));
  const totalViab = viabData.reduce((s, v) => s + v.value, 0);

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={<Building2 size={22} />} label="Licitaciones en radar"
          value={a.radar.totalLicitaciones.toLocaleString('es-CL')}
          sub="Activas ahora · igual que el radar"
          color="indigo" href="/radar"
          hint={'Mismo número que la pestaña "Licitaciones" del radar: licitaciones detectadas por tus palabras clave cuyo cierre todavía no ha pasado (hora de Chile). Sube cuando el intake encuentra nuevas y baja sola a medida que van venciendo.'} />
        <StatCard icon={<UserPlus size={22} />} label="Sin asignar"
          value={a.radar.sinAsignar.toLocaleString('es-CL')}
          sub={`De ${a.radar.totalLicitaciones.toLocaleString('es-CL')} activas · por repartir`}
          color="violet" href="/radar"
          hint={'La cola pendiente: licitaciones activas del radar que nadie tomó todavía, sin contar las descartadas ni las revocadas. Equivale al filtro "Sin asignar" del radar.'} />
        <StatCard icon={<Users size={22} />} label="Usuarios activos" value={a.usuarios.activos} sub={`${a.usuarios.total} en total · +${a.usuarios.nuevosSemana} esta semana`} color="teal" href="/admin/usuarios" />
        {/* El subtítulo nombra los TRES destinos del prefiltro. Antes solo decía PASA y
            EXCLUIDO, y las que quedan en revisión humana (un centenar) no aparecían por
            ningún lado: la tarjeta daba a entender que el prefiltro ya decidió todo. */}
        <StatCard icon={<ListChecks size={22} />} label="Pasan el prefiltro"
          value={(a.prefiltro.find(p => p.decision === 'PASA')?.n || 0).toLocaleString('es-CL')}
          sub={`${(a.prefiltro.find(p => p.decision === 'EXCLUIDO')?.n || 0).toLocaleString('es-CL')} excluidas · ${a.prefiltro.find(p => p.decision === 'REVISION_HUMANA')?.n || 0} por revisar`}
          color="cyan" />
      </div>

      {/* Analítica de gestión INTERACTIVA (pipeline · descartes · postuladas) */}
      <AnaliticaGestion />

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PanelCard title="Tendencia de detección (14 días)" icon={<CalendarClock size={15} className="text-indigo-500" />}>
          {tendencia.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={tendencia} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <defs>
                  <linearGradient id="colorN" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="dia" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                <Area type="monotone" dataKey="n" name="Licitaciones" stroke="#4f46e5" strokeWidth={2} fill="url(#colorN)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : <p className="text-sm text-slate-400 text-center py-10">Sin datos recientes</p>}
        </PanelCard>

        <PanelCard title="Distribución de viabilidad" icon={<Gauge size={15} className="text-indigo-500" />}>
          {totalViab > 0 ? (
            <div className="flex items-center justify-center gap-8">
              <ResponsiveContainer width={170} height={170}>
                <PieChart>
                  <Pie data={viabData} cx="50%" cy="50%" innerRadius={48} outerRadius={78} dataKey="value" paddingAngle={2}>
                    {viabData.map((v, i) => <Cell key={i} fill={v.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5">
                {viabData.map(v => (
                  <div key={v.name} className="flex items-center gap-2">
                    <div style={{ background: v.color }} className="w-2.5 h-2.5 rounded-sm flex-shrink-0" />
                    <span className="text-xs font-medium text-slate-700">{v.name}</span>
                    <span className="text-xs text-slate-400 tabular-nums">{v.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <p className="text-sm text-slate-400 text-center py-10">Aún sin análisis de viabilidad</p>}
        </PanelCard>

        <PanelCard title="Negocios en trabajo" icon={<Layers3 size={15} className="text-indigo-500" />}>
          {pipeData.length > 0 ? (
            <div className="flex items-center justify-center gap-8">
              <ResponsiveContainer width={170} height={170}>
                <PieChart>
                  <Pie data={pipeData} cx="50%" cy="50%" innerRadius={48} outerRadius={78} dataKey="n" paddingAngle={2}>
                    {pipeData.map((v, i) => <Cell key={i} fill={v.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5">
                {pipeData.map(p => (
                  <div key={p.etapa} className="flex items-center gap-2">
                    <div style={{ background: p.color }} className="w-2.5 h-2.5 rounded-sm flex-shrink-0" />
                    <span className="text-xs font-medium text-slate-700">{p.etapa}</span>
                    <span className="text-xs text-slate-400 tabular-nums ml-auto">{p.n}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <p className="text-sm text-slate-400 text-center py-10">Sin datos</p>}
        </PanelCard>

        <PanelCard title="Prefiltro de perfil" icon={<ListChecks size={15} className="text-indigo-500" />}>
          {prefData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={prefData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="etapa" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                <Bar dataKey="n" name="Licitaciones" radius={[6, 6, 0, 0]}>
                  {prefData.map((p, i) => <Cell key={i} fill={p.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-sm text-slate-400 text-center py-10">Sin prefiltro</p>}
        </PanelCard>

        <PanelCard title="Negocios por etapa" icon={<Layers3 size={15} className="text-indigo-500" />} right={<Link href="/negocios" className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">Ver todo</Link>}>
          {pipeData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={pipeData} layout="vertical" margin={{ top: 4, right: 4, bottom: 0, left: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis type="category" dataKey="etapa" tick={{ fontSize: 11, fill: '#94a3b8' }} width={60} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                <Bar dataKey="n" name="Negocios" radius={[0, 6, 6, 0]}>
                  {pipeData.map((p, i) => <Cell key={i} fill={p.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-sm text-slate-400 text-center py-10">Sin negocios en trabajo</p>}
        </PanelCard>

        {(a.porPerfil?.length ?? 0) > 0 && (
          <PanelCard title="Asignadas por perfil" icon={<Users size={15} className="text-indigo-500" />}>
            {a.porPerfil.length > 0 ? (
              <div className="flex items-center justify-center gap-8">
                <ResponsiveContainer width={180} height={180}>
                  <PieChart>
                    <Pie
                      data={a.porPerfil.map((p, i) => ({
                        name: p.nombre || p.email || 'Sin nombre',
                        value: p.total,
                        color: ['#4f46e5', '#7c3aed', '#0d9488', '#06b6d4', '#a855f7', '#3b82f6', '#16a34a', '#ef4444', '#8b5cf6', '#ec4899'][i % 10],
                      }))}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      dataKey="value"
                      paddingAngle={2}
                    >
                      {a.porPerfil.map((p, i) => (
                        <Cell key={i} fill={['#4f46e5', '#7c3aed', '#0d9488', '#06b6d4', '#a855f7', '#3b82f6', '#16a34a', '#ef4444', '#8b5cf6', '#ec4899'][i % 10]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1.5">
                  {a.porPerfil.map((p, i) => (
                    <div key={p.id} className="flex items-center gap-2">
                      <div
                        style={{ background: ['#4f46e5', '#7c3aed', '#0d9488', '#06b6d4', '#a855f7', '#3b82f6', '#16a34a', '#ef4444', '#8b5cf6', '#ec4899'][i % 10] }}
                        className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                      />
                      <span className="text-xs font-medium text-slate-700">{p.nombre || p.email}</span>
                      <span className="text-xs text-slate-400 tabular-nums ml-auto">{p.total}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </PanelCard>
        )}
      </div>

      {/* Listas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ProximosCierres items={data.usuario.proximosCierres} titulo="Próximos cierres (empresa)" />
        <PanelCard title="Últimos accesos" icon={<Clock4 size={15} className="text-indigo-500" />} right={<Link href="/admin/usuarios" className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">Gestionar</Link>}>
          <div className="space-y-3">
            {a.usuarios.ultimosAccesos.map((u: any) => (
              <div key={u.id} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                    {(u.nombre || u.email)[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{u.nombre || u.email}</p>
                    <p className="text-xs text-slate-400 truncate">{u.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {u.rol === 'admin' && <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded font-semibold">Admin</span>}
                  <span className="text-xs text-slate-400">{fmtFecha(u.ultimo_login)}</span>
                </div>
              </div>
            ))}
          </div>
        </PanelCard>
      </div>

      {/* Seguimiento por perfil: cada usuario, su carga, su flujo y sus descartadas */}
      {(a.porPerfil?.length ?? 0) > 0 && (
        <PanelCard title="Seguimiento por perfil" icon={<UsersRound size={15} className="text-indigo-500" />}
          right={<Link href="/analisis-licitacion" className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">Ver análisis</Link>}>
          <div className="space-y-3">
            {a.porPerfil.map(p => {
              const col = colorUsuario(p.email || p.id);
              return (
                <div key={p.id} className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0" style={{ background: col }}>
                    {inicialesUsuario(p.nombre, p.email)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-slate-800 truncate">{p.nombre || p.email}</p>
                      {p.descartadas > 0 && (
                        <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded"><Ban size={10} /> {p.descartadas}</span>
                      )}
                    </div>
                    <MiniFlujo pipeline={p.pipeline} />
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-slate-900 tabular-nums">{p.total}</p>
                    <p className="text-[10.5px] text-slate-400">{fmtMonto(p.monto)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </PanelCard>
      )}
    </div>
  );
}

// Barra apilada del flujo (pipeline) con los colores canónicos de cada etapa.
function MiniFlujo({ pipeline }: { pipeline: { etapa: string; n: number }[] }) {
  const total = pipeline.reduce((s, p) => s + p.n, 0) || 1;
  const orden = ESTADOS_PIPELINE.map(e => e.id);
  const items = [...pipeline].sort((a, b) => orden.indexOf(a.etapa) - orden.indexOf(b.etapa));
  return (
    <div className="mt-1 h-2 rounded-full overflow-hidden bg-slate-100 flex">
      {items.map(p => {
        const e = getEstadoPipeline(p.etapa);
        return <div key={p.etapa} style={{ width: `${(p.n / total) * 100}%`, background: e?.color || '#94a3b8' }} title={`${e?.label || p.etapa}: ${p.n}`} />;
      })}
    </div>
  );
}

function VistaUsuario({ data }: { data: DashData }) {
  const u = data.usuario;
  const pipeData = u.pipeline.map((p, i) => ({
    name: etapaLabel(p.etapa),
    value: p.n,
    color: PIPE_COLORS[i % PIPE_COLORS.length],
  }));
  const totalPipe = pipeData.reduce((s, p) => s + p.value, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard icon={<Building2 size={22} />} label="Mis negocios" value={u.asignadas} sub="Asignados · sin descartadas" color="indigo" href="/negocios" />
        <StatCard icon={<Wallet size={22} />} label="Monto en gestión" value={fmtMonto(u.montoAsignadas)} sub="Suma de mis licitaciones" color="teal" />
        <StatCard icon={<CalendarClock size={22} />} label="Próximos cierres" value={u.proximosCierres.length} sub="En adelante" color="orange" />
      </div>

      {/* Mi flujo: en qué etapa del pipeline están mis licitaciones */}
      {totalPipe > 0 && (
        <PanelCard title="Mi flujo" icon={<Layers3 size={15} className="text-indigo-500" />}>
          <MiniFlujo pipeline={u.pipeline} />
          <div className="mt-3 flex flex-wrap gap-1.5">
            {[...u.pipeline]
              .sort((a, b) => ESTADOS_PIPELINE.findIndex(e => e.id === a.etapa) - ESTADOS_PIPELINE.findIndex(e => e.id === b.etapa))
              .map(p => {
                const e = getEstadoPipeline(p.etapa);
                const color = e?.color || '#64748b';
                return (
                  <span key={p.etapa} className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-2.5 py-1 rounded-full" style={{ background: `${color}18`, color }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                    {e?.label || p.etapa}
                    <span className="tabular-nums">{p.n}</span>
                  </span>
                );
              })}
          </div>
        </PanelCard>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PanelCard title="Mis negocios" icon={<Layers3 size={15} className="text-indigo-500" />} right={<Link href="/negocios" className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">Ver negocios</Link>}>
          {totalPipe > 0 ? (
            <div className="flex items-center justify-center gap-8">
              <ResponsiveContainer width={170} height={170}>
                <PieChart>
                  <Pie data={pipeData} cx="50%" cy="50%" innerRadius={48} outerRadius={78} dataKey="value" paddingAngle={2}>
                    {pipeData.map((p, i) => <Cell key={i} fill={p.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5">
                {pipeData.map(p => (
                  <div key={p.name} className="flex items-center gap-2">
                    <div style={{ background: p.color }} className="w-2.5 h-2.5 rounded-sm flex-shrink-0" />
                    <span className="text-xs font-medium text-slate-700">{p.name}</span>
                    <span className="text-xs text-slate-400 tabular-nums">{p.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-10">
              <FolderClock size={28} className="text-slate-300" />
              <p className="text-sm text-slate-400">Aún no tienes licitaciones asignadas</p>
            </div>
          )}
        </PanelCard>

        <ProximosCierres items={u.proximosCierres} titulo="Mis próximos cierres" />
      </div>
    </div>
  );
}

function ProximosCierres({ items, titulo }: { items: DashData['usuario']['proximosCierres']; titulo: string }) {
  return (
    <PanelCard title={titulo} icon={<CalendarClock size={15} className="text-indigo-500" />}>
      {items.length > 0 ? (
        <div className="space-y-1">
          {items.map((it, i) => {
            const d = diasAl(it.cierre);
            const urgente = d != null && d <= 3;
            const proximo = d != null && d <= 7;
            return (
              <Link key={`${it.codigo}-${i}`} href={`/licitacion/${encodeURIComponent(it.codigo)}`}
                className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 hover:bg-slate-50 transition-colors group">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate text-slate-800 group-hover:text-indigo-600 transition-colors">{it.nombre || it.codigo}</p>
                  <p className="text-xs text-slate-400 truncate">{it.organismo || '—'}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {it.monto ? <span className="text-xs font-semibold text-slate-400 whitespace-nowrap">{fmtMontoFull(it.monto)}</span> : null}
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${urgente ? 'bg-red-50 text-red-600 border border-red-200' : proximo ? 'bg-orange-50 text-orange-600 border border-orange-200' : 'bg-slate-100 text-slate-500'}`}>
                    {d === 0 ? 'Hoy' : `${d}d`}
                  </span>
                  <ChevronRight size={14} className="text-slate-300" />
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-10">
          <Clock4 size={26} className="text-slate-300" />
          <p className="text-sm text-slate-400">Sin cierres próximos</p>
        </div>
      )}
    </PanelCard>
  );
}
