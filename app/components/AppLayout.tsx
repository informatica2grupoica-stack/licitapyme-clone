'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';
import {
  LayoutDashboard, Search, Star, Users, Settings, LogOut, User,
  ShieldCheck, Menu, X, Radar, ChevronDown, ChevronRight,
  Briefcase, FolderOpen, Bell, FileText, AlertCircle,
  Building2, Tag, Sparkles,
} from 'lucide-react';
import { IcaLogoIcon } from '@/app/components/IcaLogo';
import { useSession } from '@/app/lib/session-context';

// ── Types ──────────────────────────────────────────────────────────────────────
interface BreadcrumbItem { label: string; href?: string; }
interface AppLayoutProps {
  children:   React.ReactNode;
  breadcrumb?: BreadcrumbItem[];
  title?:     string;
}
interface NavItem {
  label:     string;
  href:      string;
  icon:      React.ReactNode;
  adminOnly?: boolean;
  badge?:    number | string;
  exact?:    boolean;
}
interface NavGroup {
  label:  string;
  items:  NavItem[];
}

// ── Nav structure ──────────────────────────────────────────────────────────────
const NAV_GROUPS: NavGroup[] = [
  {
    label: 'PRINCIPAL',
    items: [
      { label: 'Dashboard',  href: '/dashboard', icon: <LayoutDashboard size={15} />, exact: true },
      { label: 'Negocios',   href: '/negocios',  icon: <Briefcase       size={15} /> },
    ],
  },
  {
    label: 'BÚSQUEDA',
    items: [
      { label: 'Buscador',  href: '/',         icon: <Search  size={15} />, exact: true, adminOnly: true },
      { label: 'Radar',     href: '/radar',     icon: <Radar   size={15} />, adminOnly: true },
      { label: 'Analizadas', href: '/analizadas', icon: <Sparkles size={15} />, adminOnly: true },
    ],
  },
  {
    label: 'GESTIÓN',
    items: [
      { label: 'Alertas',    href: '/alertas',    icon: <Bell       size={15} />, adminOnly: true },
    ],
  },
  {
    label: 'ADMIN',
    items: [
      { label: 'Usuarios',       href: '/admin/usuarios', icon: <Users   size={15} />, adminOnly: true },
      { label: 'Líneas negocio', href: '/admin/etiquetas',icon: <Tag     size={15} />, adminOnly: true },
    ],
  },
];

// ── User Dropdown ─────────────────────────────────────────────────────────────
function UserDropdown() {
  const { usuario, logout } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

  if (!usuario) return null;

  const initials = usuario.nombre
    ? usuario.nombre.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()
    : usuario.email[0].toUpperCase();

  // Color único por usuario basado en email
  const colors = [
    'from-indigo-500 to-violet-600',
    'from-sky-500 to-cyan-600',
    'from-emerald-500 to-teal-600',
    'from-rose-500 to-pink-600',
    'from-amber-500 to-orange-600',
  ];
  const colorIdx = usuario.email.charCodeAt(0) % colors.length;
  const avatarColor = colors[colorIdx];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-white/[0.06] transition-colors w-full group"
      >
        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${avatarColor} flex items-center justify-center text-white text-xs font-bold flex-shrink-0 shadow-md`}>
          {initials}
        </div>
        <div className="flex-1 min-w-0 text-left">
          <p className="text-[12.5px] font-semibold text-slate-200 truncate leading-none mb-0.5">
            {usuario.nombre?.split(' ')[0] || usuario.email.split('@')[0]}
          </p>
          <p className="text-[11px] text-slate-500 truncate leading-none">
            {usuario.empresa || usuario.email}
          </p>
        </div>
        <ChevronDown size={12} className={`text-slate-600 flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-56 bg-[#12182b] border border-slate-700/60 rounded-xl shadow-2xl shadow-black/60 z-50 overflow-hidden scale-in">
          <div className="px-3.5 py-3 border-b border-slate-700/60">
            <p className="text-[13px] font-semibold text-slate-100 truncate">
              {usuario.nombre || 'Sin nombre'}
            </p>
            <p className="text-[11px] text-slate-500 truncate mt-0.5">{usuario.email}</p>
            {usuario.rol === 'admin' && (
              <span className="inline-flex items-center gap-1 mt-1.5 text-[10px] px-2 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full font-semibold">
                <ShieldCheck size={9} /> Administrador
              </span>
            )}
          </div>
          <div className="py-1">
            <Link href="/perfil" onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-slate-400 hover:text-slate-100 hover:bg-white/[0.05] transition-colors">
              <User size={13} /> Mi perfil
            </Link>
            {usuario.rol === 'admin' && (
              <>
                <Link href="/admin/usuarios" onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-slate-400 hover:text-slate-100 hover:bg-white/[0.05] transition-colors">
                  <Users size={13} /> Administrar usuarios
                </Link>
                <Link href="/admin/etiquetas" onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-slate-400 hover:text-slate-100 hover:bg-white/[0.05] transition-colors">
                  <Tag size={13} /> Líneas de negocio
                </Link>
              </>
            )}
          </div>
          <div className="border-t border-slate-700/60 py-1">
            <button
              onClick={() => { setOpen(false); logout(); }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-rose-400 hover:text-rose-300 hover:bg-rose-500/[0.08] transition-colors"
            >
              <LogOut size={13} /> Cerrar sesión
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function Sidebar({ mobileOpen, onCloseMobile }: { mobileOpen: boolean; onCloseMobile: () => void }) {
  const pathname = usePathname();
  const { usuario } = useSession();

  const isActive = (item: NavItem) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href);

  const visibleGroups = NAV_GROUPS.map(group => ({
    ...group,
    items: group.items.filter(i => !i.adminOnly || usuario?.rol === 'admin'),
  })).filter(g => g.items.length > 0);

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 lg:hidden"
          onClick={onCloseMobile}
        />
      )}

      {/* Sidebar panel */}
      <aside className={`
        fixed top-0 left-0 h-full z-50 flex flex-col w-60
        bg-[#0a0f1e] border-r border-white/[0.06]
        transition-transform duration-300 ease-out
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0 lg:static lg:z-auto
      `}>

        {/* Logo */}
        <div className="px-4 pt-5 pb-4 flex items-center justify-between flex-shrink-0">
          <Link
            href="/dashboard"
            onClick={onCloseMobile}
            className="flex items-center gap-2.5 group"
          >
            <div className="flex-shrink-0 group-hover:scale-105 transition-transform duration-200">
              <IcaLogoIcon size={34} />
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-white font-bold text-[13px] tracking-tight">ICA</span>
              <span className="text-slate-500 text-[9.5px] font-semibold tracking-[0.12em] uppercase mt-0.5">
                Licitaciones
              </span>
            </div>
          </Link>
          <button
            onClick={onCloseMobile}
            className="p-1.5 hover:bg-white/[0.06] rounded-lg text-slate-500 lg:hidden"
          >
            <X size={15} />
          </button>
        </div>

        {/* Divider */}
        <div className="mx-4 h-px bg-white/[0.06] mb-3 flex-shrink-0" />

        {/* Nav groups */}
        <nav className="flex-1 overflow-y-auto px-3 pb-2 space-y-4">
          {visibleGroups.map((group) => (
            <div key={group.label}>
              <p className="px-2 mb-1.5 text-[9.5px] font-bold text-slate-600 tracking-[0.12em] uppercase">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map(item => {
                  const active = isActive(item);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onCloseMobile}
                      className={`
                        flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-medium
                        transition-all duration-150 group relative
                        ${active
                          ? 'bg-indigo-500/[0.15] text-white'
                          : 'text-slate-500 hover:text-slate-200 hover:bg-white/[0.04]'
                        }
                      `}
                    >
                      {active && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-indigo-400 rounded-full" />
                      )}
                      <span className={`flex-shrink-0 transition-colors ${active ? 'text-indigo-400' : 'text-slate-600 group-hover:text-slate-400'}`}>
                        {item.icon}
                      </span>
                      <span className="flex-1">{item.label}</span>
                      {item.badge != null && (
                        <span className="bg-rose-500 text-white text-[10px] rounded-full px-1.5 py-px font-bold min-w-[18px] text-center">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* User */}
        <div className="px-2.5 pb-4 pt-2 border-t border-white/[0.06] flex-shrink-0">
          <UserDropdown />
        </div>
      </aside>
    </>
  );
}

// ── TopBar ─────────────────────────────────────────────────────────────────────
function TopBar({ breadcrumb, onOpenMobile }: { breadcrumb?: BreadcrumbItem[]; onOpenMobile: () => void }) {
  const { usuario } = useSession();
  const hora    = new Date().getHours();
  const saludo  = hora < 12 ? 'Buenos días' : hora < 18 ? 'Buenas tardes' : 'Buenas noches';
  const nombre  = usuario?.nombre?.split(' ')[0] || usuario?.email?.split('@')[0] || '';

  return (
    <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-slate-200/80 px-4 sm:px-6 h-14 flex items-center gap-3 flex-shrink-0">
      {/* Mobile hamburger */}
      <button
        onClick={onOpenMobile}
        className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors lg:hidden flex-shrink-0"
      >
        <Menu size={18} className="text-slate-600" />
      </button>

      {/* Breadcrumb / saludo */}
      <div className="flex-1 min-w-0">
        {breadcrumb && breadcrumb.length > 0 ? (
          <nav className="flex items-center gap-1 text-[13px]">
            {breadcrumb.map((item, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight size={12} className="text-slate-300 flex-shrink-0" />}
                {item.href
                  ? <Link href={item.href} className="text-slate-400 hover:text-slate-700 transition-colors">{item.label}</Link>
                  : <span className="text-slate-800 font-semibold truncate">{item.label}</span>
                }
              </span>
            ))}
          </nav>
        ) : (
          <p className="text-[13px] font-semibold text-slate-700">
            {saludo}{nombre ? `, ${nombre}` : ''}
          </p>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* API status */}
        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200/80 text-emerald-700 text-[11px] font-semibold">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          API activa
        </div>

        {/* Alertas bell */}
        <Link
          href="/alertas"
          className="relative p-2 rounded-lg hover:bg-slate-100 transition-colors text-slate-500 hover:text-slate-700"
          title="Alertas"
        >
          <Bell size={17} />
        </Link>

        {/* Perfil rápido */}
        <Link
          href="/perfil"
          className="p-2 rounded-lg hover:bg-slate-100 transition-colors text-slate-500 hover:text-slate-700"
          title="Mi perfil"
        >
          <Settings size={17} />
        </Link>
      </div>
    </header>
  );
}

// ── AppLayout ─────────────────────────────────────────────────────────────────
export function AppLayout({ children, breadcrumb }: AppLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <Sidebar mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <TopBar
          breadcrumb={breadcrumb}
          onOpenMobile={() => setMobileOpen(true)}
        />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
