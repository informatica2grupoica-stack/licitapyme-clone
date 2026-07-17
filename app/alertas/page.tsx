'use client';

// /alertas — Historial de actividad de usuarios (SOLO ADMIN).
// Muestra todo lo que hacen los usuarios (comentarios, cambios de línea de negocio,
// asignaciones, etc.), filtrable por usuario y acción; arriba una tira de
// "alertas recientes" (asignaciones de licitaciones y nuevas del radar).
import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { MultiSelect } from '@/app/components/ui/MultiSelect';
import { colorUsuario, inicialesUsuario } from '@/app/lib/user-color';
import {
  Bell, MessageSquare, Tag, UserPlus, Radar as RadarIcon, GitBranch,
  Eye, LogIn, Star, Activity, Filter, Loader2, AlertCircle, RefreshCw, Users, X, Search, Calendar,
} from 'lucide-react';

interface Actividad {
  id: number;
  usuario_id: number | null;
  accion: string;
  entidad_tipo: string | null;
  entidad_id: string | null;
  descripcion: string | null;
  metadata: any;
  created_at: string;
  usuario_nombre: string | null;
  usuario_email: string | null;
}
interface Usuario { id: number; nombre: string | null; email: string; }

// Config visual por acción
const ACCION_META: Record<string, { label: string; icon: React.ReactNode; color: string; bg: string }> = {
  comentario_licitacion: { label: 'Comentario en licitación', icon: <MessageSquare size={14} />, color: '#2563eb', bg: '#eff6ff' },
  comentario_negocio:    { label: 'Comentario en negocio',    icon: <MessageSquare size={14} />, color: '#2563eb', bg: '#eff6ff' },
  cambio_etiqueta:       { label: 'Cambió línea de negocio',  icon: <Tag size={14} />,           color: '#7c3aed', bg: '#f5f3ff' },
  cambio_pipeline:       { label: 'Cambió estado',            icon: <GitBranch size={14} />,     color: '#0891b2', bg: '#ecfeff' },
  asignacion:            { label: 'Asignó licitación',        icon: <UserPlus size={14} />,      color: '#059669', bg: '#ecfdf5' },
  radar_nuevas:          { label: 'Nuevas en el radar',       icon: <RadarIcon size={14} />,     color: '#d97706', bg: '#fffbeb' },
  ver_licitacion:        { label: 'Vio licitación',           icon: <Eye size={14} />,           color: '#64748b', bg: '#f8fafc' },
  login:                 { label: 'Inició sesión',            icon: <LogIn size={14} />,         color: '#64748b', bg: '#f8fafc' },
  favorito:              { label: 'Favorito',                 icon: <Star size={14} />,          color: '#ca8a04', bg: '#fefce8' },
  descarte_radar:        { label: 'Descarte del radar',       icon: <X size={14} />,             color: '#dc2626', bg: '#fef2f2' },
  feedback_viabilidad:   { label: 'Corrección de viabilidad', icon: <MessageSquare size={14} />, color: '#9333ea', bg: '#faf5ff' },
  chat_ia:               { label: 'Consulta al chat IA',      icon: <MessageSquare size={14} />, color: '#0d9488', bg: '#f0fdfa' },
  informe:               { label: 'Informe técnico PDF',      icon: <Activity size={14} />,      color: '#4f46e5', bg: '#eef2ff' },
  busqueda_equipamiento: { label: 'Búsqueda de equipamiento', icon: <Eye size={14} />,           color: '#0369a1', bg: '#f0f9ff' },
  radar_manual:          { label: 'Actualizó el radar',       icon: <RadarIcon size={14} />,     color: '#d97706', bg: '#fffbeb' },
};
function metaFor(accion: string) {
  return ACCION_META[accion] || { label: accion, icon: <Activity size={14} />, color: '#64748b', bg: '#f8fafc' };
}

function tiempoRelativo(fecha: string): string {
  const diff = Date.now() - new Date(fecha).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `hace ${d} d`;
  return new Date(fecha).toLocaleDateString('es-CL');
}
function HistorialContent() {
  const { usuario } = useSession();
  const isAdmin = usuario?.rol === 'admin';

  const [actividad, setActividad]   = useState<Actividad[]>([]);
  const [usuarios, setUsuarios]     = useState<Usuario[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [migracion, setMigracion]   = useState(false);
  // Filtros de SELECCIÓN MÚLTIPLE (se filtra en cliente sobre todo el historial cargado).
  const [filtroUsuario, setFiltroUsuario] = useState<string[]>([]);
  const [filtroAccion, setFiltroAccion]   = useState<string[]>([]);
  const [busqueda, setBusqueda]           = useState('');
  const [fechaDesde, setFechaDesde]       = useState('');
  const [fechaHasta, setFechaHasta]       = useState('');
  // Paginación: 1.000 eventos en una sola lista hacían la página eterna de scrollear.
  const POR_PAGINA = 50;
  const [pagina, setPagina] = useState(1);

  const cargar = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const d = await fetch('/api/actividad?limit=1000').then(r => r.json());
      if (!d.success) throw new Error(d.error || 'Error');
      setActividad(d.actividad || []);
      setUsuarios(d.usuarios || []);
      setMigracion(!!d.migracionPendiente);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (isAdmin) cargar(); }, [isAdmin, cargar]);

  // Lista filtrada en cliente por usuario(s), acción(es) y texto (descripción o código).
  const filtrada = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const enRango = (fecha: string): boolean => {
      if (!fechaDesde && !fechaHasta) return true;
      const t = new Date(fecha).getTime();
      if (isNaN(t)) return false;
      if (fechaDesde && t < new Date(`${fechaDesde}T00:00:00`).getTime()) return false;
      if (fechaHasta && t > new Date(`${fechaHasta}T23:59:59`).getTime()) return false;
      return true;
    };
    return actividad.filter(a =>
      (filtroUsuario.length === 0 || (a.usuario_id != null && filtroUsuario.includes(String(a.usuario_id)))) &&
      (filtroAccion.length === 0 || filtroAccion.includes(a.accion)) &&
      (!q || (a.descripcion || '').toLowerCase().includes(q) || (a.entidad_id || '').toLowerCase().includes(q)) &&
      enRango(a.created_at),
    );
  }, [actividad, filtroUsuario, filtroAccion, busqueda, fechaDesde, fechaHasta]);

  // Paginación sobre lo ya filtrado; al cambiar filtros se vuelve a la página 1.
  const totalPaginas = Math.max(1, Math.ceil(filtrada.length / POR_PAGINA));
  const paginaSegura = Math.min(pagina, totalPaginas);
  const filtradaPagina = useMemo(
    () => filtrada.slice((paginaSegura - 1) * POR_PAGINA, paginaSegura * POR_PAGINA),
    [filtrada, paginaSegura],
  );
  useEffect(() => { setPagina(1); }, [filtroUsuario, filtroAccion, busqueda, fechaDesde, fechaHasta]);

  // Alertas recientes: asignaciones + nuevas del radar (las últimas 6, sobre lo filtrado)
  const recientes = useMemo(
    () => filtrada.filter(a => a.accion === 'asignacion' || a.accion === 'radar_nuevas').slice(0, 6),
    [filtrada],
  );
  // Acciones presentes (para el filtro), con su conteo
  const accionesDisponibles = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of actividad) m.set(a.accion, (m.get(a.accion) || 0) + 1);
    return [...m.entries()].map(([accion, count]) => ({ accion, count }));
  }, [actividad]);
  // Usuarios presentes en el historial (con conteo), para el filtro
  const usuariosConActividad = useMemo(() => {
    const m = new Map<number, number>();
    for (const a of actividad) if (a.usuario_id != null) m.set(a.usuario_id, (m.get(a.usuario_id) || 0) + 1);
    return usuarios
      .filter(u => m.has(u.id))
      .map(u => ({ ...u, count: m.get(u.id) || 0 }))
      .sort((a, b) => b.count - a.count);
  }, [actividad, usuarios]);

  const hayFiltro = filtroUsuario.length > 0 || filtroAccion.length > 0 || busqueda.trim() !== ''
    || fechaDesde !== '' || fechaHasta !== '';

  if (usuario && !isAdmin) {
    return (
      <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Historial' }]}>
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4">
            <Bell size={26} className="text-slate-400" />
          </div>
          <h3 className="text-[15px] font-bold text-slate-800 mb-1.5">Acceso restringido</h3>
          <p className="text-[13px] text-slate-400 max-w-xs">El historial de actividad es solo para administradores.</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Historial' }]}>
      <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-600/25">
              <Activity size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">Historial de actividad</h1>
              <p className="text-[12px] text-slate-500">Todo lo que hacen los usuarios en la plataforma</p>
            </div>
          </div>
          <button onClick={cargar} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {migracion && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-xl text-[13px] mb-4">
            <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
            <span>Falta crear la tabla del historial. Ejecuta <strong>migration-18-actividad.sql</strong> en phpMyAdmin para empezar a registrar la actividad.</span>
          </div>
        )}

        {/* Alertas recientes */}
        {recientes.length > 0 && (
          <div className="mb-5">
            <h2 className="text-[12px] font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Bell size={13} /> Alertas recientes
            </h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {recientes.map(a => {
                const m = metaFor(a.accion);
                return (
                  <div key={a.id} className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-3.5 py-2.5">
                    <span style={{ color: m.color, backgroundColor: m.bg }} className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0">{m.icon}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] text-slate-800 font-medium line-clamp-1">{a.descripcion || m.label}</p>
                      <p className="text-[11px] text-slate-400">{a.usuario_nombre || a.usuario_email || 'Sistema'} · <span title={new Date(a.created_at).toLocaleString('es-CL', { dateStyle: 'full', timeStyle: 'short' })}>{tiempoRelativo(a.created_at)}</span></p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Filtros (selección múltiple) */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-[12px] text-slate-400 font-medium flex items-center gap-1"><Filter size={13} /> Filtrar:</span>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text" value={busqueda} onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre o código de licitación…"
              title="Busca en el texto de cada evento (incluye el nombre de la licitación) y en su código (ej: 1499887-11-LE26)"
              className="pl-8 pr-7 py-2 w-[230px] border border-slate-200 rounded-lg text-[12px] bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 outline-none transition-all"
            />
            {busqueda && (
              <button onClick={() => setBusqueda('')} title="Limpiar búsqueda"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X size={12} /></button>
            )}
          </div>
          <MultiSelect
            label={filtroUsuario.length ? 'Usuarios' : 'Todos los usuarios'}
            icon={<Users size={13} />}
            options={usuariosConActividad.map(u => ({
              value: String(u.id), label: u.nombre || u.email, color: colorUsuario(u.email || u.id), count: u.count,
            }))}
            selected={filtroUsuario}
            onChange={setFiltroUsuario}
          />
          <MultiSelect
            label={filtroAccion.length ? 'Acciones' : 'Todas las acciones'}
            icon={<Activity size={13} />}
            options={accionesDisponibles.map(a => ({
              value: a.accion, label: metaFor(a.accion).label, color: metaFor(a.accion).color, count: a.count,
            }))}
            selected={filtroAccion}
            onChange={setFiltroAccion}
          />
          <div className="inline-flex items-center gap-1.5 border border-slate-200 rounded-lg px-2 py-[5px] bg-white"
            title="Rango de fechas del evento (cuándo se realizó la acción)">
            <Calendar size={12} className="text-slate-400 flex-shrink-0" />
            <input type="date" value={fechaDesde} max={fechaHasta || undefined}
              onChange={e => setFechaDesde(e.target.value)}
              className="text-[12px] text-slate-600 outline-none bg-transparent w-[112px]" />
            <span className="text-slate-300 text-[11px]">→</span>
            <input type="date" value={fechaHasta} min={fechaDesde || undefined}
              onChange={e => setFechaHasta(e.target.value)}
              className="text-[12px] text-slate-600 outline-none bg-transparent w-[112px]" />
            {(fechaDesde || fechaHasta) && (
              <button onClick={() => { setFechaDesde(''); setFechaHasta(''); }}
                title="Limpiar fechas" className="text-slate-400 hover:text-red-500"><X size={12} /></button>
            )}
          </div>
          {hayFiltro && (
            <button onClick={() => { setFiltroUsuario([]); setFiltroAccion([]); setBusqueda(''); setFechaDesde(''); setFechaHasta(''); }}
              className="inline-flex items-center gap-1 text-[12px] font-semibold text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 px-2.5 py-2 rounded-lg transition-colors">
              <X size={12} /> Limpiar
            </button>
          )}
          <span className="ml-auto text-[12px] text-slate-400 tabular-nums">
            {filtrada.length}{hayFiltro ? ` de ${actividad.length}` : ''} evento{filtrada.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Timeline */}
        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm mb-4">
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-2">{[1,2,3,4,5].map(i => <div key={i} className="h-14 bg-slate-100 rounded-xl animate-pulse" />)}</div>
        ) : filtrada.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
            <Activity size={32} className="text-slate-300 mx-auto mb-3" />
            <p className="text-[14px] font-semibold text-slate-700 mb-1">{hayFiltro ? 'Sin resultados para el filtro' : 'Sin actividad registrada'}</p>
            <p className="text-[12px] text-slate-400">{hayFiltro ? 'Prueba con otro usuario o acción.' : 'Cuando los usuarios comenten, cambien líneas de negocio o se asignen licitaciones, aparecerá aquí.'}</p>
          </div>
        ) : (
          <>
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-50">
            {filtradaPagina.map(a => {
              const m = metaFor(a.accion);
              const col = colorUsuario(a.usuario_email || a.usuario_id);
              const link = a.entidad_tipo === 'licitacion' && a.entidad_id
                ? `/licitacion/${encodeURIComponent(a.entidad_id)}`
                : a.entidad_tipo === 'negocio' && a.entidad_id
                ? `/negocios/${a.entidad_id}`
                : null;
              const inner = (
                <div className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50/60 transition-colors border-l-[3px]" style={{ borderLeftColor: col }}>
                  <span style={{ color: m.color, backgroundColor: m.bg }} className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">{m.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-slate-800">{a.descripcion || m.label}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <span className="inline-flex items-center gap-1">
                        <span className="w-4 h-4 rounded-full text-white text-[8px] font-bold flex items-center justify-center" style={{ background: col }}>
                          {inicialesUsuario(a.usuario_nombre, a.usuario_email)}
                        </span>
                        <span className="font-semibold" style={{ color: col }}>{a.usuario_nombre || a.usuario_email || 'Sistema'}</span>
                      </span>
                      · <span title={new Date(a.created_at).toLocaleString('es-CL', { dateStyle: 'full', timeStyle: 'short' })}>{tiempoRelativo(a.created_at)}</span>
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold" style={{ color: m.color, background: m.bg }}>{m.label}</span>
                    </p>
                  </div>
                </div>
              );
              return link
                ? <Link key={a.id} href={link} className="block">{inner}</Link>
                : <div key={a.id}>{inner}</div>;
            })}
          </div>

          {/* Paginación (50 por página) */}
          {totalPaginas > 1 && (
            <div className="flex items-center justify-between gap-3 mt-4 flex-wrap">
              <p className="text-[12px] text-slate-500">
                Mostrando <strong className="text-slate-700">{(paginaSegura - 1) * POR_PAGINA + 1}</strong>–
                <strong className="text-slate-700">{Math.min(paginaSegura * POR_PAGINA, filtrada.length)}</strong>
                {' '}de <strong className="text-slate-700">{filtrada.length}</strong> eventos
              </p>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={paginaSegura <= 1}
                  className="px-3 py-1.5 text-[12px] font-semibold rounded-lg border border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                  Anterior
                </button>
                <span className="px-3 py-1.5 text-[12px] font-semibold text-slate-700 tabular-nums">{paginaSegura} / {totalPaginas}</span>
                <button onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))} disabled={paginaSegura >= totalPaginas}
                  className="px-3 py-1.5 text-[12px] font-semibold rounded-lg border border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                  Siguiente
                </button>
              </div>
            </div>
          )}
          </>
        )}
      </div>
    </AppLayout>
  );
}

export default function AlertasPage() {
  return <Suspense><HistorialContent /></Suspense>;
}
