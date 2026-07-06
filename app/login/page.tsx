'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Building2, Mail, Lock, Eye, EyeOff, Loader2, AlertCircle, LogIn,
  Shield, TrendingUp, Zap, CheckCircle,
} from 'lucide-react';
import { useSession } from '@/app/lib/session-context';

const FEATURES = [
  { icon: <TrendingUp size={16} />, text: 'Busca licitaciones en tiempo real' },
  { icon: <Zap size={16} />, text: 'Análisis inteligente de bases' },
  { icon: <Shield size={16} />, text: 'Alertas automáticas de nuevas oportunidades' },
  { icon: <CheckCircle size={16} />, text: 'Gestión de postulaciones y negocios' },
];

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { recargarSesion, usuario } = useSession();
  const returnUrl = searchParams.get('returnUrl') || '/';

  const [form, setForm] = useState({ email: '', password: '' });
  const [mostrarPass, setMostrarPass] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (usuario) router.replace(returnUrl);
  }, [usuario, router, returnUrl]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setCargando(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Error al iniciar sesión'); return; }
      await recargarSesion();
      router.replace(returnUrl);
    } catch {
      setError('Error de conexión. Intenta nuevamente.');
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Panel izquierdo — marca */}
      <div className="hidden lg:flex lg:w-[52%] bg-gradient-to-br from-[#1e1b4b] via-[#312e81] to-[#1e3a8a] flex-col justify-between p-12 relative overflow-hidden">
        {/* Decoración */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
        <div className="absolute top-1/2 left-1/2 w-80 h-80 bg-indigo-500/10 rounded-full -translate-x-1/2 -translate-y-1/2" />

        {/* Logo */}
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm border border-white/10">
              <Building2 size={20} className="text-white" />
            </div>
            <span className="text-white text-[17px] font-bold tracking-tight">ICA Licitaciones</span>
          </div>
          <p className="text-indigo-300 text-sm ml-[52px]">Portal de Compras Públicas Chile</p>
        </div>

        {/* Hero text */}
        <div className="relative z-10 space-y-6">
          <div>
            <h2 className="text-4xl font-bold text-white leading-tight">
              Gana más<br />
              <span className="text-indigo-300">licitaciones</span>
            </h2>
            <p className="text-indigo-200 mt-3 text-[15px] leading-relaxed max-w-sm">
              La plataforma inteligente para proveedores del Estado. Encuentra, analiza y postula a licitaciones de Mercado Público desde un solo lugar.
            </p>
          </div>

          <div className="space-y-3">
            {FEATURES.map((f, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg bg-white/10 border border-white/10 flex items-center justify-center text-indigo-300 flex-shrink-0">
                  {f.icon}
                </div>
                <span className="text-indigo-100 text-sm">{f.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <p className="relative z-10 text-indigo-400 text-xs">
          © 2026 ICA Licitaciones · Datos de Mercado Público Chile
        </p>
      </div>

      {/* Panel derecho — formulario */}
      <div className="flex-1 flex items-center justify-center bg-slate-50 px-6 py-10">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-8">
            <div className="inline-flex items-center justify-center w-12 h-12 bg-indigo-600 rounded-2xl shadow-lg mb-3">
              <Building2 size={22} className="text-white" />
            </div>
            <h1 className="text-xl font-bold text-slate-900">ICA Licitaciones</h1>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-slate-900 mb-1">Iniciar sesión</h2>
            <p className="text-[13px] text-slate-500">Ingresa tus credenciales para continuar</p>
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-[13px] px-4 py-3 rounded-xl mb-5">
              <AlertCircle size={15} className="flex-shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1.5 uppercase tracking-wider">
                Correo electrónico
              </label>
              <div className="relative">
                <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                  placeholder="tu@empresa.cl"
                  required
                  autoComplete="email"
                  className="w-full pl-10 pr-4 py-2.5 border border-slate-200 bg-white rounded-xl text-[13px] focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all shadow-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1.5 uppercase tracking-wider">
                Contraseña
              </label>
              <div className="relative">
                <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type={mostrarPass ? 'text' : 'password'}
                  value={form.password}
                  onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  className="w-full pl-10 pr-10 py-2.5 border border-slate-200 bg-white rounded-xl text-[13px] focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all shadow-sm"
                />
                <button type="button" onClick={() => setMostrarPass(!mostrarPass)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                  {mostrarPass ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={cargando || !form.email || !form.password}
              className="w-full flex items-center justify-center gap-2 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors text-[14px] shadow-sm shadow-indigo-200 mt-1"
            >
              {cargando
                ? <><Loader2 size={15} className="animate-spin" />Iniciando sesión...</>
                : <><LogIn size={15} />Iniciar sesión</>}
            </button>
          </form>

          <p className="text-center text-[13px] text-slate-500 mt-6">
            <Link href="/recuperar" className="text-indigo-600 hover:text-indigo-800 font-semibold">
              ¿Olvidaste tu contraseña?
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
