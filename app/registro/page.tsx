'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Building2, Mail, Lock, Eye, EyeOff, Loader2, AlertCircle,
  CheckCircle, User, Briefcase, ArrowRight,
} from 'lucide-react';
import { useSession } from '@/app/lib/session-context';

export default function RegistroPage() {
  const router = useRouter();
  const { recargarSesion, usuario } = useSession();

  const [form, setForm] = useState({ email: '', password: '', confirmar: '', nombre: '', empresa: '' });
  const [mostrarPass, setMostrarPass] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState(false);

  useEffect(() => { if (usuario) router.replace('/'); }, [usuario, router]);

  const passwordValida = form.password.length >= 8;
  const passwordCoincide = form.password === form.confirmar;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!passwordValida) { setError('La contraseña debe tener al menos 8 caracteres'); return; }
    if (!passwordCoincide) { setError('Las contraseñas no coinciden'); return; }
    setCargando(true);
    try {
      const res = await fetch('/api/auth/registro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email, password: form.password, nombre: form.nombre, empresa: form.empresa }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Error al crear la cuenta'); return; }
      setExito(true);
      await recargarSesion();
      setTimeout(() => router.replace('/'), 1500);
    } catch {
      setError('Error de conexión. Intenta nuevamente.');
    } finally {
      setCargando(false);
    }
  };

  if (exito) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1e1b4b] via-[#312e81] to-[#1e3a8a]">
        <div className="text-center scale-in">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-500 rounded-full shadow-2xl mb-4">
            <CheckCircle size={32} className="text-white" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">¡Cuenta creada!</h2>
          <p className="text-indigo-300 text-sm">Redirigiendo al portal...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      {/* Panel izquierdo — marca */}
      <div className="hidden lg:flex lg:w-[44%] bg-gradient-to-br from-[#1e1b4b] via-[#312e81] to-[#1e3a8a] flex-col justify-between p-12 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-60 h-60 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center border border-white/10">
            <Building2 size={20} className="text-white" />
          </div>
          <span className="text-white text-[17px] font-bold tracking-tight">ICA Licitaciones</span>
        </div>

        <div className="relative z-10 space-y-4">
          <h2 className="text-3xl font-bold text-white leading-tight">
            Únete a la<br />
            <span className="text-indigo-300">plataforma</span>
          </h2>
          <p className="text-indigo-200 text-[14px] leading-relaxed max-w-xs">
            Crea tu cuenta gratis y empieza a explorar miles de licitaciones del Estado chileno con análisis de IA.
          </p>
          <div className="flex items-center gap-2 pt-2">
            <div className="flex -space-x-2">
              {['bg-indigo-400', 'bg-purple-400', 'bg-cyan-400'].map((c, i) => (
                <div key={i} className={`w-8 h-8 rounded-full ${c} border-2 border-[#312e81] flex items-center justify-center text-white text-xs font-bold`}>
                  {String.fromCharCode(65 + i)}
                </div>
              ))}
            </div>
            <p className="text-indigo-200 text-xs">+200 empresas ya usan la plataforma</p>
          </div>
        </div>

        <p className="relative z-10 text-indigo-400 text-xs">© 2026 ICA Licitaciones</p>
      </div>

      {/* Panel derecho */}
      <div className="flex-1 flex items-center justify-center bg-slate-50 px-6 py-10 overflow-y-auto">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-8">
            <div className="inline-flex items-center justify-center w-12 h-12 bg-indigo-600 rounded-2xl shadow-lg mb-3">
              <Building2 size={22} className="text-white" />
            </div>
            <h1 className="text-xl font-bold text-slate-900">ICA Licitaciones</h1>
          </div>

          <div className="mb-6">
            <h2 className="text-2xl font-bold text-slate-900 mb-1">Crear cuenta</h2>
            <p className="text-[13px] text-slate-500">Completa el formulario para registrarte</p>
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-[13px] px-4 py-3 rounded-xl mb-4">
              <AlertCircle size={15} className="flex-shrink-0" /> {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Nombre */}
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Nombre completo</label>
              <div className="relative">
                <User size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="text" value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))}
                  placeholder="Juan Pérez" autoComplete="name"
                  className="w-full pl-10 pr-4 py-2.5 border border-slate-200 bg-white rounded-xl text-[13px] focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none shadow-sm" />
              </div>
            </div>

            {/* Empresa */}
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">
                Empresa <span className="text-slate-300 font-normal normal-case">(opcional)</span>
              </label>
              <div className="relative">
                <Briefcase size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="text" value={form.empresa} onChange={e => setForm(p => ({ ...p, empresa: e.target.value }))}
                  placeholder="Mi Empresa SpA"
                  className="w-full pl-10 pr-4 py-2.5 border border-slate-200 bg-white rounded-xl text-[13px] focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none shadow-sm" />
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Correo electrónico</label>
              <div className="relative">
                <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                  placeholder="tu@empresa.cl" required autoComplete="email"
                  className="w-full pl-10 pr-4 py-2.5 border border-slate-200 bg-white rounded-xl text-[13px] focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none shadow-sm" />
              </div>
            </div>

            {/* Contraseña */}
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Contraseña</label>
              <div className="relative">
                <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type={mostrarPass ? 'text' : 'password'} value={form.password}
                  onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                  placeholder="Mín. 8 caracteres" required autoComplete="new-password"
                  className={`w-full pl-10 pr-10 py-2.5 border rounded-xl text-[13px] focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none shadow-sm ${
                    form.password && !passwordValida ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'
                  }`} />
                <button type="button" onClick={() => setMostrarPass(!mostrarPass)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {mostrarPass ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              {form.password && !passwordValida && <p className="text-xs text-red-500 mt-1">Mínimo 8 caracteres</p>}
            </div>

            {/* Confirmar */}
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Confirmar contraseña</label>
              <div className="relative">
                <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type={mostrarPass ? 'text' : 'password'} value={form.confirmar}
                  onChange={e => setForm(p => ({ ...p, confirmar: e.target.value }))}
                  placeholder="Repite la contraseña" required autoComplete="new-password"
                  className={`w-full pl-10 pr-4 py-2.5 border rounded-xl text-[13px] focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none shadow-sm ${
                    form.confirmar && !passwordCoincide ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'
                  }`} />
              </div>
              {form.confirmar && !passwordCoincide && <p className="text-xs text-red-500 mt-1">Las contraseñas no coinciden</p>}
            </div>

            <button type="submit"
              disabled={cargando || !form.email || !form.password || !passwordValida || !passwordCoincide}
              className="w-full flex items-center justify-center gap-2 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors text-[14px] shadow-sm shadow-indigo-200 mt-1">
              {cargando
                ? <><Loader2 size={15} className="animate-spin" />Creando cuenta...</>
                : <><ArrowRight size={15} />Crear cuenta</>}
            </button>
          </form>

          <p className="text-center text-[13px] text-slate-500 mt-5">
            ¿Ya tienes cuenta?{' '}
            <Link href="/login" className="text-indigo-600 hover:text-indigo-800 font-semibold">Inicia sesión</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
