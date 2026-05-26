'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building2, Star, Search, ChevronRight } from 'lucide-react';

export function Navbar() {
  const pathname = usePathname();

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

          {/* Badge API */}
          <div className="flex items-center gap-2">
            <span className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-900/50 border border-green-700/50 text-green-400 text-xs font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              API Conectada
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}

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
