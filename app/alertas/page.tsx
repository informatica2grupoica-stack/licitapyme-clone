'use client';

// /alertas — Historial de actividad de usuarios (SOLO ADMIN).
// Muestra todo lo que hacen los usuarios (comentarios, cambios de línea de negocio,
// asignaciones, etc.), filtrable por usuario y acción; arriba una tira de
// "alertas recientes" (asignaciones de licitaciones y nuevas del radar).
import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import {
  Bell, MessageSquare, Tag, UserPlus, Radar as RadarIcon, GitBranch,
  Eye, LogIn, Star, Activity, Filter, Loader2, AlertCircle, RefreshCw,
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
function iniciales(nombre: string | null, email: string | null): string {
  const base = nombre || email || '?';
  return base.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function HistorialContent() {
  const { usuario } = useSession();
  const isAdmin = usuario?.rol === 'admin';

  const [actividad, setActividad]   = useState<Actividad[]>([]);
  const [usuarios, setUsuarios]     = useState<Usuario[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [migracion, setMigracion]   = useState(false);
  const [filtroUsuario, setFiltroUsuario] = useState('');
  const [filtroAccion, setFiltroAccion]   = useState('');

  const cargar = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams();
      if (filtroUsuario) qs.set('usuarioId', filtroUsuario);
      if (filtroAccion)  qs.set('accion', filtroAccion);
      const d = await fetch(`/api/actividad?${qs.toString()}`).then(r => r.json());
      if (!d.success) throw new Error(d.error || 'Error');
      setActividad(d.actividad || []);
      setUsuarios(d.usuarios || []);
      setMigracion(!!d.migracionPendiente);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [filtroUsuario, filtroAccion]);

  useEffect(() => { if (isAdmin) cargar(); }, [isAdmin, cargar]);

  // Alertas recientes: asignaciones + nuevas del radar (las últimas 6)
  const recientes = useMemo(
    () => actividad.filter(a => a.accion === 'asignacion' || a.accion === 'radar_nuevas').slice(0, 6),
    [actividad],
  );
  // Acciones presentes (para el filtro)
  const accionesDisponibles = useMemo(
    () => [...new Set(actividad.map(a => a.accion))],
    [actividad],
  );

  if (usuario && !isAdmin) {
    return (
      <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Alertas' }]}>
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
    <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Alertas' }]}>
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
                      <p className="text-[11px] text-slate-400">{a.usuario_nombre || a.usuario_email || 'Sistema'} · {tiempoRelativo(a.created_at)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-[12px] text-slate-400 font-medium flex items-center gap-1"><Filter size={13} /> Filtrar:</span>
          <select value={filtroUsuario} onChange={e => setFiltroUsuario(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-[13px] focus:ring-2 focus:ring-indigo-500 outline-none">
            <option value="">Todos los usuarios</option>
            {usuarios.map(u => <option key={u.id} value={u.id}>{u.nombre || u.email}</option>)}
          </select>
          <select value={filtroAccion} onChange={e => setFiltroAccion(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-[13px] focus:ring-2 focus:ring-indigo-500 outline-none">
            <option value="">Todas las acciones</option>
            {accionesDisponibles.map(ac => <option key={ac} value={ac}>{metaFor(ac).label}</option>)}
          </select>
        </div>

        {/* Timeline */}
        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm mb-4">
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-2">{[1,2,3,4,5].map(i => <div key={i} className="h-14 bg-slate-100 rounded-xl animate-pulse" />)}</div>
        ) : actividad.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
            <Activity size={32} className="text-slate-300 mx-auto mb-3" />
            <p className="text-[14px] font-semibold text-slate-700 mb-1">Sin actividad registrada</p>
            <p className="text-[12px] text-slate-400">Cuando los usuarios comenten, cambien líneas de negocio o se asignen licitaciones, aparecerá aquí.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-50">
            {actividad.map(a => {
              const m = metaFor(a.accion);
              const link = a.entidad_tipo === 'licitacion' && a.entidad_id
                ? `/licitacion/${encodeURIComponent(a.entidad_id)}`
                : a.entidad_tipo === 'negocio' && a.entidad_id
                ? `/negocios/${a.entidad_id}`
                : null;
              const inner = (
                <div className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50/60 transition-colors">
                  <span style={{ color: m.color, backgroundColor: m.bg }} className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">{m.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-slate-800">{a.descripcion || m.label}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5">
                      <span className="inline-flex items-center gap-1">
                        <span className="w-4 h-4 rounded-full bg-gradient-to-br from-indigo-400 to-violet-400 text-white text-[8px] font-bold flex items-center justify-center">
                          {iniciales(a.usuario_nombre, a.usuario_email)}
                        </span>
                        {a.usuario_nombre || a.usuario_email || 'Sistema'}
                      </span>
                      · {tiempoRelativo(a.created_at)}
                      <span className="text-slate-300">· {m.label}</span>
                    </p>
                  </div>
                </div>
              );
              return link
                ? <Link key={a.id} href={link} className="block">{inner}</Link>
                : <div key={a.id}>{inner}</div>;
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

export default function AlertasPage() {
  return <Suspense><HistorialContent /></Suspense>;
}
