'use client';

// Cabecera, datos clave y "Cómo ganar" de la vista v4 (Tailwind, mismo lenguaje que StatCard/Badge de la app).
// Movimiento: entrada escalonada y números que cuentan (framer-motion + useContador); respeta "reducir movimiento".
// Solo presentación: los datos y las reglas siguen viniendo del informe.

import { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { IconAlertTriangle as AlertTriangle, IconBan as Ban, IconCompass as Compass, IconChevronDown as ChevronDown, IconCheck as Check, IconClock as Clock, IconTrophy as Trophy, IconX as X, IconArrowRight as ArrowRight, IconBulb as Bulb, IconWallet as Wallet, IconGavel as Gavel, IconStarFilled as StarFilled, IconTrendingUp as TrendingUp, IconTrendingDown as TrendingDown, IconEqual as Equal, IconPackage as Package, IconClipboardCheck as ClipboardCheck, IconSearch as Search, IconShieldCheck as ShieldCheck, IconPencil as Pencil, IconQuote as Quote, IconScale as Scale, IconTarget as Target, IconListCheck as ListChecks, IconHelpCircle as HelpCircle } from '@tabler/icons-react';
import { Badge } from '@/app/components/ui/Badge';
import { useContador } from '@/app/lib/use-contador';
import { BotonBuscarEquipo } from './viabilidad-ui-comun';
import { Cita, FraseCitada, _norm, EVIDENCIA_TEXTO, NIVEL_VISTA, PERIODO, cap, fmt, mayus, oracion, sinCA, valorMulta } from './viabilidad-v4-comun';

const ACCION: Record<string, { cls: string; icono: React.ReactNode }> = {
  SEGUIR:         { cls: 'text-emerald-800 bg-emerald-100 border-emerald-300', icono: <Check size={15} /> },
  CONSULTAR_CA:   { cls: 'text-yellow-800 bg-yellow-100 border-yellow-300',   icono: <HelpCircle size={15} /> },
  SOLTAR:         { cls: 'text-red-800 bg-red-100 border-red-300',            icono: <Ban size={15} /> },
  REVISAR_SALIDA: { cls: 'text-orange-800 bg-orange-100 border-orange-300',   icono: <Compass size={15} /> },
  CONFIRMAR_DATO: { cls: 'text-sky-800 bg-sky-100 border-sky-300',            icono: <HelpCircle size={15} /> },
};

type Variante = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info';
const CLASE: Record<string, { label: string; variante: Variante; tip: string; ley?: boolean }> = {
  LEY_DEL_MINIMO: { label: 'Ley del mínimo', variante: 'success', ley: true, tip: 'Gana quien oferte el valor más bajo: cada unidad de mejora suma puntaje.' },
  LEY_DEL_MAXIMO: { label: 'Ley del máximo', variante: 'success', ley: true, tip: 'Gana quien oferte el valor más alto: cada unidad de mejora suma puntaje.' },
  POR_TRAMOS:     { label: 'Por tramos',     variante: 'default', tip: 'El puntaje va por rangos: basta con quedar en el mejor tramo.' },
  ACUMULATIVO:    { label: 'Acumulativo',    variante: 'primary', tip: 'Suma puntos por cada requisito que se cumple: cumple el máximo posible.' },
  BINARIO:        { label: 'Cumple o no',    variante: 'info',    tip: 'Se cumple o no se cumple: no hay puntaje intermedio.' },
};
const JUGADA: Record<string, { label: string; icono: React.ReactNode; tono: string; texto: string }> = {
  OPORTUNIDAD: { label: 'Oportunidad: aquí se gana',       icono: <TrendingUp size={17} />,   tono: 'bg-emerald-100 text-emerald-700', texto: 'text-emerald-700' },
  RESOLVER:    { label: 'Por resolver antes de ofertar',   icono: <HelpCircle size={17} />,   tono: 'bg-amber-100 text-amber-700',     texto: 'text-amber-700' },
  EMPATE:      { label: 'Empate: todos parten igual',      icono: <Equal size={17} />,        tono: 'bg-slate-100 text-slate-600',     texto: 'text-slate-500' },
  EN_CONTRA:   { label: 'En contra: nos juega en contra',  icono: <TrendingDown size={17} />, tono: 'bg-red-100 text-red-700',         texto: 'text-red-700' },
};
const COLOR_CRITERIO = [
  { hex: '#8b5cf6', barra: 'bg-violet-500', suave: 'bg-violet-50', texto: 'text-violet-700' },
  { hex: '#10b981', barra: 'bg-emerald-500', suave: 'bg-emerald-50', texto: 'text-emerald-700' },
  { hex: '#0ea5e9', barra: 'bg-sky-500', suave: 'bg-sky-50', texto: 'text-sky-700' },
  { hex: '#f59e0b', barra: 'bg-amber-500', suave: 'bg-amber-50', texto: 'text-amber-700' },
  { hex: '#f43f5e', barra: 'bg-rose-500', suave: 'bg-rose-50', texto: 'text-rose-700' },
  { hex: '#64748b', barra: 'bg-slate-500', suave: 'bg-slate-100', texto: 'text-slate-700' },
];

// ─── Movimiento ────────────────────────────────────────────────────────────────────────────
function Aparece({ i = 0, children, alto }: { i?: number; children: React.ReactNode; alto?: boolean }) {
  const reducido = useReducedMotion();
  return (
    <motion.div className={alto ? 'h-full min-w-0' : undefined} initial={reducido ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.38, delay: Math.min(i, 10) * 0.055, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </motion.div>
  );
}
function Pct({ valor }: { valor: number }) { return <>{Math.round(useContador(valor))}</>; }
function Contado({ valor }: { valor: number }) { return <>{fmt(Math.round(useContador(valor)))}</>; }

// "Texto (detalle largo): resto" → { corto: "Texto: resto", detalle } — soporta paréntesis anidados.
function partirAviso(a: string) {
  const i = a.indexOf('('), j = a.lastIndexOf(')');
  if (i <= 0 || j <= i) return { corto: a, detalle: '' };
  return { corto: (a.slice(0, i).trimEnd() + a.slice(j + 1)).replace(/\s+([:.,;])/g, '$1').trim(), detalle: a.slice(i + 1, j).trim() };
}
function Aviso({ texto }: { texto: string }) {
  const [abierto, setAbierto] = useState(false);
  const { corto, detalle } = partirAviso(sinCA(texto));
  return (
    <li className="text-[12.5px] text-amber-800 leading-snug">
      <AlertTriangle size={13} className="inline -mt-0.5 mr-1 text-amber-500" />{mayus(corto)}
      {detalle && <button type="button" onClick={() => setAbierto(v => !v)} className="ml-1.5 text-[12px] font-semibold text-violet-700 hover:underline">{abierto ? 'Ocultar motivo' : 'Ver motivo'}</button>}
      {detalle && abierto && <span className="block mt-0.5 text-slate-600">{mayus(detalle)}</span>}
    </li>
  );
}

// ─── Cabecera: nivel + acción + porqué ─────────────────────────────────────────────────────
export function CabeceraV4({ s, t, enRevision, esCA }: { s: any; t: any; enRevision: boolean; esCA: boolean }) {
  const [verDesglose, setVerDesglose] = useState(false);
  const nv = NIVEL_VISTA[s.nivel] || NIVEL_VISTA.MEDIO;
  const ac = ACCION[s.accion_asistente] || ACCION.CONSULTAR_CA;
  const avisos: string[] = Array.isArray(s.avisos) ? s.avisos : [];
  return (
    <Aparece>
      <div className={`rounded-2xl border px-4 py-3.5 ${nv.soft}`}>
        <div className="flex items-center gap-2 flex-wrap">
          <span title={nv.tip} className={`text-[13px] font-black text-white px-3 py-1 rounded-lg cursor-help ${nv.cls}`}>{nv.label}</span>
          <span className={`inline-flex items-center gap-1.5 text-[13px] font-bold px-3 py-1 rounded-lg border ${ac.cls}`}>{ac.icono} {mayus(sinCA(s.accion_texto)) || '—'}</span>
          <span title={enRevision ? 'Una persona debe revisar el informe antes de decidir' : 'Análisis firme'}
            className={`ml-auto text-[11px] font-semibold px-2 py-0.5 rounded-md border cursor-help ${enRevision ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>{enRevision ? 'Revisión humana' : 'Definitivo'}</span>
        </div>
        {s.resumen_pantalla && <p className="text-[14px] font-bold text-slate-800 mt-2.5 leading-snug">{String(s.resumen_pantalla).replace(/^[A-ZÁÉÍÓÚ ]+ · /, '').split(' · ').map(mayus).join(' · ')}</p>}
        {t.titular && <p className="text-[13px] text-slate-600 mt-0.5 leading-snug">{mayus(sinCA(t.titular))}</p>}
        {s.motivo_exclusion && (
          <div className="mt-2 text-[12.5px] text-red-800 bg-white/70 border border-red-200 rounded-lg p-2">
            <p><strong>Motivo:</strong> {s.motivo_exclusion.texto}</p>
            <FraseCitada cita={s.motivo_exclusion.cita} />
            <Cita cita={s.motivo_exclusion.cita} />
          </div>
        )}
        {avisos.length > 0 && <ul className="mt-2 space-y-1">{avisos.map((a, i) => <Aviso key={i} texto={a} />)}</ul>}
        {esCA && (s.pasos?.length ?? 0) > 0 && (
          <div className="mt-2">
            <button onClick={() => setVerDesglose(v => !v)} className="text-[11px] font-semibold text-violet-700 inline-flex items-center gap-1">
              <ChevronDown size={12} className={`transition-transform ${verDesglose ? 'rotate-180' : ''}`} /> Desglose del nivel (solo admin)
            </button>
            {verDesglose && (
              <div className="mt-1 bg-white/70 rounded-lg border border-slate-200 p-2 space-y-0.5">
                {s.pasos.map((p: any, i: number) => <p key={i} className="text-[11px] text-slate-600"><span className="font-semibold">{p.regla}</span> · {p.efecto} · {p.dato}</p>)}
                <p className="text-[10px] text-slate-400 pt-1">Reglas {s.version_reglas} · calculado {s.calculado_en ? new Date(s.calculado_en).toLocaleString('es-CL') : ''}{s.supuesto_no_claro ? ` · supuesto: ${s.supuesto_no_claro === 'GLOBAL' ? 'global' : 'por línea'}` : ''}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </Aparece>
  );
}

// ─── Datos clave: 4 tarjetas iguales (mismo molde que StatCard) ────────────────────────────
function TarjetaClave({ i, etiqueta, icono, color, alerta, titulo, valor, numero, formato, unidad, clave, texto, textoClase, pie, children }: {
  i: number; etiqueta: string; icono: React.ReactNode; color: string; alerta?: boolean; titulo?: string; valor: string;
  numero?: number; formato?: (n: number) => string; unidad?: string;
  clave?: React.ReactNode; texto?: string; textoClase?: string; pie?: React.ReactNode; children?: React.ReactNode;
}) {
  const animado = useContador(numero ?? 0);
  const visible = numero != null && formato ? formato(Math.round(animado)) : valor;
  const clsValor = valor.length > 13 ? 'text-[18px]' : valor.length > 10 ? 'text-[21px]' : 'text-[24px]';
  return (
    <Aparece i={i} alto>
      <div title={titulo} className={`min-w-0 border rounded-2xl p-4 h-full flex flex-col gap-2 break-words transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 ${alerta ? 'border-red-300 bg-red-50/30' : 'bg-white border-slate-200'}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide mb-1.5">{etiqueta}</p>
            <p className={`${clsValor} font-black leading-none tabular-nums text-slate-900`}>{visible}{unidad ? <span className="text-[11px] font-semibold text-slate-400"> {unidad}</span> : null}</p>
          </div>
          <div className="w-[38px] h-[38px] rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: color + '18', color }}>{icono}</div>
        </div>
        {clave && <div>{clave}</div>}
        {texto && <p className={`text-[12px] leading-snug ${textoClase || 'text-slate-500'}`}>{texto}</p>}
        {children}
        {pie && <div className="mt-auto pt-1">{pie}</div>}
      </div>
    </Aparece>
  );
}

export function TarjetasClaveV4({ informe, onVerPlazos }: { informe: any; onVerPlazos: () => void }) {
  const pres = informe.presupuesto || {};
  const adj = informe.adjudicacion || {};
  const pp = informe.plazos?.plazo_previo || null;
  const hitos: any[] = Array.isArray(informe.plazos?.hitos) ? informe.plazos.hitos : [];
  const atraso = informe.multas?.atraso || null;
  const porLinea: any[] = Array.isArray(pres.por_linea_interpretado) ? pres.por_linea_interpretado : [];
  const evidencia = (Array.isArray(adj.evidencias) ? adj.evidencias : []).filter((e: any) => e?.cuenta).find((e: any) => e?.cita?.frase) || null;
  const excluyente = pres.caracter === 'EXCLUYENTE';
  const dias = pp ? Number(pp.total_dias_corridos) : null;
  const sinPlazo = !!pp && dias === 0;
  const plazoNoExigido = hitos.length > 0 && hitos.every(h => String(h.estado || '').toUpperCase() === 'NO_EXISTE');
  const multaDia = atraso?.calculo?.pesos_dia_estimado;
  const hayMulta = atraso?.existe !== false && (multaDia != null || atraso?.valor);
  const prefijoPlazo = pp?.al_menos ? 'Al menos ' : '';
  const enlace = (txt: string) => <button type="button" onClick={onVerPlazos} className="text-[11.5px] font-semibold text-violet-700 hover:underline">{txt} →</button>;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 items-stretch">
      <TarjetaClave i={0} etiqueta="Presupuesto" icono={<Wallet size={20} />} color={excluyente ? '#dc2626' : '#059669'} alerta={excluyente}
        valor={pres.bruto ? fmt(pres.bruto) : 'No publicado'} numero={pres.bruto ? Number(pres.bruto) : undefined} formato={fmt} unidad={pres.bruto && !pres.regimen_fora ? 'IVA incl.' : undefined}
        clave={excluyente
          ? <span className="inline-flex items-center gap-1 text-[12.5px] font-black uppercase tracking-wide text-white bg-red-600 px-2.5 py-1 rounded-md"><Ban size={13} /> Excluyente</span>
          : <Badge>{mayus(cap(pres.caracter || 'NO_DECLARADO').toLowerCase())}</Badge>}
        texto={excluyente ? 'Si lo superas, tu oferta queda fuera de la licitación.' : pres.nota_art_32 ? mayus(pres.nota_art_32) : 'Las bases no declaran si superarlo deja fuera la oferta.'}
        textoClase={excluyente ? 'text-red-700 font-semibold' : undefined}
        pie={pres.cita ? <Cita cita={pres.cita} /> : undefined}>
        {porLinea.length >= 2 && <div>{porLinea.map((l: any) => <p key={l.linea} className="text-[12px] text-slate-600"><span className="font-bold">{l.linea}</span> {fmt(l.monto_pesos)}</p>)}</div>}
      </TarjetaClave>
      <TarjetaClave i={1} etiqueta="Cómo se adjudica" icono={<Gavel size={20} />} color={adj.resultado === 'NO_CLARO' ? '#d97706' : '#7c3aed'} alerta={false}
        valor={adj.resultado === 'POR_LINEAS' ? 'Por línea' : adj.resultado === 'GLOBAL' ? 'Global' : 'No está claro'}
        clave={adj.cotizar_100_texto ? <Badge variant="primary" className="text-[12px]">{mayus(adj.cotizar_100_texto)}</Badge> : undefined}
        texto={evidencia ? `Las bases dicen que ${EVIDENCIA_TEXTO[evidencia.tipo] || cap(evidencia.tipo).toLowerCase()}.`
          : adj.resultado === 'GLOBAL' ? 'Todo se adjudica a un solo proveedor.'
          : adj.resultado === 'POR_LINEAS' ? 'Se puede ganar una o más líneas por separado.'
          : 'Confírmalo en las bases antes de decidir.'}
        pie={evidencia ? <Cita cita={evidencia.cita} /> : undefined}>
        {adj.regla_aplicada === 'CONFIRMADA' && adj.motivo && <p className="text-[12px] text-sky-700">{mayus(adj.motivo)}</p>}
      </TarjetaClave>
      <TarjetaClave i={2} etiqueta="Plazo previo" icono={<Clock size={20} />} color="#0284c7" titulo="Tiempo administrativo entre la adjudicación y el inicio del plazo de entrega"
        valor={!pp ? '—' : sinPlazo ? 'Sin plazo previo' : `${prefijoPlazo}${dias} Días`}
        numero={pp && !sinPlazo ? dias! : undefined} formato={n => `${prefijoPlazo}${n} Días`}
        clave={pp ? <Badge variant={sinPlazo ? 'default' : 'info'} className="text-[12px]">{sinPlazo ? (plazoNoExigido ? 'Las bases no lo exigen' : 'No indicado en las bases') : 'Días corridos'}</Badge> : undefined}
        texto="Desde que se adjudica hasta que parte el plazo de entrega."
        pie={enlace('Ver plazos')} />
      <TarjetaClave i={3} etiqueta="Multa por atraso" icono={<AlertTriangle size={20} />} color="#d97706"
        valor={atraso?.existe === false ? 'No hay' : multaDia != null ? `≈ ${fmt(multaDia)}` : atraso?.valor ? valorMulta(atraso) : '—'}
        numero={atraso?.existe !== false && multaDia != null ? Number(multaDia) : undefined} formato={n => `≈ ${fmt(n)}`}
        clave={hayMulta ? <Badge variant="warning" className="text-[12px]">Por {PERIODO[String(atraso?.periodo || '').toUpperCase()] || 'día'} de atraso</Badge> : undefined}
        texto={atraso?.existe === false ? 'Las bases no establecen multa por atraso.' : atraso?.calculo?.nota ? mayus(atraso.calculo.nota) : 'Se descuenta por cada día de atraso.'}
        pie={enlace('Ver detalle')} />
    </div>
  );
}

// ─── Cómo ganar ────────────────────────────────────────────────────────────────────────────
function Bloque({ i, icon, titulo, subtitulo, derecha, children }: { i: number; icon: React.ReactNode; titulo: string; subtitulo?: string; derecha?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Aparece i={i}>
      <section className="border border-slate-200 rounded-2xl bg-white p-5">
        <div className="flex items-start gap-3 mb-4">
          <span className="flex-shrink-0 w-9 h-9 rounded-xl bg-violet-100 text-violet-600 flex items-center justify-center">{icon}</span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[17px] font-black text-slate-900 leading-tight">{titulo}</h3>
            {subtitulo && <p className="text-[12.5px] text-slate-500 mt-0.5">{subtitulo}</p>}
          </div>
          {derecha}
        </div>
        {children}
      </section>
    </Aparece>
  );
}

// El dato más importante de un criterio: cómo se puntúa el valor. Siempre sólido y destacado.
function MarcaLey({ clase }: { clase: { label: string; tip: string } }) {
  return <span title={clase.tip} className="inline-flex items-center gap-1.5 bg-emerald-600 text-white text-[12px] font-black uppercase tracking-wide px-2.5 py-1 rounded-md cursor-help"><StarFilled size={13} />{clase.label}</span>;
}

// Gráfico circular del peso del criterio: el arco se dibuja y el número sube al mismo tiempo.
function Anillo({ pond, hex }: { pond: number; hex: string }) {
  const reducido = useReducedMotion();
  const R = 30, C = 2 * Math.PI * R;
  const destino = C * (1 - Math.max(0, Math.min(100, pond)) / 100);
  return (
    <div className="relative flex-shrink-0 w-[76px] h-[76px]">
      <svg viewBox="0 0 76 76" className="w-full h-full -rotate-90">
        <circle cx="38" cy="38" r={R} fill="none" stroke="#e2e8f0" strokeWidth="8" />
        <motion.circle cx="38" cy="38" r={R} fill="none" stroke={hex} strokeWidth="8" strokeLinecap="round" strokeDasharray={C}
          initial={{ strokeDashoffset: reducido ? destino : C }} animate={{ strokeDashoffset: destino }} transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }} />
      </svg>
      <p className="absolute inset-0 flex items-center justify-center text-[18px] font-black tabular-nums text-slate-900"><Pct valor={pond} /><span className="text-[11px] font-bold text-slate-500">%</span></p>
    </div>
  );
}

function BarraDistribucion({ items }: { items: { nombre: string; pond: number; barra: string }[] }) {
  const p = useContador(1);
  return (
    <div className="flex h-4 rounded-full overflow-hidden bg-slate-100">
      {items.map((it, i) => <div key={i} title={`${it.nombre}: ${it.pond} %`} className={it.barra} style={{ width: `${Math.max(0, it.pond * p)}%` }} />)}
    </div>
  );
}

// Criterios de evaluación: lo usan "Cómo ganar" (informe de viabilidad) y la pestaña Criterios, con los datos que tenga cada fuente.
export function CriteriosEvaluacionV4({ criterios, crit = {}, i = 1 }: { criterios: object[]; crit?: any; i?: number }) {
  const lista = criterios as any[];
  const pondDe = (c: any) => Number(c.ponderacion_efectiva) || Number(c.ponderacion_nominal) || Number(c.ponderacion) || Number(c.ponderacion_pct) || 0;
  const ordenados = [...lista].sort((a, b) => pondDe(b) - pondDe(a));
  const claseDe = (c: any) => CLASE[String(c?.clase || '').toUpperCase()];
  const critLey = ordenados.find(c => claseDe(c)?.ley);
  const suma = Number(crit.suma_ponderaciones_real) || ordenados.reduce((a, c) => a + pondDe(c), 0);
  const sumaValida = crit.suma_valida ?? Math.round(suma) === 100;
  if (ordenados.length === 0) return null;
  return (
    <Bloque i={i} icon={<Scale size={18} />} titulo="Criterios de evaluación" subtitulo="Así se reparte el puntaje: mientras más alto el porcentaje, más pesa en la decisión."
      derecha={<span className={`text-[12px] font-bold px-2.5 py-1 rounded-full ${sumaValida ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>Suma {Math.round(suma)} %{sumaValida ? ' ✓' : ' · Revisar'}</span>}>
      <div className="space-y-4">
        <div>
          <BarraDistribucion items={ordenados.map((c, i) => ({ nombre: c.nombre, pond: pondDe(c), barra: COLOR_CRITERIO[i % COLOR_CRITERIO.length].barra }))} />
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
            {ordenados.map((c, i) => <span key={i} className="inline-flex items-center gap-1.5 text-[12px] text-slate-600"><span className={`w-2.5 h-2.5 rounded-sm ${COLOR_CRITERIO[i % COLOR_CRITERIO.length].barra}`} />{oracion(c.nombre)} <strong className="text-slate-800">{pondDe(c)} %</strong></span>)}
          </div>
        </div>
        {critLey && (
          <div className="rounded-xl bg-emerald-600 text-white px-4 py-3 flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-[13px] font-black uppercase tracking-wide"><StarFilled size={15} />{claseDe(critLey).label}</span>
            <span className="text-[13.5px] font-semibold leading-snug flex-1 min-w-[220px]">«{oracion(critLey.nombre)}» · {pondDe(critLey)} %: {claseDe(critLey).tip.charAt(0).toLowerCase() + claseDe(critLey).tip.slice(1)}</span>
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-stretch">
          {ordenados.map((c, i) => {
            const cl = claseDe(c);
            const col = COLOR_CRITERIO[i % COLOR_CRITERIO.length];
            const pond = pondDe(c);
            return (
              <Aparece key={i} i={i + 2} alto>
                <div className={`rounded-xl p-4 h-full flex flex-col gap-2 ${cl?.ley ? 'border-2 border-emerald-500 bg-emerald-50/60' : 'border border-slate-200 bg-white'}`}>
                  <div className="flex items-start gap-3">
                    <Anillo pond={pond} hex={col.hex} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-bold text-slate-900 leading-snug">{oracion(c.nombre)}</p>
                      <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                        {cl?.ley ? <MarcaLey clase={cl} /> : cl && <span title={cl.tip} className="cursor-help"><Badge variant={cl.variante}>{cl.label}</Badge></span>}
                        {c.tramo_max_puntaje?.borde_comodo && <span title="Valor que da el máximo puntaje con menos riesgo"><Badge variant="warning">Valor cómodo: {c.tramo_max_puntaje.borde_comodo}</Badge></span>}
                      </div>
                    </div>
                  </div>
                  {cl && <p className={`text-[12.5px] leading-snug ${cl.ley ? 'font-bold text-emerald-900' : 'text-slate-700'}`}><span className="font-bold">{cl.ley ? 'Cómo se gana: ' : 'Cómo puntúa: '}</span>{cl.tip}</p>}
                  {(c.forma_aplicacion || c.descripcion || c.fuente) && <p className="text-[12.5px] text-slate-500 leading-snug">{mayus(c.forma_aplicacion || c.descripcion || c.fuente)}</p>}
                  {c.puntaje_minimo?.valor && <p className="text-[12.5px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">Puntaje mínimo: {c.puntaje_minimo.valor} {c.puntaje_minimo.unidad || ''} — {c.puntaje_minimo.consecuencia}</p>}
                  {c.cita && <div className="mt-auto"><Cita cita={c.cita} /></div>}
                </div>
              </Aparece>
            );
          })}
        </div>
        {crit.puntaje_minimo_total?.valor && <p className="text-[13px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">Puntaje mínimo total: {crit.puntaje_minimo_total.valor} {crit.puntaje_minimo_total.unidad || ''} — {crit.puntaje_minimo_total.consecuencia} <Cita cita={crit.puntaje_minimo_total.cita} /></p>}
        {(crit.alertas?.length ?? 0) > 0 && <div className="text-[12.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-0.5">{crit.alertas.map((a: string, i: number) => <p key={i} className="flex items-start gap-1.5"><AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />{mayus(a)}</p>)}</div>}
      </div>
    </Bloque>
  );
}

export function GanarV4({ informe }: { informe: any }) {
  const t = informe.tarjeta_decision || {};
  const crit = informe.criterios_evaluacion || {};
  const criterios: any[] = Array.isArray(crit.criterios) ? crit.criterios : [];
  const est = informe.estrategia || {};
  const dsd = est.donde_se_decide || {};
  const paraGanar: string[] = Array.isArray(t.para_ganar) ? t.para_ganar : [];
  const noFuera: string[] = Array.isArray(t.no_quedes_fuera) ? t.no_quedes_fuera : [];
  const jugadas: any[] = Array.isArray(est.jugadas) ? est.jugadas : [];
  const lectura = informe.atractivo?.lectura_comercial ? mayus(sinCA(informe.atractivo.lectura_comercial)) : '';
  return (
    <div className="space-y-3">
      {(t.se_gana_en || dsd.orden_final || lectura || paraGanar.length > 0 || noFuera.length > 0) && (
        <Bloque i={0} icon={<Target size={18} />} titulo="Resumen para decidir" subtitulo="Lo esencial: dónde se gana, qué hacer y qué evitar.">
          <div className="space-y-3">
            {t.se_gana_en && (
              <div className="rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white p-4 flex items-start gap-3">
                <Trophy size={26} className="flex-shrink-0 mt-0.5" />
                <div><p className="text-[11px] font-bold uppercase tracking-wider text-violet-200">Se gana en</p><p className="text-[16px] font-bold leading-snug">{oracion(t.se_gana_en)}</p></div>
              </div>
            )}
            {dsd.orden_final && (
              <div className="rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white p-4 flex items-start gap-3">
                <Compass size={26} className="flex-shrink-0 mt-0.5" />
                <div><p className="text-[11px] font-bold uppercase tracking-wider text-violet-200">Dónde se decide</p><p className="text-[15px] font-semibold leading-snug">{oracion(dsd.orden_final)}</p></div>
              </div>
            )}
            {lectura && (
              <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-start gap-3">
                <Scale size={20} className="text-violet-600 flex-shrink-0 mt-0.5" />
                <div><p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Lectura comercial</p><p className="text-[14px] text-slate-700 leading-relaxed">{lectura}</p></div>
              </div>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-stretch">
              {paraGanar.length > 0 && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
                  <p className="flex items-center gap-1.5 text-[13px] font-black uppercase tracking-wide text-emerald-700 mb-2.5"><Check size={16} /> Para ganar</p>
                  <ol className="space-y-2">{paraGanar.map((x, i) => (
                    <li key={i} className="flex items-start gap-2.5"><span className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-600 text-white text-[12px] font-black flex items-center justify-center">{i + 1}</span><span className="text-[14px] text-slate-800 leading-snug">{oracion(x)}</span></li>
                  ))}</ol>
                </div>
              )}
              {noFuera.length > 0 && (
                <div className="rounded-xl border border-red-200 bg-red-50/50 p-4">
                  <p className="flex items-center gap-1.5 text-[13px] font-black uppercase tracking-wide text-red-700 mb-2.5"><Ban size={16} /> No quedes fuera</p>
                  <ul className="space-y-2">{noFuera.map((x, i) => (
                    <li key={i} className="flex items-start gap-2.5"><span className="flex-shrink-0 w-6 h-6 rounded-full bg-red-600 text-white flex items-center justify-center"><X size={14} /></span><span className="text-[14px] text-slate-800 leading-snug">{oracion(x)}</span></li>
                  ))}</ul>
                </div>
              )}
            </div>
            {t.antes_de_ir && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 flex items-start gap-2.5">
                <Bulb size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-[13.5px] text-amber-900 leading-snug"><span className="font-black uppercase text-[11px] tracking-wide block text-amber-700">Antes de ir</span>{oracion(t.antes_de_ir)}</p>
              </div>
            )}
          </div>
        </Bloque>
      )}

      <CriteriosEvaluacionV4 criterios={criterios} crit={crit} i={1} />

      {jugadas.length > 0 && (
        <Bloque i={3} icon={<ListChecks size={18} />} titulo="Estrategia" subtitulo="Dónde se gana el puntaje y qué hacer en cada criterio.">
          <div className="space-y-3">
            {jugadas.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-stretch">
                {jugadas.map((j, i) => {
                  const jg = JUGADA[String(j.etiqueta || '').toUpperCase()] || JUGADA.EMPATE;
                  const cl = CLASE[String(j.clase || '').toUpperCase()];
                  return (
                    <Aparece key={i} i={i + 1} alto>
                      <div className="rounded-xl border border-slate-200 bg-white p-4 h-full flex flex-col gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${jg.tono}`}>{jg.icono}</span>
                          <span className={`text-[11px] font-black uppercase tracking-wide ${jg.texto}`}>{jg.label}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-[15px] font-bold text-slate-900 leading-snug">{oracion(j.criterio)}</p>
                          {cl?.ley ? <MarcaLey clase={cl} /> : cl && <span title={cl.tip} className="cursor-help"><Badge variant={cl.variante}>{cl.label}</Badge></span>}
                          {j.exige_respaldo && <Badge variant="warning">Exige stock o respaldo</Badge>}
                        </div>
                        {j.lectura && <p className="text-[13px] text-slate-600 leading-snug">{oracion(j.lectura)}</p>}
                        {j.orden && (
                          <div className="rounded-lg bg-slate-900 text-white px-3 py-2.5 flex items-start gap-2">
                            <ArrowRight size={16} className="flex-shrink-0 mt-0.5 text-emerald-400" />
                            <p className="text-[13.5px] font-semibold leading-snug"><span className="block text-[10.5px] font-bold uppercase tracking-wide text-slate-400">Qué hacer</span>{oracion(j.orden)}{j.valor_a_ofertar ? <span className="text-emerald-300"> ({j.valor_a_ofertar})</span> : null}</p>
                          </div>
                        )}
                        {j.cita && <div className="mt-auto"><Cita cita={j.cita} /></div>}
                      </div>
                    </Aparece>
                  );
                })}
              </div>
            )}
          </div>
        </Bloque>
      )}
    </div>
  );
}

// ─── Admisibilidad: lo que deja la oferta fuera ────────────────────────────────────────────
const FIRMA: Record<string, { titulo: string; accion: string; tono: string; texto: string; icono: React.ReactNode }> = {
  ESCANEADA_BASTA:            { titulo: 'Basta firma escaneada',      accion: 'Pega la imagen de la firma.',                      tono: 'bg-emerald-100', texto: 'text-emerald-700', icono: <Check size={17} /> },
  MANO_Y_ESCANEO:             { titulo: 'Firma a mano y escanea',     accion: 'Imprime, firma a mano y escanea.',                 tono: 'bg-amber-100',   texto: 'text-amber-700',   icono: <Pencil size={17} /> },
  ORIGINAL_NOTARIAL:          { titulo: 'Original o notarial',        accion: 'Requiere gestión presencial.',                     tono: 'bg-red-100',     texto: 'text-red-700',     icono: <Ban size={17} /> },
  FIRMA_ELECTRONICA_AVANZADA: { titulo: 'Firma electrónica avanzada', accion: 'Requiere token de firma electrónica avanzada.',    tono: 'bg-red-100',     texto: 'text-red-700',     icono: <Ban size={17} /> },
};
const GARANTIAS: Array<[string, string]> = [['seriedad', 'Seriedad de la oferta'], ['fiel_cumplimiento', 'Fiel cumplimiento'], ['contrato', 'Contrato']];

const COND_TITULO: Record<string, string> = {
  PLAZO_PAGO: 'Plazo de pago', LUGAR_ENTREGA: 'Lugar de entrega', INSTALACION: 'Instalación / puesta en marcha',
  VIGENCIA_OFERTA: 'Vigencia de la oferta', UNION_SUBCONTRATACION: 'Consorcio / subcontratación',
};
const OTRA_TITULO: Record<string, string> = {
  REUNION_INFORMATIVA: 'Reunión informativa', DEMOSTRACION: 'Demostración', PRUEBA_FUNCIONAMIENTO: 'Prueba de funcionamiento',
  PRESENTACION: 'Presentación', INSPECCION_PROVEEDOR: 'Inspección al proveedor', OTRA: 'Exigencia presencial',
};

function FichaPresencial({ icono, titulo, estado, tono, datos, consecuencia, cita, delDetector }: {
  icono: React.ReactNode; titulo: string; estado: string; tono: 'rojo' | 'ambar' | 'verde' | 'gris';
  datos: Array<[string, any]>; consecuencia?: string; cita?: any; delDetector?: boolean;
}) {
  const color = { rojo: 'bg-red-100 text-red-700', ambar: 'bg-amber-100 text-amber-700', verde: 'bg-emerald-100 text-emerald-700', gris: 'bg-slate-100 text-slate-500' }[tono];
  const filas = datos.filter(([, v]) => v && String(v).trim());
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 h-full flex flex-col gap-2.5">
      <div className="flex items-start gap-2.5">
        <span className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${color}`}>{icono}</span>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{titulo}</p>
          <p className="text-[14.5px] font-bold text-slate-900 leading-snug">{estado}</p>
        </div>
      </div>
      {filas.length > 0 && (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {filas.map(([k, v]) => (
            <div key={k} className="rounded-lg bg-slate-50 px-2.5 py-1.5">
              <dt className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">{k}</dt>
              <dd className="text-[12.5px] font-semibold text-slate-800 leading-snug">{mayus(String(v))}</dd>
            </div>
          ))}
        </dl>
      )}
      {consecuencia && <p className="text-[12.5px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">Si no se cumple: {consecuencia.charAt(0).toLowerCase() + consecuencia.slice(1)}</p>}
      {delDetector && <p className="text-[11.5px] text-amber-700">Detectado por búsqueda en el texto: confirma en el documento.</p>}
      {cita && <div className="mt-auto"><Cita cita={cita} /></div>}
    </div>
  );
}

/** Visita técnica, muestras y demás exigencias presenciales / condiciones comerciales de las bases. */
function PresencialesV4({ adm }: { adm: any }) {
  const v = adm.visita_tecnica || {};
  const m = adm.muestras || {};
  const otras: any[] = (Array.isArray(adm.otras_exigencias_presenciales) ? adm.otras_exigencias_presenciales : []).filter((o: any) => o && (o.que || o.tipo));
  const conds: any[] = (Array.isArray(adm.condiciones_comerciales) ? adm.condiciones_comerciales : []).filter((c: any) => c && c.que);
  const ev = String(v.estado || 'NO_INDICADO').toUpperCase();
  const em = String(m.estado || 'NO_INDICADO').toUpperCase();
  const alertas = (ev === 'OBLIGATORIA' ? 1 : 0) + (em === 'EXIGE' ? 1 : 0) + otras.filter(o => o.obligatoria !== false).length;
  return (
    <Bloque i={1} icon={<Compass size={18} />} titulo="Visita técnica y muestras" subtitulo="Exigencias que hay que cumplir en persona o con productos físicos, y condiciones comerciales de las bases."
      derecha={<span className={`text-[12px] font-bold px-2.5 py-1 rounded-full ${alertas ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>{alertas ? `${alertas} ${alertas === 1 ? 'exigencia' : 'exigencias'}` : 'Sin exigencias'}</span>}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-stretch">
        <FichaPresencial icono={<Compass size={17} />} titulo="Visita técnica"
          estado={ev === 'OBLIGATORIA' ? 'Visita obligatoria' : ev === 'VOLUNTARIA' ? 'Visita voluntaria' : ev === 'EXISTE' ? 'Hay visita (confirmar si es obligatoria)' : ev === 'NO_EXISTE' ? 'No hay visita' : 'No indicada en las bases'}
          tono={ev === 'OBLIGATORIA' ? 'rojo' : ev === 'VOLUNTARIA' || ev === 'EXISTE' ? 'ambar' : ev === 'NO_EXISTE' ? 'verde' : 'gris'}
          datos={[['Cuándo', v.fecha_hora], ['Dónde', v.lugar], ['Cómo se acredita', v.acreditacion], ['Inscripción previa', v.inscripcion_previa]]}
          consecuencia={ev === 'OBLIGATORIA' ? v.consecuencia : undefined} cita={v.cita} delDetector={v.origen === 'detector'} />
        <FichaPresencial icono={<Package size={17} />} titulo="Muestras"
          estado={em === 'EXIGE' ? 'Piden muestras' : em === 'NO_EXISTE' ? 'No piden muestras' : 'No indicadas en las bases'}
          tono={em === 'EXIGE' ? 'rojo' : em === 'NO_EXISTE' ? 'verde' : 'gris'}
          datos={[['Productos', m.que_productos], ['Cuántas', m.cuantas], ['Plazo', m.cuando], ['Dónde se entregan', m.donde], ['Devolución', m.devolucion]]}
          consecuencia={em === 'EXIGE' ? m.consecuencia : undefined} cita={m.cita} delDetector={m.origen === 'detector'} />
      </div>
      {otras.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-stretch mt-3">
          {otras.map((o, i) => (
            <FichaPresencial key={i} icono={<Clock size={17} />} titulo={OTRA_TITULO[String(o.tipo || '').toUpperCase()] || 'Exigencia presencial'}
              estado={oracion(o.que || '')} tono={o.obligatoria === false ? 'ambar' : 'rojo'}
              datos={[['Cuándo', o.cuando], ['Carácter', o.obligatoria === false ? 'Voluntaria' : 'Obligatoria']]}
              consecuencia={o.obligatoria === false ? undefined : o.consecuencia} cita={o.cita} />
          ))}
        </div>
      )}
      {conds.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">Condiciones comerciales</p>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden">
            {conds.map((c, i) => (
              <li key={i} className="px-4 py-2.5 flex items-start gap-3">
                <Wallet size={16} className="text-violet-600 flex-shrink-0 mt-0.5" />
                <div className="min-w-0 space-y-0.5">
                  <p className="text-[13.5px] text-slate-800 leading-snug"><span className="font-bold">{COND_TITULO[String(c.tipo || '').toUpperCase()] || 'Condición'}: </span>{mayus(c.que)}</p>
                  {c.cita && <Cita cita={c.cita} />}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Bloque>
  );
}

export function AdmisibilidadV4({ informe }: { informe: any }) {
  const adm = informe.requisitos_admisibilidad || {};
  const pres = informe.presupuesto || {};
  const requisitos: any[] = Array.isArray(adm.requisitos) ? adm.requisitos : [];
  const causales: any[] = Array.isArray(adm.posibles_causales_sin_analizar) ? adm.posibles_causales_sin_analizar : [];
  const garantias = adm.garantias || {};
  const firma = FIRMA[String(adm.firma?.estado || '').toUpperCase()];
  const nAdm = Number(adm.conteo ?? requisitos.length) || 0;
  return (
    <div className="space-y-3">
      <Bloque i={0} icon={<ShieldCheck size={18} />} titulo="Lo que deja la oferta fuera" subtitulo="Si no se cumple alguno de estos requisitos, la oferta queda eliminada."
        derecha={<span className={`text-[12px] font-bold px-2.5 py-1 rounded-full ${nAdm ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>{nAdm ? `${nAdm} ${nAdm === 1 ? 'requisito' : 'requisitos'}` : 'Sin requisitos detectados'}</span>}>
        {requisitos.length === 0 ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 px-4 py-3 flex items-center gap-2.5 text-[13.5px] text-emerald-800"><Check size={18} className="flex-shrink-0" />El análisis no encontró requisitos que dejen la oferta fuera.</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-stretch">
            {requisitos.map((r: any, i: number) => {
              const datos: Array<[string, string]> = ([['Cuánto', r.cuanto], ['Cuándo', r.cuando], ['Cómo', r.como]] as Array<[string, any]>).filter(([, v]) => v).map(([k, v]) => [k, String(v)]);
              return (
                <Aparece key={i} i={i + 1} alto>
                  <div className="rounded-xl border border-slate-200 bg-white p-4 h-full flex flex-col gap-2.5">
                    <div className="flex items-start gap-2.5">
                      <span className="w-8 h-8 rounded-full bg-red-100 text-red-600 flex items-center justify-center flex-shrink-0"><Ban size={17} /></span>
                      <p className="text-[14.5px] font-bold text-slate-900 leading-snug pt-1">{oracion(r.que)}</p>
                    </div>
                    {datos.length > 0 && (
                      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {datos.map(([k, v]) => (
                          <div key={k} className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                            <dt className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">{k}</dt>
                            <dd className="text-[12.5px] font-semibold text-slate-800 leading-snug">{mayus(v)}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    {r.consecuencia && <p className="text-[12.5px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">Si no se cumple: {r.consecuencia.charAt(0).toLowerCase() + r.consecuencia.slice(1)}</p>}
                    {r.cita && <div className="mt-auto"><Cita cita={r.cita} /></div>}
                  </div>
                </Aparece>
              );
            })}
          </div>
        )}
      </Bloque>

      {causales.length > 0 && (
        <Bloque i={1} icon={<AlertTriangle size={18} />} titulo="Posibles causales sin analizar" subtitulo="Frases de las bases que dicen que la oferta puede quedar fuera y que el análisis no cubrió. Revísalas en el documento."
          derecha={<span className="text-[12px] font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">{causales.length}</span>}>
          <div className="space-y-2">
            {causales.map((c: any, i: number) => (
              <Aparece key={i} i={i + 2}>
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3.5 py-3 flex items-start gap-2.5">
                  <Quote size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0 space-y-1"><p className="text-[13px] text-slate-700 leading-snug italic">{c.oracion}</p><Cita cita={c.cita} /></div>
                </div>
              </Aparece>
            ))}
          </div>
        </Bloque>
      )}

      <PresencialesV4 adm={adm} />

      <Bloque i={2} icon={<Gavel size={18} />} titulo="Garantías, contrato y firma" subtitulo="Qué hay que presentar o firmar para poder ofertar.">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-stretch">
          {GARANTIAS.map(([k, label], i) => {
            const g = garantias[k] || {};
            const est = String(g.estado || 'NO_INDICADO').toUpperCase();
            return (
              <Aparece key={k} i={i + 3} alto>
                <div className="rounded-xl border border-slate-200 bg-white p-4 h-full flex flex-col gap-2">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
                  <div><Badge variant={est === 'EXISTE' ? 'warning' : est === 'NO_EXISTE' ? 'success' : 'default'} className="text-[12px]">{est === 'EXISTE' ? 'Se exige' : est === 'NO_EXISTE' ? 'No se exige' : 'No indicado'}</Badge></div>
                  {g.monto && <p className="text-[18px] font-black text-slate-900 leading-tight tabular-nums">{g.monto}</p>}
                  {g.cita && <div className="mt-auto pt-1"><Cita cita={g.cita} /></div>}
                </div>
              </Aparece>
            );
          })}
          {firma && (
            <Aparece i={6} alto>
              <div className="rounded-xl border border-slate-200 bg-white p-4 h-full flex flex-col gap-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Firma</p>
                <div className="flex items-center gap-2"><span className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${firma.tono} ${firma.texto}`}>{firma.icono}</span><p className="text-[14px] font-bold text-slate-900 leading-snug">{firma.titulo}</p></div>
                <p className="text-[12.5px] text-slate-500 leading-snug">{firma.accion}</p>
                {adm.firma?.cita && <div className="mt-auto pt-1"><Cita cita={adm.firma.cita} /></div>}
              </div>
            </Aparece>
          )}
        </div>
        {pres.caracter !== 'EXCLUYENTE' && pres.nota_art_32 && <p className="text-[12px] text-slate-500 mt-3 pt-3 border-t border-slate-100">{mayus(pres.nota_art_32)}</p>}
      </Bloque>
    </div>
  );
}

// ─── Plazos y multa ────────────────────────────────────────────────────────────────────────
const HITO_LABEL: Record<string, string> = {
  GARANTIA_FIEL_CUMPLIMIENTO: 'Garantía de fiel cumplimiento',
  FIRMA_CONTRATO_PROVEEDOR: 'Firma del contrato (nosotros)',
  FIRMA_CONTRATO_ORGANISMO: 'Firma o tramitación del contrato (organismo)',
  EMISION_OC: 'Emisión de la orden de compra',
  ACEPTACION_OC: 'Aceptación de la orden de compra',
};

function Dato({ etiqueta, children, alerta }: { etiqueta: string; children: React.ReactNode; alerta?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 h-full flex flex-col gap-1.5 ${alerta ? 'border-red-200 bg-red-50/40' : 'border-slate-200 bg-white'}`}>
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{etiqueta}</p>
      {children}
    </div>
  );
}

export function PlazosV4({ informe }: { informe: any }) {
  const plz = informe.plazos || {};
  const pp = plz.plazo_previo || null;
  const atraso = informe.multas?.atraso || null;
  const hitos: any[] = Array.isArray(plz.hitos) ? plz.hitos : [];
  const reducido = useReducedMotion();
  const totalDias = pp ? Number(pp.total_dias_corridos) : null;
  const textoTotal = pp ? (totalDias === 0 ? 'Sin plazo previo' : `${pp.al_menos ? 'Al menos ' : ''}${totalDias} días corridos`) : null;
  const entrega = plz.plazo_entrega && (plz.plazo_entrega.min || plz.plazo_entrega.max) ? plz.plazo_entrega : null;
  const inicio = plz.inicio_plazo_entrega?.evento ? plz.inicio_plazo_entrega : null;
  const hayMulta = atraso && atraso.existe !== false;
  const multaDia = atraso?.calculo?.pesos_dia_estimado;
  const topeTexto = atraso?.tope?.valor ? `${atraso.tope.valor} ${atraso.tope.unidad || ''}`.trim() : atraso?.calculo?.tope_estimado != null ? `≈ ${fmt(atraso.calculo.tope_estimado)}` : null;
  return (
    <div className="space-y-3">
      <Bloque i={0} icon={<Clock size={18} />} titulo="Plazo previo" subtitulo="Tiempo administrativo entre la adjudicación y el inicio del plazo de entrega."
        derecha={textoTotal ? <span className="text-[12px] font-bold px-2.5 py-1 rounded-full bg-sky-100 text-sky-700">{textoTotal}</span> : undefined}>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2.5">Hito</th>
                <th className="px-4 py-2.5">Se cuenta desde</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap">Plazo</th>
                <th className="px-4 py-2.5">Fuente</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {hitos.length === 0 && <tr><td colSpan={4} className="px-4 py-5 text-center text-slate-500">Las bases no indican hitos previos al plazo de entrega.</td></tr>}
              {hitos.map((h, i) => {
                const est = String(h.estado || '').toUpperCase();
                return (
                  <motion.tr key={i} className="align-top hover:bg-slate-50/70 transition-colors"
                    initial={reducido ? false : { opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3, delay: 0.1 + i * 0.05 }}>
                    <td className="px-4 py-3 font-semibold text-slate-800">{HITO_LABEL[h.hito] || mayus(cap(h.hito).toLowerCase())}</td>
                    <td className="px-4 py-3 text-slate-600">{h.desde && est === 'EXISTE' ? mayus(h.desde) : <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {est === 'EXISTE' ? <span className="font-black text-slate-900 tabular-nums">{h.plazo ?? '?'} <span className="font-semibold text-slate-500">{h.unidad_original || ''}</span></span>
                        : est === 'NO_EXISTE' ? <Badge variant="success">No se exige</Badge>
                        : <Badge>No indicado en las bases</Badge>}
                    </td>
                    <td className="px-4 py-3">{h.cita ? <Cita cita={h.cita} /> : <span className="text-slate-300">—</span>}</td>
                  </motion.tr>
                );
              })}
            </tbody>
            {pp && (
              <tfoot>
                <tr className="bg-sky-50/70 border-t border-sky-200">
                  <td className="px-4 py-3 font-black text-slate-900">Total plazo previo</td>
                  <td className="px-4 py-3 text-[12.5px] text-slate-600" colSpan={2}>{pp.fecha_base_origen ? <>Contado desde {pp.fecha_base_origen}{pp.fecha_base ? ` (${pp.fecha_base})` : ''}</> : null}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap font-black text-sky-800 text-[15px] tabular-nums">{textoTotal}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {(pp?.avisos?.length ?? 0) > 0 && (
          <div className="mt-3 text-[12.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-0.5">
            {pp.avisos.map((a: string, i: number) => <p key={i} className="flex items-start gap-1.5"><AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />{mayus(a)}</p>)}
          </div>
        )}
        {plz.nota_aceptacion_oc && <p className="mt-3 text-[12.5px] text-sky-800 bg-sky-50 border border-sky-100 rounded-lg px-3 py-2">{mayus(plz.nota_aceptacion_oc)}</p>}
      </Bloque>

      {(inicio || entrega) && (
        <Bloque i={1} icon={<TrendingUp size={18} />} titulo="Entrega" subtitulo="Cuándo parte el plazo de entrega y cuánto dura.">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-stretch">
            {inicio && (
              <Aparece i={2} alto>
                <Dato etiqueta="Inicio del plazo de entrega">
                  <p className="text-[15px] font-bold text-slate-900 leading-snug">{mayus(inicio.evento)}</p>
                  {inicio.desfase?.cantidad != null && <div><Badge variant="info">+{inicio.desfase.cantidad} {inicio.desfase.unidad || ''}</Badge></div>}
                  {inicio.cita && <div className="mt-auto pt-1"><Cita cita={inicio.cita} /></div>}
                </Dato>
              </Aparece>
            )}
            {entrega && (
              <Aparece i={3} alto>
                <Dato etiqueta="Plazo de entrega" alerta={!!entrega.fuera_de_rango_inadmisible}>
                  <p className="text-[22px] font-black text-slate-900 leading-tight tabular-nums">{[entrega.min && `Mín. ${entrega.min}`, entrega.max && `Máx. ${entrega.max}`].filter(Boolean).join(' · ')} <span className="text-[13px] font-semibold text-slate-500">{entrega.unidad || ''}</span></p>
                  {entrega.fuera_de_rango_inadmisible && <p className="text-[12.5px] font-semibold text-red-700">Fuera de este rango, la oferta es inadmisible.</p>}
                  {entrega.cita && <div className="mt-auto pt-1"><Cita cita={entrega.cita} /></div>}
                </Dato>
              </Aparece>
            )}
          </div>
        </Bloque>
      )}

      <Bloque i={2} icon={<Gavel size={18} />} titulo="Multa por atraso" subtitulo="Lo que se descuenta si la entrega llega después del plazo.">
        {!hayMulta ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 px-4 py-3 flex items-center gap-2.5 text-[13.5px] text-emerald-800"><Check size={18} className="flex-shrink-0" />Las bases no establecen multa por atraso.</div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-stretch">
              <Aparece i={3} alto>
                <Dato etiqueta="Según las bases">
                  <p className="text-[24px] font-black text-slate-900 leading-tight tabular-nums">{valorMulta(atraso)}</p>
                  <p className="text-[12.5px] text-slate-500 leading-snug">Por {PERIODO[String(atraso.periodo || '').toUpperCase()] || 'día'} de atraso{atraso.base_calculo ? `, sobre ${atraso.base_calculo}` : ''}.</p>
                </Dato>
              </Aparece>
              {multaDia != null && (
                <Aparece i={4} alto>
                  <Dato etiqueta="Estimado por día" alerta>
                    <p className="text-[24px] font-black text-red-700 leading-tight tabular-nums">≈ <Contado valor={Number(multaDia)} /></p>
                    {atraso.calculo?.nota && <p className="text-[12.5px] text-slate-500 leading-snug">{mayus(atraso.calculo.nota)}{atraso.calculo.valor_uf_utm ? ` · valor ${fmt(atraso.calculo.valor_uf_utm)} del ${atraso.calculo.fecha_valor}` : ''}</p>}
                  </Dato>
                </Aparece>
              )}
              {(topeTexto || atraso.al_superar_tope) && (
                <Aparece i={5} alto>
                  <Dato etiqueta="Tope de la multa">
                    <p className="text-[20px] font-black text-slate-900 leading-tight tabular-nums">{topeTexto || 'No indicado'}</p>
                    {atraso.al_superar_tope && <p className="text-[12.5px] text-slate-500 leading-snug">Al superarlo: {atraso.al_superar_tope.charAt(0).toLowerCase() + atraso.al_superar_tope.slice(1)}</p>}
                  </Dato>
                </Aparece>
              )}
            </div>
            {multaDia == null && atraso.calculo?.nota && <p className="text-[12.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{mayus(atraso.calculo.nota)}</p>}
            {atraso.cita && <Cita cita={atraso.cita} />}
          </div>
        )}
      </Bloque>
    </div>
  );
}

// ─── Productos ─────────────────────────────────────────────────────────────────────────────
type FiltroProd = 'todos' | 'especificos' | 'libre' | 'alertas';

function FilaProducto({ p, abierta, onToggle, codigo, informe }: { p: any; abierta: boolean; onToggle: () => void; codigo: string; informe: any }) {
  const cs: string[] = Array.isArray(p.caracteristicas) ? p.caracteristicas : [];
  const noEnc: string[] = Array.isArray(p.caracteristicas_no_encontradas) ? p.caracteristicas_no_encontradas : [];
  const esEsp = String(p.clasificacion || '').toLowerCase().startsWith('espec');
  const hayDetalle = cs.length > 0 || noEnc.length > 0;
  return (
    <div className={abierta ? 'bg-slate-50/70' : ''}>
      <div role={hayDetalle ? 'button' : undefined} tabIndex={hayDetalle ? 0 : undefined} onClick={hayDetalle ? onToggle : undefined}
        onKeyDown={hayDetalle ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } } : undefined}
        className={`grid grid-cols-[40px_1fr_auto] md:grid-cols-[48px_1fr_120px_96px_24px] items-center gap-x-3 gap-y-1 px-4 py-3 ${hayDetalle ? 'cursor-pointer hover:bg-slate-50 transition-colors' : ''}`}>
        <span className="text-[11px] font-black text-slate-500 bg-slate-100 rounded-md px-1.5 py-1 text-center">{p.linea}</span>
        <div className="min-w-0">
          <p className="text-[14px] font-bold text-slate-900 leading-snug">{oracion(p.nombre)}{p.marca_modelo_referencia ? <span className="font-medium text-slate-500"> · {p.marca_modelo_referencia}</span> : null}</p>
          <div className="flex items-center gap-1.5 flex-wrap mt-0.5 empty:hidden">
            {p.libertad_de_oferta && <span title="Las bases no detallan características: se puede ofertar el que más nos convenga"><Badge variant="success">Libertad de oferta</Badge></span>}
            {p.libertad_de_pricing && <span title="Las bases no publican el monto de esta línea"><Badge>Precio libre</Badge></span>}
            {p.cantidad_variable?.porcentaje && <span title="Las bases permiten variar la cantidad"><Badge variant="warning">± {p.cantidad_variable.porcentaje}</Badge></span>}
            {noEnc.length > 0 && <Badge variant="warning">{noEnc.length} por revisar</Badge>}
          </div>
        </div>
        <p className="text-right text-[14px] font-black text-slate-900 tabular-nums whitespace-nowrap">
          {p.cantidad != null ? <>{p.cantidad}<span className="text-[12px] font-semibold text-slate-500">{p.unidad_medida ? ` ${p.unidad_medida}` : ''}{p.unidad_inferida ? '*' : ''}</span></> : <span className="text-slate-300">—</span>}
        </p>
        <span className="hidden md:block"><Badge variant={esEsp ? 'primary' : 'default'}>{esEsp ? 'Específico' : 'Genérico'}</Badge></span>
        <span className="hidden md:flex justify-end text-slate-400">{hayDetalle && <ChevronDown size={16} className={`transition-transform duration-200 ${abierta ? 'rotate-180' : ''}`} />}</span>
      </div>
      <AnimatePresence initial={false}>
        {abierta && hayDetalle && (
          <motion.div key="detalle" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease: 'easeOut' }} className="overflow-hidden">
            <div className="px-4 pb-4 pl-[68px] space-y-3">
              {cs.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">Ficha técnica · {cs.length}</p>
                  <ul className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-1">
                    {cs.map((c, k) => <li key={k} className="flex items-start gap-1.5 text-[12.5px] text-slate-700 leading-snug"><Check size={14} className="text-emerald-600 flex-shrink-0 mt-0.5" />{mayus(c)}</li>)}
                  </ul>
                </div>
              )}
              {noEnc.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="flex items-start gap-1.5 text-[12.5px] font-semibold text-amber-800"><AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />{noEnc.length} {noEnc.length === 1 ? 'característica no encontrada' : 'características no encontradas'} en las bases: no pasan al auditor hasta revisarlas.</p>
                  <ul className="mt-1 ml-5 list-disc text-[12px] text-amber-900 space-y-0.5">{noEnc.map((c, k) => <li key={k}>{mayus(c)}</li>)}</ul>
                </div>
              )}
              {cs.length >= 3 && <BotonBuscarEquipo codigo={String(informe.meta?.id || codigo)} region={informe.meta?.region} producto={{ descripcion: p.nombre, caracteristicas: cs, cantidad: p.cantidad }} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ProductosV4({ informe, codigo }: { informe: any; codigo: string }) {
  const prod = informe.productos || {};
  const s = informe.score || {};
  const items: any[] = useMemo(() => (Array.isArray(prod.items) ? prod.items : []), [prod.items]);
  const lineasNivel: any[] = Array.isArray(s.lineas) ? s.lineas : [];
  const porLineaPres: any[] = Array.isArray(informe.presupuesto?.por_linea_interpretado) ? informe.presupuesto.por_linea_interpretado : [];
  const conteo = prod.conteo_cruzado;
  const requisitos: any[] = Array.isArray(prod.requisitos_generales) ? prod.requisitos_generales : [];
  // En una licitación GLOBAL (suma alzada) L1..Ln son solo el N° de cada producto en las bases: no se cotizan aparte.
  const esGlobal = String(informe.modalidad?.tipo || '').toLowerCase() === 'suma_alzada';
  const lineas = useMemo(() => [...new Set(items.map(it => String(it?.linea || 'L1')))].sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, ''))), [items]);
  const [lineaSel, setLineaSel] = useState('todas');
  const [filtro, setFiltro] = useState<FiltroProd>('todos');
  const [q, setQ] = useState('');
  const [abiertos, setAbiertos] = useState<Set<number>>(new Set());

  const esEsp = (p: any) => String(p.clasificacion || '').toLowerCase().startsWith('espec');
  const conAlerta = (p: any) => Array.isArray(p.caracteristicas_no_encontradas) && p.caracteristicas_no_encontradas.length > 0;
  const porLinea = lineaSel === 'todas' || esGlobal ? items : items.filter(it => String(it?.linea) === lineaSel);
  const cuentas = { todos: porLinea.length, especificos: porLinea.filter(esEsp).length, libre: porLinea.filter(p => p.libertad_de_oferta).length, alertas: porLinea.filter(conAlerta).length };
  const nq = _norm(q.trim());
  const visibles = porLinea.filter(p => {
    if (filtro === 'especificos' && !esEsp(p)) return false;
    if (filtro === 'libre' && !p.libertad_de_oferta) return false;
    if (filtro === 'alertas' && !conAlerta(p)) return false;
    return !nq || _norm(`${p.nombre || ''} ${p.marca_modelo_referencia || ''} ${p.linea || ''}`).includes(nq);
  });
  const alternar = (i: number) => setAbiertos(prev => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  const pill = (activo: boolean) => `text-[12px] font-semibold px-3 py-1.5 rounded-lg border transition-colors ${activo ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`;
  const tiles: Array<{ id: FiltroProd; etiqueta: string; n: number; color: string; icono: React.ReactNode }> = [
    { id: 'todos', etiqueta: 'Productos a cotizar', n: cuentas.todos, color: '#7c3aed', icono: <Package size={20} /> },
    { id: 'especificos', etiqueta: 'Específicos', n: cuentas.especificos, color: '#4f46e5', icono: <ListChecks size={20} /> },
    { id: 'libre', etiqueta: 'Libertad de oferta', n: cuentas.libre, color: '#059669', icono: <Check size={20} /> },
    { id: 'alertas', etiqueta: 'Por revisar', n: cuentas.alertas, color: '#d97706', icono: <AlertTriangle size={20} /> },
  ];

  return (
    <div className="space-y-3">
      <Aparece>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 items-stretch">
          {tiles.map(tl => (
            <button key={tl.id} type="button" onClick={() => setFiltro(f => f === tl.id ? 'todos' : tl.id)} aria-pressed={filtro === tl.id}
              className={`text-left border rounded-2xl p-4 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 ${filtro === tl.id && tl.id !== 'todos' ? 'ring-2 ring-violet-500 border-violet-300 bg-violet-50/40' : 'bg-white border-slate-200'}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide mb-1.5">{tl.etiqueta}</p>
                  <p className="text-[28px] font-black leading-none tabular-nums text-slate-900"><Pct valor={tl.n} /></p>
                </div>
                <div className="w-[38px] h-[38px] rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: tl.color + '18', color: tl.color }}>{tl.icono}</div>
              </div>
            </button>
          ))}
        </div>
      </Aparece>

      <Bloque i={1} icon={<Package size={18} />} titulo="Productos a cotizar" subtitulo="Toca un producto para ver su ficha técnica."
        derecha={conteo ? <span className="text-[12px] font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">{conteo.final} de {conteo.declarado ?? conteo.final}</span> : undefined}>
        <div className="space-y-3">
          {conteo && conteo.cuadra === false && <p className="text-[12.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-1.5"><AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />El conteo no cuadra: {conteo.detalle}</p>}

          {lineasNivel.length > 1 ? (
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setLineaSel('todas')} className={pill(lineaSel === 'todas')}>Todas</button>
              {lineasNivel.map((l: any) => (
                <button key={l.linea} onClick={() => setLineaSel(l.linea)} className={`${pill(lineaSel === l.linea)} ${!l.viable && lineaSel !== l.linea ? '!bg-slate-50 !text-slate-400' : ''}`}>
                  {l.linea} · {l.presupuesto_neto != null ? `${fmt(l.presupuesto_neto)} neto` : 'sin monto'} · {l.viable ? mayus((NIVEL_VISTA[l.nivel]?.label || l.nivel || '').toLowerCase()) : 'No viable'}
                </button>
              ))}
            </div>
          ) : lineas.length > 1 && !esGlobal ? (
            <div className="flex flex-wrap gap-1.5">
              {['todas', ...lineas].map(l => {
                const mp = porLineaPres.find((x: any) => x.linea === l);
                return <button key={l} onClick={() => setLineaSel(l)} className={pill(lineaSel === l)}>{l === 'todas' ? 'Todas' : `${l}${mp ? ` · ${fmt(mp.monto_pesos)}` : ''}`}</button>;
              })}
            </div>
          ) : null}

          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar producto, marca o línea" aria-label="Buscar producto"
              className="w-full h-10 pl-9 pr-9 rounded-xl border border-slate-200 bg-white text-[13.5px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" />
            {q && <button type="button" onClick={() => setQ('')} aria-label="Borrar búsqueda" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X size={16} /></button>}
          </div>

          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <div className="hidden md:grid grid-cols-[48px_1fr_120px_96px_24px] gap-x-3 px-4 py-2.5 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500">
              <span>Línea</span><span>Producto</span><span className="text-right">Cantidad</span><span>Tipo</span><span />
            </div>
            <div className="divide-y divide-slate-100">
              {visibles.length === 0 && <p className="px-4 py-8 text-center text-[13px] text-slate-500">{items.length === 0 ? 'El análisis no encontró productos.' : 'Ningún producto coincide con la búsqueda o el filtro.'}</p>}
              {visibles.map(p => {
                const idx = items.indexOf(p);
                return <FilaProducto key={idx} p={p} abierta={abiertos.has(idx)} onToggle={() => alternar(idx)} codigo={codigo} informe={informe} />;
              })}
            </div>
          </div>
          <div className="flex items-center justify-between text-[11.5px] text-slate-400">
            <span>{visibles.length === porLinea.length ? `${porLinea.length} ${porLinea.length === 1 ? 'producto' : 'productos'}` : `${visibles.length} de ${porLinea.length} productos`}</span>
            {items.some(p => p.unidad_inferida) && <span>* Unidad de medida no indicada en las bases</span>}
          </div>
        </div>
      </Bloque>

      {requisitos.length > 0 && (
        <Bloque i={2} icon={<ClipboardCheck size={18} />} titulo="Requisitos generales de los productos" subtitulo="Garantía, capacitación, manuales, certificados, mantenciones… Van al bloque técnico-administrativo del auditor."
          derecha={<span className="text-[12px] font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">{requisitos.length}</span>}>
          <ul className="divide-y divide-slate-100">
            {requisitos.map((r: any, i: number) => (
              <li key={i} className="py-2.5 flex items-start gap-2.5">
                <Check size={16} className="text-violet-600 flex-shrink-0 mt-0.5" />
                <div className="min-w-0 space-y-0.5">
                  <p className="text-[13.5px] text-slate-800 leading-snug">{r.producto ? <span className="font-bold text-slate-500">{mayus(r.producto)}: </span> : null}{mayus(r.texto)}</p>
                  {r.cita && <Cita cita={r.cita} />}
                </div>
              </li>
            ))}
          </ul>
        </Bloque>
      )}
    </div>
  );
}

// ─── Preparación: lo que hay que tener listo para postular ─────────────────────────────────
function Vacio({ texto }: { texto: string }) {
  return <p className="rounded-xl border border-dashed border-slate-200 px-4 py-4 text-center text-[13px] text-slate-500">{texto}</p>;
}

export function PreparacionV4({ informe }: { informe: any }) {
  const adm = informe.requisitos_admisibilidad || {};
  const acc = informe.acciones_y_advertencias || {};
  const documentos: any[] = Array.isArray(adm.documentos_solicitados) ? adm.documentos_solicitados : [];
  const anexosOrg = documentos.filter(d => d?.anexo_del_organismo);
  const docsEmpresa = documentos.filter(d => !d?.anexo_del_organismo);
  const aCrear: any[] = Array.isArray(adm.documentos_a_crear) ? adm.documentos_a_crear : [];
  const acciones: any[] = Array.isArray(acc.acciones) ? acc.acciones : [];
  const advertencias: any[] = Array.isArray(acc.advertencias) ? acc.advertencias : [];
  const ir = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const tiles = [
    { id: 'prep-empresa', etiqueta: 'Documentos de empresa', n: docsEmpresa.length, color: '#7c3aed', icono: <ClipboardCheck size={20} /> },
    { id: 'prep-anexos', etiqueta: 'Anexos del organismo', n: anexosOrg.length, color: '#0284c7', icono: <Package size={20} /> },
    { id: 'prep-crear', etiqueta: 'Documentos a crear', n: aCrear.length, color: '#059669', icono: <Pencil size={20} /> },
    { id: 'prep-acciones', etiqueta: 'Advertencias', n: advertencias.length, color: '#d97706', icono: <AlertTriangle size={20} /> },
  ];
  return (
    <div className="space-y-3">
      <Aparece>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 items-stretch">
          {tiles.map(tl => (
            <button key={tl.id} type="button" onClick={() => ir(tl.id)}
              className="text-left bg-white border border-slate-200 rounded-2xl p-4 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide mb-1.5">{tl.etiqueta}</p>
                  <p className="text-[28px] font-black leading-none tabular-nums text-slate-900"><Pct valor={tl.n} /></p>
                </div>
                <div className="w-[38px] h-[38px] rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: tl.color + '18', color: tl.color }}>{tl.icono}</div>
              </div>
            </button>
          ))}
        </div>
      </Aparece>

      {(acciones.length > 0 || advertencias.length > 0) && (
        <div id="prep-acciones" className="scroll-mt-4">
          <Bloque i={1} icon={<Target size={18} />} titulo="Acciones y advertencias" subtitulo="Qué hacer para postular y qué cuidar en el camino.">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
              {acciones.length > 0 && (
                <div>
                  <p className="flex items-center gap-1.5 text-[13px] font-black uppercase tracking-wide text-emerald-700 mb-3"><Check size={16} /> Para postular</p>
                  <ol className="space-y-3">{acciones.map((a, i) => (
                    <li key={i} className="flex items-start gap-2.5">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-600 text-white text-[12px] font-black flex items-center justify-center">{i + 1}</span>
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-[14px] font-semibold text-slate-900 leading-snug pt-px">{oracion(a.orden)}</p>
                        {a.por_que && <p className="text-[12.5px] text-slate-500 leading-snug">{oracion(a.por_que)}</p>}
                        {a.cita && <Cita cita={a.cita} />}
                      </div>
                    </li>
                  ))}</ol>
                </div>
              )}
              {advertencias.length > 0 && (
                <div>
                  <p className="flex items-center gap-1.5 text-[13px] font-black uppercase tracking-wide text-amber-700 mb-3"><AlertTriangle size={16} /> Advertencias</p>
                  <ul className="space-y-3">{advertencias.map((a, i) => (
                    <li key={i} className="flex items-start gap-2.5">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center"><AlertTriangle size={14} /></span>
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-[14px] font-semibold text-slate-900 leading-snug pt-px">{oracion(a.riesgo)}</p>
                        {a.consecuencia && <p className="text-[12.5px] text-amber-800 leading-snug">{oracion(a.consecuencia)}</p>}
                        {a.cita && <Cita cita={a.cita} />}
                      </div>
                    </li>
                  ))}</ul>
                </div>
              )}
            </div>
          </Bloque>
        </div>
      )}

      <div id="prep-empresa" className="scroll-mt-4">
        <Bloque i={2} icon={<ClipboardCheck size={18} />} titulo="Documentos de empresa" subtitulo="Estatuto, vigencia, certificados y otros papeles que la empresa debe tener al día."
          derecha={docsEmpresa.length ? <span className="text-[12px] font-bold px-2.5 py-1 rounded-full bg-violet-100 text-violet-700">{docsEmpresa.length}</span> : undefined}>
          {docsEmpresa.length === 0 ? <Vacio texto="Las bases no piden documentos de empresa aparte de los anexos." /> : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden">
              {docsEmpresa.map((d, i) => (
                <li key={i} className="px-4 py-3 flex items-start gap-3 hover:bg-slate-50/70 transition-colors">
                  <Check size={16} className="text-violet-600 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-[13.5px] font-semibold text-slate-900 leading-snug">{oracion(d.nombre)}</p>
                    {d.cita && <Cita cita={d.cita} />}
                  </div>
                  {d.antiguedad_maxima && <span title="Antigüedad máxima del documento" className="flex-shrink-0"><Badge variant="warning">Antigüedad máx. {d.antiguedad_maxima}</Badge></span>}
                </li>
              ))}
            </ul>
          )}
        </Bloque>
      </div>

      <div id="prep-anexos" className="scroll-mt-4">
        <Bloque i={3} icon={<Package size={18} />} titulo="Anexos del organismo" subtitulo="Formularios que publica el organismo y hay que completar y firmar."
          derecha={anexosOrg.length ? <span className="text-[12px] font-bold px-2.5 py-1 rounded-full bg-sky-100 text-sky-700">{anexosOrg.length}</span> : undefined}>
          {anexosOrg.length === 0 ? <Vacio texto="No se detectaron anexos del organismo." /> : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden">
              {anexosOrg.map((d, i) => (
                <li key={i} className="px-4 py-3 flex items-start gap-3 hover:bg-slate-50/70 transition-colors">
                  <Check size={16} className="text-sky-600 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-[13.5px] font-semibold text-slate-900 leading-snug">{oracion(d.nombre)}</p>
                    {d.cita && <Cita cita={d.cita} />}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
                    {d.copias && <Badge>{mayus(String(d.copias))}</Badge>}
                    {d._agregado_por_cruce && <span title="Publicado por el organismo; el análisis no lo listó. Confirma en las bases si es obligatorio."><Badge variant="warning">Por cruce</Badge></span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Bloque>
      </div>

      <div id="prep-crear" className="scroll-mt-4">
        <Bloque i={4} icon={<Pencil size={18} />} titulo="Documentos a crear" subtitulo="Documentos propios que hay que redactar para esta oferta."
          derecha={aCrear.length ? <span className="text-[12px] font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700">{aCrear.length}</span> : undefined}>
          {aCrear.length === 0 ? <Vacio texto="No hay documentos propios que crear." /> : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-stretch">
              {aCrear.map((d, i) => (
                <Aparece key={i} i={i + 5} alto>
                  <div className="rounded-xl border border-slate-200 bg-white p-4 h-full flex flex-col gap-2">
                    <div className="flex items-start gap-2.5">
                      <span className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center flex-shrink-0"><Pencil size={16} /></span>
                      <p className="text-[14.5px] font-bold text-slate-900 leading-snug pt-1">{oracion(d.que_crear)}</p>
                    </div>
                    {d.contenido_exigido && (
                      <div className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                        <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">Contenido exigido</p>
                        <p className="text-[12.5px] text-slate-700 leading-snug">{mayus(d.contenido_exigido)}</p>
                      </div>
                    )}
                    {d.cita && <div className="mt-auto"><Cita cita={d.cita} /></div>}
                  </div>
                </Aparece>
              ))}
            </div>
          )}
        </Bloque>
      </div>
    </div>
  );
}
