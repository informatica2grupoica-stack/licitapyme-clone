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
import { useRealtime } from '@/app/lib/use-realtime';

// ── Tipos del payload ──────────────────────────────────────────────────────────
interface Row {
  id: number; codigo: string; nombre: string | null; organismo: string | null;
  estado: string; analistaId: number | null; analista: string; analistaEmail: string | null;
  monto: number; empresaId: number | null; empresa: string | null; tipo: string | null;
  mpEstado: string | null; mpCerrada: boolean; aperturada: number;
  triageDias: number | null; nivelDescarte: 'N1' | 'N2' | 'error_gestion' | null;
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
function Kpi({ label, value, sub, icon, color, delay = 0 }: { label: string; value: string | number; sub?: string; icon: React.ReactNode; color: string; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.45, delay, ease: EASE }}
      whileHover={{ y: -3 }}
      className="bg-white border border-slate-200 rounded-xl p-4 cursor-default">
      <div className="flex items-start justify-between">
        <span className="text-[10.5px] font-semibold text-slate-400 uppercase tracking-wide">{label}</span>
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

function Section({ title, icon, hint, children }: { title: string; icon: React.ReactNode; hint?: string; children: React.ReactNode }) {
  return (
    <Reveal>
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
          {icon}
          <h3 className="text-sm font-bold text-slate-800">{title}</h3>
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
  const triageMed = useMemo(() => mediana(pipeSel.filter(r => r.triageDias != null).map(r => r.triageDias!)), [pipeSel]);
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
        <Kpi label="Licitaciones" value={pipeSel.length} sub={`de ${vigentes.length} vigentes`} icon={<Layers3 size={18} />} color="#4f46e5" delay={0} />
        {/* "Presupuesto MP", no "suma en gestión": es la plata que publica el organismo, no la
            nuestra. Con el rótulo viejo se leía como si fuera lo que ofertamos. */}
        <Kpi label="Presupuesto en gestión" value={fmtMonto(montoPipe)} sub="lo que publica MP" icon={<Wallet size={18} />} color="#0d9488" delay={0.05} />
        <Kpi label="Postulamos con" value={fmtMonto(ofertado.suma)} sub={`${ofertado.conMonto} de ${ofertado.total} con monto`} icon={<Send size={18} />} color="#0891b2" delay={0.1} />
        <Kpi label="% del pipeline" value={`${pct(pipeSel.length, vigentes.length)}%`} sub="del total vigente" icon={<Gauge size={18} />} color="#9333ea" delay={0.15} />
        <Kpi label="Mediana triage" value={triageMed != null ? `${triageMed}d` : '—'} sub="asignación → decisión" icon={<Clock size={18} />} color="#ea580c" delay={0.2} />
      </div>

      {/* ── Módulo 1: Pipeline (torta por estado × barras por analista) ─────────── */}
      <Section title="Pipeline y desempeño" icon={<Layers3 size={15} className="text-indigo-500" />}
        hint="pasa el mouse por la torta · toca un estado para medir ese tramo">
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

      {/* ── Adjudicación + Postuladas ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section title="Adjudicación y tasas de éxito" icon={<Trophy size={15} className="text-emerald-500" />}
          hint="desde Postuladas · datos de la API en BD">
          <div className="grid grid-cols-2 gap-3">
            <motion.div whileHover={{ y: -3 }} className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5">
              <p className="text-[10.5px] font-semibold text-emerald-700 uppercase tracking-wide flex items-center gap-1"><Percent size={11} /> Éxito competitivo</p>
              <p className="text-[28px] font-black text-emerald-700 leading-none mt-1.5 tabular-nums">{adj.exito}%</p>
              <p className="text-[11px] text-emerald-600/80 mt-1">{adj.ganadas} de {adj.resueltas} resueltas</p>
            </motion.div>
            <motion.div whileHover={{ y: -3 }} className="rounded-xl border border-indigo-200 bg-indigo-50 p-3.5">
              <p className="text-[10.5px] font-semibold text-indigo-700 uppercase tracking-wide flex items-center gap-1"><Percent size={11} /> Eficiencia embudo</p>
              <p className="text-[28px] font-black text-indigo-700 leading-none mt-1.5 tabular-nums">{adj.embudo}%</p>
              <p className="text-[11px] text-indigo-600/80 mt-1">incluye {adj.n2} descartes N2</p>
            </motion.div>
            <motion.div whileHover={{ y: -3 }} className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
              <p className="text-[10.5px] font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1"><Trophy size={11} /> Adjudicadas</p>
              <p className="text-[28px] font-black text-slate-800 leading-none mt-1.5 tabular-nums">{adj.ganadas}</p>
              <p className="text-[11px] text-slate-400 mt-1">proyectos ganados</p>
            </motion.div>
            <motion.div whileHover={{ y: -3 }} className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
              <p className="text-[10.5px] font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1"><Wallet size={11} /> Monto neto real</p>
              <p className="text-[17px] font-black text-slate-800 leading-none mt-1.5 tabular-nums">{fmtMonto(adj.montoNeto)}</p>
              <p className="text-[11px] text-slate-400 mt-1">adjudicado según acta</p>
            </motion.div>
          </div>
        </Section>

        <Section title="Postuladas por sub-estado" icon={<DoorOpen size={15} className="text-amber-500" />}
          hint={`${postuladas.total} postuladas`}>
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
        hint={`${descartes.total} descartadas`}>
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
          hint="apertura técnica → revisión">
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
          hint={`${precision.total} resueltas`}>
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
