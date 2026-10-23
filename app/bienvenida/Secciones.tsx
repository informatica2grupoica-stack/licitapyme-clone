'use client';

// Secciones de credibilidad de la landing: ciclo de una licitación, lectura de bases,
// módulos con demos animadas y marco normativo.
import { useEffect, useRef, useState } from 'react';
import { motion, useInView, useReducedMotion, useScroll, useSpring } from 'framer-motion';
import { LicitankIcon } from '@/app/components/LicitankLogo';

const EASE = [0.2, 0.7, 0.2, 1] as [number, number, number, number];
const mono = { fontFamily: 'var(--font-geist-mono), ui-monospace, monospace' } as const;
const serif = { fontFamily: 'var(--font-roboto), ui-sans-serif, system-ui, sans-serif', fontWeight: 500 } as const;

function Rise({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={className} initial={{ opacity: 0, y: reduce ? 0 : 26 }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-8% 0px' }} transition={{ duration: 0.65, delay, ease: EASE }}>
      {children}
    </motion.div>
  );
}

function useVisto<T extends Element = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const go = useInView(ref, { once: true, margin: '-80px' });
  return [ref, go] as const;
}

function useEscribe(texto: string, go: boolean, delay = 0, vel = 38) {
  const reduce = useReducedMotion();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!go) return;
    if (reduce) { const z = setTimeout(() => setN(texto.length), 0); return () => clearTimeout(z); }
    let i = 0;
    let iv: ReturnType<typeof setInterval>;
    const t = setTimeout(() => { iv = setInterval(() => { i++; setN(i); if (i >= texto.length) clearInterval(iv); }, vel); }, delay);
    return () => { clearTimeout(t); clearInterval(iv); };
  }, [go, texto, delay, vel, reduce]);
  return texto.slice(0, n);
}

function Dot({ c }: { c: string }) {
  return <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: c }} />;
}

/* ── 1. Ciclo de una licitación ───────────────────────────────────────────── */

const CICLO = [
  { t: 'Publicación', p: 'Cada día se publican decenas de licitaciones y los plazos corren desde el primer minuto.', s: 'El radar la detecta con tus palabras clave y la ordena por fecha de cierre.' },
  { t: 'Foro de consultas', p: 'Es la única ventana para aclarar bases ambiguas. Pasado el plazo, la duda se queda sin respuesta.', s: 'Lee las fechas de las bases y las deja a la vista en el negocio.' },
  { t: 'Lectura de bases', p: 'Garantías, criterios, plazos y anexos están repartidos en decenas de páginas y documentos.', s: 'La IA lee todo y entrega la viabilidad por requisito, con cita a la página de origen.' },
  { t: 'Oferta', p: 'Un error en un anexo o en la planilla económica deja la oferta fuera de bases.', s: 'Costeo con cotizaciones y margen por ítem; anexos rellenados con los datos de tu empresa.' },
  { t: 'Auditoría previa', p: 'Una oferta inadmisible no se evalúa, aunque sea la más barata.', s: 'El auditor compara requisito por requisito y bloquea la postulación si falta un anexo.' },
  { t: 'Cierre y apertura', p: 'Subir el archivo a último minuto es la forma más común de perder un negocio.', s: 'Las postuladas quedan con su hora de cierre y su fecha de adjudicación a la vista.' },
  { t: 'Adjudicación', p: 'El resultado sale en Mercado Público, sin aviso para quien postuló.', s: 'Detecta el resultado y lo marca: ganada, perdida, desierta o revocada.' },
  { t: 'Orden de compra y entrega', p: 'Ganar es la mitad: falta comprar, entregar, facturar y cobrar.', s: 'La orden de compra llega sola; compras, pagos, acta y facturación quedan en el mismo negocio.' },
];

function HitoCiclo({ i, h }: { i: number; h: (typeof CICLO)[number] }) {
  const ref = useRef<HTMLLIElement>(null);
  const activo = useInView(ref, { margin: '-45% 0px -45% 0px' });
  const visto = useInView(ref, { once: true, margin: '-8% 0px' });
  const izq = i % 2 === 0;
  return (
    <li ref={ref} className="relative grid gap-3 pb-14 pl-10 last:pb-0 md:grid-cols-2 md:gap-16 md:pl-0">
      <motion.span aria-hidden className="absolute left-0 top-1.5 z-10 grid h-[17px] w-[17px] -translate-x-1/2 place-items-center rounded-full border md:left-1/2"
        animate={{ backgroundColor: activo ? '#2dd4bf' : '#0a0d12', borderColor: activo ? '#2dd4bf' : '#334155', scale: activo ? 1.25 : 1 }}
        transition={{ duration: 0.3 }} style={{ marginLeft: 0 }} />
      <motion.div initial={{ opacity: 0, y: 22 }} animate={visto ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.6, ease: EASE }}
        className={izq ? 'md:text-right' : 'md:col-start-2'}>
        <p className="text-xs text-teal-400" style={mono}>{String(i + 1).padStart(2, '0')}</p>
        <h3 style={serif} className="mt-1.5 text-[26px] leading-[1.1] tracking-[-0.01em] text-white sm:text-[32px]">{h.t}</h3>
        <dl className={`mt-3 space-y-2.5 ${izq ? 'md:ml-auto' : ''} max-w-[440px]`}>
          <div><dt className="text-[11px] text-slate-500">Dónde se pierde</dt><dd className="mt-0.5 text-[14.5px] leading-[1.55] text-slate-400">{h.p}</dd></div>
          <div><dt className="text-[11px] text-teal-500">En LICITANK</dt><dd className="mt-0.5 text-[14.5px] leading-[1.55] text-slate-200">{h.s}</dd></div>
        </dl>
      </motion.div>
    </li>
  );
}

export function Ciclo() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 0.6', 'end 0.55'] });
  const linea = useSpring(scrollYProgress, { stiffness: 120, damping: 28, mass: 0.4 });
  return (
    <section id="ciclo" className="border-t border-white/10 bg-[#0a0d12]">
      <div className="mx-auto max-w-[1200px] px-5 py-24 sm:px-8 sm:py-32">
        <Rise>
          <p className="text-xs text-teal-400" style={mono}>El ciclo completo</p>
          <h2 style={serif} className="mt-3 max-w-[820px] text-[36px] leading-[1.06] tracking-[-0.02em] text-white sm:text-[54px]">
            Una licitación se gana o se pierde en ocho momentos. Cubrimos los ocho.
          </h2>
          <p className="mt-5 max-w-[620px] text-[16px] leading-[1.6] text-slate-400">
            Conocemos el proceso por dentro porque lo trabajamos todos los días: desde que Mercado Público publica las bases
            hasta que el cliente recibe el producto y se emite la factura.
          </p>
        </Rise>
        <div ref={ref} className="relative mt-20">
          <span aria-hidden className="absolute bottom-0 left-0 top-0 w-px bg-white/10 md:left-1/2" />
          <motion.span aria-hidden className="absolute bottom-0 left-0 top-0 w-px origin-top bg-teal-400 md:left-1/2" style={{ scaleY: linea }} />
          <ol className="relative">
            {CICLO.map((h, i) => <HitoCiclo key={h.t} i={i} h={h} />)}
          </ol>
        </div>
      </div>
    </section>
  );
}

/* ── 2. Lectura de bases: sabemos qué mirar ───────────────────────────────── */

const BASES = [
  { id: 'gar', cap: '7', t: 'Garantía de seriedad de la oferta', x: 'El oferente deberá entregar una boleta de garantía a la vista, por el 1% del monto total ofertado, con vigencia mínima de 60 días corridos desde el cierre.' },
  { id: 'plz', cap: '9', t: 'Plazo de entrega', x: 'Los bienes se entregarán en un plazo máximo de 30 días corridos contados desde la aceptación de la orden de compra.' },
  { id: 'cri', cap: '12', t: 'Criterios de evaluación', x: 'Precio, 60%. Plazo de entrega, 25%. Experiencia del oferente, 15%. Las ofertas bajo 60% de puntaje no serán adjudicadas.' },
  { id: 'inh', cap: '14', t: 'Declaraciones juradas', x: 'El oferente deberá acompañar la declaración de no estar afecto a las inhabilidades del artículo 4º de la Ley N° 19.886.' },
  { id: 'ane', cap: '15', t: 'Anexos obligatorios', x: 'Anexo N°1 identificación, Anexo N°2 declaración jurada, Anexo N°3 oferta económica. La omisión de cualquiera hará inadmisible la oferta.' },
  { id: 'mul', cap: '21', t: 'Multas por atraso', x: 'Por cada día de atraso se aplicará una multa de 0,5% del valor de la orden de compra, con tope de 10%.' },
];

const HALLAZGOS: Record<string, { q: string; r: string; h: string }> = {
  gar: { q: 'Documento físico o electrónico, con vigencia que cubre hasta la adjudicación.', r: 'Un banco puede tardar días en emitirla.', h: 'Se agrega a la lista de pendientes con fecha límite y responsable.' },
  plz: { q: 'Entrega en 30 días corridos, no hábiles.', r: 'Si el proveedor tarda más, la multa corre sola.', h: 'Se contrasta con el plazo que ofrece cada cotización antes de costear.' },
  cri: { q: 'El precio pesa 60%; plazo y experiencia suman 40%.', r: 'Bajar el precio sin cuidar el plazo no asegura el puntaje.', h: 'Los criterios se convierten en ítems de costeo para simular el puntaje.' },
  inh: { q: 'Declaración jurada sobre inhabilidades legales.', r: 'Sin ella la oferta se declara fuera de bases.', h: 'El anexo se rellena con los datos del representante de la empresa.' },
  ane: { q: 'Tres anexos, todos obligatorios y con firma.', r: 'La omisión de uno solo deja la oferta inadmisible.', h: 'Candado: no deja marcar como postulada si falta alguno.' },
  mul: { q: '0,5% diario con tope de 10% de la orden de compra.', r: 'Un atraso de 20 días ya consume el margen.', h: 'Entra al análisis de viabilidad como riesgo contractual.' },
};

export function Bases() {
  const [ref, go] = useVisto<HTMLDivElement>();
  const reduce = useReducedMotion();
  const [sel, setSel] = useState(0);
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (!go || !auto || reduce) return;
    const iv = setInterval(() => setSel(s => (s + 1) % BASES.length), 3600);
    return () => clearInterval(iv);
  }, [go, auto, reduce]);
  const b = BASES[sel];
  const h = HALLAZGOS[b.id];

  return (
    <section id="bases" className="border-t border-white/10 bg-[#0d1117]">
      <div className="mx-auto max-w-[1200px] px-5 py-24 sm:px-8 sm:py-32">
        <Rise>
          <p className="text-xs text-teal-400" style={mono}>Lectura de bases</p>
          <h2 style={serif} className="mt-3 max-w-[820px] text-[36px] leading-[1.06] tracking-[-0.02em] text-white sm:text-[54px]">
            Sabemos qué buscar en unas bases, y dónde se esconde el riesgo.
          </h2>
          <p className="mt-5 max-w-[620px] text-[16px] leading-[1.6] text-slate-400">
            Garantías, plazos, criterios, declaraciones, anexos y multas. LICITANK los extrae, los explica y los convierte en tareas
            con responsable. Extracto de ejemplo.
          </p>
        </Rise>

        <div ref={ref} className="mt-14 grid gap-6 lg:grid-cols-[1.15fr_.85fr]">
          <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0a0d12]">
            <div className="flex items-center gap-3 border-b border-white/10 px-4 py-2.5">
              <span className="flex gap-1.5" aria-hidden>{[0, 1, 2].map(i => <span key={i} className="h-2 w-2 rounded-full bg-white/15" />)}</span>
              <span className="text-xs text-slate-500" style={mono}>bases_administrativas.pdf</span>
            </div>
            <ul className="relative p-2">
              {BASES.map((x, i) => (
                <li key={x.id}>
                  <button onClick={() => { setSel(i); setAuto(false); }} aria-pressed={i === sel}
                    className="relative block w-full rounded-lg px-4 py-3.5 text-left transition-colors duration-200 hover:bg-white/[.03]">
                    {i === sel && (
                      <motion.span layoutId="base-sel" aria-hidden className="absolute inset-0 rounded-lg bg-teal-400/[.09] ring-1 ring-teal-400/30"
                        transition={{ type: 'spring', stiffness: 380, damping: 34 }} />
                    )}
                    <span className="relative block">
                      <span className="text-[11px] text-slate-500" style={mono}>Art. {x.cap}</span>
                      <span className={`mt-0.5 block text-[14px] font-medium transition-colors ${i === sel ? 'text-white' : 'text-slate-300'}`}>{x.t}</span>
                      <span className={`mt-1.5 block text-[13px] leading-[1.6] transition-colors ${i === sel ? 'text-slate-300' : 'text-slate-500'}`}>{x.x}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-xl border border-white/10 bg-[#0a0d12] p-6">
              <p className="text-[11px] text-slate-500">Lo que LICITANK extrajo</p>
              <motion.div key={b.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }}>
                <h3 style={serif} className="mt-1.5 text-[24px] leading-[1.15] text-white">{b.t}</h3>
                <dl className="mt-5 space-y-4">
                  <div><dt className="text-[11px] text-slate-500">Qué exigen</dt><dd className="mt-0.5 text-[14px] leading-[1.55] text-slate-200">{h.q}</dd></div>
                  <div><dt className="text-[11px] text-slate-500">Dónde está el riesgo</dt>
                    <dd className="mt-0.5 flex items-start gap-2 text-[14px] leading-[1.55] text-slate-200"><span className="mt-[9px]"><Dot c="#f59e0b" /></span>{h.r}</dd></div>
                  <div><dt className="text-[11px] text-teal-500">Qué hace el sistema</dt><dd className="mt-0.5 text-[14px] leading-[1.55] text-slate-200">{h.h}</dd></div>
                </dl>
                <p className="mt-5 border-t border-white/10 pt-4 text-xs text-slate-500" style={mono}>Fuente: bases administrativas · Art. {b.cap}</p>
              </motion.div>
            </div>
            <div className="mt-4 flex gap-1.5" aria-hidden>
              {BASES.map((x, i) => <span key={x.id} className={`h-[3px] flex-1 rounded-full transition-colors duration-300 ${i === sel ? 'bg-teal-400' : 'bg-white/10'}`} />)}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── 3. Módulos con demo animada ──────────────────────────────────────────── */

function Tarjeta({ className = '', rotulo, titulo, texto, children }: { className?: string; rotulo: string; titulo: string; texto: string; children: React.ReactNode }) {
  const mover = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
  };
  return (
    <Rise className={className}>
      <div onPointerMove={mover} className="lk-card group relative h-full overflow-hidden rounded-2xl border border-white/10 bg-[#0f141b] p-6 transition-colors duration-300 hover:border-white/20 sm:p-7">
        <span aria-hidden className="lk-spot pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        <div className="relative flex h-full flex-col">
          <p className="text-xs text-teal-400" style={mono}>{rotulo}</p>
          <h3 style={serif} className="mt-2 text-[24px] leading-[1.15] tracking-[-0.01em] text-white sm:text-[28px]">{titulo}</h3>
          <p className="mt-2.5 max-w-[460px] text-[14.5px] leading-[1.6] text-slate-400">{texto}</p>
          <div className="mt-6 flex-1">{children}</div>
        </div>
      </div>
    </Rise>
  );
}

function DemoViabilidad() {
  const [ref, go] = useVisto<HTMLDivElement>();
  const filas: [string, string, string, string][] = [
    ['Garantía de seriedad', 'Exige boleta por el 1% del monto', '#f59e0b', 'Bases · p. 9'],
    ['Plazo de entrega', '30 días corridos desde la OC', '#16a34a', 'Bases · p. 12'],
    ['Experiencia del oferente', 'Pide 2 contratos similares', '#16a34a', 'Bases · p. 15'],
    ['Visita a terreno', 'Obligatoria, antes del cierre', '#ef4444', 'Bases · p. 4'],
  ];
  return (
    <div ref={ref} className="rounded-lg border border-white/10 bg-[#0a0d12]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-white/10 px-5 py-3.5">
        <p className="text-[13px] font-medium text-white" style={mono}>2467-70-LE26</p>
        <dl className="flex gap-6">
          {[['Monto', '$24.741.860'], ['Líneas', '65'], ['Criterios', '5'], ['Documentos', '6']].map(([k, v]) => (
            <div key={k}><dt className="text-[11px] text-slate-500">{k}</dt><dd className="text-xs font-medium tabular-nums text-slate-200">{v}</dd></div>
          ))}
        </dl>
      </div>
      <ul className="divide-y divide-white/[.06]">
        {filas.map(([t, d, c, cita], i) => (
          <motion.li key={t} initial={{ opacity: 0, x: -10 }} animate={go ? { opacity: 1, x: 0 } : {}} transition={{ delay: 0.25 + i * 0.35, duration: 0.5, ease: EASE }}
            className="grid grid-cols-[1fr_auto] items-center gap-4 px-5 py-3 sm:grid-cols-[1.1fr_1.4fr_auto]">
            <span className="flex items-center gap-2 text-[13px] font-medium text-slate-100"><Dot c={c} />{t}</span>
            <span className="hidden text-[13px] text-slate-400 sm:block">{d}</span>
            <span className="text-[11px] text-slate-500" style={mono}>{cita}</span>
          </motion.li>
        ))}
      </ul>
      <p className="border-t border-white/10 px-5 py-3 text-xs text-slate-500">Cada veredicto cita la página de las bases donde se origina.</p>
    </div>
  );
}

function DemoLectura() {
  const [ref, go] = useVisto<HTMLUListElement>();
  const archivos: [string, string][] = [['Bases administrativas', 'PDF'], ['Anexos de la oferta', 'DOCX'], ['Planilla económica', 'XLSX'], ['Ficha técnica escaneada', 'PDF · OCR']];
  return (
    <ul ref={ref} className="space-y-2">
      {archivos.map(([n, f], i) => (
        <li key={n} className="relative overflow-hidden rounded-lg border border-white/10 bg-[#0a0d12] px-4 py-3">
          <motion.span aria-hidden className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-teal-400/20 to-transparent"
            initial={{ x: '-120%' }} animate={go ? { x: '420%' } : {}} transition={{ delay: 0.2 + i * 0.45, duration: 0.9, ease: 'easeInOut' }} />
          <div className="relative flex items-center justify-between gap-3">
            <span className="text-[13px] font-medium text-slate-200">{n}</span>
            <span className="flex items-center gap-3 text-xs">
              <span className="text-slate-500" style={mono}>{f}</span>
              <motion.span initial={{ opacity: 0 }} animate={go ? { opacity: 1 } : {}} transition={{ delay: 0.9 + i * 0.45 }} className="flex items-center gap-1.5 text-teal-400"><Dot c="#2dd4bf" />leído</motion.span>
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function DemoAnexo() {
  const [ref, go] = useVisto<HTMLDivElement>();
  const razon = useEscribe('Comercial Austral SpA', go, 300);
  const rut = useEscribe('76.123.456-7', go, 1300);
  const rep = useEscribe('María Fuentes Rojas', go, 2100);
  const campos: [string, string][] = [['Razón social', razon], ['RUT', rut], ['Representante legal', rep]];
  return (
    <div ref={ref} className="rounded-lg border border-slate-300 bg-white px-5 py-4 text-slate-900">
      <p className="text-[11px] text-slate-500">Anexo N°1 · Identificación del oferente</p>
      <dl className="mt-3 space-y-3">
        {campos.map(([k, v]) => (
          <div key={k} className="border-b border-slate-200 pb-1.5">
            <dt className="text-[11px] text-slate-500">{k}</dt>
            <dd className="h-5 text-[13.5px] font-medium">{v}<span aria-hidden className="lk-caret ml-px inline-block h-[14px] w-px translate-y-[2px] bg-teal-600" /></dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function DemoAuditor() {
  const [ref, go] = useVisto<HTMLDivElement>();
  const filas: [string, string, boolean][] = [
    ['Garantía del producto: 12 meses', '24 meses', true],
    ['Estructura de acero de 25 mm', '22 mm', false],
    ['Asiento de polipropileno', 'Polipropileno', true],
  ];
  return (
    <div ref={ref} className="overflow-hidden rounded-lg border border-white/10 bg-[#0a0d12]">
      <div className="grid grid-cols-[1.3fr_1fr_auto] gap-3 border-b border-white/10 px-4 py-2 text-[11px] text-slate-500"><span>Bases piden</span><span>Tu oferta dice</span><span>Resultado</span></div>
      {filas.map(([r, o, ok], i) => (
        <motion.div key={r} initial={{ opacity: 0 }} animate={go ? { opacity: 1 } : {}} transition={{ delay: 0.3 + i * 0.5 }}
          className="grid grid-cols-[1.3fr_1fr_auto] items-center gap-3 border-b border-white/[.06] px-4 py-2.5 last:border-b-0">
          <span className="text-[12.5px] text-slate-300">{r}</span>
          <span className="text-[12.5px] text-slate-400">{o}</span>
          <span className={`flex items-center gap-1.5 text-xs font-medium ${ok ? 'text-emerald-400' : 'text-red-400'}`}><Dot c={ok ? '#34d399' : '#f87171'} />{ok ? 'Cumple' : 'No cumple'}</span>
        </motion.div>
      ))}
    </div>
  );
}

function DemoCosteo() {
  const [ref, go] = useVisto<HTMLDivElement>();
  const cot: [string, number, boolean][] = [['Proveedor A', 18490, true], ['Proveedor B', 19250, false], ['Proveedor C', 21900, false]];
  const max = 21900;
  return (
    <div ref={ref}>
      <ul className="space-y-3">
        {cot.map(([n, v, mejor], i) => (
          <li key={n}>
            <div className="flex items-baseline justify-between text-[13px]">
              <span className={mejor ? 'font-medium text-white' : 'text-slate-400'}>{n}{mejor && <span className="ml-2 text-xs text-teal-400">menor costo</span>}</span>
              <span className="tabular-nums text-slate-300">${v.toLocaleString('es-CL')}</span>
            </div>
            <span className="mt-1.5 block h-[3px] overflow-hidden rounded-full bg-white/10">
              <motion.span className={`block h-full origin-left ${mejor ? 'bg-teal-400' : 'bg-slate-500'}`} initial={{ scaleX: 0 }}
                animate={go ? { scaleX: v / max } : {}} transition={{ delay: 0.2 + i * 0.15, duration: 0.9, ease: EASE }} />
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-slate-500">Costo por unidad con IVA, de tres cotizaciones leídas por la IA.</p>
    </div>
  );
}

function DemoCompras() {
  const [ref, go] = useVisto<HTMLOListElement>();
  const pasos = ['Orden de compra del cliente', 'Cotización y aprobación', 'Orden al proveedor', 'Entrega y acta', 'Factura'];
  return (
    <ol ref={ref} className="relative space-y-3">
      <span aria-hidden className="absolute bottom-2 left-[4px] top-2 w-px bg-white/10" />
      {pasos.map((p, i) => (
        <li key={p} className="relative flex items-center gap-4">
          <motion.span aria-hidden className="relative h-[9px] w-[9px] rounded-full" initial={{ backgroundColor: '#334155', scale: 0.6 }}
            animate={go ? { backgroundColor: '#2dd4bf', scale: 1 } : {}} transition={{ delay: 0.2 + i * 0.4, type: 'spring', stiffness: 400, damping: 18 }} />
          <motion.span initial={{ opacity: 0.35 }} animate={go ? { opacity: 1 } : {}} transition={{ delay: 0.2 + i * 0.4 }} className="text-[13px] text-slate-200">{p}</motion.span>
        </li>
      ))}
    </ol>
  );
}

function DemoChat() {
  const [ref, go] = useVisto<HTMLDivElement>();
  const reduce = useReducedMotion();
  const [paso, setPaso] = useState(0);
  useEffect(() => {
    if (!go) return;
    const t = reduce ? [setTimeout(() => setPaso(3), 0)] : [setTimeout(() => setPaso(1), 400), setTimeout(() => setPaso(2), 1200), setTimeout(() => setPaso(3), 2500)];
    return () => t.forEach(clearTimeout);
  }, [go, reduce]);
  return (
    <div ref={ref} className="min-h-[190px] space-y-3 rounded-lg border border-white/10 bg-[#0a0d12] p-4">
      <p className="text-xs text-slate-500" style={mono}>1549-58-LE26</p>
      {paso >= 1 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="ml-auto w-fit max-w-[88%] rounded-xl rounded-br-sm bg-white/10 px-3.5 py-2 text-[13px] text-white">
          ¿La oferta se presenta por el total o por ítem?
        </motion.div>
      )}
      {paso === 2 && <div className="flex gap-1 px-1" aria-hidden>{[0, 1, 2].map(i => <span key={i} className="lk-typing h-1.5 w-1.5 rounded-full bg-slate-400" style={{ animationDelay: `${i * 0.15}s` }} />)}</div>}
      {paso >= 3 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="max-w-[94%] text-[13px] leading-[1.55] text-slate-300">
          <b className="font-medium text-white">Por línea.</b> El Art. 21 adjudica por línea o por ítem y el Anexo N°10 permite ofertar ítems por separado; el total al pie es referencial.
          <span className="mt-2 block text-[11px] text-slate-500" style={mono}>Bases · Art. 21 · Anexo N°10</span>
        </motion.div>
      )}
    </div>
  );
}

export function Modulos() {
  return (
    <section id="modulos" className="border-t border-white/10 bg-[#0a0d12]">
      <style>{css}</style>
      <div className="mx-auto max-w-[1200px] px-5 py-24 sm:px-8 sm:py-32">
        <Rise>
          <p className="text-xs text-teal-400" style={mono}>La plataforma</p>
          <h2 style={serif} className="mt-3 max-w-[820px] text-[36px] leading-[1.06] tracking-[-0.02em] text-white sm:text-[54px]">
            Todo el trabajo de una licitación en un solo lugar.
          </h2>
          <p className="mt-5 max-w-[620px] text-[16px] leading-[1.6] text-slate-400">
            Hecho por gente que postula licitaciones. Cada módulo resuelve un paso que, a mano, se pierde o se hace mal.
          </p>
        </Rise>
        <div className="mt-14 grid gap-4 md:grid-cols-6">
          <Tarjeta className="md:col-span-4" rotulo="Viabilidad con IA" titulo="Qué exigen las bases, con la página donde lo dicen"
            texto="Lee bases, anexos y fichas, y entrega un veredicto por requisito para decidir si conviene postular. Caso real de Mercado Público."><DemoViabilidad /></Tarjeta>
          <Tarjeta className="md:col-span-2" rotulo="Lectura de documentos" titulo="Lee lo que otros descartan"
            texto="PDF, Word, Excel y escaneos con OCR."><DemoLectura /></Tarjeta>
          <Tarjeta className="md:col-span-2" rotulo="Anexos" titulo="Anexos rellenados"
            texto="Con los datos de tu empresa, en el formato original de las bases."><DemoAnexo /></Tarjeta>
          <Tarjeta className="md:col-span-4" rotulo="Auditor técnico" titulo="Tu oferta contra las bases, línea por línea"
            texto="Compara cada requisito técnico con lo que ofreces y marca lo que no cumple antes de que lo haga la comisión evaluadora."><DemoAuditor /></Tarjeta>
          <Tarjeta className="md:col-span-3" rotulo="Costeo" titulo="Cuánto cuesta y cuánto ganas"
            texto="Cotizaciones comparadas, margen por ítem y presupuesto listo para la oferta económica."><DemoCosteo /></Tarjeta>
          <Tarjeta className="md:col-span-3" rotulo="Compras" titulo="Después de ganar, el negocio sigue"
            texto="De la orden de compra a la factura, con aprobación, proveedores y entrega en el mismo flujo."><DemoCompras /></Tarjeta>
          <Tarjeta className="md:col-span-6" rotulo="Asistente de la licitación" titulo="Pregúntale a las bases"
            texto="Responde con las bases leídas y cita el artículo y el anexo de donde sale cada respuesta. Una pregunta real: el anexo sugería un total, pero las bases adjudican por línea."><DemoChat /></Tarjeta>
        </div>
      </div>
    </section>
  );
}

/* ── 4. Marco normativo ───────────────────────────────────────────────────── */

const MARCO: [string, string][] = [
  ['Ley N° 19.886', 'Bases sobre contratos administrativos de suministro y prestación de servicios, y su reglamento.'],
  ['Ley N° 21.634', 'Modernización de la Ley de Compras Públicas.'],
  ['Compra Ágil', 'Cotizaciones rápidas de menor monto, con plazos de horas.'],
  ['Licitaciones L1, LE, LP, LQ y LR', 'Los tipos de licitación pública según monto, cada uno con sus plazos y exigencias.'],
  ['Registro de Proveedores', 'Inscripción y documentos vigentes para ofertar al Estado.'],
  ['Garantías', 'Seriedad de la oferta y fiel cumplimiento del contrato.'],
  ['Inhabilidades', 'Declaraciones juradas del artículo 4º de la Ley N° 19.886.'],
  ['Convenio Marco', 'El catálogo electrónico, como alternativa y como competencia.'],
];

export function Marco() {
  return (
    <section className="border-t border-white/10 bg-[#0d1117]">
      <div className="mx-auto max-w-[1200px] px-5 py-24 sm:px-8 sm:py-32">
        <Rise>
          <p className="text-xs text-teal-400" style={mono}>Conocimiento del sector</p>
          <h2 style={serif} className="mt-3 max-w-[820px] text-[36px] leading-[1.06] tracking-[-0.02em] text-white sm:text-[54px]">
            Construido sobre cómo compra el Estado de Chile.
          </h2>
        </Rise>
        <dl className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
          {MARCO.map(([k, v], i) => (
            <motion.div key={k} initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true, margin: '-10% 0px' }} transition={{ delay: (i % 4) * 0.08, duration: 0.6 }}
              className="bg-[#0a0d12] p-6 transition-colors duration-200 hover:bg-[#10161d]">
              <dt className="text-[15px] font-medium text-white">{k}</dt>
              <dd className="mt-2 text-[13.5px] leading-[1.6] text-slate-400">{v}</dd>
            </motion.div>
          ))}
        </dl>
        <Rise delay={0.1}>
          <div className="mt-16 flex items-center gap-4 text-slate-400">
            <LicitankIcon size={34} />
            <p className="max-w-[640px] text-[15px] leading-[1.6]">
              Cada regla que ves arriba está en el sistema: en el análisis de bases, en los candados de la postulación y en las alertas.
            </p>
          </div>
        </Rise>
      </div>
    </section>
  );
}

const css = `
.lk-spot{background:radial-gradient(420px circle at var(--mx,50%) var(--my,50%),rgba(45,212,191,.11),transparent 62%)}
.lk-caret{animation:lk-caret 1s steps(2,start) infinite}
@keyframes lk-caret{to{visibility:hidden}}
.lk-typing{animation:lk-typing 1s ease-in-out infinite}
@keyframes lk-typing{0%,100%{opacity:.3;transform:translateY(0)}50%{opacity:1;transform:translateY(-3px)}}
@media (prefers-reduced-motion:reduce){.lk-caret,.lk-typing{animation:none}}
`;
