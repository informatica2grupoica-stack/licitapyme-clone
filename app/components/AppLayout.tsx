'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';
import {
  LayoutDashboard, Search, Star,
  Users, Settings, LogOut, User, ShieldCheck,
  Menu, X, Radar, ChevronDown, ChevronRight, Briefcase, FolderOpen,
} from 'lucide-react';
import { IcaLogoIcon } from '@/app/components/IcaLogo';

import { useSession } from '@/app/lib/session-context';

// ── Tipos ──────────────────────────────────────────────────────────────────────
interface NavItem {
  label:     string;
  href:      string;
  icon:      React.ReactNode;
  adminOnly?: boolean;
  badge?:    number;
}

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface AppLayoutProps {
  children:   React.ReactNode;
  breadcrumb?: BreadcrumbItem[];
  title?:     string;
}

// ── Nav items ─────────────────────────────────────────────────────────────────
const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard',  href: '/dashboard',      icon: <LayoutDashboard size={16} /> },
  { label: 'Negocios',   href: '/negocios',        icon: <Briefcase       size={16} /> },
  { label: 'Buscador',   href: '/',                icon: <Search          size={16} /> },
  { label: 'Favoritos',  href: '/favoritos',       icon: <Star            size={16} /> },
  { label: 'Documentos', href: '/documentos',      icon: <FolderOpen      size={16} /> },
  { label: 'Radar',      href: '/radar',           icon: <Radar           size={16} /> },
  { label: 'Usuarios',   href: '/admin/usuarios',  icon: <Users           size={16} />, adminOnly: true },
  { label: 'Perfil',     href: '/perfil',          icon: <Settings        size={16} /> },
];

// ── User Dropdown ─────────────────────────────────────────────────────────────
function UserDropdown() {
  const { usuario, logout } = useSession();
  const [open, setOpen]     = useState(false);
  const ref                 = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

  if (!usuario) return null;

  const initials = usuario.nombre
    ? usuario.nombre.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
    : usuario.email[0].toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-white/[0.06] transition-colors w-full group"
      >
        {/* Avatar */}
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 shadow-lg">
          {initials}
        </div>
        {/* Name */}
        <div className="flex-1 min-w-0 text-left hidden lg:block">
          <p className="text-[13px] font-semibold text-zinc-200 truncate leading-none mb-0.5">
            {usuario.nombre || usuario.email.split('@')[0]}
          </p>
          <p className="text-[11px] text-zinc-500 truncate leading-none">
            {usuario.empresa || usuario.email}
          </p>
        </div>
        <ChevronDown
          size={13}
          className={`text-zinc-600 flex-shrink-0 hidden lg:block transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-56 bg-[#18181b] border border-zinc-800 rounded-xl shadow-2xl shadow-black/60 z-50 overflow-hidden scale-in">
          {/* User info */}
          <div className="px-3.5 py-3 border-b border-zinc-800/80">
            <p className="text-[13px] font-semibold text-zinc-100 truncate">
              {usuario.nombre || 'Sin nombre'}
            </p>
            <p className="text-[11px] text-zinc-500 truncate mt-0.5">{usuario.email}</p>
            {usuario.rol === 'admin' && (
              <span className="inline-flex items-center gap-1 mt-1.5 text-[10px] px-2 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full font-medium">
                <ShieldCheck size={9} /> Admin
              </span>
            )}
          </div>

          {/* Actions */}
          <div className="py-1">
            <Link href="/perfil" onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.04] transition-colors">
              <User size={13} /> Mi perfil
            </Link>
            {usuario.rol === 'admin' && (<>
              <Link href="/admin/usuarios" onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.04] transition-colors">
                <Users size={13} /> Administrar usuarios
              </Link>
              <Link href="/admin/etiquetas" onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.04] transition-colors">
                <Briefcase size={13} /> Líneas de negocio
              </Link>
            </>)}
          </div>

          <div className="border-t border-zinc-800/80 py-1">
            <button
              onClick={() => { setOpen(false); logout(); }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-red-400 hover:text-red-300 hover:bg-red-500/[0.06] transition-colors"
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
function Sidebar({
  mobileOpen,
  onCloseMobile,
}: {
  mobileOpen:     boolean;
  onCloseMobile:  () => void;
}) {
  const pathname = usePathname();
  const { usuario } = useSession();

  const navItems = NAV_ITEMS.filter(i => !i.adminOnly || usuario?.rol === 'admin');

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

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
        bg-[#0f1117] border-r border-white/[0.06]
        transition-transform duration-300 ease-out
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0 lg:static lg:z-auto
      `}>

        {/* Logo */}
        <div className="px-4 pt-5 pb-4 flex items-center justify-between">
          <Link
            href="/dashboard"
            onClick={onCloseMobile}
            className="flex items-center gap-2.5 group"
          >
            <div className="flex-shrink-0 group-hover:scale-105 transition-transform duration-200">
              <IcaLogoIcon size={32} />
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-white font-bold text-sm tracking-tight">ICA</span>
              <span className="text-zinc-500 text-[10px] font-medium tracking-widest uppercase mt-0.5">
                plataforma inteligente
              </span>
            </div>
          </Link>
          <button
            onClick={onCloseMobile}
            className="p-1.5 hover:bg-white/[0.06] rounded-lg text-zinc-500 lg:hidden"
          >
            <X size={15} />
          </button>
        </div>

        {/* Divider */}
        <div className="mx-4 h-px bg-white/[0.06] mb-3" />

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2.5 space-y-0.5">
          {navItems.map(item => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onCloseMobile}
                className={`
                  flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-medium
                  transition-all duration-150 group relative
                  ${active
                    ? 'bg-white/[0.09] text-white'
                    : 'text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.05]'
                  }
                `}
              >
                {/* Active indicator */}
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-blue-500 rounded-full" />
                )}
                <span className={`flex-shrink-0 transition-colors ${active ? 'text-blue-400' : 'text-zinc-600 group-hover:text-zinc-400'}`}>
                  {item.icon}
                </span>
                <span className="flex-1">{item.label}</span>
                {item.badge != null && item.badge > 0 && (
                  <span className="bg-red-500 text-white text-[10px] rounded-full px-1.5 py-px font-bold min-w-[18px] text-center tabular-nums">
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* User */}
        <div className="px-2.5 pb-3 pt-3 border-t border-white/[0.06]">
          <UserDropdown />
        </div>
      </aside>
    </>
  );
}

// ── TopBar ─────────────────────────────────────────────────────────────────────
function TopBar({
  breadcrumb,
  onOpenMobile,
}: {
  breadcrumb?:  BreadcrumbItem[];
  onOpenMobile: () => void;
}) {
  const { usuario } = useSession();

  const hora       = new Date().getHours();
  const saludo     = hora < 12 ? 'Buenos días' : hora < 18 ? 'Buenas tardes' : 'Buenas noches';
  const nombre     = usuario?.nombre?.split(' ')[0] || usuario?.email?.split('@')[0] || '';

  return (
    <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-zinc-200/60 px-4 sm:px-6 h-14 flex items-center gap-3">
      {/* Mobile hamburger */}
      <button
        onClick={onOpenMobile}
        className="p-1.5 hover:bg-zinc-100 rounded-lg transition-colors lg:hidden flex-shrink-0"
      >
        <Menu size={18} className="text-zinc-600" />
      </button>

      {/* Breadcrumb / saludo */}
      <div className="flex-1 min-w-0">
        {breadcrumb && breadcrumb.length > 0 ? (
          <nav className="flex items-center gap-1 text-[13px]">
            {breadcrumb.map((item, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight size={12} className="text-zinc-300 flex-shrink-0" />}
                {item.href
                  ? <Link href={item.href} className="text-zinc-400 hover:text-zinc-700 transition-colors">{item.label}</Link>
                  : <span className="text-zinc-700 font-semibold truncate">{item.label}</span>
                }
              </span>
            ))}
          </nav>
        ) : (
          <p className="text-[13px] font-semibold text-zinc-700">
            {saludo}{nombre ? `, ${nombre}` : ''}
          </p>
        )}
      </div>

      {/* API status pill */}
      <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200/80 text-emerald-600 text-[11px] font-medium flex-shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        API activa
      </div>
    </header>
  );
}

// ── AppLayout ─────────────────────────────────────────────────────────────────
export function AppLayout({ children, breadcrumb }: AppLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen bg-[#f5f5f7] overflow-hidden">
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
