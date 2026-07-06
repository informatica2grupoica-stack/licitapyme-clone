'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Building2, Mail, Loader2, AlertCircle, ArrowLeft, CheckCircle, Send } from 'lucide-react';

export default function RecuperarPage() {
  const [email, setEmail] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setCargando(true);
    try {
      const res = await fetch('/api/auth/recuperar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'No se pudo procesar la solicitud'); return; }
      setEnviado(true);
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

        {enviado ? (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 bg-green-50 rounded-full mb-4">
              <CheckCircle size={24} className="text-green-600" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 mb-2">Revisa tu correo</h2>
            <p className="text-[13px] text-slate-500 leading-relaxed">
              Si el correo corresponde a una cuenta, te enviamos un enlace para restablecer tu contraseña.
              El enlace vence en 30 minutos.
            </p>
            <Link href="/login" className="inline-flex items-center gap-1.5 mt-6 text-[13px] text-indigo-600 hover:text-indigo-800 font-semibold">
              <ArrowLeft size={14} /> Volver al inicio de sesión
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-slate-900 mb-1">¿Olvidaste tu contraseña?</h2>
              <p className="text-[13px] text-slate-500">Ingresa tu correo y te enviaremos un enlace para crear una nueva.</p>
            </div>

            {error && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-[13px] px-4 py-3 rounded-xl mb-5">
                <AlertCircle size={15} className="flex-shrink-0" /> {error}
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
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="tu@empresa.cl"
                    required
                    autoComplete="email"
                    className="w-full pl-10 pr-4 py-2.5 border border-slate-200 bg-white rounded-xl text-[13px] focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all shadow-sm"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={cargando || !email}
                className="w-full flex items-center justify-center gap-2 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors text-[14px] shadow-sm shadow-indigo-200"
              >
                {cargando
                  ? <><Loader2 size={15} className="animate-spin" />Enviando...</>
                  : <><Send size={15} />Enviar enlace</>}
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
