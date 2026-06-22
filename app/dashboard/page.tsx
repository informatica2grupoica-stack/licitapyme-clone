'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import {
  Star, FileText, Brain, Users, TrendingUp, ExternalLink,
  Loader2, ArrowRight, Building2, Calendar, DollarSign,
  Search, ShieldCheck, Activity, UserCheck, UserPlus,
  ChevronRight, AlertCircle, Hash, Radar, FolderOpen,
  Bell, Briefcase, BarChart2, Clock,
} from 'lucide-react';
import { Badge } from '@/app/components/ui/Badge';

// ── Types ─────────────────────────────────────────────────────────────────────
interface DashboardStats { favoritos: number; documentos: number; analisisIA: number; }
interface FavoritoReciente {
  codigo: string; nombre: string; organismo: string;
  monto_total: number | null; fecha_cierre: string | null; estado: string;
}
interface AdminStats {
  totalUsuarios: number; usuariosActivos: number;
  nuevosEstaSemana: number; ultimosAccesos: any[];
}
interface DashboardData { stats: DashboardStats; favoritosRecientes: FavoritoReciente[]; admin: AdminStats | null; }

// ── Utils ─────────────────────────────────────────────────────────────────────
function formatCLP(n?: number | null) {
  if (!n) return null;
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
}
function formatFecha(f?: string | null) {
  if (!f) return null;
  try { return new Date(f).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return f; }
}
function getDiasRestantes(f?: string | null) {
  if (!f) return null;
  const d = Math.ceil((new Date(f).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (d < 0) return null;
  return d;
}
function estadoLabel(estado: string): { label: string; variant: 'success' | 'warning' | 'default' | 'danger' } {
  const map: Record<string, { label: string; variant: any }> = {
    '5': { label: 'Publicada', variant: 'success' },
    '6': { label: 'Cerrada', variant: 'default' },
    '7': { label: 'Desierta', variant: 'danger' },
    '8': { label: 'Adjudicada', variant: 'primary' },
    '15': { label: 'Revocada', variant: 'danger' },
  };
  return map[estado] || { label: 'Estado ' + estado, variant: 'default' };
}

// ── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({
  icon, label, value, sub, color, iconColor, href, trend,
}: {
  icon: React.ReactNode; label: string; value: string | number;
  sub?: string; color: string; iconColor: string;
  href?: string; trend?: string;
}) {
  const content = (
    <div className={`card card-hover p-5 ${href ? 'cursor-pointer' : ''}`}>
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-xl ${color} flex items-center justify-center`}>
          <span className={iconColor}>{icon}</span>
        </div>
        {href && (
          <ArrowRight size={15} className="text-slate-300 group-hover:text-indigo-500 group-hover:translate-x-0.5 transition-all" />
        )}
      </div>
      <p className="text-2xl font-bold text-slate-900 mb-0.5 tabular-nums">{value}</p>
      <p className="text-sm font-medium text-slate-600">{label}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      {trend && (
        <div className="mt-2 pt-2 border-t border-slate-100">
          <span className="text-[11px] text-slate-400">{trend}</span>
        </div>
      )}
    </div>
  );
  return href ? <Link href={href} className="group">{content}</Link> : <div>{content}</div>;
}

// ── Licitación row ─────────────────────────────────────────────────────────────
function LicitacionRow({ fav }: { fav: FavoritoReciente }) {
  const dias = getDiasRestantes(fav.fecha_cierre);
  const est  = estadoLabel(fav.estado);
  return (
    <Link
      href={`/licitacion/${encodeURIComponent(fav.codigo)}`}
      className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors group border-b border-slate-50 last:border-0"
    >
      <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center flex-shrink-0">
        <Hash size={13} className="text-indigo-500" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-slate-800 truncate group-hover:text-indigo-600 transition-colors">{fav.nombre}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <Building2 size={10} className="text-slate-400 flex-shrink-0" />
          <p className="text-[11px] text-slate-400 truncate">{fav.organismo || '—'}</p>
        </div>
      </div>
      <div className="flex-shrink-0 text-right flex flex-col items-end gap-1">
        <Badge variant={est.variant}>{est.label}</Badge>
        {fav.monto_total && <p className="text-[11px] font-semibold text-slate-600">{formatCLP(fav.monto_total)}</p>}
        {dias !== null && (
          <p className={`text-[10px] font-semibold ${dias <= 3 ? 'text-rose-500' : dias <= 7 ? 'text-amber-500' : 'text-slate-400'}`}>
            {dias === 0 ? 'Cierra hoy' : `${dias}d restantes`}
          </p>
        )}
      </div>
      <ChevronRight size={13} className="text-slate-300 group-hover:text-indigo-400 flex-shrink-0 ml-1" />
    </Link>
  );
}

// ── Usuario row ───────────────────────────────────────────────────────────────
function UsuarioRow({ u }: { u: any }) {
  const colors = ['from-indigo-500 to-violet-600','from-sky-500 to-cyan-600','from-emerald-500 to-teal-600','from-rose-500 to-pink-600'];
  const idx = (u.nombre || u.email).charCodeAt(0) % colors.length;
  const init = (u.nombre || u.email)[0].toUpperCase();
  return (
    <div className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0">
      <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${colors[idx]} flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0 shadow-sm`}>
        {init}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-slate-800 truncate">{u.nombre || 'Sin nombre'}</p>
        <p className="text-[11px] text-slate-400 truncate">{u.email}</p>
      </div>
      <div className="flex-shrink-0 flex items-center gap-2">
        {u.rol === 'admin' && (
          <Badge variant="warning"><ShieldCheck size={9} /> Admin</Badge>
        )}
        <div className="flex items-center gap-1 text-[11px] text-slate-400">
          <Clock size={10} />
          {formatFecha(u.ultimo_login) || 'Nunca'}
        </div>
      </div>
    </div>
  );
}

// ── Quick Access Card ─────────────────────────────────────────────────────────
function QuickCard({ href, icon, label, color, desc }: { href: string; icon: React.ReactNode; label: string; color: string; desc?: string }) {
  return (
    <Link href={href}
      className="flex items-start gap-3 p-4 rounded-xl border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50/40 transition-all group">
      <div className={`w-9 h-9 ${color} rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm group-hover:scale-105 transition-transform`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[12.5px] font-semibold text-slate-700 group-hover:text-indigo-700">{label}</p>
        {desc && <p className="text-[11px] text-slate-400 mt-0.5">{desc}</p>}
      </div>
    </Link>
  );
}

// ── Página ─────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { usuario } = useSession();
  const [data, setData] = useState<DashboardData | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/dashboard')
      .then(r => r.json())
      .then(d => { if (d.success) setData(d); else setError(d.error); })
      .catch(() => setError('Error al cargar estadísticas'))
      .finally(() => setCargando(false));
  }, []);

  const hora = new Date().getHours();
  const saludo = hora < 12 ? 'Buenos días' : hora < 18 ? 'Buenas tardes' : 'Buenas noches';
  const nombreMostrar = usuario?.nombre?.split(' ')[0] || usuario?.email?.split('@')[0] || '';

  return (
    <AppLayout>
      <div className="p-5 sm:p-7 max-w-7xl mx-auto space-y-6">

        {/* ── Header ─── */}
        <div className="flex items-start justify-between gap-4 pt-1">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900 tracking-tight">
              {saludo}{nombreMostrar ? `, ${nombreMostrar}` : ''} 👋
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
          <Link
            href="/"
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition-colors flex-shrink-0 shadow-sm shadow-indigo-200"
          >
            <Search size={15} />
            <span className="hidden sm:inline">Buscar licitaciones</span>
            <span className="sm:hidden">Buscar</span>
          </Link>
        </div>

        {cargando ? (
          <div className="flex items-center justify-center py-20 gap-3 text-slate-500">
            <Loader2 size={22} className="animate-spin text-indigo-500" />
            <span className="text-sm font-medium">Cargando tu información...</span>
          </div>
        ) : error ? (
          <div className="flex items-center gap-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm px-5 py-4 rounded-xl">
            <AlertCircle size={17} className="flex-shrink-0" />
            <span>{error}</span>
          </div>
        ) : data ? (
          <>
            {/* ── KPIs personales ── */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <KpiCard
                icon={<Star size={18} />}
                label="Favoritos guardados"
                value={data.stats.favoritos}
                color="bg-amber-50" iconColor="text-amber-600"
                href="/favoritos"
                sub="Licitaciones de interés"
              />
              <KpiCard
                icon={<FileText size={18} />}
                label="Documentos"
                value={data.stats.documentos}
                color="bg-blue-50" iconColor="text-blue-600"
                href="/documentos"
                sub="PDFs y archivos adjuntos"
              />
              <KpiCard
                icon={<Brain size={18} />}
                label="Análisis IA"
                value={data.stats.analisisIA}
                color="bg-purple-50" iconColor="text-purple-600"
                sub="Análisis realizados"
                trend="Gemini + clasificación documental"
              />
            </div>

            {/* ── KPIs admin ── */}
            {data.admin && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                    <ShieldCheck size={15} className="text-amber-500" />
                    Panel de administración
                  </h2>
                  <Link href="/admin/usuarios" className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1">
                    Ver todos <ArrowRight size={11} />
                  </Link>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                  <KpiCard icon={<Users size={18} />} label="Usuarios totales" value={data.admin.totalUsuarios} color="bg-indigo-50" iconColor="text-indigo-600" href="/admin/usuarios" />
                  <KpiCard icon={<UserCheck size={18} />} label="Usuarios activos" value={data.admin.usuariosActivos} color="bg-emerald-50" iconColor="text-emerald-600" />
                  <KpiCard icon={<UserPlus size={18} />} label="Nuevos esta semana" value={data.admin.nuevosEstaSemana} color="bg-sky-50" iconColor="text-sky-600" />
                </div>
              </div>
            )}

            {/* ── Grid 2 columnas ── */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">

              {/* Favoritos recientes */}
              <div className="card overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm">
                    <Star size={14} className="text-amber-500 fill-amber-500" />
                    Favoritos recientes
                  </h3>
                  <Link href="/favoritos" className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1">
                    Ver todos <ArrowRight size={11} />
                  </Link>
                </div>
                {data.favoritosRecientes.length > 0 ? (
                  <div>
                    {data.favoritosRecientes.map(fav => (
                      <LicitacionRow key={fav.codigo} fav={fav} />
                    ))}
                  </div>
                ) : (
                  <div className="py-12 text-center px-4">
                    <div className="w-12 h-12 bg-amber-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
                      <Star size={22} className="text-amber-300" />
                    </div>
                    <p className="text-sm font-semibold text-slate-600">Sin favoritos aún</p>
                    <p className="text-xs text-slate-400 mt-1">Guarda licitaciones desde el buscador</p>
                    <Link href="/" className="inline-flex items-center gap-1.5 mt-3 text-xs text-indigo-600 hover:underline font-semibold">
                      <Search size={12} /> Ir al buscador
                    </Link>
                  </div>
                )}
              </div>

              {/* Panel derecho: admin últimos accesos / accesos rápidos */}
              {data.admin ? (
                <div className="card overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm">
                      <Activity size={14} className="text-emerald-500" />
                      Últimos accesos
                    </h3>
                    <Link href="/admin/usuarios" className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1">
                      Gestionar <ArrowRight size={11} />
                    </Link>
                  </div>
                  <div>
                    {data.admin.ultimosAccesos.slice(0, 6).map((u: any) => (
                      <UsuarioRow key={u.id} u={u} />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="card overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-100">
                    <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                      <BarChart2 size={14} className="text-indigo-500" />
                      Accesos rápidos
                    </h3>
                  </div>
                  <div className="p-4 grid grid-cols-2 gap-2.5">
                    <QuickCard href="/"          icon={<Search size={17} className="text-indigo-600" />}  label="Buscar"     desc="Licitaciones activas" color="bg-indigo-50" />
                    <QuickCard href="/favoritos" icon={<Star size={17} className="text-amber-500" />}     label="Favoritos"  desc="Tus licitaciones"     color="bg-amber-50" />
                    <QuickCard href="/radar"     icon={<Radar size={17} className="text-sky-600" />}      label="Radar"      desc="Monitor automático"   color="bg-sky-50" />
                    <QuickCard href="/documentos" icon={<FolderOpen size={17} className="text-purple-600" />} label="Documentos" desc="Archivos descargados"  color="bg-purple-50" />
                    <QuickCard href="/negocios"  icon={<Briefcase size={17} className="text-emerald-600" />} label="Negocios"  desc="Seguimiento"          color="bg-emerald-50" />
                    <QuickCard href="/alertas"   icon={<Bell size={17} className="text-rose-500" />}      label="Alertas"    desc="Notificaciones"        color="bg-rose-50" />
                  </div>
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </AppLayout>
  );
}
