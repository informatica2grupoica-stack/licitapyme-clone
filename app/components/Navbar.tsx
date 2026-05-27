'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Building2, Star, Search, ChevronRight, LogOut, User, Settings, ShieldCheck } from 'lucide-react';
import { useSession } from '@/app/lib/session-context';
import { useState, useRef, useEffect } from 'react';

// ─── Dropdown del usuario ──────────────────────────────────────────────────
function UserMenu() {
  const { usuario, logout } = useSession();
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Cerrar al hacer click fuera
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setAbierto(false);
      }
    }
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
        onClick={() => setAbierto(!abierto)}
        className="flex items-center gap-2.5 pl-2 pr-3 py-1.5 rounded-lg hover:bg-slate-800 transition-colors"
      >
        {/* Avatar */}
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
          {iniciales}
        </div>
        <div className="hidden sm:flex flex-col items-start leading-none">
          <span className="text-white text-sm font-medium">{usuario.nombre || usuario.email.split('@')[0]}</span>
          {usuario.empresa && <span className="text-slate-400 text-xs mt-0.5 truncate max-w-[120px]">{usuario.empresa}</span>}
        </div>
      </button>

      {/* Dropdown */}
      {abierto && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden">
          {/* Info usuario */}
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
            <p className="text-sm font-semibold text-gray-900 truncate">{usuario.nombre || 'Sin nombre'}</p>
            <p className="text-xs text-gray-500 truncate mt-0.5">{usuario.email}</p>
            {usuario.rol === 'admin' && (
              <span className="inline-flex items-center gap-1 mt-1.5 text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full font-medium">
                <ShieldCheck size={10} /> Admin
              </span>
            )}
          </div>

          {/* Links */}
          <div className="py-1">
            <Link
              href="/perfil"
              onClick={() => setAbierto(false)}
              className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <User size={15} className="text-gray-400" />
              Mi perfil
            </Link>
            {usuario.rol === 'admin' && (
              <Link
                href="/admin/usuarios"
                onClick={() => setAbierto(false)}
                className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Settings size={15} className="text-gray-400" />
                Administrar usuarios
              </Link>
            )}
          </div>

          {/* Logout */}
          <div className="border-t border-gray-100 py-1">
            <button
              onClick={() => { setAbierto(false); logout(); }}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
            >
              <LogOut size={15} />
              Cerrar sesión
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Navbar principal ──────────────────────────────────────────────────────
export function Navbar() {
  const pathname = usePathname();
  const { usuario, cargando } = useSession();

  return (
    <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="h-16 flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg group-hover:bg-blue-500 transition-colors">
              <Building2 size={18} className="text-white" />
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-white font-bold text-base tracking-tight">ICA</span>
              <span className="text-slate-400 text-xs font-medium tracking-wider uppercase">Licitaciones</span>
            </div>
          </Link>

          {/* Nav links */}
          <nav className="hidden md:flex items-center gap-1">
            <Link
              href="/"
              className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                pathname === '/'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Search size={15} />
              Buscador
            </Link>
            <Link
              href="/?favoritos=true"
              className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <Star size={15} />
              Favoritos
            </Link>
          </nav>

          {/* Derecha: estado API + usuario */}
          <div className="flex items-center gap-3">
            <span className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-900/50 border border-green-700/50 text-green-400 text-xs font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              API Conectada
            </span>

            {/* Sesión */}
            {cargando ? (
              <div className="w-8 h-8 rounded-full bg-slate-700 animate-pulse" />
            ) : usuario ? (
              <UserMenu />
            ) : (
              <Link
                href="/login"
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <User size={14} />
                Iniciar sesión
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

// ─── Breadcrumb ──────────────────────────────────────────────────────────
export function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <div className="bg-slate-900 border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5">
        <nav className="flex items-center gap-1.5 text-sm">
          {items.map((item, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight size={13} className="text-slate-600" />}
              {item.href ? (
                <Link href={item.href} className="text-slate-400 hover:text-white transition-colors">
                  {item.label}
                </Link>
              ) : (
                <span className="text-slate-300 font-medium">{item.label}</span>
              )}
            </span>
          ))}
        </nav>
      </div>
    </div>
  );
}
