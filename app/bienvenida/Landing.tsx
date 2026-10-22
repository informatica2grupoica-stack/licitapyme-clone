'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Lenis from 'lenis';
import {
  animate, motion, useInView, useMotionValueEvent, useReducedMotion, useScroll, useSpring, useTransform,
  type MotionValue, type Variants,
} from 'framer-motion';
import { LicitankIcon } from '@/app/components/LicitankLogo';
import { MercadoPublicoMark } from '@/app/components/MercadoPublicoLogo';
import { useSession } from '@/app/lib/session-context';

/* Contacto comercial: se define en el entorno (NEXT_PUBLIC_CONTACTO_EMAIL). Sin él, el botón de demo no se muestra. */
const CONTACTO = process.env.NEXT_PUBLIC_CONTACTO_EMAIL;
const MAIL_DEMO = CONTACTO
  ? `mailto:${CONTACTO}?subject=${encodeURIComponent('Quiero una demo de LICITANK')}`
  : null;

const EASE = [0.2, 0.7, 0.2, 1] as [number, number, number, number];
const mono = { fontFamily: 'var(--font-geist-mono), ui-monospace, monospace' } as const;
const roboto = { fontFamily: 'var(--font-roboto), ui-sans-serif, system-ui, sans-serif' } as const;
const serif = { fontFamily: 'var(--font-roboto), ui-sans-serif, system-ui, sans-serif', fontWeight: 500 } as const; // títulos: Roboto medium

/* ── Movimiento ───────────────────────────────────────────────────────────── */

const item: Variants = {
  h: { opacity: 0, y: 12 },
  s: (d: number = 0) => ({ opacity: 1, y: 0, transition: { delay: 0.1 + d * 0.12, duration: 0.5, ease: EASE } }),
};

function Item({ d = 0, className = '', style, children }: { d?: number; className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  return <motion.div variants={item} custom={d} className={className} style={style}>{children}</motion.div>;
}

function Rise({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={className} initial={{ opacity: 0, y: reduce ? 0 : 26 }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-8% 0px' }} transition={{ duration: 0.65, delay, ease: EASE }}>
      {children}
    </motion.div>
  );
}

function Titular({ lineas, className = '', delay = 0 }: { lineas: string[]; className?: string; delay?: number }) {
  let k = 0;
  return (
    <h1 className={className} aria-label={lineas.join(' ')}>
      {lineas.map((l, li) => (
        <span key={li} className="block" aria-hidden="true">
          {l.split(' ').map(w => (
            <span key={k} className="inline-block overflow-hidden pb-[0.14em] align-bottom">
              <motion.span className="inline-block" initial={{ y: '110%' }} animate={{ y: 0 }}
                transition={{ duration: 0.8, delay: delay + 0.06 * k++, ease: EASE }}>
                {w}&nbsp;
              </motion.span>
            </span>
          ))}
        </span>
      ))}
    </h1>
  );
}

/** Número que sube de `a` a `b` cuando `go` es verdadero. */
function Cuenta({ a = 0, b, go, dur = 1.3, delay = 0 }: { a?: number; b: number; go: boolean; dur?: number; delay?: number }) {
  const [v, setV] = useState(a);
  useEffect(() => {
    if (!go) return;
    const c = animate(a, b, { duration: dur, delay, ease: 'easeOut', onUpdate: x => setV(Math.round(x)) });
    return () => c.stop();
  }, [go, a, b, dur, delay]);
  return <span className="tabular-nums">{v}</span>;
}

/* ── Piezas de interfaz ───────────────────────────────────────────────────── */

function Avatar({ nombre, tono }: { nombre: string; tono: 'teal' | 'slate' }) {
  const ini = nombre.split(' ').map(p => p[0]).slice(0, 2).join('');
  return (
    <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white ${tono === 'teal' ? 'bg-teal-700' : 'bg-slate-600'}`}>{ini}</span>
  );
}

function Ventana({ ruta, children }: { ruta: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-300 bg-white"
      style={{ boxShadow: '0 1px 2px rgba(15,23,42,.08), 0 18px 32px -24px rgba(15,23,42,.35)', ...roboto }}>
      <div className="flex items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden="true">
          {[0, 1, 2].map(i => <span key={i} className="h-2 w-2 rounded-full bg-slate-300" />)}
        </span>
        <span className="truncate text-xs text-slate-500" style={mono}>{ruta}</span>
      </div>
      {children}
    </div>
  );
}

function Dato({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] text-slate-500">{rotulo}</dt>
      <dd className="mt-0.5 text-xs font-medium text-slate-700">{children}</dd>
    </div>
  );
}

/* ── Hero: radar animado ──────────────────────────────────────────────────── */

const T_RADAR = 7; // segundos por vuelta
const BLIPS = [
  { a: 28, r: 64 }, { a: 96, r: 40 }, { a: 152, r: 78 }, { a: 204, r: 52 }, { a: 258, r: 70 }, { a: 312, r: 34 }, { a: 338, r: 82 },
];

function Radar() {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[470px]">
      {[100, 74, 48, 22].map(p => (
        <span key={p} aria-hidden className="absolute rounded-full border border-white/10" style={{ inset: `${(100 - p) / 2}%` }} />
      ))}
      <span aria-hidden className="absolute left-1/2 top-0 h-full w-px bg-white/[.07]" />
      <span aria-hidden className="absolute left-0 top-1/2 h-px w-full bg-white/[.07]" />
      <span aria-hidden className="lk-sweep absolute inset-0 rounded-full" style={{ animationDuration: `${T_RADAR}s` }} />
      <span aria-hidden className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-teal-300" />
      {BLIPS.map(b => {
        const rad = (b.a * Math.PI) / 180;
        return (
          <span key={b.a} aria-hidden className="lk-blip absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-teal-300"
            style={{
              left: `${50 + (b.r / 100) * 50 * Math.sin(rad)}%`, top: `${50 - (b.r / 100) * 50 * Math.cos(rad)}%`,
              animationDuration: `${T_RADAR}s`, animationDelay: `${(((b.a - 60 + 360) % 360) / 360) * T_RADAR}s`,
            }} />
        );
      })}

      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.4, duration: 0.7, ease: EASE }}
        className="absolute -right-2 top-[6%] hidden w-[230px] sm:block lg:-right-14">
        <div className="lk-flota flex items-start gap-3" style={roboto}>
          <span aria-hidden className="mt-[9px] h-px w-10 shrink-0 bg-white/40" />
          <div>
            <p className="text-[11px] text-slate-400">Nueva coincidencia</p>
            <p className="mt-1 text-[13px] font-medium leading-snug text-white">MOBILIARIO ESCOLAR PARA ESTABLECIMIENTOS</p>
            <p className="mt-0.5 text-xs text-slate-400">I. Municipalidad de Temuco</p>
            <p className="mt-2 text-xs font-medium text-red-400">Cierra mañana, 15:00</p>
          </div>
        </div>
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2.1, duration: 0.7, ease: EASE }}
        className="absolute -left-2 bottom-[8%] hidden w-[220px] sm:block lg:-left-14">
        <div className="lk-flota flex items-start justify-end gap-3 text-right" style={{ ...roboto, animationDelay: '-2s' }}>
          <div>
            <p className="text-[11px] text-slate-400">Asignada a</p>
            <p className="mt-1 flex items-center justify-end gap-2 text-[13px] font-medium text-white">Diego Rojas<Avatar nombre="Diego Rojas" tono="slate" /></p>
            <p className="mt-1 text-xs text-slate-400">Materiales eléctricos · Talca</p>
          </div>
          <span aria-hidden className="mt-[9px] h-px w-10 shrink-0 bg-white/40" />
        </div>
      </motion.div>
    </div>
  );
}

const PALABRAS = ['mobiliario escolar', 'materiales eléctricos', 'equipos computacionales', 'insumos médicos', 'vestuario institucional', 'servicios de aseo', 'útiles de oficina', 'mantención de edificios', 'alimentación', 'maquinaria'];

function Cinta() {
  const fila = [...PALABRAS, ...PALABRAS];
  return (
    <div className="border-y border-white/10 py-5" style={{ maskImage: 'linear-gradient(to right, transparent, #000 12%, #000 88%, transparent)', WebkitMaskImage: 'linear-gradient(to right, transparent, #000 12%, #000 88%, transparent)' }}>
      <div className="lk-cinta flex w-max gap-10 whitespace-nowrap text-[15px] text-slate-400">
        {fila.map((p, i) => (
          <span key={i} className="flex items-center gap-10">
            {p}
            <span aria-hidden className="h-1 w-1 rounded-full bg-teal-500/70" />
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Texto que se ilumina al hacer scroll ─────────────────────────────────── */

function Palabra({ w, p, i, n }: { w: string; p: MotionValue<number>; i: number; n: number }) {
  const o = useTransform(p, [i / n, (i + 1) / n], [0.16, 1]);
  return <motion.span style={{ opacity: o }}>{w} </motion.span>;
}

const RELATO = 'Cada día aparecen licitaciones nuevas en Mercado Público. Revisarlas a mano toma horas, y la que no viste ya cerró. LICITANK las busca por ti, las ordena por fecha de cierre y deja a una persona a cargo de cada una.';

function Relato() {
  const ref = useRef<HTMLParagraphElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 0.85', 'end 0.45'] });
  const ws = RELATO.split(' ');
  return (
    <section className="mx-auto max-w-[1200px] px-5 py-28 sm:px-8 sm:py-40">
      <p ref={ref} style={serif} className="max-w-[980px] text-[30px] leading-[1.2] tracking-[-0.015em] text-white sm:text-[50px]">
        {ws.map((w, i) => <Palabra key={i} w={w} p={scrollYProgress} i={i} n={ws.length} />)}
      </p>
    </section>
  );
}

/* ── Smooth scroll (lenis) ────────────────────────────────────────────────── */

let lenisGlobal: Lenis | null = null;

function useSmoothScroll() {
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) return;
    const lenis = new Lenis({ lerp: 0.085, anchors: { offset: -64 } });
    lenisGlobal = lenis;
    let raf = 0;
    const loop = (t: number) => { lenis.raf(t); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); lenis.destroy(); lenisGlobal = null; };
  }, [reduce]);
}

/* ── Recorrido fijado al scroll: cada paso se anima al aparecer ───────────── */

const PASOS = [
  { n: '01', t: 'Detectar', d: 'El radar revisa Mercado Público todos los días con tus palabras clave, tus rubros y tus regiones. Lo nuevo aparece ordenado por fecha de cierre.' },
  { n: '02', t: 'Asignar', d: 'Cada licitación se asigna a una persona del equipo con un clic. Quien la recibe la ve en su lista de negocios, con el cierre a la vista.' },
  { n: '03', t: 'Seguir', d: 'El negocio avanza por etapas, con comentarios e historial. Cuando Mercado Público adjudica, queda como ganado o perdido.' },
];

function PanelDetectar({ go }: { go: boolean }) {
  const kws = ['mobiliario escolar', 'materiales eléctricos', 'equipos computacionales'];
  return (
    <Ventana ruta="radar / configuración">
      <div className="p-5">
        <p className="text-[11px] text-slate-500">Palabras clave</p>
        <ul className="mt-2 divide-y divide-slate-100">
          {kws.map((k, i) => (
            <Item key={k} d={i} className="flex items-center justify-between py-2.5 text-[13px] font-medium text-slate-800">
              {k}
              <span className="text-xs font-normal text-slate-500"><b className="font-bold tabular-nums text-slate-900"><Cuenta b={[6, 5, 3][i]} go={go} delay={0.5 + i * 0.25} /></b> nuevas</span>
            </Item>
          ))}
        </ul>
        <dl className="mt-3 grid grid-cols-2 gap-4">
          <Dato rotulo="Regiones">Araucanía · Maule · Biobío</Dato>
          <Dato rotulo="Revisión">Todos los días</Dato>
        </dl>
      </div>
      <div className="flex items-baseline justify-between border-t border-slate-200 bg-slate-50 px-5 py-4">
        <p className="text-xs text-slate-500">Licitaciones nuevas hoy</p>
        <p className="text-3xl font-bold text-slate-900"><Cuenta b={14} go={go} delay={0.4} dur={1.5} /></p>
      </div>
    </Ventana>
  );
}

function PanelAsignar({ go }: { go: boolean }) {
  const gente: { n: string; tono: 'teal' | 'slate'; act: number }[] = [
    { n: 'María Fuentes', tono: 'teal', act: 6 },
    { n: 'Diego Rojas', tono: 'slate', act: 4 },
  ];
  return (
    <Ventana ruta="negocios / asignación">
      <div className="p-5">
        <p className="text-[11px] text-slate-500">Licitación por asignar</p>
        <p className="mt-0.5 text-[13px] font-medium text-slate-900">MATERIALES ELÉCTRICOS PARA MANTENCIÓN</p>
        <ul className="relative mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
          {gente.map((g, i) => (
            <li key={g.n} className="relative flex items-center gap-3 px-4 py-3.5">
              <Avatar nombre={g.n} tono={g.tono} />
              <span className="text-[13px] font-medium text-slate-800">{g.n}</span>
              {i === 1 && (
                <motion.span initial={{ opacity: 0, scale: 0.8 }} animate={go ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.8 }}
                  transition={{ delay: 1.2, type: 'spring', stiffness: 360, damping: 22 }}
                  className="text-xs font-medium text-teal-700">+ Recibió esta licitación</motion.span>
              )}
              <dl className="ml-auto">
                <Dato rotulo="Negocios activos">
                  <span className="text-[15px] font-bold tabular-nums">{i === 1 ? <Cuenta a={g.act} b={g.act + 1} go={go} dur={0.4} delay={1.25} /> : g.act}</span>
                </Dato>
              </dl>
            </li>
          ))}
          <motion.span aria-hidden initial={{ opacity: 0 }} animate={go ? { opacity: [0, 1, 1, 0], y: [-44, -44, 38, 38] } : { opacity: 0 }}
            transition={{ duration: 1.3, delay: 0.3, times: [0, 0.15, 0.75, 1], ease: 'easeInOut' }}
            className="pointer-events-none absolute left-4 right-4 top-0 rounded-lg border border-teal-700/40 bg-teal-50 px-3 py-2 text-xs font-medium text-teal-900 shadow-md">
            1234-71-LE26 → Diego Rojas
          </motion.span>
        </ul>
      </div>
    </Ventana>
  );
}

function PanelSeguir({ go }: { go: boolean }) {
  const hitos: [string, string, string][] = [
    ['Asignado', '#64748b', 'Diego Rojas recibe la licitación.'],
    ['En proceso', '#0d9488', 'Se trabaja la postulación; el equipo comenta en el negocio.'],
    ['Postulada', '#16a34a', 'Se marca como postulada y queda a la espera del resultado.'],
    ['Ganada o perdida', '#16a34a', 'El resultado se detecta desde Mercado Público.'],
  ];
  return (
    <Ventana ruta="negocios / seguimiento">
      <ol className="p-5">
        {hitos.map(([t, col, d], i) => (
          <li key={t} className="relative flex gap-4 pb-6 last:pb-0">
            {i < hitos.length - 1 && (
              <motion.span aria-hidden className="absolute left-[4px] top-4 h-[calc(100%-8px)] w-px origin-top bg-slate-300"
                initial={{ scaleY: 0 }} animate={go ? { scaleY: 1 } : { scaleY: 0 }} transition={{ delay: 0.3 + i * 0.5, duration: 0.45, ease: 'easeOut' }} />
            )}
            <motion.span aria-hidden className="relative mt-1.5 h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: col }}
              initial={{ scale: 0 }} animate={go ? { scale: 1 } : { scale: 0 }} transition={{ delay: 0.15 + i * 0.5, type: 'spring', stiffness: 420, damping: 18 }} />
            <motion.div initial={{ opacity: 0, x: -8 }} animate={go ? { opacity: 1, x: 0 } : { opacity: 0, x: -8 }} transition={{ delay: 0.2 + i * 0.5, duration: 0.4 }}>
              <p className="text-[13px] font-medium text-slate-900">{t}</p>
              <p className="text-xs text-slate-500">{d}</p>
            </motion.div>
          </li>
        ))}
      </ol>
    </Ventana>
  );
}

const PANELES = [PanelDetectar, PanelAsignar, PanelSeguir];

function Panel({ i, ver = false, go: forzado = true }: { i: number; ver?: boolean; go?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const visto = useInView(ref, { once: true, margin: '-60px' });
  const go = ver ? visto : forzado;
  const P = PANELES[i];
  return (
    <motion.div ref={ref} initial="h" animate={go ? 's' : 'h'}>
      <P go={go} />
    </motion.div>
  );
}

/** Peso 0→1→0 de un paso según el avance del scroll: las capas se mezclan, no se reemplazan. */
function usePeso(p: MotionValue<number>, i: number, n: number) {
  const a = i / n, b = (i + 1) / n, m = 0.05;
  const entrada = i === 0 ? [0, b - m, b + m] : i === n - 1 ? [a - m, a + m, 1] : [a - m, a + m, b - m, b + m];
  const salida = i === 0 ? [1, 1, 0] : i === n - 1 ? [0, 1, 1] : [0, 1, 1, 0];
  return useTransform(p, entrada, salida);
}

function CapaPaso({ p, i, n, activo, ir }: { p: MotionValue<number>; i: number; n: number; activo: boolean; ir: (i: number) => void }) {
  const o = usePeso(p, i, n);
  const opTitulo = useTransform(o, [0, 1], [0.28, 1]);
  const x = useTransform(o, [0, 1], [0, 10]);
  const e = PASOS[i];
  return (
    <button onClick={() => ir(i)} className="block w-full cursor-pointer py-3 text-left" aria-label={`Ver ${e.t}`} aria-current={activo}>
      <motion.div className="flex items-baseline gap-4" style={{ opacity: opTitulo, x }}>
        <span className="text-xs text-teal-700" style={mono}>{e.n}</span>
        <span style={serif} className="text-[42px] leading-none tracking-[-0.015em] xl:text-[56px]">{e.t}</span>
      </motion.div>
    </button>
  );
}

function CapaTexto({ p, i, n }: { p: MotionValue<number>; i: number; n: number }) {
  const peso = usePeso(p, i, n);
  const o = useTransform(peso, [0, 0.55, 1], [0, 0, 1]);
  const y = useTransform(peso, [0, 1], [12, 0]);
  return (
    <motion.p style={{ opacity: o, y }} className="absolute inset-x-0 top-0 max-w-[410px] pl-[38px] text-[15px] leading-[1.6] text-slate-600">
      {PASOS[i].d}
    </motion.p>
  );
}

function CapaPanel({ p, i, n, go }: { p: MotionValue<number>; i: number; n: number; go: boolean }) {
  const peso = usePeso(p, i, n);
  const o = useTransform(peso, [0, 0.55, 1], [0, 0, 1]);
  const y = useTransform(peso, [0, 1], [26, 0]);
  const escala = useTransform(peso, [0, 1], [0.985, 1]);
  return (
    <motion.div style={{ opacity: o, y, scale: escala }} className="absolute inset-0 flex items-center will-change-transform">
      <div className="w-full"><Panel i={i} go={go} /></div>
    </motion.div>
  );
}

/** Fondo del recorrido: logo grande y desenfocado con anillos de radar, que se mueve apenas con el scroll. */
function FondoRecorrido({ p }: { p: MotionValue<number> }) {
  const giro = useTransform(p, [0, 1], [-14, 14]);
  const sube = useTransform(p, [0, 1], [50, -50]);
  const giroChico = useTransform(p, [0, 1], [12, -12]);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <motion.div className="absolute right-[-200px] top-1/2 -mt-[380px]" style={{ rotate: giro, y: sube, filter: 'blur(2.5px)', opacity: 0.13 }}>
        <LicitankIcon size={760} />
      </motion.div>
      {[980, 700, 430].map(s => (
        <span key={s} className="absolute rounded-full border border-slate-300/60" style={{ width: s, height: s, right: 180 - s / 2, top: `calc(50% - ${s / 2}px)` }} />
      ))}
      <motion.div className="absolute bottom-[-90px] left-[-70px]" style={{ rotate: giroChico, filter: 'blur(6px)', opacity: 0.09 }}>
        <LicitankIcon size={300} />
      </motion.div>
    </div>
  );
}

function Recorrido() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const [act, setAct] = useState(0);
  useMotionValueEvent(scrollYProgress, 'change', p => setAct(Math.min(PASOS.length - 1, Math.max(0, Math.floor(p * PASOS.length * 0.999)))));
  const riel = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.4 });
  const n = PASOS.length;

  const ir = (i: number) => {
    const el = ref.current;
    if (!el) return;
    const top = el.offsetTop + ((el.offsetHeight - window.innerHeight) * (i + 0.5)) / n;
    if (lenisGlobal) lenisGlobal.scrollTo(top, { duration: 1.2 });
    else window.scrollTo({ top, behavior: 'smooth' });
  };

  return (
    <section id="recorrido" className="bg-slate-50 text-slate-900">
      <div ref={ref} className="relative hidden lg:block" style={{ height: `${n * 60 + 40}vh` }}>
        <div className="sticky top-0 flex h-screen items-center overflow-hidden">
          <FondoRecorrido p={scrollYProgress} />
          <div className="relative mx-auto grid w-full max-w-[1200px] grid-cols-[.85fr_1.15fr] items-center gap-16 px-8 pt-16">
            <div>
              <div className="relative pl-7">
                <div className="absolute bottom-1 left-0 top-1 w-px bg-slate-300" />
                <motion.div className="absolute left-0 top-1 w-px origin-top bg-teal-600" style={{ height: 'calc(100% - 8px)', scaleY: riel }} />
                {PASOS.map((_, i) => <CapaPaso key={i} p={scrollYProgress} i={i} n={n} activo={i === act} ir={ir} />)}
              </div>
              <div className="relative mt-5 h-[120px] pl-7">
                {PASOS.map((_, i) => <CapaTexto key={i} p={scrollYProgress} i={i} n={n} />)}
              </div>
            </div>
            <div className="relative h-[430px]">
              {PASOS.map((_, i) => <CapaPanel key={i} p={scrollYProgress} i={i} n={n} go={act >= i} />)}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[640px] px-5 py-20 lg:hidden">
        {PASOS.map((e, i) => (
          <div key={e.n} className="mt-14 first:mt-0">
            <p className="text-xs text-teal-700" style={mono}>{e.n}</p>
            <h3 style={serif} className="mt-2 text-[38px] tracking-[-0.015em]">{e.t}</h3>
            <p className="mb-6 mt-3 text-[15px] leading-[1.6] text-slate-600">{e.d}</p>
            <Panel i={i} ver />
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── Qué incluye: lista editorial, una animación propia en cada fila ──────── */

function Fila({ n, t, d, children }: { n: string; t: string; d: string; children: React.ReactNode }) {
  return (
    <Rise>
      <div className="grid gap-6 border-t border-slate-300 py-9 md:grid-cols-[1fr_1.1fr] md:gap-12 lg:grid-cols-[1.05fr_1.2fr]">
        <div>
          <p className="text-xs text-slate-400" style={mono}>{n}</p>
          <h3 style={serif} className="mt-2 text-[28px] leading-[1.1] tracking-[-0.01em]">{t}</h3>
          <p className="mt-3 max-w-[400px] text-[15px] leading-[1.6] text-slate-600">{d}</p>
        </div>
        <div className="min-h-[96px] self-center">{children}</div>
      </div>
    </Rise>
  );
}

function Cuadricula() {
  const kws: [string, number][] = [['mobiliario escolar', 6], ['materiales eléctricos', 5], ['equipos computacionales', 3], ['insumos médicos', 2]];
  const pasos = ['Asignado', 'En proceso', 'Postulada', 'Ganada'];
  const cols = ['#64748b', '#0d9488', '#16a34a', '#16a34a'];
  return (
    <div className="bg-white text-slate-900">
      <section id="incluye" className="mx-auto max-w-[1200px] px-5 py-24 sm:px-8 sm:py-32">
        <Rise>
          <h2 style={serif} className="max-w-[760px] text-[36px] leading-[1.06] tracking-[-0.02em] sm:text-[54px]">
            Lo necesario para no perder una licitación por desorden.
          </h2>
        </Rise>

        <div className="mt-16">
          <Fila n="01" t="Radar propio" d="Tus palabras clave, rubros y regiones. Lo que ya descartaste no vuelve a aparecer.">
            <ul>
              {kws.map(([k, n], i) => (
                <li key={k} className="flex items-center gap-4 py-2 text-[13px]">
                  <span className="w-[170px] shrink-0 font-medium text-slate-800">{k}</span>
                  <span className="h-[3px] flex-1 overflow-hidden bg-slate-200">
                    <motion.span className="block h-full origin-left bg-teal-700" initial={{ scaleX: 0 }} whileInView={{ scaleX: n / 6 }}
                      viewport={{ once: true }} transition={{ delay: 0.2 + i * 0.12, duration: 0.8, ease: EASE }} />
                  </span>
                  <span className="w-6 text-right text-xs font-bold tabular-nums text-slate-900">{n}</span>
                </li>
              ))}
            </ul>
          </Fila>

          <Fila n="02" t="Trabajo en equipo" d="Asigna licitaciones entre tus dos usuarios y mira la carga de cada uno.">
            <ul className="space-y-4">
              {([['María Fuentes', 'teal', 6], ['Diego Rojas', 'slate', 4]] as const).map(([n, tono, c], i) => (
                <li key={n}>
                  <div className="flex items-center gap-2.5 text-[13px] font-medium text-slate-800"><Avatar nombre={n} tono={tono} />{n}
                    <span className="ml-auto text-xs font-bold tabular-nums">{c}</span></div>
                  <span className="mt-2 block h-[3px] overflow-hidden bg-slate-200">
                    <motion.span className="block h-full origin-left bg-slate-600" initial={{ scaleX: 0 }} whileInView={{ scaleX: c / 8 }}
                      viewport={{ once: true }} transition={{ delay: 0.3 + i * 0.15, duration: 0.8, ease: EASE }} />
                  </span>
                </li>
              ))}
            </ul>
          </Fila>

          <Fila n="03" t="Negocios por etapa" d="Asignado, en proceso, postulada, ganada o perdida, con el cierre siempre a la vista.">
            <div className="relative pt-3">
              <span aria-hidden className="absolute left-[5px] right-[5px] top-[17px] h-px bg-slate-300" />
              <motion.span aria-hidden className="absolute left-[5px] right-[5px] top-[17px] h-px origin-left bg-teal-700" initial={{ scaleX: 0 }}
                whileInView={{ scaleX: 1 }} viewport={{ once: true }} transition={{ delay: 0.3, duration: 1.4, ease: 'easeInOut' }} />
              <div className="relative flex justify-between">
                {pasos.map((p, i) => (
                  <div key={p} className="flex flex-col items-center gap-2 text-center">
                    <motion.span className="h-[11px] w-[11px] rounded-full ring-4 ring-white" style={{ background: cols[i] }} initial={{ scale: 0 }}
                      whileInView={{ scale: 1 }} viewport={{ once: true }} transition={{ delay: 0.3 + i * 0.4, type: 'spring', stiffness: 400, damping: 18 }} />
                    <span className="text-xs text-slate-600">{p}</span>
                  </div>
                ))}
              </div>
            </div>
          </Fila>

          <Fila n="04" t="Comentarios" d="Cada negocio tiene su hilo de conversación para dejar acuerdos y pendientes.">
            <div className="space-y-3 text-xs">
              {[['María Fuentes', 'Falta la garantía de seriedad de la oferta.'], ['Diego Rojas', 'La subo hoy antes de las 15:00.']].map(([n, c], i) => (
                <motion.div key={n} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.3 + i * 0.7, duration: 0.5 }}>
                  <p className="text-[11px] text-slate-500">{n}</p>
                  <p className="mt-0.5 text-[13px] font-medium text-slate-800">{c}</p>
                </motion.div>
              ))}
            </div>
          </Fila>

          <Fila n="05" t="Historial" d="Quién asignó, quién cambió la etapa y cuándo. Nada se pierde entre personas.">
            <ul className="space-y-2.5 text-[13px] text-slate-700">
              {[['14:32', 'María asignó la licitación a Diego'], ['14:40', 'Diego pasó el negocio a En proceso'], ['15:05', 'Diego marcó el negocio como postulado']].map(([h, t], i) => (
                <motion.li key={h} className="flex gap-4" initial={{ opacity: 0, x: -10 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.2 + i * 0.35, duration: 0.45 }}>
                  <span className="w-10 shrink-0 text-slate-400 tabular-nums" style={mono}>{h}</span>{t}
                </motion.li>
              ))}
            </ul>
          </Fila>
          <div className="border-t border-slate-300" />
        </div>
      </section>
    </div>
  );
}

/* ── Landing ──────────────────────────────────────────────────────────────── */

export default function Landing() {
  useSmoothScroll();
  const { usuario } = useSession();
  const { scrollYProgress } = useScroll();
  const barra = useSpring(scrollYProgress, { stiffness: 140, damping: 28 });
  const cta = usuario
    ? { href: '/dashboard', label: 'Ir al panel' }
    : { href: '/login', label: 'Iniciar sesión' };

  const btnSolido = 'lk-btn group inline-flex items-center gap-2 rounded-md bg-teal-500 px-5 py-3 text-[14.5px] font-medium text-[#04201c] hover:bg-teal-400';
  const btnBorde = 'lk-btn inline-flex items-center gap-2 rounded-md border border-white/25 px-5 py-3 text-[14.5px] font-medium text-white hover:border-white/50';
  const flecha = <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>;

  return (
    <div className="min-h-screen bg-[#0a0d12] text-slate-200 antialiased">
      <style>{css}</style>

      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#0a0d12]/90">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-5 sm:px-8">
          <a href="#top" className="flex items-center gap-2.5">
            <LicitankIcon size={30} />
            <span className="text-[15px] font-bold tracking-tight text-white">LICITANK</span>
          </a>
          <nav className="hidden items-center gap-8 text-[14px] text-slate-400 md:flex">
            <a className="lk-nav" href="#recorrido">Cómo funciona</a>
            <a className="lk-nav" href="#incluye">Qué incluye</a>
            <a className="lk-nav" href="#plan">Plan</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href={cta.href} className="lk-btn inline-flex items-center rounded-md px-3 py-2 text-[13.5px] font-medium text-slate-300 hover:text-white">
              {cta.label}
            </Link>
            {MAIL_DEMO && (
              <a href={MAIL_DEMO} className="lk-btn hidden items-center rounded-md bg-teal-500 px-4 py-2 text-[13.5px] font-medium text-[#04201c] hover:bg-teal-400 sm:inline-flex">
                Solicitar demo
              </a>
            )}
          </div>
        </div>
        <motion.div className="absolute inset-x-0 bottom-[-1px] h-[2px] origin-left bg-teal-400" style={{ scaleX: barra }} />
      </header>

      <main id="top">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="relative mx-auto grid max-w-[1200px] items-center gap-14 px-5 pb-16 pt-14 sm:px-8 sm:pt-20 lg:grid-cols-[1.1fr_.9fr] lg:pb-24">
            <div>
              <div style={serif}>
                <Titular lineas={['Encuentra las', 'licitaciones que', 'sí son para ti.']} delay={0.1}
                  className="text-[48px] leading-[1] tracking-[-0.025em] text-white sm:text-[80px]" />
              </div>
              <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7, duration: 0.7, ease: EASE }}
                className="mt-7 max-w-[520px] text-[17px] leading-[1.6] text-slate-400 sm:text-[18px]">
                LICITANK vigila Mercado Público con tus palabras clave y te muestra lo nuevo cada día. Después asignas cada
                licitación a una persona de tu equipo y sigues el negocio hasta el resultado.
              </motion.p>
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.85, duration: 0.7, ease: EASE }}
                className="mt-9 flex flex-wrap items-center gap-3">
                {MAIL_DEMO ? (
                  <a href={MAIL_DEMO} className={btnSolido}>Solicitar demo {flecha}</a>
                ) : (
                  <Link href={cta.href} className={btnSolido}>{cta.label} {flecha}</Link>
                )}
                <a href="#recorrido" className={btnBorde}>Ver cómo funciona</a>
              </motion.div>
              <motion.dl initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1, duration: 0.8 }} className="mt-12 grid max-w-[520px] grid-cols-3 gap-6 border-t border-white/10 pt-6">
                {[['Fuente', 'Mercado Público'], ['Revisión', 'Todos los días'], ['Equipo', '2 usuarios']].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[11px] text-slate-500">{k}</dt>
                    <dd className="mt-1 text-[13px] font-medium text-slate-200">{v}</dd>
                  </div>
                ))}
              </motion.dl>
            </div>
            <Radar />
          </div>
          <Cinta />
        </section>

        <Relato />

        <Recorrido />

        <Cuadricula />

        {/* Plan */}
        <section id="plan" className="border-y border-white/10 bg-[#0a0d12]">
          <div className="mx-auto grid max-w-[1200px] gap-12 px-5 py-24 sm:px-8 sm:py-32 lg:grid-cols-[.9fr_1.1fr] lg:gap-24">
            <Rise>
              <h2 style={serif} className="text-[36px] leading-[1.06] tracking-[-0.02em] text-white sm:text-[52px]">
                Un plan para un equipo de dos.
              </h2>
              <p className="mt-5 max-w-[440px] text-[16px] leading-[1.6] text-slate-400">
                Cada empresa tiene su propio radar y sus propios negocios. Nadie más ve lo que tú gestionas.
              </p>
              <p className="mt-4 max-w-[440px] text-[16px] leading-[1.6] text-slate-400">
                Hoy el plan cubre Radar y Negocios. Más adelante se suman módulos para analizar bases con inteligencia
                artificial, preparar anexos y gestionar compras.
              </p>
            </Rise>
            <Rise delay={0.08}>
              <dl>
                <div className="flex items-baseline justify-between border-t border-white/15 py-5">
                  <dt className="text-[13px] text-slate-400">Usuarios incluidos</dt>
                  <dd className="text-5xl font-bold tabular-nums text-white">2</dd>
                </div>
                <div className="flex items-baseline justify-between border-t border-white/15 py-5">
                  <dt className="text-[13px] text-slate-400">Usuarios adicionales</dt>
                  <dd className="text-[15px] font-medium text-slate-200">Consúltanos</dd>
                </div>
                {[['Radar', 'Palabras clave, rubros y regiones propios'], ['Negocios', 'Asignación entre tus dos usuarios, con etapas, comentarios e historial'], ['Resultados', 'Seguimiento del resultado desde Mercado Público'], ['Soporte', 'Por ticket']].map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-8 border-t border-white/15 py-5">
                    <dt className="text-[13px] text-slate-400">{k}</dt>
                    <dd className="max-w-[340px] text-right text-[14.5px] text-slate-200">{v}</dd>
                  </div>
                ))}
                <div className="border-t border-white/15" />
              </dl>
              {MAIL_DEMO && <a href={MAIL_DEMO} className={`${btnSolido} mt-8`}>Solicitar demo {flecha}</a>}
            </Rise>
          </div>
        </section>

        {/* Cierre */}
        <section className="relative overflow-hidden">
          <span aria-hidden className="lk-sweep absolute left-1/2 top-1/2 h-[900px] w-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-25" style={{ animationDuration: '14s' }} />
          {[860, 600, 340].map(s => (
            <span key={s} aria-hidden className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[.07]" style={{ width: s, height: s }} />
          ))}
          <div className="relative mx-auto max-w-[1200px] px-5 py-32 text-center sm:px-8 sm:py-44">
            <Rise>
              <h2 style={serif} className="mx-auto max-w-[800px] text-[38px] leading-[1.04] tracking-[-0.025em] text-white sm:text-[66px]">
                Que ninguna licitación se pase por no haberla visto.
              </h2>
              <p className="mt-5 text-[16px] text-slate-400">
                {usuario ? 'Tu sesión está iniciada.' : 'Si ya tienes cuenta, ingresa y sigue donde quedaste.'}
              </p>
              <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
                <Link href={cta.href} className={btnSolido}>{cta.label} {flecha}</Link>
                {MAIL_DEMO && <a href={MAIL_DEMO} className={btnBorde}>Solicitar demo</a>}
              </div>
            </Rise>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-5 px-5 py-8 text-[12.5px] text-slate-400 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span className="flex items-center gap-2.5">
            <LicitankIcon size={22} />
            <span className="font-bold text-white">LICITANK</span>
            <span>© {new Date().getFullYear()}</span>
          </span>
          <span className="flex items-center gap-3">
            Datos públicos de
            <MercadoPublicoMark size={22} />
          </span>
        </div>
      </footer>
    </div>
  );
}

const css = `
html.lenis,html.lenis body{height:auto}
.lenis.lenis-smooth{scroll-behavior:auto!important}
.lk-nav{transition:color .15s}
.lk-nav:hover{color:#fff}
.lk-btn{transition:transform .15s,box-shadow .15s,background-color .15s,border-color .15s,color .15s}
.lk-btn:hover{transform:translateY(-1px)}
.lk-btn:active{transform:scale(.98)}
.lk-sweep{background:conic-gradient(from 0deg,rgba(45,212,191,0) 0deg,rgba(45,212,191,.34) 60deg,rgba(45,212,191,0) 60.6deg);animation:lk-gira 7s linear infinite}
@keyframes lk-gira{to{transform:rotate(360deg)}}
.lk-blip{opacity:.28;animation:lk-blip 7s linear infinite}
@keyframes lk-blip{0%{opacity:1;transform:translate(-50%,-50%) scale(1.9)}10%{opacity:1;transform:translate(-50%,-50%) scale(1)}70%{opacity:.28}100%{opacity:.28;transform:translate(-50%,-50%) scale(1)}}
.lk-flota{animation:lk-flota 5s ease-in-out infinite alternate}
@keyframes lk-flota{from{transform:translateY(-4px)}to{transform:translateY(5px)}}
.lk-cinta{animation:lk-cinta 48s linear infinite}
@keyframes lk-cinta{to{transform:translateX(-50%)}}
@media (prefers-reduced-motion:reduce){.lk-sweep,.lk-blip,.lk-flota,.lk-cinta{animation:none}.lk-blip{opacity:.7}.lk-btn{transition:none}}
`;
