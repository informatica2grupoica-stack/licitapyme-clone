'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Lenis from 'lenis';
import {
  AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll, useSpring, useTransform, type Variants,
} from 'framer-motion';
import {
  IconArrowRight as ArrowRight, IconLogin as LogIn,
  IconLayoutDashboard as LayoutDashboard, IconBriefcase as Briefcase, IconClipboardCheck as ClipboardCheck,
  IconSend as Send, IconShoppingCart as ShoppingCart, IconPackage as PackageCheck, IconRadar as Radar,
  IconReceipt as Receipt, IconBuildingStore as Store, IconSearch as Search, IconShieldCheck as ShieldCheck,
  IconUsers as Users, IconLock as Lock, IconTruckDelivery as Truck,
} from '@tabler/icons-react';
import { LicitankIcon } from '@/app/components/LicitankLogo';
import { MercadoPublicoMark } from '@/app/components/MercadoPublicoLogo';
import { useSession } from '@/app/lib/session-context';

/* Paleta tomada de la propia aplicación (globals.css, AppLayout y pipeline.ts). */
const C = {
  ink: '#0f172a',
  text2: '#475569',
  text3: '#94a3b8',
  border: '#e2e8f0',
  surface2: '#f8fafc',
  surface3: '#f1f5f9',
  indigo: '#4f46e5',
  indigoDark: '#4338ca',
  indigoSoft: '#e0e7ff',
  indigoTint: '#eef2ff',
  side: '#1c2027',
  sideDeep: '#15181d',
  verde: '#16a34a',
};
/* Colores de etapa tal cual están en app/lib/pipeline.ts */
const ETAPA: Record<string, { label: string; color: string }> = {
  ASIGNADO: { label: 'ASIGNADO', color: '#4F63D2' },
  EN_PROCESO: { label: 'EN PROCESO', color: '#9333EA' },
  ANEXOS: { label: 'PRE-POSTULACIÓN', color: '#EA580C' },
  ANEXO_LISTO: { label: 'ANEXO LISTO', color: '#0D9488' },
  POSTULADA: { label: 'POSTULADA', color: '#B45309' },
  GANADA: { label: 'GANADA', color: '#16A34A' },
};

const EASE = [0.2, 0.7, 0.2, 1] as [number, number, number, number];
const mono = { fontFamily: 'var(--font-geist-mono), ui-monospace, monospace' } as const;
const roboto = { fontFamily: 'var(--font-roboto), ui-sans-serif, system-ui, sans-serif' } as const;

const ETAPAS = [
  { n: '01', t: 'Detectar', d: 'El radar revisa Mercado Público todos los días y el prefiltro aparta lo que no corresponde, con el motivo a la vista.', mods: 'Radar · Prefiltro · Viabilidad' },
  { n: '02', t: 'Auditar', d: 'Se leen las bases completas y cada producto se compara con su ficha técnica, su costo y el precio de mercado.', mods: 'Auditor · Fichas técnicas · Costo' },
  { n: '03', t: 'Postular', d: 'El certificado de admisibilidad, los compromisos y los anexos quedan listos. Mientras algo falte, los anexos económicos no se generan.', mods: 'Pre-postulación · Anexos' },
  { n: '04', t: 'Comprar', d: 'Las cotizaciones se comparan contra lo costeado. Se elige proveedor, se emite la orden de compra y se sigue su estado.', mods: 'Compras · Proveedores · Órdenes de compra' },
  { n: '05', t: 'Entregar', d: 'Despacho, fleteros y entregas con su plazo. Quien debe cumplir ve lo comprometido y cuánto tiempo queda.', mods: 'Entregas · Logística' },
  { n: '06', t: 'Medir', d: 'La adjudicación se detecta desde Mercado Público. Cada negocio queda como ganado, perdido, desierto o revocado.', mods: 'Ganadas / Perdidas' },
];

type Estado = 'CUMPLE' | 'SOBRECUMPLE' | 'NO CUMPLE' | 'FALTA DATO';
const ESTADO_STYLE: Record<Estado, { fg: string; bg: string }> = {
  'CUMPLE': { fg: '#15803d', bg: '#dcfce7' },
  'SOBRECUMPLE': { fg: '#0f766e', bg: '#ccfbf1' },
  'NO CUMPLE': { fg: '#b91c1c', bg: '#fee2e2' },
  'FALTA DATO': { fg: '#a16207', bg: '#fef3c7' },
};

/* ── Movimiento ───────────────────────────────────────────────────────────── */

const item: Variants = {
  h: { opacity: 0, y: 12 },
  s: (d: number = 0) => ({ opacity: 1, y: 0, transition: { delay: 0.1 + d * 0.08, duration: 0.45, ease: EASE } }),
};
const pop: Variants = {
  h: { opacity: 0, scale: 0.7 },
  s: (d: number = 0) => ({ opacity: 1, scale: 1, transition: { delay: 0.18 + d * 0.1, type: 'spring', stiffness: 420, damping: 24 } }),
};

function Item({ d = 0, className = '', style, children }: { d?: number; className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  return <motion.div variants={item} custom={d} className={className} style={style}>{children}</motion.div>;
}

function Rise({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={className} initial={{ opacity: 0, y: reduce ? 0 : 24 }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-8% 0px' }} transition={{ duration: 0.7, delay, ease: EASE }}>
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

/* ── Piezas de interfaz (réplica del estilo de la app) ────────────────────── */

function Chip({ e }: { e: Estado }) {
  const s = ESTADO_STYLE[e];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded px-1.5 py-[3px] text-[10px] font-semibold tracking-[0.03em]"
      style={{ color: s.fg, background: s.bg, ...mono }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.fg }} />
      {e}
    </span>
  );
}

function EtapaChip({ id }: { id: string }) {
  const e = ETAPA[id];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-[3px] text-[10.5px] font-semibold"
      style={{ color: e.color, background: `${e.color}1a`, ...roboto }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: e.color }} />
      {e.label}
    </span>
  );
}

function Ventana({ ruta, children, className = '' }: { ruta: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-xl border bg-white ${className}`}
      style={{ borderColor: C.border, boxShadow: '0 1px 2px rgba(15,23,42,.06), 0 30px 60px -28px rgba(0,0,0,.55)', ...roboto }}>
      <div className="flex items-center gap-3 border-b px-4 py-2.5" style={{ borderColor: C.border, background: C.surface2 }}>
        <span className="flex gap-1.5" aria-hidden="true">
          {[0, 1, 2].map(i => <span key={i} className="h-2 w-2 rounded-full" style={{ background: '#cbd5e1' }} />)}
        </span>
        <span className="truncate text-[11px]" style={{ color: C.text2, ...mono }}>{ruta}</span>
      </div>
      {children}
    </div>
  );
}

function Tick({ ok }: { ok: boolean }) {
  return (
    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full"
      style={ok ? { background: C.indigo } : { border: '1.5px solid #f59e0b', color: '#b45309' }}>
      {ok ? (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <motion.path d="M2.5 6.3l2.4 2.4 4.6-5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
            variants={{ h: { pathLength: 0 }, s: { pathLength: 1, transition: { delay: 0.5, duration: 0.4 } } }} />
        </svg>
      ) : <span className="text-[11px] font-bold leading-none">!</span>}
    </span>
  );
}

/* ── Pantallas del recorrido ──────────────────────────────────────────────── */

function PanelDetectar() {
  const filas = [
    { c: '2126-107-LE26', n: 'Catres clínicos eléctricos, campaña invierno', o: 'Hospital de Coquimbo', s: 65, tag: 'GANABLE', ok: true },
    { c: '2467-70-LE26', n: 'Adquisición de materiales eléctricos', o: 'I. Municipalidad de Chillán', s: 65, tag: 'GANABLE', ok: true },
    { c: '2920-30-LE26', n: 'Materiales e insumos para la DOM', o: 'I. Municipalidad de Juan Fernández', s: 39, tag: 'REVISIÓN', ok: false },
  ];
  return (
    <Ventana ruta="radar">
      <div className="p-5">
        {filas.map((f, i) => (
          <Item key={f.c} d={i} className="border-b py-3.5 first:pt-0" style={{ borderColor: C.border }}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px]" style={{ color: C.text3, ...mono }}>{f.c}</p>
                <p className="truncate text-[14px] font-semibold" style={{ color: C.ink }}>{f.n}</p>
                <p className="text-[12.5px]" style={{ color: C.text2 }}>{f.o}</p>
              </div>
              <span className="shrink-0 rounded px-1.5 py-[3px] text-[10px] font-semibold"
                style={{ ...mono, color: f.ok ? '#15803d' : '#a16207', background: f.ok ? '#dcfce7' : '#fef3c7' }}>{f.tag}</span>
            </div>
            <div className="mt-2.5 flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: C.surface3 }}>
                <motion.div className="h-full origin-left rounded-full" style={{ width: `${f.s}%`, background: f.ok ? C.indigo : '#f59e0b' }}
                  variants={{ h: { scaleX: 0 }, s: { scaleX: 1, transition: { delay: 0.35 + i * 0.12, duration: 0.9, ease: EASE } } }} />
              </div>
              <span className="w-6 text-right text-[11px]" style={{ color: C.text2, ...mono }}>{f.s}</span>
            </div>
          </Item>
        ))}
        <Item d={3} className="mt-4 flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[12.5px]" style={{ background: C.surface3, color: C.text2 }}>
          <span className="text-[10px] font-semibold" style={mono}>PREFILTRO</span>
          <span className="line-through opacity-70">Obra civil · mantención de edificio</span>
          <span className="ml-auto">descartada: fuera de rubro</span>
        </Item>
      </div>
    </Ventana>
  );
}

function PanelAuditar() {
  const filas: { req: string; celdas: { e: Estado; dato: string }[] }[] = [
    { req: 'Brillo (lúmenes ANSI)', celdas: [{ e: 'SOBRECUMPLE', dato: '4.000 lm' }, { e: 'CUMPLE', dato: '3.600 lm' }, { e: 'FALTA DATO', dato: '—' }] },
    { req: 'Vida útil de la fuente de luz', celdas: [{ e: 'CUMPLE', dato: '10.000 h' }, { e: 'NO CUMPLE', dato: '6.000 h' }, { e: 'FALTA DATO', dato: '—' }] },
    { req: 'Entrada HDMI', celdas: [{ e: 'CUMPLE', dato: '2 puertos' }, { e: 'CUMPLE', dato: '1 puerto' }, { e: 'FALTA DATO', dato: '—' }] },
  ];
  return (
    <Ventana ruta="negocio / auditor / línea 5 · proyector">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[500px] border-collapse text-left text-[13px]">
          <thead>
            <tr style={{ color: C.text2, background: C.surface2 }}>
              <th className="px-5 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.06em]">Requisito</th>
              {['Opción A', 'Opción B', 'Opción C'].map(o => (
                <th key={o} className="px-3 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.06em]">{o}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((r, ri) => (
              <tr key={r.req} className="border-t" style={{ borderColor: C.border }}>
                <td className="px-5 py-3.5 font-medium" style={{ color: C.ink }}>{r.req}</td>
                {r.celdas.map((c, ci) => (
                  <td key={ci} className="px-3 py-3.5 align-top">
                    <motion.div variants={pop} custom={ri * 3 + ci} style={{ originX: 0 }}><Chip e={c.e} /></motion.div>
                    <Item d={ri * 3 + ci} className="mt-1 text-[11.5px]" style={{ color: C.text2, ...mono }}>{c.dato}</Item>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Item d={11} className="border-t p-4 sm:p-5" style={{ borderColor: C.border, background: C.indigoTint }}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: C.indigo }}>Qué hacer</p>
        <p className="mt-1.5 text-[13.5px] leading-snug" style={{ color: C.ink }}>
          Firmar la opción A. La B no se puede firmar: <span className="font-semibold">la vida útil de 6.000 h no cumple</span>.
          A la C se le pide la ficha técnica al proveedor.
        </p>
      </Item>
    </Ventana>
  );
}

function PanelPostular() {
  const pasos = [
    { t: 'Líneas con opción aprobada', m: '4 de 4', ok: true },
    { t: 'Certificado de admisibilidad', m: 'Emitido · exigencias verificadas', ok: true },
    { t: 'Compromisos técnico-administrativos', m: '1 pendiente: garantía extendida', ok: false },
  ];
  const docs = [['Anexo N°1 · Identificación', true], ['Anexo N°4 · Declaración jurada', true], ['Anexo N°7 · Oferta económica', false], ['Fichas técnicas · líneas 1 a 4', true]] as const;
  return (
    <Ventana ruta="negocio / pre-postulación">
      <div className="p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: C.text2 }}>Candado de anexos</p>
        <ul className="mt-2">
          {pasos.map((p, i) => (
            <Item key={p.t} d={i} className="flex items-center gap-4 border-b py-3.5" style={{ borderColor: C.border }}>
              <Tick ok={p.ok} />
              <div className="min-w-0">
                <p className="text-[14px] font-semibold" style={{ color: C.ink }}>{p.t}</p>
                <p className="text-[12.5px]" style={{ color: C.text2 }}>{p.m}</p>
              </div>
            </Item>
          ))}
        </ul>
        <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: C.text2 }}>Documentos para subir a Mercado Público</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {docs.map(([d, ok], i) => (
            <Item key={d} d={4 + i} className="flex items-center justify-between rounded-lg border px-3 py-2.5 text-[12.5px]" style={{ borderColor: C.border, color: C.ink }}>
              <span className="truncate">{d}</span>
              <span className="ml-3 shrink-0 text-[10px] font-semibold" style={{ color: ok ? '#15803d' : '#a16207', ...mono }}>{ok ? 'LISTO' : 'BLOQUEADO'}</span>
            </Item>
          ))}
        </div>
      </div>
    </Ventana>
  );
}

function PanelComprar() {
  const filas = [
    { p: 'Producto 1', c: '$1.180.000', v: [['$1.120.000', '−5 %', true], ['$1.205.000', '+2 %', false], ['—', '', false]] },
    { p: 'Producto 2', c: '$349.000', v: [['$341.500', '−2 %', true], ['—', '', false], ['$398.000', '+14 %', false]] },
    { p: 'Producto 3', c: '$2.460.000', v: [['—', '', false], ['—', '', false], ['—', '', false]] },
  ];
  return (
    <Ventana ruta="compras / cotizaciones">
      <Item d={0} className="flex items-center gap-3 border-b px-5 py-3" style={{ borderColor: C.border, background: C.indigoTint }}>
        <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ background: C.indigo }}>SIGUIENTE PASO</span>
        <p className="text-[13.5px] font-medium" style={{ color: C.ink }}>Falta cotizar el producto 3 antes de definir la compra.</p>
      </Item>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-left text-[13px]">
          <thead>
            <tr style={{ color: C.text2, background: C.surface2 }}>
              {['Producto', 'Costeado', 'Prov. 1', 'Prov. 2', 'Prov. 3'].map(h => (
                <th key={h} className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.06em]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((r, ri) => (
              <tr key={r.p} className="border-t" style={{ borderColor: C.border }}>
                <td className="px-4 py-3.5 font-medium" style={{ color: C.ink }}>{r.p}</td>
                <td className="px-4 py-3.5" style={{ color: C.text2, ...mono }}>{r.c}</td>
                {r.v.map(([precio, dif, mejor], i) => (
                  <td key={i} className="relative px-4 py-3.5">
                    {mejor && (
                      <motion.span className="absolute inset-0 origin-left" style={{ background: C.indigoSoft }}
                        variants={{ h: { scaleX: 0 }, s: { scaleX: 1, transition: { delay: 0.5 + ri * 0.2, duration: 0.5, ease: EASE } } }} />
                    )}
                    <motion.span className="relative" variants={item} custom={ri + i * 0.4}>
                      <span className="font-semibold" style={{ color: C.ink, ...mono }}>{precio}</span>
                      {dif && <span className="ml-1.5 text-[10.5px]" style={{ color: mejor ? C.indigoDark : C.text2, ...mono }}>{dif}</span>}
                    </motion.span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t px-4 py-2.5 text-[11px]" style={{ borderColor: C.border, color: C.text3 }}>Cifras de ejemplo. El sistema compara cada precio con lo costeado en la postulación.</p>
    </Ventana>
  );
}

function PanelEntregar() {
  const hitos = [
    { t: 'Orden de compra aceptada', m: 'Proveedor confirmado', ok: true },
    { t: 'Despacho coordinado', m: 'Fletero asignado', ok: true },
    { t: 'Entrega al organismo', m: 'Compromiso: 14 días corridos', ok: false },
  ];
  return (
    <Ventana ruta="entregas / seguimiento">
      <div className="p-5">
        <div className="flex items-baseline justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: C.text2 }}>Plazo de entrega</p>
          <p className="text-[12px] font-semibold" style={{ color: C.ink, ...mono }}>día 9 de 14</p>
        </div>
        <div className="mt-2.5 h-2 overflow-hidden rounded-full" style={{ background: C.surface3 }}>
          <motion.div className="h-full origin-left rounded-full" style={{ width: '64%', background: C.indigo }}
            variants={{ h: { scaleX: 0 }, s: { scaleX: 1, transition: { delay: 0.3, duration: 1.1, ease: EASE } } }} />
        </div>
        <ul className="mt-5">
          {hitos.map((h, i) => (
            <Item key={h.t} d={i + 1} className="flex items-center gap-4 border-b py-3.5 last:border-b-0" style={{ borderColor: C.border }}>
              <Tick ok={h.ok} />
              <div>
                <p className="text-[14px] font-semibold" style={{ color: C.ink }}>{h.t}</p>
                <p className="text-[12.5px]" style={{ color: C.text2 }}>{h.m}</p>
              </div>
            </Item>
          ))}
        </ul>
        <Item d={5} className="mt-3 rounded-lg px-3 py-2.5 text-[12.5px]" style={{ background: '#fef3c7', color: '#854d0e' }}>
          Se avisa automáticamente cuando el plazo está por vencer.
        </Item>
      </div>
    </Ventana>
  );
}

function PanelMedir() {
  const filas: [string, string, string][] = [
    ['GANADA', '#16A34A', 'Adjudicada a la empresa. Llega la orden de compra.'],
    ['PERDIDA', '#9F1239', 'Adjudicada a otro proveedor. Se guarda la oferta ganadora.'],
    ['DESIERTA', '#78716C', 'Sin ofertas válidas. Sale de las postuladas.'],
    ['REVOCADA', '#64748B', 'El organismo dejó sin efecto el proceso.'],
  ];
  return (
    <Ventana ruta="ganadas y perdidas">
      <div className="p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: C.text2 }}>Resultado detectado desde Mercado Público</p>
        <ul className="mt-2">
          {filas.map(([e, col, d], i) => (
            <Item key={e} d={i} className="flex items-center gap-4 border-b py-3.5 last:border-b-0" style={{ borderColor: C.border }}>
              <span className="w-[82px] shrink-0 rounded-md px-2 py-[3px] text-center text-[10.5px] font-semibold" style={{ color: col, background: `${col}1a` }}>{e}</span>
              <p className="text-[13px] leading-snug" style={{ color: C.ink }}>{d}</p>
            </Item>
          ))}
        </ul>
      </div>
    </Ventana>
  );
}

const PANELES = [PanelDetectar, PanelAuditar, PanelPostular, PanelComprar, PanelEntregar, PanelMedir];

function Panel({ i, view = false }: { i: number; view?: boolean }) {
  const P = PANELES[i];
  return (
    <motion.div initial="h" variants={{ h: {}, s: {} }}
      {...(view ? { whileInView: 's', viewport: { once: true, margin: '-60px' } } : { animate: 's' })}>
      <P />
    </motion.div>
  );
}

/* ── Smooth scroll (lenis) ────────────────────────────────────────────────── */

let lenisGlobal: Lenis | null = null;

function useSmoothScroll() {
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) return;
    const lenis = new Lenis({ lerp: 0.1, anchors: { offset: -64 } });
    lenisGlobal = lenis;
    let raf = 0;
    const loop = (t: number) => { lenis.raf(t); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); lenis.destroy(); lenisGlobal = null; };
  }, [reduce]);
}

/* ── Recorrido fijado al scroll ───────────────────────────────────────────── */

function Recorrido() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const [act, setAct] = useState(0);
  useMotionValueEvent(scrollYProgress, 'change', p => setAct(Math.min(ETAPAS.length - 1, Math.max(0, Math.floor(p * ETAPAS.length * 0.999)))));
  const riel = useSpring(scrollYProgress, { stiffness: 120, damping: 24 });

  const ir = (i: number) => {
    const el = ref.current;
    if (!el) return;
    const top = el.offsetTop + ((el.offsetHeight - window.innerHeight) * (i + 0.5)) / ETAPAS.length;
    if (lenisGlobal) lenisGlobal.scrollTo(top, { duration: 1.1 });
    else window.scrollTo({ top, behavior: 'smooth' });
  };

  return (
    <section id="recorrido" style={{ background: C.sideDeep, color: '#e2e8f0' }}>
      <div ref={ref} className="relative hidden lg:block" style={{ height: `${ETAPAS.length * 78 + 40}vh` }}>
        <div className="sticky top-0 flex h-screen items-center">
          <div className="mx-auto grid w-full max-w-[1200px] grid-cols-[.85fr_1.15fr] items-center gap-16 px-8 pt-16">
            <div>
              <p className="text-[15px] font-medium" style={{ color: '#a5b4fc' }}>Del radar a la entrega</p>
              <div className="relative mt-7 pl-7">
                <div className="absolute bottom-1 left-0 top-1 w-px" style={{ background: 'rgba(255,255,255,.14)' }} />
                <motion.div className="absolute left-0 top-1 w-px origin-top" style={{ background: '#818cf8', height: 'calc(100% - 8px)', scaleY: riel }} />
                {ETAPAS.map((e, i) => (
                  <button key={e.n} onClick={() => ir(i)} className="block w-full cursor-pointer py-2 text-left" aria-label={`Ver ${e.t}`}>
                    <div className="flex items-baseline gap-4 transition-opacity duration-300" style={{ opacity: i === act ? 1 : 0.34 }}>
                      <span className="text-[11px]" style={{ color: '#818cf8', ...mono }}>{e.n}</span>
                      <span className="text-[34px] font-semibold leading-none tracking-[-0.03em] text-white xl:text-[44px]">{e.t}</span>
                    </div>
                    <motion.div initial={false} animate={{ height: i === act ? 'auto' : 0, opacity: i === act ? 1 : 0 }}
                      transition={{ duration: 0.4, ease: EASE }} className="overflow-hidden">
                      <p className="max-w-[410px] pb-2 pl-[38px] pt-3 text-[14.5px] leading-[1.6]" style={{ color: '#a8b3c4' }}>{e.d}</p>
                      <p className="pb-1 pl-[38px] text-[12px]" style={{ color: '#818cf8' }}>{e.mods}</p>
                    </motion.div>
                  </button>
                ))}
              </div>
            </div>
            <div className="relative min-h-[430px]">
              <AnimatePresence mode="wait">
                <motion.div key={act} initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -14 }} transition={{ duration: 0.32, ease: EASE }}>
                  <Panel i={act} />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[640px] px-5 py-20 lg:hidden">
        <p className="text-[15px] font-medium" style={{ color: '#a5b4fc' }}>Del radar a la entrega</p>
        {ETAPAS.map((e, i) => (
          <div key={e.n} className="mt-14">
            <p className="text-[11px]" style={{ color: '#818cf8', ...mono }}>{e.n}</p>
            <h3 className="mt-2 text-[34px] font-semibold tracking-[-0.03em] text-white">{e.t}</h3>
            <p className="mb-6 mt-3 text-[15px] leading-[1.6]" style={{ color: '#a8b3c4' }}>{e.d}</p>
            <Panel i={i} view />
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── Ventana de la aplicación (hero) ──────────────────────────────────────── */

const NAV: { g: string; items: { l: string; Icon: React.ElementType; on?: boolean }[] }[] = [
  { g: 'PRINCIPAL', items: [{ l: 'Dashboard', Icon: LayoutDashboard }, { l: 'Negocios', Icon: Briefcase, on: true }, { l: 'Aprobaciones', Icon: ClipboardCheck }, { l: 'Postuladas', Icon: Send }, { l: 'Compras', Icon: ShoppingCart }, { l: 'Entregas', Icon: PackageCheck }] },
  { g: 'BÚSQUEDA', items: [{ l: 'Radar', Icon: Radar }] },
  { g: 'GESTIÓN', items: [{ l: 'Órdenes de compra', Icon: Receipt }, { l: 'Proveedores', Icon: Store }] },
];

const FILAS = [
  { c: '2126-107-LE26', n: 'Catres clínicos eléctricos, campaña invierno', o: 'Hospital de Coquimbo', e: 'ASIGNADO' },
  { c: '2467-70-LE26', n: 'Adquisición de materiales eléctricos', o: 'I. Municipalidad de Chillán', e: 'CICLO' },
  { c: '2920-30-LE26', n: 'Materiales e insumos para la DOM', o: 'I. Municipalidad de Juan Fernández', e: 'EN_PROCESO' },
];
const CICLO = ['ASIGNADO', 'EN_PROCESO', 'ANEXOS', 'ANEXO_LISTO', 'POSTULADA'];
const AVISOS = [
  'Se asignó el negocio al equipo comercial',
  'Opción aprobada en las 4 líneas',
  'Certificado de admisibilidad emitido',
  'Anexos listos para firmar',
  'Negocio marcado como postulado',
];

function VentanaApp() {
  const reduce = useReducedMotion();
  const [paso, setPaso] = useState(reduce ? 2 : 0);
  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setPaso(p => (p + 1) % CICLO.length), 2300);
    return () => clearInterval(id);
  }, [reduce]);

  return (
    <div className="relative overflow-hidden rounded-xl border text-left"
      style={{ borderColor: 'rgba(15,23,42,.14)', background: '#f5f5f7', boxShadow: '0 2px 4px rgba(15,23,42,.06), 0 50px 90px -30px rgba(15,23,42,.45)', ...roboto }}>
      <div className="flex items-center gap-3 border-b px-4 py-2.5" style={{ borderColor: C.border, background: '#fff' }}>
        <span className="flex gap-1.5" aria-hidden="true">
          {[0, 1, 2].map(i => <span key={i} className="h-2.5 w-2.5 rounded-full" style={{ background: '#cbd5e1' }} />)}
        </span>
        <span className="mx-auto rounded-md px-16 py-1 text-[11px]" style={{ background: C.surface3, color: C.text2, ...mono }}>app.licitank.cl / negocios</span>
        <span className="w-12" />
      </div>
      <div className="grid md:grid-cols-[210px_1fr]">
        <aside className="hidden flex-col px-3 py-4 md:flex" style={{ background: `linear-gradient(to bottom, ${C.side}, ${C.sideDeep})` }}>
          <div className="mb-5 flex items-center gap-2.5 px-2">
            <LicitankIcon size={30} />
            <span className="text-[14px] font-black tracking-tight text-white">LICITANK</span>
          </div>
          {NAV.map(g => (
            <div key={g.g} className="mb-4">
              <p className="mb-1.5 px-2 text-[9.5px] font-semibold tracking-[0.12em]" style={{ color: '#64748b' }}>{g.g}</p>
              {g.items.map(({ l, Icon, on }) => (
                <div key={l} className="mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[12.5px]"
                  style={on ? { background: 'rgba(79,70,229,.2)', color: '#e0e7ff' } : { color: '#94a3b8' }}>
                  <Icon size={16} stroke={1.8} style={on ? { color: '#a5b4fc' } : undefined} />
                  {l}
                </div>
              ))}
            </div>
          ))}
        </aside>

        <div className="min-w-0 p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[18px] font-bold tracking-tight" style={{ color: C.ink }}>Negocios</p>
              <p className="text-[12px]" style={{ color: C.text2 }}>Licitaciones asignadas al equipo</p>
            </div>
            <div className="flex items-center gap-2 rounded-lg border bg-white px-3 py-1.5 text-[12px]" style={{ borderColor: C.border, color: C.text3 }}>
              <Search size={14} /> Buscar por código u organismo
            </div>
          </div>

          <div className="mt-5 overflow-hidden rounded-xl border bg-white" style={{ borderColor: C.border }}>
            {FILAS.map((f, i) => {
              const id = f.e === 'CICLO' ? CICLO[paso] : f.e;
              return (
                <div key={f.c} className="flex items-center justify-between gap-4 border-b px-4 py-3.5 last:border-b-0"
                  style={{ borderColor: C.border, background: f.e === 'CICLO' ? '#fafaff' : '#fff' }}>
                  <div className="min-w-0">
                    <p className="text-[11px]" style={{ color: C.text3, ...mono }}>{f.c}</p>
                    <p className="truncate text-[13.5px] font-semibold" style={{ color: C.ink }}>{f.n}</p>
                    <p className="truncate text-[12px]" style={{ color: C.text2 }}>{f.o}</p>
                  </div>
                  <div className="relative h-[24px] w-[140px] shrink-0 text-right">
                    <AnimatePresence mode="popLayout" initial={false}>
                      <motion.div key={id} className="absolute right-0 top-0" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3 }}>
                        <EtapaChip id={id} />
                      </motion.div>
                    </AnimatePresence>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="h-16 sm:h-5" />
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={paso} initial={{ opacity: 0, y: 16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="absolute bottom-4 right-4 flex max-w-[calc(100%-2rem)] items-center gap-3 rounded-xl border bg-white px-4 py-3 shadow-lg"
            style={{ borderColor: C.border }}>
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full" style={{ background: C.indigoSoft, color: C.indigo }}>
              <ShieldCheck size={15} />
            </span>
            <div className="min-w-0">
              <p className="text-[11px]" style={{ color: C.text3, ...mono }}>2467-70-LE26</p>
              <p className="truncate text-[12.5px] font-medium" style={{ color: C.ink }}>{AVISOS[paso]}</p>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ── Landing ──────────────────────────────────────────────────────────────── */

export default function Landing() {
  useSmoothScroll();
  const { usuario } = useSession();
  const { scrollY, scrollYProgress } = useScroll();
  const barra = useSpring(scrollYProgress, { stiffness: 140, damping: 28 });
  const inclina = useTransform(scrollY, [0, 520], [16, 0]);
  const escala = useTransform(scrollY, [0, 520], [0.95, 1]);
  const cta = usuario
    ? { href: '/dashboard', label: 'Ir al panel', Icon: LayoutDashboard }
    : { href: '/login', label: 'Iniciar sesión', Icon: LogIn };

  return (
    <div className="min-h-screen bg-white antialiased" style={{ color: C.ink }}>
      <style>{css}</style>

      <header className="sticky top-0 z-50 border-b backdrop-blur-md" style={{ borderColor: C.border, background: 'rgba(255,255,255,.82)' }}>
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-5 sm:px-8">
          <a href="#top" className="flex items-center gap-2.5">
            <LicitankIcon size={30} />
            <span className="text-[15px] font-black tracking-tight">LICITANK</span>
          </a>
          <nav className="hidden items-center gap-8 text-[14px] font-medium md:flex" style={{ color: C.text2 }}>
            <a className="lk-nav" href="#recorrido">Cómo funciona</a>
            <a className="lk-nav" href="#criterio">Control</a>
            <a className="lk-nav" href="#acceso">Equipos</a>
          </nav>
          <Link href={cta.href} className="lk-btn inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13.5px] font-semibold text-white"
            style={{ background: C.indigo }}>
            {cta.label}
          </Link>
        </div>
        <motion.div className="absolute inset-x-0 bottom-[-1px] h-[2px] origin-left" style={{ background: C.indigo, scaleX: barra }} />
      </header>

      <main id="top">
        {/* Hero */}
        <section className="relative overflow-hidden" style={{ background: `linear-gradient(to bottom, #fff 0%, ${C.surface2} 100%)` }}>
          <div className="mx-auto max-w-[1200px] px-5 pt-16 text-center sm:px-8 sm:pt-24">
            <Titular lineas={['Toda la licitación,', 'en un solo sistema.']} delay={0.05}
              className="text-[42px] font-semibold leading-[1.02] tracking-[-0.04em] sm:text-[72px]" />
            <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55, duration: 0.7, ease: EASE }}
              className="mx-auto mt-7 max-w-[640px] text-[17px] leading-[1.6] sm:text-[18px]" style={{ color: C.text2 }}>
              LICITANK acompaña cada negocio de Mercado Público desde que aparece en el radar hasta que se entrega
              al organismo: audita bases y fichas técnicas, arma la postulación, ordena las compras y avisa cuando algo vence.
            </motion.p>
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7, duration: 0.7, ease: EASE }}
              className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Link href={cta.href} className="lk-btn group inline-flex items-center gap-2 rounded-lg px-5 py-3 text-[14.5px] font-semibold text-white"
                style={{ background: C.indigo, boxShadow: '0 8px 20px -8px rgba(79,70,229,.7)' }}>
                <cta.Icon size={16} />
                {cta.label}
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
              </Link>
              <a href="#recorrido" className="lk-btn inline-flex items-center gap-2 rounded-lg border bg-white px-5 py-3 text-[14.5px] font-semibold"
                style={{ borderColor: '#cbd5e1', color: C.ink }}>
                Ver cómo funciona
              </a>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45, duration: 1, ease: EASE }}
              className="mx-auto mt-16 max-w-[1080px]" style={{ perspective: 1600 }}>
              <motion.div style={{ rotateX: inclina, scale: escala, transformOrigin: 'top center' }}>
                <VentanaApp />
              </motion.div>
            </motion.div>
          </div>
        </section>

        <Recorrido />

        {/* Control */}
        <section id="criterio" className="mx-auto max-w-[1200px] px-5 py-24 sm:px-8 sm:py-32">
          <Rise>
            <h2 className="max-w-[720px] text-[32px] font-semibold leading-[1.06] tracking-[-0.035em] sm:text-[48px]">
              Qué hace la inteligencia artificial y qué decide una persona.
            </h2>
            <p className="mt-5 max-w-[600px] text-[17px] leading-[1.6]" style={{ color: C.text2 }}>
              La IA lee y compara. Las decisiones, como firmar una línea, autorizar una compra o emitir un anexo, quedan en manos del equipo, con registro de quién las tomó.
            </p>
          </Rise>

          <div className="mt-14 grid gap-5 md:grid-cols-3">
            <Rise>
              <div className="lk-card h-full rounded-2xl border p-6" style={{ borderColor: C.border, background: C.surface2 }}>
                <div className="rounded-xl border bg-white p-4" style={{ borderColor: C.border }}>
                  <p className="text-[12.5px] leading-[1.6]" style={{ color: C.text2 }}>
                    «…el oferente deberá acreditar <mark className="rounded px-0.5" style={{ background: '#fde68a', color: C.ink }}>garantía técnica mínima de 12 meses</mark> sobre cada equipo…»
                  </p>
                  <div className="mt-3 flex items-center gap-2 text-[11px]" style={mono}>
                    <span style={{ color: '#15803d' }}>✓ cita encontrada</span>
                    <span style={{ color: C.text3 }}>Bases · Art. 21</span>
                  </div>
                </div>
                <h3 className="mt-6 text-[19px] font-semibold tracking-[-0.01em]">Cada dato muestra de dónde salió</h3>
                <p className="mt-2 text-[14.5px] leading-[1.6]" style={{ color: C.text2 }}>Las lecturas citan documento y artículo. Si una cita no está en el texto original, queda marcada.</p>
              </div>
            </Rise>
            <Rise delay={0.08}>
              <div className="lk-card h-full rounded-2xl border p-6" style={{ borderColor: C.border, background: C.surface2 }}>
                <div className="rounded-xl border bg-white p-4" style={{ borderColor: C.border }}>
                  {[['Opción A aprobada', 'Asesor', '14:32'], ['Anexo económico emitido', 'Comercial', '14:40'], ['Compra autorizada', 'Administración', '15:05']].map(([a, b, h]) => (
                    <div key={a} className="flex items-center gap-2.5 border-b py-2 text-[12.5px] first:pt-0 last:border-b-0 last:pb-0" style={{ borderColor: C.border }}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: C.indigo }} />
                      <span className="font-medium" style={{ color: C.ink }}>{a}</span>
                      <span className="ml-auto" style={{ color: C.text3 }}>{b} · {h}</span>
                    </div>
                  ))}
                </div>
                <h3 className="mt-6 text-[19px] font-semibold tracking-[-0.01em]">Las decisiones tienen responsable</h3>
                <p className="mt-2 text-[14.5px] leading-[1.6]" style={{ color: C.text2 }}>Aprobar, firmar o emitir requiere un permiso. Todo queda en la bitácora del negocio.</p>
              </div>
            </Rise>
            <Rise delay={0.16}>
              <div className="lk-card h-full rounded-2xl border p-6" style={{ borderColor: C.border, background: C.surface2 }}>
                <div className="rounded-xl border bg-white p-4" style={{ borderColor: C.border }}>
                  <Chip e="FALTA DATO" />
                  <p className="mt-3 text-[12.5px] leading-[1.55]" style={{ color: C.text2 }}>
                    Pregunta para el proveedor: <span className="font-medium" style={{ color: C.ink }}>¿cuál es la vida útil de la fuente de luz?</span>
                  </p>
                </div>
                <h3 className="mt-6 text-[19px] font-semibold tracking-[-0.01em]">Si falta información, se pregunta</h3>
                <p className="mt-2 text-[14.5px] leading-[1.6]" style={{ color: C.text2 }}>El sistema no rellena con supuestos. El estado queda en «falta dato» y la línea no se firma hasta resolverlo.</p>
              </div>
            </Rise>
          </div>
        </section>

        {/* Equipos */}
        <section id="acceso" className="border-y" style={{ borderColor: C.border, background: C.surface2 }}>
          <div className="mx-auto grid max-w-[1200px] gap-12 px-5 py-24 sm:px-8 sm:py-28 lg:grid-cols-[.8fr_1.2fr] lg:gap-20">
            <Rise>
              <h2 className="text-[32px] font-semibold leading-[1.06] tracking-[-0.035em] sm:text-[44px]">
                Cada equipo trabaja en su parte.
              </h2>
              <p className="mt-5 max-w-[420px] text-[16px] leading-[1.6]" style={{ color: C.text2 }}>
                Los permisos se definen por persona. Nadie ve ni modifica lo que no le corresponde.
              </p>
            </Rise>
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                { Icon: Users, t: 'Administración', d: 'Todo el radar y todos los negocios. Reasigna, aprueba y define permisos.' },
                { Icon: Briefcase, t: 'Equipo comercial', d: 'Audita, costea y arma la postulación de los negocios asignados.' },
                { Icon: Truck, t: 'Compras', d: 'Cotizaciones, proveedores, órdenes de compra y entregas.' },
                { Icon: Lock, t: 'Externos', d: 'Ven solo las licitaciones que se les asignan.' },
              ].map(({ Icon, t, d }, i) => (
                <Rise key={t} delay={i * 0.07}>
                  <div className="lk-card h-full rounded-2xl border bg-white p-6" style={{ borderColor: C.border }}>
                    <span className="grid h-10 w-10 place-items-center rounded-xl" style={{ background: C.indigoSoft, color: C.indigo }}>
                      <Icon size={20} stroke={1.8} />
                    </span>
                    <h3 className="mt-5 text-[17px] font-semibold tracking-[-0.01em]">{t}</h3>
                    <p className="mt-1.5 text-[14.5px] leading-[1.6]" style={{ color: C.text2 }}>{d}</p>
                  </div>
                </Rise>
              ))}
            </div>
          </div>
        </section>

        {/* Cierre */}
        <section className="mx-auto max-w-[1200px] px-5 py-24 sm:px-8">
          <Rise>
            <div className="relative overflow-hidden rounded-3xl p-8 sm:p-16" style={{ background: C.sideDeep }}>
              <div className="relative flex flex-col items-start justify-between gap-8 sm:flex-row sm:items-center">
                <div>
                  <h2 className="max-w-[560px] text-[32px] font-semibold leading-[1.05] tracking-[-0.035em] text-white sm:text-[50px]">
                    Retoma tus negocios donde los dejaste.
                  </h2>
                  <p className="mt-4 text-[16px]" style={{ color: '#a8b3c4' }}>Ingresa con tu cuenta del equipo.</p>
                </div>
                <Link href={cta.href} className="lk-btn group inline-flex shrink-0 items-center gap-2.5 rounded-lg px-6 py-3.5 text-[15px] font-semibold text-white"
                  style={{ background: C.indigo, boxShadow: '0 10px 24px -8px rgba(79,70,229,.8)' }}>
                  {cta.label}
                  <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" />
                </Link>
              </div>
            </div>
          </Rise>
        </section>
      </main>

      <footer className="border-t" style={{ borderColor: C.border }}>
        <div className="mx-auto flex max-w-[1200px] flex-col gap-5 px-5 py-8 text-[12.5px] sm:flex-row sm:items-center sm:justify-between sm:px-8" style={{ color: C.text2 }}>
          <span className="flex items-center gap-2.5">
            <LicitankIcon size={22} />
            <span className="font-bold" style={{ color: C.ink }}>LICITANK</span>
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
.lk-nav{position:relative;transition:color .2s}
.lk-nav:hover{color:#0f172a}
.lk-btn{transition:transform .2s,box-shadow .2s,background-color .2s}
.lk-btn:hover{transform:translateY(-1px)}
.lk-btn:active{transform:scale(.98)}
.lk-card{transition:transform .3s,box-shadow .3s,border-color .3s}
.lk-card:hover{transform:translateY(-3px);box-shadow:0 18px 36px -22px rgba(15,23,42,.35);border-color:#c7d2fe!important}
@media (prefers-reduced-motion:reduce){.lk-btn,.lk-card{transition:none}}
`;
