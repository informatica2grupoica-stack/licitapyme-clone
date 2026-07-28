'use client';

// Dashboard de gestión INTERACTIVO (Módulos 1/2/3 de la ficha de análisis de pipeline).
//
// Todo el cruce y la medición ocurren EN EL CLIENTE sobre las filas que entrega
// /api/dashboard/analitica: al tocar estados, analistas o empresas, cada KPI se recalcula
// al instante (patrón "selectivo que va midiendo"). Un solo fetch, medición reactiva.
//
// UX 2026: tortas interactivas con resaltado cruzado (hover en un segmento → se marca su
// etiqueta y se atenúan los demás), selección múltiple de estados, y animaciones de
// entrada al hacer scroll (framer-motion).

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Loader2, Filter, X, Users, Building2, Layers3, Gauge, Clock, Wallet,
  Trophy, Ban, AlertTriangle, DoorOpen, Sparkles, TriangleAlert, RefreshCw, Percent, ListChecks,
  Tag, Timer, Target, Send,
} from 'lucide-react';
import { getEstadoPipeline } from '@/app/lib/pipeline';
import { colorUsuario, inicialesUsuario } from '@/app/lib/user-color';
import { MultiSelect } from '@/app/components/ui/MultiSelect';
import { MetricInfo, type EspecificacionMetrica } from '@/app/components/ui/MetricInfo';
import { useRealtime } from '@/app/lib/use-realtime';

// ── Tipos del payload ──────────────────────────────────────────────────────────
interface Row {
  id: number; codigo: string; nombre: string | null; organismo: string | null;
  estado: string; analistaId: number | null; analista: string; analistaEmail: string | null;
  monto: number; empresaId: number | null; empresa: string | null; tipo: string | null;
  mpEstado: string | null; mpCerrada: boolean; aperturada: number;
  triageDias: number | null; triageResueltoEn: string | null; nivelDescarte: 'N1' | 'N2' | 'error_gestion' | null;
  descarteMotivo: string | null; resultado: 'ganada' | 'perdida' | 'evaluacion' | null;
  montoNeto: number | null; montoOfertado: number | null;
  lineas: string[]; fuePosibleAdj: boolean; slaAperturaDias: number | null; aperturaEn: string | null;
}
interface Payload {
  success: boolean; rows: Row[];
  analistas: { id: number; nombre: string; email: string | null }[];
  empresas: { id: number; nombre: string }[];
  lineas: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────────
// Peso a peso, sin abreviar: "$1.245.980.850", no "$1.2B". Redondear a un decimal escondía
// diferencias de decenas de millones entre dos cifras que se veían idénticas.
const fmtMonto = (n: number) =>
  new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n || 0);
const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) : 0);
const mediana = (arr: number[]) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const motivoBase = (m: string | null) => (m || '').split(' — ')[0].trim() || '(sin motivo)';

// ── Ventana de la mediana de triage (Frente B) ──────────────────────────────────
// La licitación entra a la ventana por CUÁNDO SE RESOLVIÓ el triage (triageResueltoEn), no por
// cuándo se asignó: así un caso viejo recién decidido no distorsiona la foto del período actual.
type VentanaTriage = '7d' | 'mes' | 'trimestre' | 'rango';
const VENTANA_LABEL: Record<VentanaTriage, string> = {
  '7d': 'Últimos 7 días', mes: 'Este mes', trimestre: 'Este trimestre', rango: 'Rango elegido',
};
function limitesVentana(tipo: VentanaTriage, desde: string, hasta: string): { desde: number; hasta: number } | null {
  const ahora = new Date();
  if (tipo === '7d') {
    const d = new Date(ahora); d.setDate(d.getDate() - 6); d.setHours(0, 0, 0, 0);
    return { desde: d.getTime(), hasta: ahora.getTime() };
  }
  if (tipo === 'mes') {
    const d = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    return { desde: d.getTime(), hasta: ahora.getTime() };
  }
  if (tipo === 'trimestre') {
    const d = new Date(ahora.getFullYear(), Math.floor(ahora.getMonth() / 3) * 3, 1);
    return { desde: d.getTime(), hasta: ahora.getTime() };
  }
  // rango: sin ambas fechas todavía, no hay ventana válida.
  if (!desde || !hasta) return null;
  const d0 = new Date(`${desde}T00:00:00`);
  const d1 = new Date(`${hasta}T23:59:59.999`);
  return { desde: d0.getTime(), hasta: d1.getTime() };
}

const esVigente = (r: Row) => r.mpEstado === 'Publicada' && r.estado !== 'DESCARTADA';
const ESTADOS_VIGENTES = ['ASIGNADO', 'EN_PROCESO', 'ANEXOS', 'ANEXO_LISTO', 'VISADO', 'POSTULADA'];
// Ya ofertamos: incluye las resueltas (ganada/perdida), porque "lo que postulamos" es histórico
// y no deja de serlo cuando MP publica el resultado. Ojo: en la práctica NINGUNA postulada es
// `esVigente` — al postular, la licitación cierra a los días y deja de estar Publicada.
const ESTADOS_POSTULADOS = ['POSTULADA', 'POSIBLE_ADJ', 'ADJUDICADA', 'PERDIDA'];
const PRE_POSTULADO = ['ASIGNADO', 'EN_PROCESO', 'ANEXOS', 'ANEXO_LISTO', 'VISADO'];
// EN TRABAJO = ESTADOS_VIGENTES menos ASIGNADO: alguien ya le metió mano. Es la SELECCIÓN INICIAL
// de los chips de estado, para que el tablero abra respondiendo la pregunta que importa: "de lo
// vigente, ¿qué % está realmente trabajándose?" (hoy 13% — el resto sigue solo repartido).
// Es un default, no un candado: los chips siguen vivos y "Limpiar" devuelve el 100%.
const ESTADOS_EN_TRABAJO = ['EN_PROCESO', 'ANEXOS', 'ANEXO_LISTO', 'VISADO', 'POSTULADA'];
const NIVEL_META: Record<string, { label: string; color: string; desc: string }> = {
  N1: { label: 'Nivel 1 · recién asignada', color: '#d97706', desc: 'Descartada al abrir las bases' },
  N2: { label: 'Nivel 2 · tras análisis', color: '#dc2626', desc: 'Descartada tras costeo/análisis' },
  error_gestion: { label: 'Error de gestión', color: '#7c3aed', desc: 'Frenada en Anexos/Visado' },
};

const EASE = [0.22, 1, 0.36, 1] as const;

// ── Animación de entrada al hacer scroll ───────────────────────────────────────
function Reveal({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div className={className}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5, delay, ease: EASE }}>
      {children}
    </motion.div>
  );
}

// ── KPI con micro-interacción al pasar el mouse ────────────────────────────────
// spec: ficha "cómo se mide" con el ícono ⓘ SIEMPRE visible (app/components/ui/MetricInfo.tsx)
// — antes esto vivía solo en el código; un perfil no tenía cómo saber qué se le estaba midiendo.
function Kpi({ label, value, sub, icon, color, delay = 0, spec }: { label: string; value: string | number; sub?: string; icon: React.ReactNode; color: string; delay?: number; spec?: EspecificacionMetrica }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.45, delay, ease: EASE }}
      whileHover={{ y: -3 }}
      className="bg-white border border-slate-200 rounded-2xl p-4 cursor-default">
      <div className="flex items-start justify-between">
        <span className="text-[10.5px] font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1">
          {label}
          {spec && <MetricInfo spec={spec} />}
        </span>
        <span style={{ color }}>{icon}</span>
      </div>
      {/* Los montos van completos ("$9.233.366.323" = 14 chars) y a 26px desbordaban la tarjeta.
          El tamaño baja según el largo en vez de truncar: un monto cortado es peor que uno chico. */}
      <p className={`font-black leading-none tabular-nums text-slate-900 mt-2 ${
        String(value).length > 12 ? 'text-[17px]' : String(value).length > 9 ? 'text-[21px]' : 'text-[26px]'
      }`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-1">{sub}</p>}
    </motion.div>
  );
}

function Section({ title, icon, hint, spec, children }: { title: string; icon: React.ReactNode; hint?: string; spec?: EspecificacionMetrica; children: React.ReactNode }) {
  return (
    <Reveal>
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
          {icon}
          <h3 className="text-sm font-bold text-slate-800">{title}</h3>
          {spec && <MetricInfo spec={spec} />}
          {hint && <span className="text-[11px] text-slate-400 ml-auto">{hint}</span>}
        </div>
        <div className="p-5">{children}</div>
      </div>
    </Reveal>
  );
}

// Barra horizontal con relleno animado (crece al aparecer / al cambiar la selección).
function BarRow({ label, value, max, color, initials, onClick, active }: {
  label: string; value: number; max: number; color: string; initials?: string; onClick?: () => void; active?: boolean;
}) {
  const Comp: any = onClick ? 'button' : 'div';
  return (
    <Comp onClick={onClick}
      className={`flex items-center gap-2.5 w-full text-left rounded-lg px-1.5 py-1 transition-colors ${onClick ? 'hover:bg-slate-50 cursor-pointer' : ''} ${active ? 'bg-slate-100 ring-1 ring-slate-300' : ''}`}>
      <span className="flex items-center gap-1.5 w-[112px] flex-shrink-0 text-[12px] font-semibold text-slate-600 truncate">
        {initials && <span className="w-5 h-5 rounded-full text-white text-[9px] font-bold flex items-center justify-center flex-shrink-0" style={{ background: color }}>{initials}</span>}
        <span className="truncate">{label}</span>
      </span>
      <span className="flex-1 h-4 bg-slate-100 rounded-md overflow-hidden">
        <motion.span className="block h-full rounded-md"
          style={{ background: color, minWidth: value ? 4 : 0 }}
          initial={{ width: 0 }}
          animate={{ width: `${max > 0 ? (value / max) * 100 : 0}%` }}
          transition={{ duration: 0.6, ease: EASE }} />
      </span>
      <span className="w-8 text-right text-[12px] font-bold text-slate-800 tabular-nums flex-shrink-0">{value}</span>
    </Comp>
  );
}

// ── Torta interactiva: hover cruzado (segmento ↔ etiqueta) + clic para filtrar ──
function DonutInteractivo({ segments, total, unidad, selected, onToggle, size = 148 }: {
  segments: { key: string; label: string; value: number; color: string }[];
  total: number; unidad: string;
  selected?: string[]; onToggle?: (k: string) => void; size?: number;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const R = 54, SW = 16, C = 2 * Math.PI * R;
  let acc = 0;
  const arcs = segments.filter(s => s.value > 0).map(s => {
    const len = (s.value / (total || 1)) * C;
    const el = { ...s, len, offset: acc };
    acc += len;
    return el;
  });
  const he = hover ? segments.find(s => s.key === hover) : null;
  return (
    <div className="flex items-center gap-5">
      <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox="0 0 140 140" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={70} cy={70} r={R} fill="none" stroke="#f1f5f9" strokeWidth={SW} />
          {arcs.map(a => {
            const dim = hover != null && hover !== a.key;
            return (
              <circle key={a.key} cx={70} cy={70} r={R} fill="none" stroke={a.color}
                strokeWidth={hover === a.key ? SW + 6 : SW}
                strokeDasharray={`${a.len} ${C - a.len}`} strokeDashoffset={-a.offset}
                strokeLinecap="butt"
                style={{ opacity: dim ? 0.28 : 1, cursor: onToggle ? 'pointer' : 'default', transition: 'opacity .2s, stroke-width .2s' }}
                onMouseEnter={() => setHover(a.key)} onMouseLeave={() => setHover(null)}
                onClick={() => onToggle?.(a.key)} />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-4">
          <span className="text-[24px] font-black tabular-nums leading-none" style={{ color: he ? he.color : '#1e293b' }}>{he ? he.value : total}</span>
          <span className="text-[10.5px] text-slate-400 text-center leading-tight mt-0.5 line-clamp-2">{he ? he.label : unidad}</span>
        </div>
      </div>
      <div className="space-y-1 flex-1 min-w-0">
        {segments.map(s => {
          const on = selected?.includes(s.key);
          const hl = hover === s.key;
          const Comp: any = onToggle ? 'button' : 'div';
          return (
            <Comp key={s.key}
              onMouseEnter={() => setHover(s.key)} onMouseLeave={() => setHover(null)}
              onClick={() => onToggle?.(s.key)}
              className={`w-full flex items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors ${onToggle ? 'cursor-pointer' : ''}`}
              style={{ background: hl ? `${s.color}16` : on ? `${s.color}0d` : 'transparent' }}>
              <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: s.color, outline: on ? `2px solid ${s.color}` : 'none', outlineOffset: 1 }} />
              <span className={`text-[12.5px] truncate transition-colors ${hl ? 'font-bold text-slate-900' : 'text-slate-600'}`}>{s.label}</span>
              <span className="ml-auto text-[12.5px] font-bold tabular-nums" style={{ color: hl || on ? s.color : '#1e293b' }}>{s.value}</span>
            </Comp>
          );
        })}
      </div>
    </div>
  );
}

// ── Componente principal ────────────────────────────────────────────────────────
export function AnaliticaGestion() {
  const [data, setData] = useState<Payload | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selAnalistas, setSelAnalistas] = useState<number[]>([]);
  const [selEmpresas, setSelEmpresas] = useState<number[]>([]);
  const [selEstados, setSelEstados] = useState<string[]>(ESTADOS_EN_TRABAJO);
  const [selLineas, setSelLineas] = useState<string[]>([]);

  // Ventana de la mediana de triage (Frente B) — independiente del filtro de Estado: mide
  // CUÁNDO SE RESOLVIÓ el triage, no en qué etapa está el negocio hoy. Default "Este mes": la
  // pregunta más común de gestión ("¿cómo vamos este mes?"), no un solo día que salta.
  const [ventanaTriage, setVentanaTriage] = useState<VentanaTriage>('mes');
  const [rangoDesde, setRangoDesde] = useState('');
  const [rangoHasta, setRangoHasta] = useState('');

  // No se marca "cargando" al refrescar: el tablero se repinta con el dato nuevo sin
  // parpadear ni perder la selección de filtros que el usuario tenga puesta.
  const cargar = useCallback(() => {
    fetch('/api/dashboard/analitica', { cache: 'no-store' }).then(r => r.json())
      .then(d => { if (d.success) { setData(d); setError(null); } else setError(d.error || 'Error'); })
      .catch(() => setError('No se pudo cargar la analítica'))
      .finally(() => setCargando(false));
  }, []);

  useEffect(() => { cargar(); }, [cargar]);
  useRealtime(cargar);

  const toggleNum = (v: number) => setSelAnalistas(a => a.includes(v) ? a.filter(x => x !== v) : [...a, v]);
  const toggleEstado = (v: string) => setSelEstados(a => a.includes(v) ? a.filter(x => x !== v) : [...a, v]);

  // Filtro GLOBAL (analista + empresa): afecta a todas las secciones.
  const rows = data?.rows ?? [];
  const baseRows = useMemo(() => rows.filter(r =>
    (selAnalistas.length === 0 || (r.analistaId != null && selAnalistas.includes(r.analistaId))) &&
    (selEmpresas.length === 0 || (r.empresaId != null && selEmpresas.includes(r.empresaId))) &&
    (selLineas.length === 0 || r.lineas.some(l => selLineas.includes(l))),
  ), [rows, selAnalistas, selEmpresas, selLineas]);

  // ── Módulo 1: pipeline vigente (estado filtra solo este bloque) ─────────────────
  const vigentes = useMemo(() => baseRows.filter(esVigente), [baseRows]);
  const pipeSel = useMemo(() =>
    selEstados.length ? vigentes.filter(r => selEstados.includes(r.estado)) : vigentes,
    [vigentes, selEstados]);
  const porEstado = useMemo(() => ESTADOS_VIGENTES.map(id => ({
    key: id, label: getEstadoPipeline(id)?.label || id, color: getEstadoPipeline(id)?.color || '#94a3b8',
    value: vigentes.filter(r => r.estado === id).length,
  })), [vigentes]);
  const porAnalista = useMemo(() => {
    const m = new Map<string, { nombre: string; email: string | null; n: number }>();
    for (const r of pipeSel) {
      const k = String(r.analistaId ?? r.analista);
      if (!m.has(k)) m.set(k, { nombre: r.analista, email: r.analistaEmail, n: 0 });
      m.get(k)!.n++;
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [pipeSel]);
  // ── Mediana móvil de triage por ventana elegible (Frente B) ─────────────────────
  // A propósito NO depende de selEstados/pipeSel: mide cuándo se RESOLVIÓ el triage (entró/salió
  // de la bandeja), sin importar en qué etapa esté el negocio hoy ni si la licitación ya cerró en
  // MP — un caso descartado hace un mes sigue siendo un triage resuelto ese mes. Sí respeta
  // analista/empresa/línea (baseRows), porque esos cortes siguen teniendo sentido para "por persona".
  const limitesTriage = useMemo(() => limitesVentana(ventanaTriage, rangoDesde, rangoHasta), [ventanaTriage, rangoDesde, rangoHasta]);
  const triageEnVentana = useMemo(() => {
    if (!limitesTriage) return [];
    return baseRows.filter(r => {
      if (r.triageDias == null || !r.triageResueltoEn) return false;
      const t = new Date(r.triageResueltoEn).getTime();
      return t >= limitesTriage.desde && t <= limitesTriage.hasta;
    });
  }, [baseRows, limitesTriage]);
  const triageMed = useMemo(() => mediana(triageEnVentana.map(r => r.triageDias!)), [triageEnVentana]);
  const triagePorAnalista = useMemo(() => {
    const m = new Map<string, { nombre: string; email: string | null; dias: number[] }>();
    for (const r of triageEnVentana) {
      const k = String(r.analistaId ?? r.analista);
      if (!m.has(k)) m.set(k, { nombre: r.analista, email: r.analistaEmail, dias: [] });
      m.get(k)!.dias.push(r.triageDias!);
    }
    return [...m.values()]
      .map(a => ({ nombre: a.nombre, email: a.email, mediana: mediana(a.dias)!, n: a.dias.length }))
      .sort((a, b) => a.mediana - b.mediana);
  }, [triageEnVentana]);
  const montoPipe = useMemo(() => pipeSel.reduce((s, r) => s + r.monto, 0), [pipeSel]);
  // "Postulamos con": suma de monto_ofertado, lo que el equipo carga A MANO al postular. Es un
  // universo DISTINTO al de los otros KPIs de la fila (que miden las vigentes): sumar ofertado
  // sobre las vigentes daría $0 siempre. Sigue los filtros de analista/empresa/línea (baseRows),
  // no el de estado —ese es del bloque de vigentes—. La cobertura va en el subtítulo porque hoy
  // solo 33 de 57 tienen el monto cargado: sin ese dato, el total parecería el 100% de lo ofertado.
  const ofertado = useMemo(() => {
    const post = baseRows.filter(r => ESTADOS_POSTULADOS.includes(r.estado));
    const conMonto = post.filter(r => (r.montoOfertado || 0) > 0);
    return {
      suma: conMonto.reduce((s, r) => s + (r.montoOfertado || 0), 0),
      conMonto: conMonto.length,
      total: post.length,
    };
  }, [baseRows]);

  // ── Adjudicación + tasas (datos ya persistidos desde la API en Postuladas) ──────
  const adj = useMemo(() => {
    const resueltas = baseRows.filter(r => r.resultado === 'ganada' || r.resultado === 'perdida');
    const ganadas = resueltas.filter(r => r.resultado === 'ganada');
    const n2 = baseRows.filter(r => r.estado === 'DESCARTADA' && r.nivelDescarte === 'N2');
    const montoNeto = ganadas.reduce((s, r) => s + (r.montoNeto || 0), 0);
    return {
      ganadas: ganadas.length, resueltas: resueltas.length, n2: n2.length, montoNeto,
      exito: pct(ganadas.length, resueltas.length),
      embudo: pct(ganadas.length, resueltas.length + n2.length),
    };
  }, [baseRows]);

  // ── Descartes por nivel + motivos + fugas (Módulo 2) ────────────────────────────
  const descartes = useMemo(() => {
    const desc = baseRows.filter(r => r.estado === 'DESCARTADA');
    const nivel = { N1: 0, N2: 0, error_gestion: 0 } as Record<string, number>;
    const motivos = new Map<string, number>();
    for (const r of desc) {
      if (r.nivelDescarte) nivel[r.nivelDescarte]++;
      const mb = motivoBase(r.descarteMotivo);
      motivos.set(mb, (motivos.get(mb) || 0) + 1);
    }
    const sinGestionar = baseRows.filter(r => PRE_POSTULADO.includes(r.estado) && r.mpCerrada).length;
    return {
      total: desc.length, nivel,
      motivos: [...motivos.entries()].map(([m, n]) => ({ m, n })).sort((a, b) => b.n - a.n).slice(0, 8),
      sinGestionar,
    };
  }, [baseRows]);

  // ── Postuladas por sub-estado (Módulo 3) ────────────────────────────────────────
  const postuladas = useMemo(() => {
    const post = baseRows.filter(r => ESTADOS_POSTULADOS.includes(r.estado));
    // Sub-estados finos (§4.1/4.3). "Resuelta" = MP ya publicó resultado (cache), aunque el
    // estado interno siga en POSTULADA.
    const resueltas = post.filter(r => r.resultado === 'ganada' || r.resultado === 'perdida');
    const pend = post.filter(r => !(r.resultado === 'ganada' || r.resultado === 'perdida'));
    return {
      total: post.length,
      enPlazo: pend.filter(r => !r.mpCerrada).length,                                        // Publicada en plazo
      cerradaSinApertura: pend.filter(r => r.mpCerrada && !r.aperturada).length,             // Cerrada sin apertura
      aperturaSinMarcar: pend.filter(r => r.aperturada && !r.fuePosibleAdj).length,          // Con apertura, sin marcar
      posible: pend.filter(r => r.fuePosibleAdj).length,                                     // Posible adjudicado
      resuelta: resueltas.length,                                                            // Resuelto oficial
    };
  }, [baseRows]);

  // SLA de revisión de apertura (§4.3): mediana de días apertura→marca; y cuántas aperturadas
  // siguen SIN revisar (fuga de proceso que quedaría invisible sin medirla).
  const sla = useMemo(() => {
    const post = baseRows.filter(r => ['POSTULADA', 'POSIBLE_ADJ'].includes(r.estado));
    const revisadas = post.filter(r => r.slaAperturaDias != null).map(r => r.slaAperturaDias!);
    const sinRevisar = post.filter(r => r.aperturada && !r.fuePosibleAdj && r.resultado !== 'ganada' && r.resultado !== 'perdida');
    const diasAbierto = (r: Row) => r.aperturaEn ? Math.floor((Date.now() - new Date(r.aperturaEn).getTime()) / 86400000) : null;
    const espera = sinRevisar.map(diasAbierto).filter((d): d is number => d != null);
    return {
      medianaRevision: mediana(revisadas),
      sinRevisar: sinRevisar.length,
      esperaMax: espera.length ? Math.max(...espera) : null,
    };
  }, [baseRows]);

  // Precisión de "Posible Adjudicado" (§4.4): matriz 2×2 sobre las YA resueltas.
  const precision = useMemo(() => {
    const resueltas = baseRows.filter(r => r.resultado === 'ganada' || r.resultado === 'perdida');
    let acierto = 0, falsoPos = 0, falsoNeg = 0, correcto = 0;
    for (const r of resueltas) {
      const gano = r.resultado === 'ganada';
      if (r.fuePosibleAdj) gano ? acierto++ : falsoPos++;
      else gano ? falsoNeg++ : correcto++;
    }
    const marcadas = acierto + falsoPos;
    return { acierto, falsoPos, falsoNeg, correcto, total: resueltas.length, precisionMarca: pct(acierto, marcadas) };
  }, [baseRows]);

  const hayFiltro = selAnalistas.length || selEmpresas.length || selEstados.length || selLineas.length;
  const limpiar = () => { setSelAnalistas([]); setSelEmpresas([]); setSelEstados([]); setSelLineas([]); };

  if (cargando && !data) {
    return <div className="flex items-center justify-center py-16"><Loader2 size={28} className="animate-spin text-indigo-500" /></div>;
  }
  if (error) {
    return <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm"><TriangleAlert size={18} /> {error}</div>;
  }
  if (!data) return null;

  const maxAnalista = Math.max(1, ...porAnalista.map(a => a.n));

  return (
    <div className="space-y-5">
      {/* ── Barra de filtros globales ─────────────────────────────────────────── */}
      <Reveal>
        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Filter size={14} className="text-indigo-500" />
            <span className="text-[13px] font-bold text-slate-700">Filtros</span>
            <span className="text-[11px] text-slate-400">— la medición se recalcula con tu selección</span>
            <div className="ml-auto flex items-center gap-2">
              {hayFiltro ? (
                <button onClick={limpiar} className="inline-flex items-center gap-1 text-[12px] font-semibold text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 px-2.5 py-1.5 rounded-lg transition-colors">
                  <X size={12} /> Limpiar
                </button>
              ) : null}
              <button onClick={cargar} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg" title="Refrescar">
                <RefreshCw size={14} className={cargando ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <MultiSelect
              label="Estado" icon={<ListChecks size={13} />}
              options={porEstado.map(e => ({ value: e.key, label: e.label, color: e.color, count: e.value }))}
              selected={selEstados} onChange={setSelEstados} />
            <MultiSelect
              label="Analista" icon={<Users size={13} />}
              options={data.analistas.map(a => ({ value: String(a.id), label: a.nombre, color: colorUsuario(a.email || a.id), count: vigentes.filter(r => r.analistaId === a.id).length }))}
              selected={selAnalistas.map(String)} onChange={(next) => setSelAnalistas(next.map(Number))} />
            {data.empresas.length > 0 && (
              <MultiSelect
                label="Empresa" icon={<Building2 size={13} />}
                options={data.empresas.map(e => ({ value: String(e.id), label: e.nombre, color: '#0d9488' }))}
                selected={selEmpresas.map(String)} onChange={(next) => setSelEmpresas(next.map(Number))} />
            )}
            {data.lineas.length > 0 && (
              <MultiSelect
                label="Línea de negocio" icon={<Tag size={13} />}
                options={data.lineas.map(l => ({ value: l, label: l, color: '#7c3aed', count: vigentes.filter(r => r.lineas.includes(l)).length }))}
                selected={selLineas} onChange={setSelLineas} />
            )}
          </div>
        </div>
      </Reveal>

      {/* ── KPIs vivos ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <Kpi label="Licitaciones" value={pipeSel.length} sub={`de ${vigentes.length} vigentes`} icon={<Layers3 size={18} />} color="#4f46e5" delay={0}
          spec={{
            mide: 'Cuántos negocios activos caen en la etapa (o etapas) de Estado que tienes marcada arriba, sobre el total de licitaciones vigentes.',
            calculo: '"Vigente" = Mercado Público todavía dice Publicada Y el negocio no está en Descartada. Respeta también los filtros de Analista/Empresa/Línea de negocio.',
            fuente: 'negocios (activo=TRUE) + estado efectivo de MP',
          }} />
        {/* "Presupuesto MP", no "suma en gestión": es la plata que publica el organismo, no la
            nuestra. Con el rótulo viejo se leía como si fuera lo que ofertamos. */}
        <Kpi label="Presupuesto en gestión" value={fmtMonto(montoPipe)} sub="lo que publica MP" icon={<Wallet size={18} />} color="#0d9488" delay={0.05}
          spec={{
            mide: 'El presupuesto que publica el organismo en las licitaciones vigentes de la selección actual — NO es lo que nosotros vamos a cotizar.',
            calculo: 'Suma de licitacion_monto de esas mismas licitaciones vigentes filtradas.',
            fuente: 'negocios.licitacion_monto',
          }} />
        <Kpi label="Postulamos con" value={fmtMonto(ofertado.suma)} sub={`${ofertado.conMonto} de ${ofertado.total} con monto`} icon={<Send size={18} />} color="#0891b2" delay={0.1}
          spec={{
            mide: 'Cuánto ofertamos en total en lo que ya se postuló (o pasó de esa etapa).',
            calculo: 'Suma de monto_ofertado — un monto que el equipo carga A MANO al postular, no lo calcula el sistema. Universo distinto a los demás KPI: mira Postulada en adelante, no lo "vigente".',
            fuente: 'negocios.monto_ofertado',
            nota: 'El subtítulo dice cuántas de esas licitaciones tienen el monto cargado — si falta cargarlo en varias, el total se ve más bajo de lo real.',
          }} />
        <Kpi label="% del pipeline" value={`${pct(pipeSel.length, vigentes.length)}%`} sub="del total vigente" icon={<Gauge size={18} />} color="#9333ea" delay={0.15}
          spec={{
            mide: 'Qué porción de todo lo vigente está en la etapa (o etapas) que tienes marcada en el filtro de Estado.',
            calculo: 'Licitaciones en la selección de Estado ÷ total de vigentes × 100.',
          }} />
        <Kpi label="Mediana triage" value={triageMed != null ? `${triageMed}d` : '—'}
          sub={`${triageEnVentana.length} caso${triageEnVentana.length === 1 ? '' : 's'} · ${VENTANA_LABEL[ventanaTriage]}${triageEnVentana.length > 0 && triageEnVentana.length < 5 ? ' (poca base)' : ''}`}
          icon={<Clock size={18} />} color={triageEnVentana.length > 0 && triageEnVentana.length < 5 ? '#d97706' : '#ea580c'} delay={0.2}
          spec={{
            mide: 'Cuántos días tarda, típicamente, pasar de "recién asignada" a "ya se decidió qué hacer con ella".',
            calculo: 'Para cada licitación: días desde la ÚLTIMA (re)asignación hasta el PRIMER cambio a "En proceso" O a "Descartada" (lo que pase primero) — NO hasta que se completó la viabilidad, ni hasta cualquier otro cambio de estado. Si la reasignan, el reloj vuelve a cero. De todas las licitaciones cuya decisión cayó dentro de la ventana elegida (abajo), se toma la MEDIANA (el valor típico, no el promedio) de esos días.',
            fuente: 'actividad_usuario (cambio_pipeline + asignacion) → negocios.created_at',
            nota: 'Entra a la ventana por CUÁNDO SE DECIDIÓ, no por cuándo llegó la licitación ni por su etapa actual. Con menos de 5 casos, la mediana no es confiable — se avisa aparte.',
          }} />
      </div>

      {/* ── Módulo 1: Pipeline (torta por estado × barras por analista) ─────────── */}
      <Section title="Pipeline y desempeño" icon={<Layers3 size={15} className="text-indigo-500" />}
        hint="pasa el mouse por la torta · toca un estado para medir ese tramo"
        spec={{
          mide: 'Cuántas licitaciones vigentes hay en cada etapa del pipeline, y cuántas tiene cada analista.',
          calculo: '"Vigentes" según el mismo criterio de arriba (Publicada y no Descartada). La torta se puede tocar para quedarte solo con esa etapa; el listado "por analista" respeta esa selección.',
          fuente: 'negocios.estado_pipeline',
        }}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2.5">Por estado interno</p>
            <DonutInteractivo segments={porEstado} total={vigentes.length} unidad="vigentes"
              selected={selEstados} onToggle={toggleEstado} />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2.5">
              Por analista {selEstados.length ? `· ${selEstados.map(s => getEstadoPipeline(s)?.label).join(', ')}` : ''}
            </p>
            {porAnalista.length ? (
              <div className="space-y-1">
                {porAnalista.map(a => (
                  <BarRow key={a.nombre} label={a.nombre.split(' ')[0]} value={a.n} max={maxAnalista}
                    color={colorUsuario(a.email || a.nombre)} initials={inicialesUsuario(a.nombre, a.email)} />
                ))}
              </div>
            ) : <p className="text-sm text-slate-400 py-8 text-center">Sin licitaciones en la selección</p>}
          </div>
        </div>
      </Section>

      {/* ── Frente B: mediana móvil de triage por ventana elegible ─────────────── */}
      <Section title="Tiempos de triage" icon={<Timer size={15} className="text-orange-500" />}
        hint="mediana móvil · entra por cuándo se RESOLVIÓ, no por cuándo se asignó"
        spec={{
          mide: 'Cuánto tarda típicamente el equipo en decidir qué hacer con una licitación recién asignada.',
          calculo: 'Días desde la ÚLTIMA (re)asignación hasta el PRIMER cambio a "En proceso" o a "Descartada" — no hasta que termina la viabilidad, ni hasta cualquier otro cambio de estado. Si la reasignan, el reloj vuelve a cero. La ventana filtra por cuándo se tomó ESA decisión, no por cuándo llegó la licitación ni por su etapa de hoy.',
          fuente: 'actividad_usuario (cambio_pipeline + asignacion)',
          nota: 'El desglose "por analista" mide a quien tenía la licitación en el momento exacto de decidir, no necesariamente a quien la tiene hoy.',
        }}>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {(['7d', 'mes', 'trimestre', 'rango'] as VentanaTriage[]).map(v => (
            <button key={v} type="button" onClick={() => setVentanaTriage(v)}
              className={`px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border transition-colors ${
                ventanaTriage === v ? 'bg-orange-50 border-orange-300 text-orange-700' : 'border-slate-200 text-slate-500 hover:border-slate-400'
              }`}>
              {VENTANA_LABEL[v]}
            </button>
          ))}
          {ventanaTriage === 'rango' && (
            <div className="flex items-center gap-1.5 ml-1">
              <input type="date" value={rangoDesde} onChange={e => setRangoDesde(e.target.value)}
                className="px-2 py-1.5 border border-slate-200 rounded-lg text-[12.5px] text-slate-600 outline-none focus:border-orange-300" />
              <span className="text-slate-400 text-[12px]">a</span>
              <input type="date" value={rangoHasta} onChange={e => setRangoHasta(e.target.value)}
                className="px-2 py-1.5 border border-slate-200 rounded-lg text-[12.5px] text-slate-600 outline-none focus:border-orange-300" />
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="flex items-center gap-4 rounded-xl border border-orange-200 bg-orange-50 p-4">
            <div className="w-11 h-11 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center flex-shrink-0">
              <Clock size={20} />
            </div>
            <div className="min-w-0">
              <p className="text-[26px] font-black text-orange-700 leading-none tabular-nums">{triageMed != null ? `${triageMed}d` : '—'}</p>
              <p className="text-[12px] text-orange-600/80 mt-1">
                {triageEnVentana.length} caso{triageEnVentana.length === 1 ? '' : 's'} resuelto{triageEnVentana.length === 1 ? '' : 's'} · {VENTANA_LABEL[ventanaTriage]}
              </p>
              {triageEnVentana.length > 0 && triageEnVentana.length < 5 && (
                <p className="text-[11px] text-amber-700 font-semibold mt-1 flex items-center gap-1">
                  <AlertTriangle size={11} /> Pocos casos: la mediana no es confiable todavía
                </p>
              )}
            </div>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2.5">Por analista, en la ventana elegida</p>
            {triagePorAnalista.length ? (
              <div className="space-y-1.5">
                {triagePorAnalista.map(a => (
                  <div key={a.nombre} className="flex items-center gap-2.5">
                    <span className="w-5 h-5 rounded-full text-white text-[9px] font-bold flex items-center justify-center flex-shrink-0" style={{ background: colorUsuario(a.email || a.nombre) }}>
                      {inicialesUsuario(a.nombre, a.email)}
                    </span>
                    <span className="text-[12.5px] font-semibold text-slate-600 truncate flex-1">{a.nombre.split(' ')[0]}</span>
                    <span className="text-[12.5px] font-bold text-slate-800 tabular-nums">{a.mediana}d</span>
                    <span className="text-[11px] text-slate-400 tabular-nums w-16 text-right">{a.n} caso{a.n === 1 ? '' : 's'}</span>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-slate-400 py-6 text-center">Sin triages resueltos en la ventana elegida</p>}
          </div>
        </div>
      </Section>

      {/* ── Adjudicación + Postuladas ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section title="Adjudicación y tasas de éxito" icon={<Trophy size={15} className="text-emerald-500" />}
          hint="desde Postuladas · datos de la API en BD"
          spec={{
            mide: 'Cómo nos está yendo en lo que ya se resolvió (Mercado Público ya adjudicó).',
            calculo: 'Se lee el acta de adjudicación de MP para cada licitación postulada; se compara el RUT ganador de CADA línea contra los RUT de nuestras empresas. Si ganamos al menos una línea, cuenta como "ganada".',
            fuente: 'adjudicacion_cache.lineas (snapshot del acta de MP)',
          }}>
          <div className="grid grid-cols-2 gap-3">
            <motion.div whileHover={{ y: -3 }} className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5">
              <p className="text-[10.5px] font-semibold text-emerald-700 uppercase tracking-wide flex items-center gap-1"><Percent size={11} /> Éxito competitivo
                <MetricInfo spec={{
                  mide: 'De lo ya resuelto por MP, qué porcentaje ganamos.',
                  calculo: 'Ganadas ÷ (ganadas + perdidas) × 100. Solo mira licitaciones donde MP ya publicó a quién adjudicó — no cuenta lo que sigue en evaluación.',
                }} />
              </p>
              <p className="text-[28px] font-black text-emerald-700 leading-none mt-1.5 tabular-nums">{adj.exito}%</p>
              <p className="text-[11px] text-emerald-600/80 mt-1">{adj.ganadas} de {adj.resueltas} resueltas</p>
            </motion.div>
            <motion.div whileHover={{ y: -3 }} className="rounded-xl border border-indigo-200 bg-indigo-50 p-3.5">
              <p className="text-[10.5px] font-semibold text-indigo-700 uppercase tracking-wide flex items-center gap-1"><Percent size={11} /> Eficiencia embudo
                <MetricInfo spec={{
                  mide: 'Qué tan bien se filtra ANTES de postular, no solo el resultado final.',
                  calculo: 'Ganadas ÷ (ganadas + perdidas + descartes de Nivel 2). Suma los descartes N2 (los que se botaron después de analizarlas, no al toque) al denominador — castiga haber invertido tiempo en algo que igual no se ganó ni se llegó a postular.',
                }} />
              </p>
              <p className="text-[28px] font-black text-indigo-700 leading-none mt-1.5 tabular-nums">{adj.embudo}%</p>
              <p className="text-[11px] text-indigo-600/80 mt-1">incluye {adj.n2} descartes N2</p>
            </motion.div>
            <motion.div whileHover={{ y: -3 }} className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
              <p className="text-[10.5px] font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1"><Trophy size={11} /> Ganadas
                <MetricInfo spec={{
                  mide: 'Cuántas licitaciones ganamos (al menos una línea).',
                  calculo: 'Cuenta de licitaciones donde el RUT de alguna de nuestras empresas aparece como ganador en al menos una línea del acta de MP.',
                }} />
              </p>
              <p className="text-[28px] font-black text-slate-800 leading-none mt-1.5 tabular-nums">{adj.ganadas}</p>
              <p className="text-[11px] text-slate-400 mt-1">proyectos ganados</p>
            </motion.div>
            <motion.div whileHover={{ y: -3 }} className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
              <p className="text-[10.5px] font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1"><Wallet size={11} /> Monto neto real
                <MetricInfo spec={{
                  mide: 'Cuánto ganamos en plata, sumando TODAS las líneas que ganamos en cada licitación (no solo una).',
                  calculo: 'Por cada licitación ganada, se recorren TODAS las líneas del acta y se suma MontoUnitario × Cantidad de cada línea donde el RUT ganador es nuestro. Si ganamos 3 líneas de 8, se suman las 3. Si por algún motivo esa suma queda en cero, usa como respaldo el monto que el equipo cargó a mano al ofertar.',
                  fuente: 'adjudicacion_cache.lineas → app/lib/adjudicacion.ts (enriquecer)',
                  nota: 'Una vez que el sistema marca una licitación como "ya adjudicada", no la vuelve a consultar contra MP — si MP resuelve líneas en fechas distintas, las que se resuelvan DESPUÉS de esa foto podrían no capturarse solas.',
                }} />
              </p>
              <p className="text-[17px] font-black text-slate-800 leading-none mt-1.5 tabular-nums">{fmtMonto(adj.montoNeto)}</p>
              <p className="text-[11px] text-slate-400 mt-1">adjudicado según acta</p>
            </motion.div>
          </div>
        </Section>

        <Section title="Postuladas por sub-estado" icon={<DoorOpen size={15} className="text-amber-500" />}
          hint={`${postuladas.total} postuladas`}
          spec={{
            mide: 'En qué momento del trámite post-postulación está cada licitación (todavía no es "ganada/perdida" para el resto del tablero hasta que MP resuelve).',
            calculo: '"Publicada en plazo" = MP todavía no cierra. "Cerrada sin apertura" = cerró pero MP no ha hecho la apertura técnica. "Con apertura, sin marcar" = ya hubo apertura pero nadie la marcó "posible adjudicado". "Posible adjudicado" = alguien la marcó a mano. "Resuelto oficial" = el acta de MP ya dice ganada o perdida.',
            fuente: 'negocios + licitacion_apertura + adjudicacion_cache',
          }}>
          <DonutInteractivo total={postuladas.total} unidad="postuladas"
            segments={[
              { key: 'enPlazo', label: 'Publicada en plazo', value: postuladas.enPlazo, color: '#d97706' },
              { key: 'cerradaSinApertura', label: 'Cerrada sin apertura', value: postuladas.cerradaSinApertura, color: '#0891b2' },
              { key: 'aperturaSinMarcar', label: 'Con apertura, sin marcar', value: postuladas.aperturaSinMarcar, color: '#0369a1' },
              { key: 'posible', label: 'Posible adjudicado', value: postuladas.posible, color: '#6366f1' },
              { key: 'resuelta', label: 'Resuelto oficial', value: postuladas.resuelta, color: '#059669' },
            ]} />
        </Section>
      </div>

      {/* ── Módulo 2: Descartes por nivel + motivos + fugas ────────────────────── */}
      <Section title="Descartes y fugas de proceso" icon={<Ban size={15} className="text-red-500" />}
        hint={`${descartes.total} descartadas`}
        spec={{
          mide: 'Cuánto se descarta y en qué momento del proceso — más "sin gestionar", el descuido silencioso de dejar que algo cierre en MP sin haber postulado.',
          calculo: 'Nivel 1 = descartada apenas asignada, antes de analizar nada. Nivel 2 = descartada después de haber avanzado al análisis/costeo. Error de gestión = se descartó habiendo llegado a Anexos o más allá (trabajo ya invertido). "Sin gestionar" = la licitación cerró en MP sin que nunca se haya postulado ni descartado a propósito.',
          fuente: 'negocios.estado_pipeline + actividad_usuario (máxima etapa alcanzada antes de descartar)',
        }}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-3">
            {(['N1', 'N2', 'error_gestion'] as const).map(nv => {
              const meta = NIVEL_META[nv]; const n = descartes.nivel[nv] || 0;
              return (
                <motion.div key={nv} whileHover={{ x: 3 }}
                  className="flex items-center gap-3 rounded-xl border p-3" style={{ borderColor: `${meta.color}33`, background: `${meta.color}0d` }}>
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${meta.color}1f`, color: meta.color }}>
                    <Ban size={16} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-bold text-slate-800">{meta.label}</p>
                    <p className="text-[11px] text-slate-400">{meta.desc}</p>
                  </div>
                  <span className="ml-auto text-[22px] font-black tabular-nums" style={{ color: meta.color }}>{n}</span>
                </motion.div>
              );
            })}
            <motion.div whileHover={{ x: 3 }}
              className="flex items-center gap-3 rounded-xl border border-orange-200 bg-orange-50 p-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-orange-100 text-orange-600">
                <AlertTriangle size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-bold text-slate-800">Sin gestionar</p>
                <p className="text-[11px] text-slate-400">Cerró en MP sin que postuláramos</p>
              </div>
              <span className="ml-auto text-[22px] font-black tabular-nums text-orange-600">{descartes.sinGestionar}</span>
            </motion.div>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2.5">Motivos más frecuentes</p>
            {descartes.motivos.length ? (
              <div className="space-y-1">
                {descartes.motivos.map(m => (
                  <BarRow key={m.m} label={m.m} value={m.n} max={Math.max(1, ...descartes.motivos.map(x => x.n))} color="#dc2626" />
                ))}
              </div>
            ) : <p className="text-sm text-slate-400 py-8 text-center">Sin descartes en la selección</p>}
          </div>
        </div>
      </Section>

      {/* ── Módulo 3: SLA de revisión de apertura + precisión de "Posible Adjudicado" ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section title="Revisión de apertura (SLA)" icon={<Timer size={15} className="text-sky-500" />}
          hint="apertura técnica → revisión"
          spec={{
            mide: 'Qué tan rápido se revisa una licitación después de que Mercado Público hace la apertura técnica de las ofertas.',
            calculo: 'Mediana de días entre licitacion_apertura.detectada_en (cuándo el sistema detectó la apertura) y el momento en que alguien la marcó "posible adjudicado". "Sin revisar" cuenta las que tuvieron apertura pero nadie las marcó ni tienen resultado todavía — son las que corren el riesgo de perderse.',
            fuente: 'licitacion_apertura.detectada_en → actividad_usuario (marca POSIBLE_ADJ)',
          }}>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-3.5">
              <p className="text-[10.5px] font-semibold text-sky-700 uppercase tracking-wide">Mediana</p>
              <p className="text-[26px] font-black text-sky-700 leading-none mt-1.5 tabular-nums">{sla.medianaRevision != null ? `${sla.medianaRevision}d` : '—'}</p>
              <p className="text-[11px] text-sky-600/80 mt-1">apertura → marca</p>
            </div>
            <div className="rounded-xl border border-orange-200 bg-orange-50 p-3.5">
              <p className="text-[10.5px] font-semibold text-orange-700 uppercase tracking-wide">Sin revisar</p>
              <p className="text-[26px] font-black text-orange-700 leading-none mt-1.5 tabular-nums">{sla.sinRevisar}</p>
              <p className="text-[11px] text-orange-600/80 mt-1">aperturadas pendientes</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
              <p className="text-[10.5px] font-semibold text-slate-500 uppercase tracking-wide">Espera máx.</p>
              <p className="text-[26px] font-black text-slate-800 leading-none mt-1.5 tabular-nums">{sla.esperaMax != null ? `${sla.esperaMax}d` : '—'}</p>
              <p className="text-[11px] text-slate-400 mt-1">la más rezagada</p>
            </div>
          </div>
          <p className="text-[11px] text-slate-400 mt-3">Distingue "revisamos y decidimos no marcar" de "nadie la ha revisado todavía" — lo segundo es una fuga de proceso.</p>
        </Section>

        <Section title="Precisión de «Posible Adjudicado»" icon={<Target size={15} className="text-violet-500" />}
          hint={`${precision.total} resueltas`}
          spec={{
            mide: 'Qué tan confiable es la marca manual "posible adjudicado" comparada contra el resultado real que después confirma MP.',
            calculo: 'Matriz de 2×2 sobre licitaciones ya resueltas por MP: Acierto = se marcó y se ganó. Falso positivo = se marcó y NO se ganó. Falso negativo = NO se marcó y se ganó igual (una señal que se escapó). Correcto = no se marcó y efectivamente no se ganó.',
            fuente: 'actividad_usuario (marca POSIBLE_ADJ) vs. adjudicacion_cache (resultado real)',
          }}>
          <div className="grid grid-cols-2 gap-2.5">
            {[
              { l: 'Acierto', v: precision.acierto, sub: 'marcamos y ganamos', c: '#059669', bg: 'bg-emerald-50 border-emerald-200' },
              { l: 'Falso positivo', v: precision.falsoPos, sub: 'marcamos y no ganamos', c: '#dc2626', bg: 'bg-rose-50 border-rose-200' },
              { l: 'Falso negativo', v: precision.falsoNeg, sub: 'no marcamos y ganamos', c: '#d97706', bg: 'bg-amber-50 border-amber-200' },
              { l: 'Correcto', v: precision.correcto, sub: 'no marcamos, no ganamos', c: '#0891b2', bg: 'bg-cyan-50 border-cyan-200' },
            ].map(x => (
              <div key={x.l} className={`rounded-xl border p-3 ${x.bg}`}>
                <p className="text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: x.c }}>{x.l}</p>
                <p className="text-[24px] font-black leading-none mt-1 tabular-nums" style={{ color: x.c }}>{x.v}</p>
                <p className="text-[10.5px] text-slate-500 mt-0.5">{x.sub}</p>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-3">Precisión de la marca: <b className="text-slate-600">{precision.precisionMarca}%</b> de las que marcamos terminaron ganadas.</p>
        </Section>
      </div>

      <p className="text-[11px] text-slate-400 flex items-center gap-1.5 justify-center pt-1">
        <Sparkles size={12} className="text-indigo-400" /> Triage, niveles de descarte, SLA de apertura y precisión se derivan del historial real de estados — precisión creciente a medida que se registran más cambios.
      </p>
    </div>
  );
}
