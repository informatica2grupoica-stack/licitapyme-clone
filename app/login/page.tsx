'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Mail, Lock, Eye, EyeOff, Loader2, AlertCircle, LogIn, Check, ArrowLeft,
} from 'lucide-react';
import { useSession } from '@/app/lib/session-context';
import { LicitankIcon } from '@/app/components/LicitankLogo';
import { MercadoPublicoMark } from '@/app/components/MercadoPublicoLogo';
import { IlustracionAsistente } from '@/app/components/IlustracionAsistente';

/* Misma identidad que la landing (/bienvenida): claro + teal del logo. */
const BRAND = '#2FC7A6';
const BRAND_INK = '#0e8f72';

const PUNTOS = [
  'Radar de Mercado Público con puntaje por perfil',
  'Viabilidad con IA citando documento, artículo y página',
  'Costeo, postulación y resultado en un solo flujo',
];

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { recargarSesion, usuario } = useSession();
  const returnUrl = searchParams.get('returnUrl') || '/';
  const reduce = useReducedMotion();

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

  const inputCls =
    'w-full rounded-xl border border-zinc-200 bg-white py-2.5 pl-10 text-[13.5px] text-zinc-900 outline-none transition-all placeholder:text-zinc-400 focus:border-[#2FC7A6] focus:ring-2 focus:ring-[#2FC7A6]/25';

  return (
    <div className="relative flex min-h-screen flex-col bg-[#fafafa] text-zinc-900 antialiased">
      {/* textura de puntos, como en la landing */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(24,24,27,0.05) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
          maskImage: 'linear-gradient(to bottom, black 0%, transparent 85%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 0%, transparent 85%)',
        }} />

      {/* ── Header (vuelta clara a la portada) ───────────────────────────── */}
      <header className="relative z-10 border-b border-zinc-200/80 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex h-[60px] max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/bienvenida" className="flex items-center gap-2.5">
            <LicitankIcon size={30} />
            <span className="text-[15px] font-black tracking-tight">LICITANK</span>
          </Link>
          <Link href="/bienvenida"
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3.5 py-2 text-[13px] font-semibold text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-zinc-50">
            <ArrowLeft size={14} />
            <span className="hidden sm:inline">Conocer la plataforma</span>
            <span className="sm:hidden">Portada</span>
          </Link>
        </div>
      </header>

      {/* ── Contenido ────────────────────────────────────────────────────── */}
      <main className="relative z-10 mx-auto grid w-full max-w-6xl flex-1 items-center gap-12 px-4 py-12 sm:px-6 lg:grid-cols-[1.05fr_.95fr] lg:gap-16">
        {/* Panel izquierdo: marca + ilustración */}
        <motion.div
          initial={{ opacity: 0, y: reduce ? 0 : 14 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55 }}
          className="hidden lg:block">
          <h1 className="max-w-md text-[34px] font-black leading-[1.1] tracking-tight">
            El radar del equipo para{' '}
            <span style={{ color: BRAND_INK }}>ganar licitaciones</span>.
          </h1>
          <ul className="mt-6 space-y-3">
            {PUNTOS.map(t => (
              <li key={t} className="flex items-start gap-2.5 text-[14px] text-zinc-600">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#2FC7A6]/15">
                  <Check size={12} strokeWidth={3} style={{ color: BRAND_INK }} />
                </span>
                {t}
              </li>
            ))}
          </ul>
          <IlustracionAsistente className="mt-4 w-full max-w-[460px]" />
        </motion.div>

        {/* Formulario */}
        <motion.div
          initial={{ opacity: 0, y: reduce ? 0 : 16 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.08 }}
          className="mx-auto w-full max-w-sm lg:max-w-md">
          <div className="rounded-2xl border border-zinc-200 bg-white p-7 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_20px_50px_-24px_rgba(24,24,27,0.18)] sm:p-9">
            <div className="mb-7 lg:hidden">
              <LicitankIcon size={40} />
            </div>
            <h2 className="text-[22px] font-black tracking-tight">Iniciar sesión</h2>
            <p className="mt-1 text-[13px] text-zinc-500">Ingresa con tu cuenta del equipo para continuar.</p>

            {error && (
              <div className="mt-5 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
                <AlertCircle size={15} className="shrink-0" />
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wider text-zinc-500">
                  Correo electrónico
                </label>
                <div className="relative">
                  <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="email"
                    value={form.email}
                    onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                    placeholder="tu@empresa.cl"
                    required
                    autoComplete="email"
                    className={`${inputCls} pr-4`}
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wider text-zinc-500">
                  Contraseña
                </label>
                <div className="relative">
                  <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input
                    type={mostrarPass ? 'text' : 'password'}
                    value={form.password}
                    onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                    placeholder="••••••••"
                    required
                    autoComplete="current-password"
                    className={`${inputCls} pr-10`}
                  />
                  <button type="button" onClick={() => setMostrarPass(!mostrarPass)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-400 transition-colors hover:text-zinc-600">
                    {mostrarPass ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={cargando || !form.email || !form.password}
                className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 py-3 text-[14px] font-bold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
              >
                {cargando
                  ? <><Loader2 size={15} className="animate-spin" />Iniciando sesión...</>
                  : <><LogIn size={15} />Iniciar sesión</>}
              </button>
            </form>

            <p className="mt-6 text-center text-[13px]">
              <Link href="/recuperar" className="font-semibold transition-opacity hover:opacity-75" style={{ color: BRAND_INK }}>
                ¿Olvidaste tu contraseña?
              </Link>
            </p>
          </div>

          <p className="mt-5 text-center text-[12.5px] text-zinc-400">
            <Link href="/bienvenida" className="inline-flex items-center gap-1 transition-colors hover:text-zinc-600">
              <ArrowLeft size={12} />
              Volver a la portada
            </Link>
          </p>
        </motion.div>
      </main>

      {/* ── Pie ──────────────────────────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-zinc-200 bg-white/70">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-5 sm:flex-row sm:px-6">
          <p className="text-[11.5px] text-zinc-400">© {new Date().getFullYear()} LICITANK · Inteligencia de licitaciones públicas</p>
          <MercadoPublicoMark size={24} tone="dark" />
        </div>
      </footer>
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
