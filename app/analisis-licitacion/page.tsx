'use client';

// Análisis de licitación (SOLO ADMIN): tablero ANALÍTICO por perfil.
// Se elige UN perfil (o "Todos") y se muestran SUS estadísticas: KPIs, gráficos
// interactivos (dona por estado, barras por tipo, evolución mensual, top organismos,
// tasa de adjudicación) y, aparte, la LISTA de sus licitaciones. Se nutre de
// /api/negocios (admin = todos los negocios).

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Activity, Loader2, RefreshCw, Building2, Calendar, DollarSign, Send, Clock,
  Layers, Users, Trophy, Ban, Briefcase, TrendingUp, Target, ChevronRight, ExternalLink,
} from 'lucide-react';
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip as RTooltip, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, AreaChart, Area, RadialBarChart, RadialBar,
} from 'recharts';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { colorUsuario, inicialesUsuario } from '@/app/lib/user-color';
import { ESTADOS_PIPELINE, getEstadoPipeline } from '@/app/lib/pipeline';
import { extractTipoFromCodigo, getTipoLicitacion } from '@/app/lib/tipos-licitacion';
import { cierreVencido } from '@/app/lib/estado-mp';

interface Negocio {
  id: number;
  licitacion_codigo: string;
  licitacion_nombre: string | null;
  licitacion_organismo: string | null;
  licitacion_monto: number | null;
  licitacion_cierre: string | null;
  licitacion_region: string | null;
  monto_ofertado: number | null;
  estado_pipeline: string;
  created_at: string | null;
  updated_at: string | null;
  usuario_nombre: string | null;
  usuario_email: string | null;
  comentarios_count?: number | null;
}

const RESUELTOS = new Set(['POSTULADA', 'DESCARTADA', 'ADJUDICADA', 'POSIBLE_ADJ', 'PERDIDA']);
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const fmtMonto = (n: number | null) =>
  n ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n) : '—';
const fmtMontoCorto = (n: number) => {
  if (!n) return '$0';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}MM`;
  if (n >= 1_000_000) return `$${Math.round(n / 1_000_000)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
};
const fmtFecha = (s: string | null) => {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: '2-digit' });
};
const diasHasta = (s: string | null): number | null => {
  if (!s) return null;
  const d = new Date(s); if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
};
const labelDe = (estado: string) => getEstadoPipeline(estado)?.label || estado || 'ASIGNADO';
const idDe = (estado: string) => getEstadoPipeline(estado)?.id || estado || 'ASIGNADO';

// ── Tooltip común de los gráficos ─────────────────────────────────────────────
function ChartTooltip({ active, payload, label, sufijo }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-[12px]">
      {label != null && <p className="font-semibold text-slate-700 mb-0.5">{label}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} className="text-slate-600 flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm" style={{ background: p.color || p.payload?.color }} />
          <span className="font-bold tabular-nums">{p.value}</span> {sufijo || p.name || ''}
        </p>
      ))}
    </div>
  );
}

export default function AnalisisLicitacionPage() {
  const { usuario, cargando: cargandoSesion } = useSession();
  const router = useRouter();
  const [negocios, setNegocios] = useState<Negocio[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [perfil, setPerfil] = useState<string | null>(null);   // email/nombre del perfil o null=Todos
  const [estadoLista, setEstadoLista] = useState<string | null>(null); // filtro de la lista

  const esAdmin = usuario?.rol === 'admin';

  useEffect(() => {
    if (!cargandoSesion && usuario && !esAdmin) router.replace('/negocios');
  }, [cargandoSesion, usuario, esAdmin, router]);

  const cargar = async () => {
    setCargando(true); setError(null);
    try {
      const res = await fetch('/api/negocios');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al cargar');
      setNegocios(data.negocios || []);
    } catch (e: any) { setError(e.message); }
    finally { setCargando(false); }
  };
  useEffect(() => { if (esAdmin) cargar(); }, [esAdmin]);

  // Perfiles disponibles (para el selector).
  const perfiles = useMemo(() => {
    const m = new Map<string, { key: string; nombre: string; email: string | null; total: number }>();
    for (const n of negocios) {
      const key = n.usuario_email || n.usuario_nombre || 'sin';
      const e = m.get(key) || { key, nombre: n.usuario_nombre || n.usuario_email || 'Sin asignar', email: n.usuario_email, total: 0 };
      e.total++; m.set(key, e);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [negocios]);

  // Conjunto visible según el perfil elegido.
  const visibles = useMemo(
    () => negocios.filter(n => perfil == null || (n.usuario_email || n.usuario_nombre) === perfil),
    [negocios, perfil]);

  // ── Métricas ────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    let vigentes = 0, postuladas = 0, adjudicadas = 0, descartadas = 0, perdidas = 0,
      enProceso = 0, asignadas = 0, cierran7 = 0, montoOfertado = 0, montoAdjudicado = 0;
    const porEstadoMap = new Map<string, number>();
    const porTipoMap = new Map<string, number>();
    const porMesMap = new Map<string, number>();
    const porOrgMap = new Map<string, number>();

    for (const n of visibles) {
      const id = idDe(n.estado_pipeline);
      porEstadoMap.set(id, (porEstadoMap.get(id) || 0) + 1);

      if (id === 'ASIGNADO') asignadas++;
      if (id === 'EN_PROCESO' || id === 'ANEXOS' || id === 'ANEXO_LISTO' || id === 'VISADO') enProceso++;
      if (id === 'POSTULADA') postuladas++;
      if (id === 'ADJUDICADA') { adjudicadas++; montoAdjudicado += n.monto_ofertado || n.licitacion_monto || 0; }
      if (id === 'DESCARTADA') descartadas++;
      if (id === 'PERDIDA') perdidas++;

      const resuelta = RESUELTOS.has(id);
      if (!resuelta && !cierreVencido(n.licitacion_cierre)) vigentes++;

      const d = diasHasta(n.licitacion_cierre);
      if (d != null && d >= 0 && d <= 7 && !resuelta) cierran7++;

      montoOfertado += n.monto_ofertado || n.licitacion_monto || 0;

      const tipo = extractTipoFromCodigo(n.licitacion_codigo || '') || '—';
      porTipoMap.set(tipo, (porTipoMap.get(tipo) || 0) + 1);

      if (n.licitacion_cierre) {
        const dt = new Date(n.licitacion_cierre);
        if (!isNaN(dt.getTime())) {
          const k = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
          porMesMap.set(k, (porMesMap.get(k) || 0) + 1);
        }
      }
      if (n.licitacion_organismo) porOrgMap.set(n.licitacion_organismo, (porOrgMap.get(n.licitacion_organismo) || 0) + 1);
    }

    const total = visibles.length;
    // Dona por estado, en orden del pipeline.
    const porEstado = ESTADOS_PIPELINE
      .filter(e => (porEstadoMap.get(e.id) || 0) > 0)
      .map(e => ({ id: e.id, name: e.label, value: porEstadoMap.get(e.id)!, color: e.color, pct: total ? Math.round((porEstadoMap.get(e.id)! / total) * 100) : 0 }));

    // Dona "en trabajo": EXCLUYE descartadas y postuladas (no son dato crudo de gestión activa).
    // Muestra el dato real de lo que se está trabajando. Los % se recalculan sobre ese subtotal.
    const EXCLUIDOS_TRABAJO = new Set(['DESCARTADA', 'POSTULADA']);
    const totalTrabajo = ESTADOS_PIPELINE
      .filter(e => !EXCLUIDOS_TRABAJO.has(e.id))
      .reduce((acc, e) => acc + (porEstadoMap.get(e.id) || 0), 0);
    const porEstadoTrabajo = ESTADOS_PIPELINE
      .filter(e => !EXCLUIDOS_TRABAJO.has(e.id) && (porEstadoMap.get(e.id) || 0) > 0)
      .map(e => ({ id: e.id, name: e.label, value: porEstadoMap.get(e.id)!, color: e.color, pct: totalTrabajo ? Math.round((porEstadoMap.get(e.id)! / totalTrabajo) * 100) : 0 }));

    const porTipo = [...porTipoMap.entries()]
      .map(([tipo, value]) => ({ tipo, name: tipo, value, color: getTipoLicitacion(tipo)?.color || '#94a3b8' }))
      .sort((a, b) => b.value - a.value);

    const porMes = [...porMesMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-8)
      .map(([k, value]) => { const [y, m] = k.split('-'); return { mes: `${MESES[+m - 1]} ${y.slice(2)}`, value }; });

    const topOrg = [...porOrgMap.entries()]
      .map(([name, value]) => ({ name: name.length > 26 ? name.slice(0, 26) + '…' : name, value }))
      .sort((a, b) => b.value - a.value).slice(0, 6);

    const tasaAdj = postuladas + adjudicadas > 0 ? Math.round((adjudicadas / (postuladas + adjudicadas)) * 100) : 0;

    return {
      total, vigentes, asignadas, enProceso, postuladas, adjudicadas, descartadas, perdidas,
      cierran7, montoOfertado, montoAdjudicado, tasaAdj,
      porEstado, porEstadoTrabajo, totalTrabajo, porTipo, porMes, topOrg,
    };
  }, [visibles]);

  // Lista (respeta el filtro por estado que se elija abajo).
  const lista = useMemo(() => {
    const arr = estadoLista ? visibles.filter(n => idDe(n.estado_pipeline) === estadoLista) : visibles;
    return [...arr].sort((a, b) => {
      const da = a.licitacion_cierre ? new Date(a.licitacion_cierre).getTime() : Infinity;
      const db = b.licitacion_cierre ? new Date(b.licitacion_cierre).getTime() : Infinity;
      return da - db;
    });
  }, [visibles, estadoLista]);

  if (!cargandoSesion && usuario && !esAdmin) {
    return <AppLayout breadcrumb={[{ label: 'Análisis de licitación' }]}><div className="p-10 text-center text-sm text-slate-500">Redirigiendo…</div></AppLayout>;
  }

  const perfilNombre = perfil == null ? 'Todos los perfiles' : (perfiles.find(p => p.key === perfil)?.nombre || perfil);

  return (
    <AppLayout breadcrumb={[{ label: 'Análisis de licitación' }]}>
      <div className="max-w-full space-y-5 pb-8">
        {/* Encabezado */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
              <Activity size={18} />
            </div>
            <div>
              <h1 className="text-[16px] font-bold text-slate-900">Análisis de licitación</h1>
              <p className="text-xs text-slate-500">Estadísticas y gráficos por perfil</p>
            </div>
          </div>
          <button onClick={cargar} disabled={cargando}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
            <RefreshCw size={15} className={cargando ? 'animate-spin' : ''} />
          </button>
        </div>

        {error && <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>}

        {cargando ? (
          <div className="flex items-center justify-center py-16 gap-2 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin text-indigo-500" /> Cargando…
          </div>
        ) : negocios.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Activity size={20} className="text-slate-300" />
            </div>
            <p className="text-sm font-semibold text-slate-600">No hay licitaciones en gestión</p>
          </div>
        ) : (
          <>
            {/* Selector de perfil */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
              <div className="flex items-center gap-2 mb-2.5">
                <Users size={13} className="text-slate-400" />
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Selecciona un perfil</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => { setPerfil(null); setEstadoLista(null); }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border transition-colors ${
                    perfil === null ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                  }`}>
                  <Layers size={13} /> Todos <span className="opacity-70">({negocios.length})</span>
                </button>
                {perfiles.map(p => {
                  const activo = perfil === p.key;
                  const col = colorUsuario(p.email || p.key);
                  return (
                    <button key={p.key} onClick={() => { setPerfil(activo ? null : p.key); setEstadoLista(null); }}
                      style={activo ? { backgroundColor: col, borderColor: col } : { borderColor: col + '55' }}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border transition-colors ${
                        activo ? 'text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                      }`}>
                      <span style={{ background: activo ? 'rgba(255,255,255,.3)' : col }}
                        className="inline-flex items-center justify-center w-5 h-5 rounded-full text-white text-[9px] font-bold">
                        {inicialesUsuario(p.nombre, p.email)}
                      </span>
                      {p.nombre} <span className="opacity-70">({p.total})</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Título del scope */}
            <div className="flex items-center gap-2 text-[13px] text-slate-500">
              <span className="font-bold text-slate-800">{perfilNombre}</span>
              <span>·</span>
              <span>{stats.total} licitación{stats.total !== 1 ? 'es' : ''} en total</span>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <KPI icon={<Briefcase size={16} />} label="Vigentes" value={String(stats.vigentes)} tint="#4f46e5" sub="en trabajo" />
              <KPI icon={<Send size={16} />} label="Postuladas" value={String(stats.postuladas)} tint="#b45309" />
              <KPI icon={<Trophy size={16} />} label="Adjudicadas" value={String(stats.adjudicadas)} tint="#16a34a" />
              <KPI icon={<Ban size={16} />} label="Descartadas" value={String(stats.descartadas)} tint="#dc2626" />
              <KPI icon={<Target size={16} />} label="Tasa adjudicación" value={`${stats.tasaAdj}%`} tint="#7c3aed" sub="adj / postuladas" />
              <KPI icon={<Clock size={16} />} label="Cierran ≤ 7 días" value={String(stats.cierran7)} tint={stats.cierran7 > 0 ? '#dc2626' : '#64748b'} />
            </div>

            {/* Montos */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-gradient-to-br from-teal-50 to-white rounded-xl border border-teal-100 p-4 flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-teal-100 text-teal-600 flex items-center justify-center flex-shrink-0"><DollarSign size={20} /></div>
                <div><p className="text-[11px] text-teal-700 font-semibold uppercase tracking-wide">Monto ofertado / estimado</p><p className="text-[22px] font-black text-slate-900 tabular-nums leading-tight">{fmtMonto(stats.montoOfertado)}</p></div>
              </div>
              <div className="bg-gradient-to-br from-emerald-50 to-white rounded-xl border border-emerald-100 p-4 flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center flex-shrink-0"><Trophy size={20} /></div>
                <div><p className="text-[11px] text-emerald-700 font-semibold uppercase tracking-wide">Monto adjudicado</p><p className="text-[22px] font-black text-slate-900 tabular-nums leading-tight">{fmtMonto(stats.montoAdjudicado)}</p></div>
              </div>
            </div>

            {/* Gráficos */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Dona por estado — TODAS (dato completo) */}
              <ChartCard title="Distribución por estado · todas" icon={<Layers size={13} />}>
                {stats.porEstado.length === 0 ? <SinDatos /> : (
                  <DonaEstados data={stats.porEstado} total={stats.total} centroLabel="licitaciones" />
                )}
              </ChartCard>

              {/* Dona "en trabajo" — EXCLUYE descartadas y postuladas (dato real de gestión activa) */}
              <ChartCard title="En trabajo · sin descartadas ni postuladas" icon={<Briefcase size={13} />}>
                {stats.porEstadoTrabajo.length === 0 ? <SinDatos /> : (
                  <>
                    <DonaEstados data={stats.porEstadoTrabajo} total={stats.totalTrabajo} centroLabel="en trabajo" />
                    <p className="mt-2 text-[10.5px] text-slate-400 leading-snug">
                      No incluye <span className="font-semibold text-red-600">descartadas</span> ni <span className="font-semibold text-amber-600">postuladas</span> — solo lo que sigue en gestión.
                    </p>
                  </>
                )}
              </ChartCard>

              {/* Tasa de adjudicación (radial) */}
              <ChartCard title="Tasa de adjudicación" icon={<Target size={13} />}>
                <div className="flex items-center gap-4">
                  <div style={{ width: 180, height: 200 }} className="relative">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadialBarChart innerRadius="70%" outerRadius="100%" data={[{ name: 'tasa', value: stats.tasaAdj, fill: '#7c3aed' }]}
                        startAngle={90} endAngle={90 - (stats.tasaAdj / 100) * 360}>
                        <RadialBar background dataKey="value" cornerRadius={10} />
                      </RadialBarChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-[30px] font-black text-violet-700 leading-none tabular-nums">{stats.tasaAdj}%</span>
                      <span className="text-[10px] text-slate-400 font-semibold">éxito</span>
                    </div>
                  </div>
                  <div className="flex-1 space-y-2.5">
                    <MiniStat label="Postuladas" value={stats.postuladas} color="#b45309" />
                    <MiniStat label="Adjudicadas" value={stats.adjudicadas} color="#16a34a" />
                    <MiniStat label="Perdidas" value={stats.perdidas} color="#9f1239" />
                    <MiniStat label="Descartadas" value={stats.descartadas} color="#dc2626" />
                  </div>
                </div>
              </ChartCard>

              {/* Barras por tipo */}
              <ChartCard title="Por tipo de licitación" icon={<Layers size={13} />}>
                {stats.porTipo.length === 0 ? <SinDatos /> : (
                  <ResponsiveContainer width="100%" height={210}>
                    <BarChart data={stats.porTipo} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                      <CartesianGrid horizontal={false} stroke="#f1f5f9" />
                      <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} width={40} />
                      <RTooltip content={<ChartTooltip sufijo="licitaciones" />} cursor={{ fill: '#f8fafc' }} />
                      <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                        {stats.porTipo.map((e) => <Cell key={e.tipo} fill={e.color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </ChartCard>

              {/* Evolución mensual */}
              <ChartCard title="Cierres por mes" icon={<TrendingUp size={13} />}>
                {stats.porMes.length === 0 ? <SinDatos /> : (
                  <ResponsiveContainer width="100%" height={210}>
                    <AreaChart data={stats.porMes} margin={{ left: -18, right: 12, top: 8, bottom: 4 }}>
                      <defs>
                        <linearGradient id="gradArea" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="mes" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} width={30} />
                      <RTooltip content={<ChartTooltip sufijo="cierran" />} />
                      <Area type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2} fill="url(#gradArea)" />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </ChartCard>

              {/* Top organismos */}
              <ChartCard title="Top organismos" icon={<Building2 size={13} />} className="lg:col-span-2">
                {stats.topOrg.length === 0 ? <SinDatos /> : (
                  <ResponsiveContainer width="100%" height={Math.max(120, stats.topOrg.length * 34)}>
                    <BarChart data={stats.topOrg} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                      <CartesianGrid horizontal={false} stroke="#f1f5f9" />
                      <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} width={200} />
                      <RTooltip content={<ChartTooltip sufijo="licitaciones" />} cursor={{ fill: '#f8fafc' }} />
                      <Bar dataKey="value" fill="#0d9488" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </ChartCard>
            </div>

            {/* Lista de licitaciones (aparte de los gráficos) */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 flex-wrap">
                <Briefcase size={13} className="text-slate-400" />
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Lista de licitaciones</span>
                <span className="text-[11px] text-slate-400">({lista.length})</span>
                {/* Filtro por estado */}
                <div className="ml-auto flex flex-wrap gap-1">
                  <button onClick={() => setEstadoLista(null)}
                    className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-md border ${estadoLista === null ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>Todas</button>
                  {stats.porEstado.map(e => (
                    <button key={e.id} onClick={() => setEstadoLista(estadoLista === e.id ? null : e.id)}
                      style={estadoLista === e.id ? { backgroundColor: e.color, borderColor: e.color, color: '#fff' } : { borderColor: e.color + '55', color: e.color }}
                      className="text-[10.5px] font-semibold px-2 py-0.5 rounded-md border bg-white hover:bg-slate-50">
                      {e.name} {e.value}
                    </button>
                  ))}
                </div>
              </div>
              <div className="divide-y divide-slate-50">
                {lista.length === 0 ? (
                  <p className="text-center text-sm text-slate-400 py-10">Sin licitaciones en este filtro</p>
                ) : lista.map(n => {
                  const cfg = getEstadoPipeline(n.estado_pipeline);
                  const col = cfg?.color || '#64748b';
                  const d = diasHasta(n.licitacion_cierre);
                  const cierreTint = d != null && d >= 0 ? (d <= 3 ? '#dc2626' : d <= 7 ? '#d97706' : '#64748b') : '#94a3b8';
                  const perfilCol = colorUsuario(n.usuario_email || n.usuario_nombre || 'sin');
                  return (
                    <Link key={n.id} href={`/negocios/${n.id}`}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors group">
                      <span className="text-[10.5px] font-mono font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded flex-shrink-0 w-[130px] truncate">{n.licitacion_codigo}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-slate-800 truncate group-hover:text-indigo-700 transition-colors">{n.licitacion_nombre || '(sin nombre)'}</p>
                        {n.licitacion_organismo && <p className="text-[11px] text-slate-400 truncate flex items-center gap-1"><Building2 size={9} /> {n.licitacion_organismo}</p>}
                      </div>
                      {perfil == null && (
                        <span className="w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0" style={{ background: perfilCol }} title={n.usuario_nombre || n.usuario_email || ''}>
                          {inicialesUsuario(n.usuario_nombre, n.usuario_email)}
                        </span>
                      )}
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0 whitespace-nowrap"
                        style={{ background: col + '18', color: col, borderColor: col + '40' }}>{cfg?.label || n.estado_pipeline}</span>
                      <span className="text-[12px] font-semibold text-slate-700 tabular-nums w-16 text-right flex-shrink-0">{fmtMontoCorto(n.monto_ofertado || n.licitacion_monto || 0)}</span>
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium tabular-nums w-20 justify-end flex-shrink-0" style={{ color: cierreTint }}>
                        <Calendar size={10} /> {fmtFecha(n.licitacion_cierre)}
                      </span>
                      <ChevronRight size={14} className="text-slate-300 group-hover:text-indigo-500 flex-shrink-0" />
                    </Link>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}

// ── Sub-componentes ────────────────────────────────────────────────────────────
function KPI({ icon, label, value, tint, sub }: { icon: React.ReactNode; label: string; value: string; tint: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-3.5 py-3">
      <div className="flex items-center gap-2 mb-1.5">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${tint}14`, color: tint }}>{icon}</div>
        <p className="text-[10.5px] text-slate-400 font-semibold uppercase tracking-wide leading-tight">{label}</p>
      </div>
      <p className="text-[24px] font-black text-slate-900 leading-none tabular-nums">{value}</p>
      {sub && <p className="text-[10px] text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}

function ChartCard({ title, icon, children, className = '' }: { title: string; icon: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-sm p-4 ${className}`}>
      <div className="flex items-center gap-1.5 mb-3">
        <span className="text-slate-400">{icon}</span>
        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{title}</span>
      </div>
      {children}
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: color }} />
      <span className="text-[12px] text-slate-500 flex-1">{label}</span>
      <span className="text-[15px] font-bold text-slate-800 tabular-nums">{value}</span>
    </div>
  );
}

function SinDatos() {
  return <div className="h-[200px] flex items-center justify-center text-[12px] text-slate-300">Sin datos</div>;
}

// Dona por estado reutilizable (leyenda con valor y %). Se usa para "todas" y "en trabajo".
function DonaEstados({ data, total, centroLabel }: {
  data: { id: string; name: string; value: number; color: string; pct: number }[];
  total: number;
  centroLabel: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative flex-shrink-0" style={{ width: 180, height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%"
              innerRadius={52} outerRadius={80} paddingAngle={2} stroke="none">
              {data.map((e) => <Cell key={e.id} fill={e.color} />)}
            </Pie>
            <RTooltip content={<ChartTooltip sufijo="licitaciones" />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[26px] font-black text-slate-900 leading-none tabular-nums">{total}</span>
          <span className="text-[10px] text-slate-400 font-semibold">{centroLabel}</span>
        </div>
      </div>
      <div className="flex-1 space-y-1.5 min-w-0">
        {data.map(e => (
          <div key={e.id} className="flex items-center gap-2 text-[12px]">
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: e.color }} />
            <span className="text-slate-600 truncate flex-1">{e.name}</span>
            <span className="font-bold text-slate-800 tabular-nums">{e.value}</span>
            <span className="text-slate-400 tabular-nums w-9 text-right">{e.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
