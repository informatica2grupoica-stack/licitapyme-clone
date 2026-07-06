'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Building2, Lock, Eye, EyeOff, Loader2, AlertCircle, CheckCircle, ArrowLeft, KeyRound,
} from 'lucide-react';

function RestablecerContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';

  const [estado, setEstado] = useState<'verificando' | 'valido' | 'invalido' | 'listo'>('verificando');
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [mostrarPass, setMostrarPass] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Verificar el token al montar.
  useEffect(() => {
    if (!token) { setEstado('invalido'); return; }
    (async () => {
      try {
        const res = await fetch(`/api/auth/restablecer?token=${encodeURIComponent(token)}`);
        const data = await res.json();
        setEstado(data.valido ? 'valido' : 'invalido');
      } catch { setEstado('invalido'); }
    })();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (form.password.length < 8) { setError('La contraseña debe tener al menos 8 caracteres'); return; }
    if (form.password !== form.confirm) { setError('Las contraseñas no coinciden'); return; }
    setCargando(true);
    try {
      const res = await fetch('/api/auth/restablecer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: form.password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'No se pudo restablecer la contraseña'); return; }
      setEstado('listo');
      setTimeout(() => router.replace('/login'), 2500);
    } catch {
      setError('Error de conexión. Intenta nuevamente.');
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-indigo-600 rounded-2xl shadow-lg mb-3">
            <Building2 size={22} className="text-white" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">ICA Licitaciones</h1>
        </div>

        {estado === 'verificando' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-10 text-center text-slate-500">
            <Loader2 size={22} className="animate-spin mx-auto mb-3 text-indigo-500" />
            Verificando el enlace...
          </div>
        )}

        {estado === 'invalido' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 bg-red-50 rounded-full mb-4">
              <AlertCircle size={24} className="text-red-500" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 mb-2">Enlace no válido</h2>
            <p className="text-[13px] text-slate-500 leading-relaxed">
              Este enlace venció o ya fue usado. Solicita uno nuevo desde la pantalla de recuperación.
            </p>
            <Link href="/recuperar" className="inline-flex items-center gap-1.5 mt-6 text-[13px] text-indigo-600 hover:text-indigo-800 font-semibold">
              <KeyRound size={14} /> Pedir un enlace nuevo
            </Link>
          </div>
        )}

        {estado === 'listo' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 bg-green-50 rounded-full mb-4">
              <CheckCircle size={24} className="text-green-600" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 mb-2">Contraseña actualizada</h2>
            <p className="text-[13px] text-slate-500 leading-relaxed">Ya puedes iniciar sesión con tu clave nueva. Te llevamos al inicio...</p>
          </div>
        )}

        {estado === 'valido' && (
          <>
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-slate-900 mb-1">Crea tu contraseña</h2>
              <p className="text-[13px] text-slate-500">Elige una clave nueva de al menos 8 caracteres.</p>
            </div>

            {error && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-[13px] px-4 py-3 rounded-xl mb-5">
                <AlertCircle size={15} className="flex-shrink-0" /> {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-[12px] font-semibold text-slate-600 mb-1.5 uppercase tracking-wider">Contraseña nueva</label>
                <div className="relative">
                  <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type={mostrarPass ? 'text' : 'password'}
                    value={form.password}
                    onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                    placeholder="••••••••" required minLength={8} autoComplete="new-password"
                    className="w-full pl-10 pr-10 py-2.5 border border-slate-200 bg-white rounded-xl text-[13px] focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all shadow-sm"
                  />
                  <button type="button" onClick={() => setMostrarPass(!mostrarPass)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                    {mostrarPass ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-slate-600 mb-1.5 uppercase tracking-wider">Repetir contraseña</label>
                <div className="relative">
                  <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type={mostrarPass ? 'text' : 'password'}
                    value={form.confirm}
                    onChange={e => setForm(p => ({ ...p, confirm: e.target.value }))}
                    placeholder="••••••••" required minLength={8} autoComplete="new-password"
                    className="w-full pl-10 pr-4 py-2.5 border border-slate-200 bg-white rounded-xl text-[13px] focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all shadow-sm"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={cargando || !form.password || !form.confirm}
                className="w-full flex items-center justify-center gap-2 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors text-[14px] shadow-sm shadow-indigo-200"
              >
                {cargando
                  ? <><Loader2 size={15} className="animate-spin" />Guardando...</>
                  : <><KeyRound size={15} />Guardar contraseña</>}
              </button>
            </form>

            <p className="text-center mt-6">
              <Link href="/login" className="inline-flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-slate-700 font-medium">
                <ArrowLeft size={14} /> Volver al inicio de sesión
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default function RestablecerPage() {
  return (
    <Suspense>
      <RestablecerContent />
    </Suspense>
  );
}
