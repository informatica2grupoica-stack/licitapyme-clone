'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { motion, useReducedMotion } from 'framer-motion';
import { useSession } from '@/app/lib/session-context';
import { LicitankIcon } from '@/app/components/LicitankLogo';
import { MercadoPublicoMark } from '@/app/components/MercadoPublicoLogo';

/* Misma identidad que la landing (/bienvenida): oscuro, teal, Roboto, radar. */
const EASE = [0.2, 0.7, 0.2, 1] as [number, number, number, number];
const T_RADAR = 7;
const BLIPS = [
  { a: 28, r: 64 }, { a: 96, r: 40 }, { a: 152, r: 78 }, { a: 204, r: 52 }, { a: 258, r: 70 }, { a: 312, r: 34 }, { a: 338, r: 82 },
];

function Radar() {
  return (
    <div aria-hidden className="relative mx-auto aspect-square w-full max-w-[520px]">
      {[100, 74, 48, 22].map(p => (
        <span key={p} className="absolute rounded-full border border-white/10" style={{ inset: `${(100 - p) / 2}%` }} />
      ))}
      <span className="absolute left-1/2 top-0 h-full w-px bg-white/[.07]" />
      <span className="absolute left-0 top-1/2 h-px w-full bg-white/[.07]" />
      <span className="lk-sweep absolute inset-0 rounded-full" />
      <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-teal-300" />
      {BLIPS.map(b => {
        const rad = (b.a * Math.PI) / 180;
        return (
          <span key={b.a} className="lk-blip absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-teal-300"
            style={{
              left: `${50 + (b.r / 100) * 50 * Math.sin(rad)}%`, top: `${50 - (b.r / 100) * 50 * Math.cos(rad)}%`,
              animationDelay: `${(((b.a - 60 + 360) % 360) / 360) * T_RADAR}s`,
            }} />
        );
      })}
    </div>
  );
}

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
    'w-full rounded-md border border-white/15 bg-[#11161d] px-3.5 py-3 text-[14px] text-white outline-none transition-colors placeholder:text-slate-500 hover:border-white/30 focus:border-teal-400';

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#0a0d12] text-slate-200 antialiased" style={{ fontFamily: 'var(--font-roboto), ui-sans-serif, system-ui, sans-serif' }}>
      <style>{css}</style>

      <header className="relative z-10 border-b border-white/10">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-5 sm:px-8">
          <Link href="/bienvenida" className="flex items-center gap-2.5">
            <LicitankIcon size={30} />
            <span className="text-[15px] font-bold tracking-tight text-white">LICITANK</span>
          </Link>
          <Link href="/bienvenida" className="text-[13.5px] text-slate-400 transition-colors hover:text-white">
            ← Volver a la portada
          </Link>
        </div>
      </header>

      <main className="relative z-10 mx-auto grid w-full max-w-[1200px] flex-1 items-center gap-12 px-5 py-12 sm:px-8 lg:grid-cols-[1.05fr_.95fr] lg:gap-20">
        {/* Izquierda: radar con la frase de marca */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }} className="relative hidden lg:block">
          <Radar />
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="max-w-[300px] text-center text-[26px] font-medium leading-[1.15] tracking-[-0.02em] text-white [text-shadow:0_0_14px_#0a0d12,0_0_28px_#0a0d12]">
              Que ninguna licitación se pase por no haberla visto.
            </p>
          </div>
        </motion.div>

        {/* Derecha: formulario sin caja */}
        <motion.div
          initial={{ opacity: 0, y: reduce ? 0 : 16 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1, ease: EASE }}
          className="mx-auto w-full max-w-sm">
          <h1 className="text-[34px] font-medium leading-[1.05] tracking-[-0.03em] text-white sm:text-[40px]">Iniciar sesión</h1>
          <p className="mt-3 text-[14.5px] leading-[1.6] text-slate-400">Ingresa con tu cuenta para seguir donde quedaste.</p>

          {error && (
            <p role="alert" className="mt-6 text-[13.5px] font-medium text-red-400">{error}</p>
          )}

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div>
              <label htmlFor="login-email" className="mb-1.5 block text-[12.5px] text-slate-400">Correo electrónico</label>
              <input
                id="login-email"
                type="email"
                value={form.email}
                onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                placeholder="tu@empresa.cl"
                required
                autoComplete="email"
                className={inputCls}
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <label htmlFor="login-password" className="text-[12.5px] text-slate-400">Contraseña</label>
                <Link href="/recuperar" className="text-[12.5px] text-teal-300 transition-colors hover:text-teal-200">¿Olvidaste tu contraseña?</Link>
              </div>
              <div className="relative">
                <input
                  id="login-password"
                  type={mostrarPass ? 'text' : 'password'}
                  value={form.password}
                  onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  className={`${inputCls} pr-20`}
                />
                <button type="button" onClick={() => setMostrarPass(!mostrarPass)}
                  aria-label={mostrarPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[12.5px] text-slate-400 transition-colors hover:text-white">
                  {mostrarPass ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={cargando || !form.email || !form.password}
              className="lk-btn mt-2 flex w-full items-center justify-center rounded-md bg-teal-500 py-3 text-[14.5px] font-medium text-[#04201c] hover:bg-teal-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-slate-500"
            >
              {cargando ? 'Iniciando sesión…' : 'Iniciar sesión'}
            </button>
          </form>
        </motion.div>
      </main>

      <footer className="relative z-10 border-t border-white/10">
        <div className="mx-auto flex max-w-[1200px] flex-col items-center justify-between gap-3 px-5 py-5 text-[12.5px] text-slate-500 sm:flex-row sm:px-8">
          <p>© {new Date().getFullYear()} LICITANK</p>
          <span className="flex items-center gap-3">
            Datos públicos de
            <MercadoPublicoMark size={22} tone="light" />
          </span>
        </div>
      </footer>
    </div>
  );
}

const css = `
.lk-btn{transition:transform .15s,background-color .15s}
.lk-btn:not(:disabled):hover{transform:translateY(-1px)}
.lk-btn:not(:disabled):active{transform:scale(.98)}
.lk-sweep{background:conic-gradient(from 0deg,rgba(45,212,191,0) 0deg,rgba(45,212,191,.34) 60deg,rgba(45,212,191,0) 60.6deg);animation:lk-gira ${T_RADAR}s linear infinite}
@keyframes lk-gira{to{transform:rotate(360deg)}}
.lk-blip{opacity:.28;animation:lk-blip ${T_RADAR}s linear infinite}
@keyframes lk-blip{0%{opacity:1;transform:translate(-50%,-50%) scale(1.9)}10%{opacity:1;transform:translate(-50%,-50%) scale(1)}70%{opacity:.28}100%{opacity:.28;transform:translate(-50%,-50%) scale(1)}}
@media (prefers-reduced-motion:reduce){.lk-sweep,.lk-blip{animation:none}.lk-blip{opacity:.7}.lk-btn{transition:none}}
`;

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
