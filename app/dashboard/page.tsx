'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import {
  Star, FileText, Brain, Users, TrendingUp, ExternalLink,
  Loader2, ArrowRight, Building2, Calendar, DollarSign,
  Search, ShieldCheck, Activity, UserCheck, UserPlus,
  ChevronRight, AlertCircle, Clock, Hash
} from 'lucide-react';

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface DashboardStats {
  favoritos: number;
  documentos: number;
  analisisIA: number;
}
interface FavoritoReciente {
  codigo: string;
  nombre: string;
  organismo: string;
  monto_total: number | null;
  fecha_cierre: string | null;
  estado: string;
}
interface AdminStats {
  totalUsuarios: number;
  usuariosActivos: number;
  nuevosEstaSemana: number;
  ultimosAccesos: any[];
}
interface DashboardData {
  stats: DashboardStats;
  favoritosRecientes: FavoritoReciente[];
  admin: AdminStats | null;
}

// ─── Utils ───────────────────────────────────────────────────────────────────
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

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({
  icon, label, value, sub, color, href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
  href?: string;
}) {
  const content = (
    <div className={`bg-white rounded-xl border border-gray-200 shadow-sm p-5 hover:shadow-md transition-shadow group ${href ? 'cursor-pointer' : ''}`}>
      <div className="flex items-start justify-between mb-4">
        <div className={`w-11 h-11 rounded-xl ${color} flex items-center justify-center`}>
          {icon}
        </div>
        {href && (
          <ArrowRight size={16} className="text-gray-300 group-hover:text-blue-500 group-hover:translate-x-0.5 transition-all" />
        )}
      </div>
      <p className="text-2xl font-bold text-gray-900 mb-0.5">{value}</p>
      <p className="text-sm font-medium text-gray-600">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : <div>{content}</div>;
}

// ─── Licitación row ───────────────────────────────────────────────────────────
function LicitacionRow({ fav }: { fav: FavoritoReciente }) {
  const dias = getDiasRestantes(fav.fecha_cierre);
  return (
    <Link
      href={`/licitacion/${encodeURIComponent(fav.codigo)}`}
      className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors group"
    >
      <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
        <Hash size={14} className="text-blue-500" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate group-hover:text-blue-600 transition-colors">{fav.nombre}</p>
        <p className="text-xs text-gray-400 truncate">{fav.organismo}</p>
      </div>
      <div className="flex-shrink-0 text-right">
        {fav.monto_total && <p className="text-sm font-semibold text-gray-700">{formatCLP(fav.monto_total)}</p>}
        {dias !== null && (
          <p className={`text-xs font-medium ${dias <= 3 ? 'text-red-500' : dias <= 7 ? 'text-orange-500' : 'text-gray-400'}`}>
            {dias === 0 ? 'Cierra hoy' : `${dias}d restantes`}
          </p>
        )}
      </div>
      <ChevronRight size={14} className="text-gray-300 group-hover:text-blue-400 flex-shrink-0" />
    </Link>
  );
}

// ─── Usuario row (admin) ──────────────────────────────────────────────────────
function UsuarioRow({ u }: { u: any }) {
  const iniciales = (u.nombre || u.email)[0].toUpperCase();
  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
        {iniciales}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">{u.nombre || 'Sin nombre'}</p>
        <p className="text-xs text-gray-400 truncate">{u.email}</p>
      </div>
      <div className="flex-shrink-0 flex items-center gap-2">
        {u.rol === 'admin' && (
          <span className="text-xs px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full font-medium flex items-center gap-0.5">
            <ShieldCheck size={9} /> Admin
          </span>
        )}
        <span className="text-xs text-gray-400">{formatFecha(u.ultimo_login) || 'Nunca'}</span>
      </div>
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────
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
      <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">

        {/* Header saludo */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {saludo}, {nombreMostrar} 👋
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
          <Link
            href="/"
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors flex-shrink-0 shadow-sm"
          >
            <Search size={15} />
            <span className="hidden sm:inline">Buscar licitaciones</span>
            <span className="sm:hidden">Buscar</span>
          </Link>
        </div>

        {cargando ? (
          <div className="flex items-center justify-center py-16 gap-2 text-gray-500">
            <Loader2 size={22} className="animate-spin text-blue-500" />
            <span className="text-sm">Cargando tu información...</span>
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
            <AlertCircle size={16} /> {error}
          </div>
        ) : data ? (
          <>
            {/* ─── KPIs personales ─── */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <KpiCard
                icon={<Star size={20} className="text-amber-600" />}
                label="Favoritos guardados"
                value={data.stats.favoritos}
                color="bg-amber-50"
                href="/?favoritos=true"
                sub="Licitaciones de interés"
              />
              <KpiCard
                icon={<FileText size={20} className="text-blue-600" />}
                label="Documentos subidos"
                value={data.stats.documentos}
                color="bg-blue-50"
                sub="PDFs, DOCX y más"
              />
              <KpiCard
                icon={<Brain size={20} className="text-purple-600" />}
                label="Análisis IA"
                value={data.stats.analisisIA}
                color="bg-purple-50"
                sub="Análisis realizados"
              />
            </div>

            {/* ─── KPIs admin ─── */}
            {data.admin && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
                    <ShieldCheck size={16} className="text-amber-500" />
                    Panel de administración
                  </h2>
                  <Link href="/admin/usuarios" className="text-xs text-blue-600 hover:underline font-medium flex items-center gap-1">
                    Ver todos <ArrowRight size={12} />
                  </Link>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                  <KpiCard
                    icon={<Users size={20} className="text-blue-600" />}
                    label="Usuarios totales"
                    value={data.admin.totalUsuarios}
                    color="bg-blue-50"
                    href="/admin/usuarios"
                  />
                  <KpiCard
                    icon={<UserCheck size={20} className="text-green-600" />}
                    label="Usuarios activos"
                    value={data.admin.usuariosActivos}
                    color="bg-green-50"
                  />
                  <KpiCard
                    icon={<UserPlus size={20} className="text-indigo-600" />}
                    label="Nuevos esta semana"
                    value={data.admin.nuevosEstaSemana}
                    color="bg-indigo-50"
                  />
                </div>
              </div>
            )}

            {/* ─── Contenido en 2 columnas ─── */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

              {/* Favoritos recientes */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="font-bold text-gray-900 flex items-center gap-2 text-sm">
                    <Star size={15} className="text-amber-500 fill-amber-500" />
                    Favoritos recientes
                  </h3>
                  <Link href="/?favoritos=true" className="text-xs text-blue-600 hover:underline font-medium flex items-center gap-1">
                    Ver todos <ArrowRight size={12} />
                  </Link>
                </div>
                {data.favoritosRecientes.length > 0 ? (
                  <div className="divide-y divide-gray-50">
                    {data.favoritosRecientes.map(fav => (
                      <LicitacionRow key={fav.codigo} fav={fav} />
                    ))}
                  </div>
                ) : (
                  <div className="py-10 text-center px-4">
                    <Star size={28} className="text-gray-200 mx-auto mb-2" />
                    <p className="text-sm text-gray-500 font-medium">Sin favoritos aún</p>
                    <p className="text-xs text-gray-400 mt-1">Guarda licitaciones desde el buscador</p>
                    <Link href="/" className="inline-flex items-center gap-1.5 mt-3 text-xs text-blue-600 hover:underline font-medium">
                      <Search size={12} /> Ir al buscador
                    </Link>
                  </div>
                )}
              </div>

              {/* Panel admin: últimos accesos / Panel usuario: accesos rápidos */}
              {data.admin ? (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="font-bold text-gray-900 flex items-center gap-2 text-sm">
                      <Activity size={15} className="text-green-500" />
                      Últimos accesos
                    </h3>
                    <Link href="/admin/usuarios" className="text-xs text-blue-600 hover:underline font-medium flex items-center gap-1">
                      Gestionar <ArrowRight size={12} />
                    </Link>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {data.admin.ultimosAccesos.map((u: any) => (
                      <UsuarioRow key={u.id} u={u} />
                    ))}
                  </div>
                </div>
              ) : (
                // Accesos rápidos para usuarios normales
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-100">
                    <h3 className="font-bold text-gray-900 text-sm">Accesos rápidos</h3>
                  </div>
                  <div className="p-4 grid grid-cols-2 gap-3">
                    {[
                      { href: '/', icon: <Search size={20} className="text-blue-600" />, label: 'Buscar licitaciones', color: 'bg-blue-50' },
                      { href: '/?favoritos=true', icon: <Star size={20} className="text-amber-500" />, label: 'Mis favoritos', color: 'bg-amber-50' },
                      { href: '/perfil', icon: <Users size={20} className="text-indigo-600" />, label: 'Mi perfil', color: 'bg-indigo-50' },
                      { href: '/', icon: <TrendingUp size={20} className="text-green-600" />, label: 'Nuevas hoy', color: 'bg-green-50' },
                    ].map(item => (
                      <Link key={item.href + item.label} href={item.href}
                        className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-100 hover:border-blue-200 hover:bg-blue-50/40 transition-colors text-center group">
                        <div className={`w-11 h-11 ${item.color} rounded-xl flex items-center justify-center`}>
                          {item.icon}
                        </div>
                        <p className="text-xs font-medium text-gray-700 group-hover:text-blue-700">{item.label}</p>
                      </Link>
                    ))}
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
