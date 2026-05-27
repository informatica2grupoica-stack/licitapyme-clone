'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';
import {
  Building2, LayoutDashboard, Search, Star, FileText,
  Users, Settings, LogOut, ChevronRight, User, ShieldCheck,
  Menu, X, Bell, ChevronDown, Briefcase
} from 'lucide-react';
import { useSession } from '@/app/lib/session-context';

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
  badge?: number;
}

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface AppLayoutProps {
  children: React.ReactNode;
  breadcrumb?: BreadcrumbItem[];
  title?: string;
}

// ─── Navegación ───────────────────────────────────────────────────────────────
const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard',   href: '/dashboard',        icon: <LayoutDashboard size={20} /> },
  { label: 'Buscador',    href: '/',                  icon: <Search size={20} /> },
  { label: 'Favoritos',   href: '/?favoritos=true',   icon: <Star size={20} /> },
  { label: 'Documentos',  href: '/documentos',        icon: <FileText size={20} /> },
  { label: 'Usuarios',    href: '/admin/usuarios',    icon: <Users size={20} />,     adminOnly: true },
  { label: 'Configuración', href: '/perfil',          icon: <Settings size={20} /> },
];

// ─── User dropdown ────────────────────────────────────────────────────────────
function UserDropdown() {
  const { usuario, logout } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (!usuario) return null;

  const iniciales = usuario.nombre
    ? usuario.nombre.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
    : usuario.email[0].toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-slate-800 transition-colors w-full"
      >
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
          {iniciales}
        </div>
        <div className="flex-1 min-w-0 text-left hidden lg:block">
          <p className="text-sm font-semibold text-white truncate">{usuario.nombre || usuario.email.split('@')[0]}</p>
          <p className="text-xs text-slate-400 truncate">{usuario.empresa || usuario.email}</p>
        </div>
        <ChevronDown size={14} className="text-slate-400 flex-shrink-0 hidden lg:block" />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-56 bg-white border border-gray-200 rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-900 truncate">{usuario.nombre || 'Sin nombre'}</p>
            <p className="text-xs text-gray-500 truncate mt-0.5">{usuario.email}</p>
            {usuario.rol === 'admin' && (
              <span className="inline-flex items-center gap-1 mt-1.5 text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full font-medium">
                <ShieldCheck size={10} /> Admin
              </span>
            )}
          </div>
          <div className="py-1">
            <Link href="/perfil" onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
              <User size={14} className="text-gray-400" /> Mi perfil
            </Link>
            {usuario.rol === 'admin' && (
              <Link href="/admin/usuarios" onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
                <Users size={14} className="text-gray-400" /> Administrar usuarios
              </Link>
            )}
          </div>
          <div className="border-t border-gray-100 py-1">
            <button onClick={() => { setOpen(false); logout(); }}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors">
              <LogOut size={14} /> Cerrar sesión
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function Sidebar({ mobileOpen, onCloseMobile }: { mobileOpen: boolean; onCloseMobile: () => void }) {
  const pathname = usePathname();
  const { usuario } = useSession();

  const navItems = NAV_ITEMS.filter(item => !item.adminOnly || usuario?.rol === 'admin');

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    if (href === '/?favoritos=true') return false; // handled separately
    return pathname.startsWith(href);
  };

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/60 z-40 lg:hidden" onClick={onCloseMobile} />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed top-0 left-0 h-full z-50 flex flex-col
        bg-slate-900 border-r border-slate-800
        transition-all duration-300
        w-64
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0 lg:static lg:z-auto
      `}>
        {/* Logo */}
        <div className="px-4 py-5 flex items-center justify-between border-b border-slate-800">
          <Link href="/dashboard" className="flex items-center gap-3 group" onClick={onCloseMobile}>
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg group-hover:bg-blue-500 transition-colors flex-shrink-0">
              <Building2 size={18} className="text-white" />
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-white font-bold text-base tracking-tight">ICA</span>
              <span className="text-slate-400 text-xs font-medium tracking-wider uppercase">Licitaciones</span>
            </div>
          </Link>
          <button onClick={onCloseMobile} className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 lg:hidden">
            <X size={16} />
          </button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {navItems.map(item => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onCloseMobile}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium
                  transition-all duration-150 group
                  ${active
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }
                `}
              >
                <span className={`flex-shrink-0 ${active ? 'text-white' : 'text-slate-400 group-hover:text-white'}`}>
                  {item.icon}
                </span>
                <span className="flex-1">{item.label}</span>
                {item.badge ? (
                  <span className="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 font-bold min-w-[1.25rem] text-center">
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        {/* User section */}
        <div className="px-3 py-3 border-t border-slate-800">
          <UserDropdown />
        </div>
      </aside>
    </>
  );
}

// ─── TopBar ───────────────────────────────────────────────────────────────────
function TopBar({
  breadcrumb,
  onOpenMobile,
}: {
  breadcrumb?: BreadcrumbItem[];
  onOpenMobile: () => void;
}) {
  const { usuario } = useSession();

  const hora = new Date().getHours();
  const saludo = hora < 12 ? 'Buenos días' : hora < 18 ? 'Buenas tardes' : 'Buenas noches';
  const nombreCorto = usuario?.nombre?.split(' ')[0] || usuario?.email?.split('@')[0] || '';

  return (
    <div className="bg-white border-b border-gray-100 px-4 sm:px-6 py-3 flex items-center gap-4">
      {/* Mobile menu button */}
      <button
        onClick={onOpenMobile}
        className="p-2 hover:bg-gray-100 rounded-lg transition-colors lg:hidden flex-shrink-0"
      >
        <Menu size={20} className="text-gray-600" />
      </button>

      {/* Breadcrumb / Saludo */}
      <div className="flex-1 min-w-0">
        {breadcrumb && breadcrumb.length > 0 ? (
          <nav className="flex items-center gap-1.5 text-sm">
            {breadcrumb.map((item, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <ChevronRight size={13} className="text-gray-300" />}
                {item.href ? (
                  <Link href={item.href} className="text-gray-400 hover:text-gray-700 transition-colors">
                    {item.label}
                  </Link>
                ) : (
                  <span className="text-gray-700 font-medium truncate max-w-[200px] sm:max-w-none">{item.label}</span>
                )}
              </span>
            ))}
          </nav>
        ) : (
          <p className="text-sm font-semibold text-gray-700">
            {saludo}{nombreCorto ? `, ${nombreCorto}` : ''}
          </p>
        )}
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-50 border border-green-200 text-green-600 text-xs font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          API Activa
        </span>
      </div>
    </div>
  );
}

// ─── AppLayout principal ──────────────────────────────────────────────────────
export function AppLayout({ children, breadcrumb, title }: AppLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Sidebar */}
      <Sidebar mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />

      {/* Main content */}
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
