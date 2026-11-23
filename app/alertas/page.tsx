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
import { Encabezado, Esqueleto, Vacio } from '@/app/components/ui/kit/Estructura';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Banner } from '@/app/components/ui/Banner';
import { Tooltip } from '@/app/components/ui/Tooltip';
import { IconBell as Bell, IconMessage as MessageSquare, IconTag as Tag, IconUserPlus as UserPlus, IconRadar as RadarIcon, IconGitBranch as GitBranch, IconEye as Eye, IconLogin as LogIn, IconStar as Star, IconActivity as Activity, IconFilter as Filter, IconLoader2 as Loader2, IconAlertCircle as AlertCircle, IconRefresh as RefreshCw, IconUsers as Users, IconX as X, IconSearch as Search, IconCalendar as Calendar } from '@tabler/icons-react';

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
  cambio_etiqueta:       { label: 'Cambió línea de negocio',  icon: <Tag size={14} />,           color: '#0891b2', bg: '#ecfeff' },
  cambio_pipeline:       { label: 'Cambió estado',            icon: <GitBranch size={14} />,     color: '#0891b2', bg: '#ecfeff' },
  asignacion:            { label: 'Asignó licitación',        icon: <UserPlus size={14} />,      color: '#059669', bg: '#ecfdf5' },
  radar_nuevas:          { label: 'Nuevas en el radar',       icon: <RadarIcon size={14} />,     color: '#d97706', bg: '#fffbeb' },
  ver_licitacion:        { label: 'Vio licitación',           icon: <Eye size={14} />,           color: '#64748b', bg: '#f8fafc' },
  login:                 { label: 'Inició sesión',            icon: <LogIn size={14} />,         color: '#64748b', bg: '#f8fafc' },
  favorito:              { label: 'Favorito',                 icon: <Star size={14} />,          color: '#ca8a04', bg: '#fefce8' },
  descarte_radar:        { label: 'Descarte del radar',       icon: <X size={14} />,             color: '#dc2626', bg: '#fef2f2' },
  feedback_viabilidad:   { label: 'Corrección de viabilidad', icon: <MessageSquare size={14} />, color: '#475569', bg: '#faf5ff' },
  chat_ia:               { label: 'Consulta a ankIA',         icon: <MessageSquare size={14} />, color: '#0d9488', bg: '#f0fdfa' },
  informe:               { label: 'Informe técnico PDF',      icon: <Activity size={14} />,      color: '#0d9488', bg: '#f0fdfa' },
  busqueda_equipamiento: { label: 'Búsqueda de equipamiento', icon: <Eye size={14} />,           color: '#0369a1', bg: '#f0f9ff' },
  producto_referencia:   { label: 'Producto de referencia',   icon: <Eye size={14} />,           color: '#0369a1', bg: '#f0f9ff' },
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
  const isAdmin = !!usuario?.permisos?.ver_historial;

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
        <div className="p-4 sm:p-6 lg:p-8">
          <Vacio icono={<Bell size={28} stroke={1.75} />} titulo="Acceso restringido" texto="El historial de actividad es solo para administradores." />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Historial' }]}>
      <div className="@container p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
        <Encabezado
          titulo="Historial de actividad"
          descripcion="Todo lo que hacen los usuarios en la plataforma."
          acciones={
            <Tooltip label="Actualizar">
              <Boton onClick={cargar} aria-label="Actualizar" className="!px-0 w-9">
                <RefreshCw size={16} stroke={1.75} className={loading ? 'animate-spin text-slate-400' : 'text-slate-400'} />
              </Boton>
            </Tooltip>
          }
        />

        {migracion && (
          <div className="mb-4">
            <Banner variante="warning">Falta crear la tabla del historial. Ejecuta <strong>migration-18-actividad.sql</strong> en phpMyAdmin para empezar a registrar la actividad.</Banner>
          </div>
        )}

        {/* Alertas recientes */}
        {recientes.length > 0 && (
          <div className="mb-5">
            <h2 className="text-[15px] font-semibold text-tinta dark:text-slate-100 mb-3 flex items-center gap-2">
              <Bell size={18} stroke={1.75} className="text-slate-400" /> Alertas recientes
            </h2>
            <div className="grid gap-2 @xl:grid-cols-2">
              {recientes.map(a => {
                const m = metaFor(a.accion);
                return (
                  <div key={a.id} className="flex items-center gap-3 bg-white dark:bg-slate-900 rounded-xl border border-linea dark:border-slate-800 shadow-tarjeta px-4 py-3">
                    <span style={{ color: m.color, backgroundColor: m.bg }} className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0">{m.icon}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-tinta dark:text-slate-100 font-medium line-clamp-1">{a.descripcion || m.label}</p>
                      <p className="text-xs text-slate-400">{a.usuario_nombre || a.usuario_email || 'Sistema'} · <span title={new Date(a.created_at).toLocaleString('es-CL', { dateStyle: 'full', timeStyle: 'short' })}>{tiempoRelativo(a.created_at)}</span></p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Filtros (selección múltiple) */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-[13px] font-medium text-tinta-2 dark:text-slate-400 flex items-center gap-1.5 mr-1"><Filter size={16} stroke={1.75} className="text-slate-400" /> Filtros</span>
          <div className="relative">
            <Search size={16} stroke={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text" value={busqueda} onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre o código de licitación…"
              title="Busca en el texto de cada evento (incluye el nombre de la licitación) y en su código (ej: 1499887-11-LE26)"
              aria-label="Buscar en el historial" className="h-9 pl-9 pr-8 w-[260px] border border-linea dark:border-slate-700 rounded-lg text-[13px] text-tinta dark:text-slate-100 placeholder:text-tinta-3 bg-white dark:bg-slate-900 focus-visible:ring-2 focus-visible:ring-marca/60 outline-none"
            />
            {busqueda && (
              <button onClick={() => setBusqueda('')} title="Limpiar búsqueda" aria-label="Limpiar búsqueda" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-tinta"><X size={16} stroke={1.75} /></button>
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
          <div className="inline-flex h-9 items-center gap-1.5 border border-linea dark:border-slate-700 rounded-lg px-2.5 bg-white dark:bg-slate-900"
            title="Rango de fechas del evento (cuándo se realizó la acción)">
            <Calendar size={16} stroke={1.75} className="text-slate-400 flex-shrink-0" />
            <input type="date" value={fechaDesde} max={fechaHasta || undefined}
              onChange={e => setFechaDesde(e.target.value)}
              className="text-[13px] text-tinta dark:text-slate-100 outline-none bg-transparent w-[118px]" />
            <span className="text-tinta-3 text-xs">→</span>
            <input type="date" value={fechaHasta} min={fechaDesde || undefined}
              onChange={e => setFechaHasta(e.target.value)}
              className="text-[13px] text-tinta dark:text-slate-100 outline-none bg-transparent w-[118px]" />
            {(fechaDesde || fechaHasta) && (
              <button onClick={() => { setFechaDesde(''); setFechaHasta(''); }}
                title="Limpiar fechas" aria-label="Limpiar fechas" className="text-slate-400 hover:text-urgente"><X size={16} stroke={1.75} /></button>
            )}
          </div>
          {hayFiltro && (
            <Boton variante="fantasma" onClick={() => { setFiltroUsuario([]); setFiltroAccion([]); setBusqueda(''); setFechaDesde(''); setFechaHasta(''); }} icono={<X size={16} stroke={1.75} />}>Limpiar</Boton>
          )}
          <span className="ml-auto text-xs text-tinta-2 dark:text-slate-400 tabular-nums">
            {filtrada.length}{hayFiltro ? ` de ${actividad.length}` : ''} evento{filtrada.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Timeline */}
        {error && <div className="mb-4"><Banner variante="error">{error}</Banner></div>}

        {loading ? (
          <div className="space-y-2">{[1, 2, 3, 4, 5].map(i => <Esqueleto key={i} className="h-14 rounded-xl" />)}</div>
        ) : filtrada.length === 0 ? (
          <Vacio icono={<Activity size={28} stroke={1.75} />}
            titulo={hayFiltro ? 'Sin resultados para el filtro' : 'Sin actividad registrada'}
            texto={hayFiltro ? 'Prueba con otro usuario o acción.' : 'Cuando los usuarios comenten, cambien líneas de negocio o se asignen licitaciones, aparecerá aquí.'}
            accion={hayFiltro ? <Boton tamano="sm" onClick={() => { setFiltroUsuario([]); setFiltroAccion([]); setBusqueda(''); setFechaDesde(''); setFechaHasta(''); }}>Quitar filtros</Boton> : undefined} />
        ) : (
          <>
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-linea dark:border-slate-800 shadow-tarjeta divide-y divide-linea dark:divide-slate-800 overflow-hidden">
            {filtradaPagina.map(a => {
              const m = metaFor(a.accion);
              const col = colorUsuario(a.usuario_email || a.usuario_id);
              const link = a.entidad_tipo === 'licitacion' && a.entidad_id
                ? `/licitacion/${encodeURIComponent(a.entidad_id)}`
                : a.entidad_tipo === 'negocio' && a.entidad_id
                ? `/negocios/${a.entidad_id}`
                : null;
              const inner = (
                <div className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <span style={{ color: m.color, backgroundColor: m.bg }} className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">{m.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-tinta dark:text-slate-100">{a.descripcion || m.label}</p>
                    <p className="text-xs text-tinta-2 dark:text-slate-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <span className="inline-flex items-center gap-1">
                        <span className="w-4 h-4 rounded-full text-white text-[8px] font-semibold flex items-center justify-center" style={{ background: col }}>
                          {inicialesUsuario(a.usuario_nombre, a.usuario_email)}
                        </span>
                        <span className="font-medium text-tinta dark:text-slate-200">{a.usuario_nombre || a.usuario_email || 'Sistema'}</span>
                      </span>
                      · <span title={new Date(a.created_at).toLocaleString('es-CL', { dateStyle: 'full', timeStyle: 'short' })}>{tiempoRelativo(a.created_at)}</span>
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-tinta dark:text-slate-200"><span aria-hidden style={{ backgroundColor: m.color }} className="h-1.5 w-1.5 rounded-full" />{m.label}</span>
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
              <p className="text-xs text-tinta-2 dark:text-slate-400 tabular-nums">
                Mostrando <strong className="font-semibold text-tinta dark:text-slate-100">{(paginaSegura - 1) * POR_PAGINA + 1}</strong>–
                <strong className="font-semibold text-tinta dark:text-slate-100">{Math.min(paginaSegura * POR_PAGINA, filtrada.length)}</strong>
                {' '}de <strong className="font-semibold text-tinta dark:text-slate-100">{filtrada.length}</strong> eventos
              </p>
              <div className="flex items-center gap-1.5">
                <Boton tamano="sm" onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={paginaSegura <= 1}>Anterior</Boton>
                <span className="px-2 text-xs font-medium text-tinta dark:text-slate-200 tabular-nums">{paginaSegura} / {totalPaginas}</span>
                <Boton tamano="sm" onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))} disabled={paginaSegura >= totalPaginas}>Siguiente</Boton>
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
