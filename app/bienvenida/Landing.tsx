'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, useInView, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import {
  Radar, Sparkles, ShieldCheck, Calculator, Briefcase, BellRing,
  ArrowRight, Check, Search, LayoutDashboard, Users, Lock,
  FileSearch, Bot, LineChart, LogIn, Bell, ChevronDown, MessageCircle,
} from 'lucide-react';
import { LicitankIcon } from '@/app/components/LicitankLogo';
import { MercadoPublicoMark } from '@/app/components/MercadoPublicoLogo';
import { IlustracionAsistente } from '@/app/components/IlustracionAsistente';
import { useSession } from '@/app/lib/session-context';

/* Identidad: los colores salen del logo (teal #2FC7A6) sobre el fondo claro de la app. */
const BRAND = '#2FC7A6';
const BRAND_INK = '#0e8f72'; // teal oscurecido, legible sobre blanco

/* ────────────────────────────────────────────────────────────────────────────
   Contenido (todo refleja lo que la plataforma hace de verdad)
──────────────────────────────────────────────────────────────────────────── */

const FUNCIONES = [
  {
    n: '01', icon: Radar, titulo: 'Radar inteligente',
    desc: 'Vigila el universo de Mercado Público y cruza cada licitación con las palabras clave de cada perfil: puntaje de relevancia, región, monto y rubro.',
  },
  {
    n: '02', icon: Bot, titulo: 'Prefiltro con IA',
    desc: 'Descarta lo que no aplica —obra civil, servicios ajenos, presupuesto bajo— antes de gastar recursos, y siempre deja el motivo a la vista.',
  },
  {
    n: '03', icon: ShieldCheck, titulo: 'Viabilidad con evidencia',
    desc: 'Lee las bases completas, incluidas las escaneadas, y emite un veredicto citando documento, artículo y página de cada dato.',
  },
  {
    n: '04', icon: Calculator, titulo: 'Costeo automático',
    desc: 'Genera el Excel de costeo desde la plantilla real de la empresa, con la estructura de la licitación —suma alzada o por línea— y precios de mercado por ítem.',
  },
  {
    n: '05', icon: Briefcase, titulo: 'Gestión de negocios',
    desc: 'Asignar, trabajar, anexar, postular y medir. Estados, comentarios y bitácora de quién hizo qué, desde la detección hasta el resultado.',
  },
  {
    n: '06', icon: BellRing, titulo: 'Alertas oportunas',
    desc: 'Campana, tiempo real y correo: nuevas oportunidades, cambios de etapa, aperturas y aviso de cierre antes de que venza el plazo.',
  },
];

/* Campos que el análisis valida en cada licitación (los reales del pipeline) */
const VALIDACIONES = [
  'Modalidad de oferta', 'Tipo de adjudicación', 'Criterios y pesos (suman 100%)',
  'Garantías exigidas', 'Plazos y fecha de cierre', 'Presupuesto disponible',
  'Ítems y cantidades', 'Anexos y formularios',
];

const PASOS = [
  { t: 'Detección', d: 'El radar captura lo nuevo de Mercado Público y lo cruza con el perfil del equipo.', icon: FileSearch },
  { t: 'Prefiltro', d: 'La IA aparta lo que no calza con el negocio, con su motivo visible.', icon: Bot },
  { t: 'Viabilidad', d: 'Se leen las bases completas y se responde con fuentes: ¿conviene competir?', icon: ShieldCheck },
  { t: 'Postulación', d: 'Costeo, anexos y presentación de la oferta, con seguimiento.', icon: Briefcase },
  { t: 'Resultado', d: 'Apertura y adjudicación detectadas desde Mercado Público, medidas en el panel.', icon: LineChart },
];

const ROLES = [
  { icon: LayoutDashboard, t: 'Administrador', d: 'Visión total: todo el radar, todos los negocios, reasignación, re-análisis y buscador.' },
  { icon: Users, t: 'Usuario', d: 'Sus alertas y los negocios que le asignan, con permisos finos por perfil.' },
  { icon: Lock, t: 'Externo', d: 'Acceso acotado a las licitaciones que se le asignan, sin ver el resto.' },
];

/* Licitaciones REALES de Mercado Público (datos del set de validación de la
   plataforma: código, organismo, región, monto y puntaje tal como se analizaron). */
const FILAS = [
  {
    codigo: '2126-107-LE26', nombre: 'Adquisición de catres clínicos eléctricos, campaña invierno',
    org: 'Hospital de Coquimbo', region: 'Región de Coquimbo', cierre: 'cierra hoy',
    score: 65, chip: 'GANABLE', tono: 'ok' as const, estado: 'En estudio',
  },
  {
    codigo: '2467-70-LE26', nombre: 'Adquisición de materiales eléctricos',
    org: 'I. Municipalidad de Chillán', region: 'Región del Ñuble', cierre: 'en 3 días',
    score: 65, chip: 'GANABLE', tono: 'ok' as const, estado: 'Asignada', activa: true,
  },
  {
    codigo: '2920-30-LE26', nombre: 'Materiales e insumos para la DOM',
    org: 'I. Municipalidad de Juan Fernández', region: 'Región de Valparaíso', cierre: 'cierra hoy',
    score: 39, chip: 'REVISIÓN', tono: 'warn' as const, estado: 'Prefiltro',
  },
];

/* ────────────────────────────────────────────────────────────────────────────
   Utilidades de animación
──────────────────────────────────────────────────────────────────────────── */

function Reveal({ children, delay = 0, className = '' }: {
  children: React.ReactNode; delay?: number; className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, y: reduce ? 0 : 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-70px' }}
      transition={{ duration: 0.55, delay, ease: [0.21, 0.47, 0.32, 0.98] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* Subrayado dibujado a mano bajo la palabra clave del titular */
function Subrayado({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative inline-block">
      {children}
      <svg className="absolute left-0 -bottom-1.5 w-full" viewBox="0 0 220 12" fill="none"
        preserveAspectRatio="none" aria-hidden="true" style={{ height: '0.32em' }}>
        <path d="M4 8.5C40 3.5 96 2.5 132 4.5c30 1.6 60 3 84 2.5" stroke={BRAND}
          strokeWidth="5" strokeLinecap="round" opacity="0.85" />
      </svg>
    </span>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Landing
──────────────────────────────────────────────────────────────────────────── */

export default function Landing() {
  const { usuario } = useSession();
  const reduce = useReducedMotion();
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] });
  const radarY = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : 70]);

  const cta = usuario
    ? { href: '/dashboard', label: 'Ir al panel', icon: LayoutDashboard }
    : { href: '/login', label: 'Iniciar sesión', icon: LogIn };

  return (
    <div className="min-h-screen bg-[#fafafa] text-zinc-900 antialiased">
      <style>{radarCss}</style>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-zinc-200/80 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex h-[60px] max-w-6xl items-center justify-between px-4 sm:px-6">
          <a href="#top" className="flex items-center gap-2.5">
            <LicitankIcon size={30} />
            <span className="text-[15px] font-black tracking-tight">LICITANK</span>
          </a>
          <nav className="hidden items-center gap-8 text-[13.5px] font-medium text-zinc-500 md:flex">
            <a href="#producto" className="transition-colors hover:text-zinc-900">Producto</a>
            <a href="#asistente" className="transition-colors hover:text-zinc-900">Asistente IA</a>
            <a href="#flujo" className="transition-colors hover:text-zinc-900">Cómo funciona</a>
            <a href="#roles" className="transition-colors hover:text-zinc-900">Acceso</a>
          </nav>
          <Link href={cta.href}
            className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-zinc-700">
            {cta.label}
            <ArrowRight size={14} />
          </Link>
        </div>
      </header>

      <main id="top">

        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section ref={heroRef} className="relative overflow-hidden">
          {/* textura de puntos, se desvanece hacia abajo */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: 'radial-gradient(circle, rgba(24,24,27,0.055) 1px, transparent 1px)',
              backgroundSize: '22px 22px',
              maskImage: 'linear-gradient(to bottom, black 0%, transparent 82%)',
              WebkitMaskImage: 'linear-gradient(to bottom, black 0%, transparent 82%)',
            }} />

          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-16 sm:px-6 sm:pt-24 lg:grid-cols-[1.05fr_.95fr] lg:gap-6">
            {/* Copy */}
            <div>
              <motion.h1
                initial={{ opacity: 0, y: reduce ? 0 : 14 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
                className="text-[38px] font-black leading-[1.06] tracking-tight sm:text-[54px]">
                De miles de licitaciones,{' '}
                <Subrayado>las que ganamos</Subrayado>.
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: reduce ? 0 : 14 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1 }}
                className="mt-6 max-w-xl text-[16.5px] leading-relaxed text-zinc-600">
                LICITANK vigila Mercado Público, lee las bases con inteligencia artificial
                y acompaña cada oportunidad —de la detección a la adjudicación— para que
                el equipo compita solo donde vale la pena.
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: reduce ? 0 : 14 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.18 }}
                className="mt-8 flex flex-wrap items-center gap-3">
                <Link href={cta.href}
                  className="group inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-5 py-3 text-[14.5px] font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.15),0_8px_20px_-8px_rgba(0,0,0,0.3)] transition-all hover:bg-zinc-700">
                  <cta.icon size={16} />
                  {cta.label}
                  <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
                </Link>
                <a href="#producto"
                  className="inline-flex items-center gap-2 rounded-xl border border-zinc-300 bg-white px-5 py-3 text-[14.5px] font-semibold text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-zinc-50">
                  Ver el producto
                  <ChevronDown size={15} className="text-zinc-400" />
                </a>
              </motion.div>

              <motion.ul
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.7, delay: 0.32 }}
                className="mt-9 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-zinc-500">
                {[
                  '+14.000 licitaciones revisadas por corrida',
                  'Bases leídas al 100%, incluso escaneadas',
                  'Vigilancia automática 24/7',
                ].map(t => (
                  <li key={t} className="inline-flex items-center gap-1.5">
                    <Check size={14} strokeWidth={2.5} style={{ color: BRAND_INK }} />
                    {t}
                  </li>
                ))}
              </motion.ul>
            </div>

            {/* Radar animado + tarjetas con datos reales */}
            <motion.div
              style={{ y: radarY }}
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.75, delay: 0.15, ease: [0.21, 0.47, 0.32, 0.98] }}
              className="relative mx-auto w-full max-w-[420px]">
              <div className="lp-radar">
                <div className="lp-radar-rings" />
                {!reduce && (
                  <motion.div className="lp-radar-sweep" animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 6.5, ease: 'linear' }} />
                )}
                <span className="lp-blip" style={{ top: '26%', left: '64%' }} />
                <span className="lp-blip lp-blip-d1" style={{ top: '60%', left: '34%' }} />
                <span className="lp-blip lp-blip-d2" style={{ top: '42%', left: '74%' }} />
                <span className="lp-blip lp-blip-d3" style={{ top: '70%', left: '58%' }} />
                <div className="absolute inset-0 grid place-items-center">
                  <span className="grid h-16 w-16 place-items-center rounded-2xl border border-zinc-200 bg-white shadow-[0_8px_30px_-10px_rgba(24,24,27,0.25)]">
                    <LicitankIcon size={40} />
                  </span>
                </div>
              </div>

              {/* Tarjeta: viabilidad real (2467-70-LE26, set de validación) */}
              <motion.div
                animate={reduce ? undefined : { y: [0, -9, 0] }}
                transition={{ repeat: Infinity, duration: 5.2, ease: 'easeInOut' }}
                className="lp-float absolute -left-2 top-6 w-48 sm:-left-8">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10.5px] font-semibold text-zinc-400">2467-70-LE26</span>
                  <span className="rounded bg-[#2FC7A6]/15 px-1.5 py-0.5 text-[10px] font-bold text-[#0e8f72]">GANABLE</span>
                </div>
                <div className="mt-1.5 flex items-end gap-1.5">
                  <span className="text-[24px] font-black leading-none text-zinc-900">65</span>
                  <span className="mb-0.5 text-[11px] text-zinc-400">/ 100</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100">
                  <div className="h-full rounded-full" style={{ width: '65%', background: BRAND }} />
                </div>
              </motion.div>

              {/* Tarjeta: alerta de cierre */}
              <motion.div
                animate={reduce ? undefined : { y: [0, 10, 0] }}
                transition={{ repeat: Infinity, duration: 6.2, ease: 'easeInOut', delay: 0.5 }}
                className="lp-float absolute -right-1 bottom-8 w-52 sm:-right-6">
                <div className="flex items-start gap-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-600"><BellRing size={15} /></span>
                  <div className="min-w-0">
                    <p className="text-[12px] font-bold leading-tight text-zinc-900">Cierre próximo</p>
                    <p className="mt-0.5 truncate text-[11px] leading-snug text-zinc-500">Materiales eléctricos · Chillán</p>
                    <p className="text-[10.5px] font-semibold text-amber-600">Queda 35% del plazo</p>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          </div>
        </section>

        {/* ── Mockup del producto ──────────────────────────────────────────── */}
        <section id="producto" className="relative">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <motion.div
              initial={{ opacity: 0, y: reduce ? 0 : 32 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.7, ease: [0.21, 0.47, 0.32, 0.98] }}
            >
              <AppPreview reduce={!!reduce} />
            </motion.div>
            <p className="mt-3 text-center text-[11.5px] text-zinc-400">
              Licitaciones reales de Mercado Público, tal como las analizó la plataforma.
            </p>
          </div>
        </section>

        {/* ── Atribución de fuentes ────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex flex-col items-center justify-between gap-4 border-b border-zinc-200 py-9 sm:flex-row">
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
              Datos desde la fuente oficial
            </p>
            <div className="flex items-center gap-7">
              <MercadoPublicoMark size={30} tone="dark" />
              <span className="hidden h-5 w-px bg-zinc-200 sm:block" />
              <span className="hidden items-center gap-2 sm:inline-flex">
                <LicitankIcon size={24} />
                <span className="text-[13.5px] font-black tracking-tight">LICITANK</span>
              </span>
            </div>
          </div>
        </section>

        {/* ── Funciones ────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
          <Reveal>
            <p className="text-[12.5px] font-bold uppercase tracking-[0.15em]" style={{ color: BRAND_INK }}>
              Qué hace la plataforma
            </p>
            <h2 className="mt-3 max-w-2xl text-[28px] font-black leading-tight tracking-tight sm:text-[36px]">
              Todo el ciclo de una licitación, sin trabajo manual
            </h2>
          </Reveal>

          <div className="mt-11 grid gap-px overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-200 sm:grid-cols-2 lg:grid-cols-3">
            {FUNCIONES.map((f, i) => (
              <Reveal key={f.n} delay={Math.min(i * 0.05, 0.25)} className="h-full">
                <article className="group h-full bg-white p-6 transition-colors hover:bg-zinc-50/80 sm:p-7">
                  <div className="flex items-center justify-between">
                    <span className="grid h-10 w-10 place-items-center rounded-lg border border-zinc-200 bg-white transition-colors group-hover:border-[#2FC7A6]/50"
                      style={{ color: BRAND_INK }}>
                      <f.icon size={19} strokeWidth={1.9} />
                    </span>
                    <span className="font-mono text-[12px] font-semibold text-zinc-300 transition-colors group-hover:text-zinc-400">{f.n}</span>
                  </div>
                  <h3 className="mt-5 text-[16px] font-bold tracking-tight">{f.titulo}</h3>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-zinc-500">{f.desc}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── Asistente IA ─────────────────────────────────────────────────── */}
        <section id="asistente" className="border-y border-zinc-200 bg-white">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-2 lg:gap-16">
            <Reveal>
              <p className="text-[12.5px] font-bold uppercase tracking-[0.15em]" style={{ color: BRAND_INK }}>
                Asistente por licitación
              </p>
              <h2 className="mt-3 text-[28px] font-black leading-tight tracking-tight sm:text-[36px]">
                Pregúntale a las bases, responde con las bases
              </h2>
              <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-zinc-600">
                Cada licitación tiene su propio asistente, que ya leyó todos los documentos
                del proceso. Responde en segundos y siempre indica de dónde salió el dato:
                documento, artículo y página. Nada de interpretar a ciegas.
              </p>
              <ul className="mt-7 space-y-3">
                {[
                  'Disponible en el radar y en cada negocio',
                  'Contexto completo: bases, anexos y formularios',
                  'Si un dato no está en los documentos, lo dice',
                ].map(t => (
                  <li key={t} className="flex items-start gap-2.5 text-[14px] text-zinc-600">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#2FC7A6]/15">
                      <Check size={12} strokeWidth={3} style={{ color: BRAND_INK }} />
                    </span>
                    {t}
                  </li>
                ))}
              </ul>

              <div className="mt-8">
                <p className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                  Lo que valida en cada análisis
                </p>
                <div className="mt-3 flex max-w-lg flex-wrap gap-2">
                  {VALIDACIONES.map(v => (
                    <span key={v} className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-[12px] font-medium text-zinc-600">
                      {v}
                    </span>
                  ))}
                </div>
              </div>
            </Reveal>

            <Reveal delay={0.1}>
              <IlustracionAsistente className="mx-auto -mb-3 w-full max-w-[430px]" />
              <ChatDemo reduce={!!reduce} />
            </Reveal>
          </div>
        </section>

        {/* ── Cómo funciona ────────────────────────────────────────────────── */}
        <section id="flujo" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
          <Reveal>
            <p className="text-[12.5px] font-bold uppercase tracking-[0.15em]" style={{ color: BRAND_INK }}>
              Cómo funciona
            </p>
            <h2 className="mt-3 text-[28px] font-black leading-tight tracking-tight sm:text-[36px]">
              De la detección a la adjudicación
            </h2>
          </Reveal>

          <div className="relative mt-12">
            <div aria-hidden="true"
              className="absolute left-[27px] top-4 bottom-4 w-px bg-zinc-200 md:left-0 md:right-0 md:top-[27px] md:bottom-auto md:h-px md:w-auto" />
            <ol className="grid gap-8 md:grid-cols-5 md:gap-4">
              {PASOS.map((p, i) => (
                <Reveal key={p.t} delay={Math.min(i * 0.07, 0.3)}>
                  <li className="relative flex gap-5 md:block">
                    <span className="relative z-10 grid h-[54px] w-[54px] shrink-0 place-items-center rounded-2xl border border-zinc-200 bg-white shadow-sm">
                      <p.icon size={21} strokeWidth={1.9} className="text-zinc-700" />
                    </span>
                    <div className="pt-1 md:pt-5">
                      <p className="font-mono text-[11.5px] font-semibold text-zinc-400">Paso {i + 1}</p>
                      <h3 className="mt-0.5 text-[15.5px] font-bold tracking-tight">{p.t}</h3>
                      <p className="mt-1.5 max-w-[16rem] text-[13px] leading-relaxed text-zinc-500">{p.d}</p>
                    </div>
                  </li>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        {/* ── Roles ────────────────────────────────────────────────────────── */}
        <section id="roles" className="border-t border-zinc-200 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
            <Reveal>
              <p className="text-[12.5px] font-bold uppercase tracking-[0.15em]" style={{ color: BRAND_INK }}>
                Acceso por perfil
              </p>
              <h2 className="mt-3 max-w-2xl text-[28px] font-black leading-tight tracking-tight sm:text-[36px]">
                Cada quien ve exactamente lo que le corresponde
              </h2>
            </Reveal>
            <div className="mt-11 grid gap-4 sm:grid-cols-3">
              {ROLES.map((r, i) => (
                <Reveal key={r.t} delay={i * 0.07} className="h-full">
                  <div className="h-full rounded-2xl border border-zinc-200 bg-[#fafafa] p-6 transition-shadow hover:shadow-[0_12px_30px_-18px_rgba(24,24,27,0.25)] sm:p-7">
                    <span className="grid h-10 w-10 place-items-center rounded-lg border border-zinc-200 bg-white" style={{ color: BRAND_INK }}>
                      <r.icon size={19} strokeWidth={1.9} />
                    </span>
                    <h3 className="mt-5 text-[16px] font-bold tracking-tight">{r.t}</h3>
                    <p className="mt-2 text-[13.5px] leading-relaxed text-zinc-500">{r.d}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA final ────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <Reveal>
            <div className="relative overflow-hidden rounded-3xl bg-zinc-900 px-8 py-16 text-center sm:px-14">
              <div aria-hidden="true" className="pointer-events-none absolute -top-32 left-1/2 h-64 w-[560px] -translate-x-1/2 rounded-full opacity-25 blur-3xl"
                style={{ background: BRAND }} />
              <div className="relative">
                <LicitankIcon size={44} />
                <h2 className="mx-auto mt-6 max-w-xl text-[28px] font-black leading-tight tracking-tight text-white sm:text-[36px]">
                  Todo listo para trabajar
                </h2>
                <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-zinc-400">
                  Ingresa con tu cuenta del equipo y retoma el radar, tus negocios
                  y los análisis donde los dejaste.
                </p>
                <Link href={cta.href}
                  className="group mt-8 inline-flex items-center gap-2 rounded-xl px-6 py-3.5 text-[15px] font-bold text-zinc-900 transition-transform hover:-translate-y-0.5"
                  style={{ background: BRAND }}>
                  <cta.icon size={17} />
                  {cta.label}
                  <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
                </Link>
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="border-t border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-5 px-4 py-9 sm:flex-row sm:px-6">
          <div className="flex items-center gap-2.5">
            <LicitankIcon size={26} />
            <div>
              <p className="text-[13.5px] font-black leading-none tracking-tight">LICITANK</p>
              <p className="mt-1 text-[11.5px] text-zinc-400">Inteligencia de licitaciones públicas</p>
            </div>
          </div>
          <div className="flex items-center gap-6 text-[13px] text-zinc-500">
            <a href="#producto" className="transition-colors hover:text-zinc-900">Producto</a>
            <a href="#asistente" className="transition-colors hover:text-zinc-900">Asistente IA</a>
            <a href="#flujo" className="transition-colors hover:text-zinc-900">Cómo funciona</a>
            <Link href="/login" className="font-semibold transition-colors hover:opacity-80" style={{ color: BRAND_INK }}>
              Iniciar sesión
            </Link>
          </div>
        </div>
        <div className="border-t border-zinc-100">
          <p className="mx-auto max-w-6xl px-4 py-5 text-[11.5px] leading-relaxed text-zinc-400 sm:px-6">
            © {new Date().getFullYear()} LICITANK · Los datos provienen de la API oficial de Mercado
            Público (ChileCompra). Esta herramienta no está afiliada ni respaldada por dichas entidades.
          </p>
        </div>
      </footer>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Mockup del producto: radar + panel de viabilidad.
   Filas y panel con licitaciones REALES del set de validación de la plataforma.
──────────────────────────────────────────────────────────────────────────── */

function AppPreview({ reduce }: { reduce: boolean }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05),0_24px_60px_-24px_rgba(24,24,27,0.22)]">
      {/* Barra de ventana */}
      <div className="flex items-center gap-3 border-b border-zinc-100 bg-zinc-50/70 px-4 py-2.5">
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-200" />
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-200" />
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-200" />
        </div>
        <div className="mx-auto flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1 text-[11.5px] text-zinc-400">
          <Lock size={10} />
          licitank · radar
        </div>
        <span className="w-[52px]" aria-hidden="true" />
      </div>

      {/* Encabezado de la app */}
      <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-5">
          <span className="flex items-center gap-2">
            <LicitankIcon size={22} />
            <span className="hidden text-[13px] font-black tracking-tight sm:inline">LICITANK</span>
          </span>
          <nav className="hidden items-center gap-1 text-[12.5px] font-medium text-zinc-500 md:flex">
            <span className="rounded-md bg-zinc-100 px-2.5 py-1 font-semibold text-zinc-900">Radar</span>
            <span className="px-2.5 py-1">Negocios</span>
            <span className="px-2.5 py-1">Postuladas</span>
            <span className="px-2.5 py-1">Análisis</span>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-2 rounded-lg border border-zinc-200 px-3 py-1.5 text-[12px] text-zinc-400 sm:flex">
            <Search size={13} />
            Buscar licitación…
          </span>
          <span className="relative text-zinc-400">
            <Bell size={17} />
            <span className="absolute -right-0.5 -top-0.5 grid h-3.5 w-3.5 place-items-center rounded-full text-[9px] font-bold text-white" style={{ background: BRAND_INK }}>3</span>
          </span>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1.65fr_1fr]">
        {/* Tabla del radar */}
        <div className="border-b border-zinc-100 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between px-4 pb-1 pt-4 sm:px-6">
            <p className="text-[13px] font-bold tracking-tight">Oportunidades de hoy</p>
            <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-zinc-400">
              <span className={`h-1.5 w-1.5 rounded-full ${reduce ? '' : 'animate-pulse'}`} style={{ background: BRAND }} />
              Radar activo
            </span>
          </div>
          <div className="px-2 pb-4 pt-2 sm:px-3">
            {FILAS.map(f => (
              <div key={f.codigo}
                className={`flex items-center gap-3 rounded-xl px-3 py-3 transition-colors sm:gap-4 ${f.activa ? 'bg-[#2FC7A6]/[0.07] ring-1 ring-inset ring-[#2FC7A6]/25' : 'hover:bg-zinc-50'}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] font-semibold text-zinc-400">{f.codigo}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      f.estado === 'Asignada' ? 'bg-[#2FC7A6]/15 text-[#0e8f72]'
                      : f.estado === 'Prefiltro' ? 'bg-zinc-100 text-zinc-500'
                      : 'bg-amber-100/80 text-amber-700'}`}>
                      {f.estado}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[13px] font-semibold text-zinc-800">{f.nombre}</p>
                  <p className="truncate text-[11.5px] text-zinc-400">{f.org} · {f.region} · {f.cierre}</p>
                </div>
                <div className="w-[84px] shrink-0 text-right">
                  <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold ${
                    f.tono === 'ok' ? 'bg-[#2FC7A6]/15 text-[#0e8f72]' : 'bg-amber-100/80 text-amber-700'}`}>
                    {f.tono === 'ok' ? <Check size={11} strokeWidth={3} /> : null}
                    {f.score}/100
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Panel de viabilidad — datos reales de 2467-70-LE26 */}
        <aside className="bg-zinc-50/50 p-4 sm:p-6">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-bold tracking-tight">Viabilidad IA</p>
            <span className="font-mono text-[11px] text-zinc-400">2467-70-LE26</span>
          </div>

          <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-4">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Veredicto</p>
                <p className="mt-1 text-[22px] font-black leading-none" style={{ color: BRAND_INK }}>GANABLE</p>
              </div>
              <p className="font-mono text-[26px] font-bold leading-none text-zinc-900">65<span className="text-[13px] text-zinc-400">/100</span></p>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-100">
              <div className="h-full rounded-full" style={{ width: '65%', background: BRAND }} />
            </div>
          </div>

          <div className="mt-3 space-y-2">
            {[
              { k: 'Presupuesto', v: '$24.741.860' },
              { k: 'Modalidad de oferta', v: 'Por línea · 65 ítems' },
              { k: 'Criterios de evaluación', v: '5 · suman 100%' },
              { k: 'Documentos leídos', v: '6 de 6' },
            ].map(c => (
              <div key={c.k} className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-3 py-2.5">
                <p className="text-[12px] text-zinc-400">{c.k}</p>
                <p className="text-[12.5px] font-semibold text-zinc-800">{c.v}</p>
              </div>
            ))}
          </div>

          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-zinc-400">
            <Sparkles size={11} style={{ color: BRAND_INK }} />
            Cada dato cita su documento, artículo y página.
          </p>
        </aside>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Demo del asistente: conversación real (caso 1549-58-LE26 del set de
   validación: el Anexo N°10 sugería un total único, pero el Art. 21 adjudica
   por línea). Se anima por pasos al entrar en pantalla.
──────────────────────────────────────────────────────────────────────────── */

function ChatDemo({ reduce }: { reduce: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-90px' });
  const [paso, setPaso] = useState(reduce ? 3 : 0);

  useEffect(() => {
    if (!inView || reduce) return;
    const timers = [
      setTimeout(() => setPaso(1), 500),   // pregunta
      setTimeout(() => setPaso(2), 1300),  // escribiendo…
      setTimeout(() => setPaso(3), 2600),  // respuesta + cita
    ];
    return () => timers.forEach(clearTimeout);
  }, [inView, reduce]);

  return (
    <div ref={ref} className="rounded-2xl border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05),0_20px_50px_-24px_rgba(24,24,27,0.25)]">
      {/* Encabezado del chat */}
      <div className="flex items-center gap-3 border-b border-zinc-100 px-5 py-3.5">
        <span className="grid h-9 w-9 place-items-center rounded-xl border border-zinc-200 bg-white">
          <LicitankIcon size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold leading-tight">Asistente de la licitación</p>
          <p className="truncate font-mono text-[11px] text-zinc-400">1549-58-LE26 · Hospital San José</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#2FC7A6]/10 px-2.5 py-1 text-[10.5px] font-bold" style={{ color: BRAND_INK }}>
          <MessageCircle size={11} />
          Con las bases leídas
        </span>
      </div>

      <div className="space-y-4 px-5 py-5">
        {/* Pregunta del usuario */}
        <motion.div
          initial={{ opacity: 0, y: reduce ? 0 : 10 }}
          animate={paso >= 1 ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.4 }}
          className="flex justify-end">
          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-zinc-900 px-4 py-2.5 text-[13.5px] leading-relaxed text-white">
            ¿La oferta se presenta por el total o por ítem?
          </div>
        </motion.div>

        {/* Indicador escribiendo… */}
        {paso === 2 && (
          <div className="flex">
            <div className="rounded-2xl rounded-bl-md border border-zinc-200 bg-zinc-50 px-4 py-3">
              <span className="lp-typing"><i /><i /><i /></span>
            </div>
          </div>
        )}

        {/* Respuesta con cita */}
        <motion.div
          initial={{ opacity: 0, y: reduce ? 0 : 10 }}
          animate={paso >= 3 ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.45 }}
          className={`flex ${paso >= 3 ? '' : 'pointer-events-none'}`}>
          <div className="max-w-[92%] space-y-2.5">
            <div className="rounded-2xl rounded-bl-md border border-zinc-200 bg-zinc-50 px-4 py-3 text-[13.5px] leading-relaxed text-zinc-700">
              <strong className="font-bold text-zinc-900">Por línea.</strong> El Art. 21 de las bases
              indica que se adjudica «por línea o por ítem», y el Anexo N°10 contempla ofertar
              a dos o más ítems por separado. El total al pie del anexo es solo referencial.
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-zinc-500">
                <FileSearch size={11} style={{ color: BRAND_INK }} />
                Bases administrativas · Art. 21
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-zinc-500">
                <FileSearch size={11} style={{ color: BRAND_INK }} />
                Anexo N°10 · oferta económica
              </span>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   CSS del radar (adaptado al tema claro) y del indicador de escritura
──────────────────────────────────────────────────────────────────────────── */

const radarCss = `
.lp-radar{ position:relative; width:100%; aspect-ratio:1; border-radius:9999px;
  background:radial-gradient(circle at 50% 50%, rgba(47,199,166,.07), rgba(47,199,166,.02) 55%, transparent 72%);
  border:1px solid rgba(24,24,27,.06); }
.lp-radar-rings{ position:absolute; inset:0; border-radius:9999px;
  background:
    radial-gradient(circle, transparent 0 22%, rgba(14,143,114,.18) 22.5% 23%, transparent 23.5%),
    radial-gradient(circle, transparent 0 40%, rgba(14,143,114,.15) 40.5% 41%, transparent 41.5%),
    radial-gradient(circle, transparent 0 62%, rgba(14,143,114,.12) 62.5% 63%, transparent 63.5%),
    radial-gradient(circle, transparent 0 84%, rgba(14,143,114,.10) 84.5% 85%, transparent 85.5%); }
.lp-radar-rings::before,.lp-radar-rings::after{ content:""; position:absolute; background:rgba(14,143,114,.10); }
.lp-radar-rings::before{ left:50%; top:6%; bottom:6%; width:1px; transform:translateX(-50%); }
.lp-radar-rings::after{ top:50%; left:6%; right:6%; height:1px; transform:translateY(-50%); }
.lp-radar-sweep{ position:absolute; inset:0; border-radius:9999px;
  background:conic-gradient(from 0deg, rgba(47,199,166,.30), rgba(47,199,166,0) 52%, rgba(47,199,166,0)); }

.lp-blip{ position:absolute; width:9px; height:9px; border-radius:9999px; background:#2FC7A6;
  box-shadow:0 0 0 0 rgba(47,199,166,.55); animation:lp-pulse 2.4s ease-out infinite; }
.lp-blip-d1{ animation-delay:.7s; }
.lp-blip-d2{ animation-delay:1.3s; background:#0e8f72; box-shadow:0 0 0 0 rgba(14,143,114,.5); }
.lp-blip-d3{ animation-delay:1.9s; width:7px; height:7px; opacity:.8; }
@keyframes lp-pulse{
  0%{ box-shadow:0 0 0 0 rgba(47,199,166,.45); }
  70%{ box-shadow:0 0 0 14px rgba(47,199,166,0); }
  100%{ box-shadow:0 0 0 0 rgba(47,199,166,0); } }

.lp-float{ background:rgba(255,255,255,.92); border:1px solid rgba(24,24,27,.09); border-radius:14px;
  padding:12px 14px; backdrop-filter:blur(8px);
  box-shadow:0 1px 2px rgba(0,0,0,.04), 0 18px 40px -18px rgba(24,24,27,.28); }

.lp-typing{ display:inline-flex; gap:4px; align-items:center; height:10px; }
.lp-typing i{ width:6px; height:6px; border-radius:9999px; background:#a1a1aa; display:inline-block;
  animation:lp-dot 1.2s ease-in-out infinite; }
.lp-typing i:nth-child(2){ animation-delay:.15s; }
.lp-typing i:nth-child(3){ animation-delay:.3s; }
@keyframes lp-dot{ 0%,60%,100%{ transform:translateY(0); opacity:.5; } 30%{ transform:translateY(-4px); opacity:1; } }

@media (prefers-reduced-motion: reduce){
  .lp-blip{ animation:none; }
  .lp-typing i{ animation:none; }
}
`;
