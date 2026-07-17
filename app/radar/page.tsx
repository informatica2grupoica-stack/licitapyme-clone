'use client';

import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import { useToast } from '@/app/components/ui/toast';
import { useConfirm } from '@/app/components/ui/confirm';
import { Select } from '@/app/components/ui/Select';
import { MultiSelect } from '@/app/components/ui/MultiSelect';
import { StatCard } from '@/app/components/ui/StatCard';
import { useSession } from '@/app/lib/session-context';
import {
  Radar, Plus, Trash2, ExternalLink, Tag,
  CheckCheck, Building2, Calendar, DollarSign, Loader2,
  BellOff, X, Clock, Search, Zap, ToggleLeft, ToggleRight,
  Sparkles, Filter, ChevronDown, FileText, Download, MapPin,
  ArrowUpDown, Eye, EyeOff, AlertCircle, Flame, SlidersHorizontal,
  CheckSquare, Square, UserPlus, Undo2, UserCheck,
  Ban, MinusCircle, History,
} from 'lucide-react';
import { extractTipoFromCodigo, getTipoLicitacion, TIPO_COLOR_CLASS } from '@/app/lib/tipos-licitacion';
import { estadoEfectivoNombre } from '@/app/lib/estado-mp';
import { Resaltar } from '@/app/components/Resaltar';

// ── Tipos ──────────────────────────────────────────────────────────────────────
interface PalabraClave {
  id: number; keyword: string; activo: boolean;
  categoria_id: number | null;
  categoria_nombre: string | null;
  categoria_color: string | null;
  es_negativa?: boolean | number;
  ultima_busqueda: string | null; resultados_nuevos: number;
  total_encontradas: number; created_at: string;
}

interface Alerta {
  id: number;
  keyword_texto: string;
  licitacion_codigo: string;
  licitacion_nombre: string;
  licitacion_organismo: string;
  licitacion_monto: number | null;
  licitacion_cierre: string | null;
  licitacion_fecha_publicacion: string | null;
  licitacion_estado: string | null;
  licitacion_region: string | null;
  licitacion_tipo: string | null;
  match_fuente: string | null;
  match_contexto: string | null;
  match_score?: number | null;
  categoria_nombre: string | null;
  categoria_color: string | null;
  leida: boolean;
  created_at: string;
  tiene_documentos?: number | boolean;
  viabilidad_score?: number | null;
  viabilidad_semaforo?: string | null;
  viabilidad_area?: string | null;
  viabilidad_informe?: {
    resumen?: string;
    recomendacion?: string;
    ventaja_competitiva?: string;
    riesgos?: string[];
  } | string | null;
  prefiltro_decision?: string | null;
  prefiltro_categoria?: string | null;
  prefiltro_motivo?: string | null;
  prefiltro_confianza?: number | null;
  // Estado de gestión (lo añade /api/alertas)
  asignada?: boolean;
  asignado_a?: number | null;
  asignado_nombre?: string | null;
  descartada?: boolean;
}

interface Usuario  { id: number; nombre: string | null; email: string; empresa: string | null; rol?: string; }
interface Etiqueta { id: number; nombre: string; color: string; }

// ── Constantes ────────────────────────────────────────────────────────────────
const ESTADOS_CFG = [
  { key: 'Publicada',  label: 'Publicada',  dot: '#10b981', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', pill: 'bg-emerald-500' },
  { key: 'Desierta',  label: 'Desierta',   dot: '#f59e0b', bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200',   pill: 'bg-amber-500'   },
  { key: 'Suspendida',label: 'Suspendida', dot: '#3b82f6', bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200',    pill: 'bg-blue-500'    },
  { key: 'Cerrada',   label: 'Cerrada',    dot: '#9ca3af', bg: 'bg-zinc-50',    text: 'text-zinc-500',    border: 'border-zinc-200',    pill: 'bg-zinc-400'    },
  { key: 'Adjudicada',label: 'Adjudicada', dot: '#8b5cf6', bg: 'bg-violet-50',  text: 'text-violet-700',  border: 'border-violet-200',  pill: 'bg-violet-500'  },
  { key: 'Revocada',  label: 'Revocada',   dot: '#f87171', bg: 'bg-red-50',     text: 'text-red-700',     border: 'border-red-200',     pill: 'bg-red-400'     },
];
const ESTADOS_ACTIVOS_DEFAULT = ['Publicada'];

// Claves de sessionStorage — persisten filtros y la última lista de alertas para que
// al volver de una licitación el radar conserve el estado y pinte al instante.
const SS_FILTROS = 'radar:filtros:v1';
const SS_ALERTAS = 'radar:alertas:v1';

const RANGOS_MONTO = [
  { key: '',       label: 'Cualquier monto' },
  { key: '<5',     label: '< $5M' },
  { key: '5-20',   label: '$5M – $20M' },
  { key: '20-100', label: '$20M – $100M' },
  { key: '>100',   label: '> $100M' },
];

const RANGOS_DIAS = [
  { key: '',      label: 'Cualquier plazo' },
  { key: '3',     label: '≤ 3 días (urgente)' },
  { key: '7',     label: '≤ 7 días' },
  { key: '30',    label: '≤ 30 días' },
  { key: 'venc',  label: 'Ya vencidos' },
];

const OPCIONES_ORDEN = [
  { key: 'publicacion-desc', label: 'Publicación más reciente' },
  { key: 'relevancia-desc',  label: 'Mayor relevancia' },
  { key: 'viabilidad-desc',  label: 'Mayor viabilidad' },
  { key: 'cierre-asc',       label: 'Cierre más próximo' },
  { key: 'monto-desc',       label: 'Mayor monto' },
  { key: 'monto-asc',        label: 'Menor monto' },
  { key: 'noleidas',         label: 'No leídas primero' },
];

// ── Viabilidad (Fase 2) ──────────────────────────────────────────────────────
const SEMAFORO_CFG: Record<string, { label: string; emoji: string; bg: string; text: string; border: string; dot: string }> = {
  VERDE:     { label: 'Viable',      emoji: '🟢', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: '#10b981' },
  AMARILLO:  { label: 'Media-alta',  emoji: '🟡', bg: 'bg-yellow-50',  text: 'text-yellow-700',  border: 'border-yellow-200',  dot: '#eab308' },
  NARANJA:   { label: 'Media',       emoji: '🟠', bg: 'bg-orange-50',  text: 'text-orange-700',  border: 'border-orange-200',  dot: '#f97316' },
  ROJO:      { label: 'Baja',        emoji: '🔴', bg: 'bg-red-50',     text: 'text-red-700',     border: 'border-red-200',     dot: '#ef4444' },
  ROJO_DURO: { label: 'Descartar',   emoji: '⛔', bg: 'bg-red-100',    text: 'text-red-800',     border: 'border-red-300',     dot: '#b91c1c' },
};
const SEMAFOROS_ORDEN = ['VERDE', 'AMARILLO', 'NARANJA', 'ROJO', 'ROJO_DURO'];

// ── Prefiltro (Fase 0) ─────────────────────────────────────────────────────────
const PREFILTRO_CFG: Record<string, { label: string; bg: string; text: string; border: string; dot: string }> = {
  PASA:            { label: 'Pasa',     bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: '#10b981' },
  REVISION_HUMANA: { label: 'Revisar',  bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200',   dot: '#f59e0b' },
  EXCLUIDO:        { label: 'Excluida', bg: 'bg-slate-100',  text: 'text-slate-500',   border: 'border-slate-300',   dot: '#94a3b8' },
};
const PREFILTRO_ORDEN = ['PASA', 'REVISION_HUMANA', 'EXCLUIDO'];
const CATEGORIA_LABEL: Record<string, string> = {
  servicio: 'Servicio', obra_civil: 'Obra civil', alta_ejecucion_tecnica: 'Alta ejecución técnica',
  capacitacion_pura: 'Capacitación', consultoria: 'Consultoría', convenio_suministro: 'Convenio de suministro',
  commodity: 'Commodity', presupuesto: 'Presupuesto bajo',
};

// ── Colores variados para etiqueta de asesor asignado ─────────────────────────
const COLORS_ASESOR = [
  { bg: 'bg-violet-50',  text: 'text-violet-700',  border: 'border-violet-200'  },
  { bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200'    },
  { bg: 'bg-teal-50',    text: 'text-teal-700',    border: 'border-teal-200'    },
  { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200'   },
  { bg: 'bg-rose-50',    text: 'text-rose-700',    border: 'border-rose-200'    },
  { bg: 'bg-indigo-50',  text: 'text-indigo-700',  border: 'border-indigo-200'  },
  { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  { bg: 'bg-orange-50',  text: 'text-orange-700',  border: 'border-orange-200'  },
];
function colorAsesor(id: number | null | undefined) {
  if (!id) return COLORS_ASESOR[0];
  return COLORS_ASESOR[Math.abs(id) % COLORS_ASESOR.length];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n: number | null): string {
  if (!n) return '';
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
}

function fmtFechaCorta(s: string | null): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return s; }
}

function tiempoRelativo(fecha: string): string {
  const d = Math.floor((Date.now() - new Date(fecha).getTime()) / 60000);
  if (d < 1) return 'ahora';
  if (d < 60) return `${d}m`;
  const h = Math.floor(d / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function diasAlCierre(cierre: string | null): number | null {
  if (!cierre) return null;
  return Math.ceil((new Date(cierre).getTime() - Date.now()) / 86400000);
}

function matchMonto(monto: number | null, rango: string): boolean {
  if (!rango) return true;
  const m = (monto ?? 0) / 1_000_000;
  if (rango === '<5')     return m > 0 && m < 5;
  if (rango === '5-20')   return m >= 5 && m <= 20;
  if (rango === '20-100') return m > 20 && m <= 100;
  if (rango === '>100')   return m > 100;
  return true;
}

// ¿La fecha de publicación cae dentro del rango [desde, hasta] (ambos opcionales)?
// Si hay rango activo y la licitación no tiene fecha de publicación → se excluye.
function dentroRangoPublicacion(fechaIso: string | null, desde: string, hasta: string): boolean {
  if (!desde && !hasta) return true;
  if (!fechaIso) return false;
  const t = new Date(fechaIso).getTime();
  if (isNaN(t)) return false;
  if (desde && t < new Date(`${desde}T00:00:00`).getTime()) return false;
  if (hasta && t > new Date(`${hasta}T23:59:59`).getTime()) return false;
  return true;
}

// ── Badges ────────────────────────────────────────────────────────────────────
function EstadoBadge({ estado, cierre }: { estado: string | null; cierre?: string | null }) {
  // Estado EFECTIVO: si figura "Publicada" pero su cierre ya pasó, se muestra "Cerrada".
  const efectivo = estadoEfectivoNombre(estado, cierre);
  if (!efectivo) return null;
  const cfg = ESTADOS_CFG.find(e => e.key.toLowerCase() === efectivo.toLowerCase());
  const estadoMostrar = efectivo;
  if (!cfg) return (
    <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-500 font-semibold border border-zinc-200">
      {estadoMostrar}
    </span>
  );
  return (
    <span
      title={estado && estado.toLowerCase() === 'publicada' && efectivo.toLowerCase() === 'cerrada'
        ? 'Mercado Público aún la lista como "Publicada", pero su fecha de cierre ya pasó → se muestra como Cerrada (estado efectivo)'
        : `Estado en Mercado Público: ${cfg.label}`}
      className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: cfg.dot }} />
      {cfg.label}
    </span>
  );
}

function TipoBadge({ codigo }: { codigo: string }) {
  const tipo = extractTipoFromCodigo(codigo);
  if (!tipo) return null;
  const info = getTipoLicitacion(tipo);
  const bg   = TIPO_COLOR_CLASS[tipo] || 'bg-zinc-400';
  return (
    <span className={`inline-flex items-center text-white text-[10px] font-black px-2 py-0.5 rounded-md flex-shrink-0 ${bg}`} title={info?.label}>
      {tipo}
    </span>
  );
}

function DiasCountdown({ cierre }: { cierre: string | null }) {
  const dias = diasAlCierre(cierre);
  if (dias === null) return null;
  const titulo = `Días corridos hasta la fecha de cierre de ofertas (${fmtFechaCorta(cierre)}). Rojo ≤3 días, ámbar ≤7.`;
  if (dias <= 0) return (
    <span title={`La fecha de cierre (${fmtFechaCorta(cierre)}) ya pasó: no se pueden presentar ofertas`}
      className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg bg-zinc-100 text-zinc-500 border border-zinc-200">
      Vencido
    </span>
  );
  if (dias <= 3) return (
    <span title={titulo} className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg bg-red-50 text-red-700 border border-red-200">
      <Flame size={11} className="flex-shrink-0" />
      {dias}d restante{dias !== 1 ? 's' : ''}
    </span>
  );
  if (dias <= 7) return (
    <span title={titulo} className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 border border-amber-200">
      <AlertCircle size={11} className="flex-shrink-0" />
      {dias}d restantes
    </span>
  );
  return (
    <span title={titulo} className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-100">
      <Calendar size={10} className="flex-shrink-0" />
      {dias}d restantes
    </span>
  );
}

function parseInforme(v: Alerta['viabilidad_informe']) {
  if (!v) return null;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  return v;
}

function ViabilidadBadge({ semaforo, score, area, informe }: {
  semaforo?: string | null; score?: number | null; area?: string | null;
  informe?: Alerta['viabilidad_informe'];
}) {
  if (!semaforo) return null;
  const cfg = SEMAFORO_CFG[semaforo];
  if (!cfg) return null;
  const inf = parseInforme(informe);
  const hayResumen = inf && (inf.resumen || inf.recomendacion || inf.ventaja_competitiva);

  return (
    <span className="relative group/viab inline-flex">
      <span
        title={hayResumen ? undefined : `Viabilidad según el análisis IA de las bases: ${cfg.label}${score != null ? ` (score ${score}/100)` : ''}`}
        className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-lg border cursor-default ${cfg.bg} ${cfg.text} ${cfg.border}`}
      >
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: cfg.dot }} />
        {cfg.label}
        {score != null && <span className="tabular-nums opacity-70">{score}</span>}
      </span>

      {/* Popover con el resumen del análisis (hover) */}
      {hayResumen && (
        <div className="invisible opacity-0 group-hover/viab:visible group-hover/viab:opacity-100 transition-opacity duration-150
                        absolute right-0 top-full mt-1.5 z-30 w-72 p-3 rounded-xl bg-white border border-slate-200 shadow-xl text-left pointer-events-none">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cfg.dot }} />
            <span className={`text-[11px] font-bold ${cfg.text}`}>{cfg.label}{score != null ? ` · ${score}/100` : ''}</span>
            {area && <span className="text-[10px] text-slate-400 ml-auto">{area}</span>}
          </div>
          {inf.resumen && <p className="text-[11.5px] text-slate-600 leading-snug mb-2">{inf.resumen}</p>}
          {inf.ventaja_competitiva && (
            <p className="text-[11px] text-emerald-700 leading-snug mb-1.5"><strong>Ventaja:</strong> {inf.ventaja_competitiva}</p>
          )}
          {inf.recomendacion && (
            <p className="text-[11px] text-indigo-700 leading-snug"><strong>Recomendación:</strong> {inf.recomendacion}</p>
          )}
        </div>
      )}
    </span>
  );
}

function PrefiltroBadge({ decision, categoria, motivo, confianza }: {
  decision?: string | null; categoria?: string | null; motivo?: string | null; confianza?: number | null;
}) {
  if (!decision) return null;
  const cfg = PREFILTRO_CFG[decision];
  if (!cfg) return null;
  const catLabel = categoria ? (CATEGORIA_LABEL[categoria] || categoria) : null;
  const hayDetalle = motivo || catLabel;

  return (
    <span className="relative group/pref inline-flex">
      <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-lg border cursor-default ${cfg.bg} ${cfg.text} ${cfg.border}`}>
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: cfg.dot }} />
        {cfg.label}
        {decision !== 'PASA' && catLabel && <span className="opacity-70 font-semibold">· {catLabel}</span>}
      </span>

      {/* Popover con el motivo del prefiltro — también para PASA (antes solo Revisar/Excluida,
          y el usuario no tenía cómo saber POR QUÉ una licitación pasó). */}
      {hayDetalle && (
        <div className="invisible opacity-0 group-hover/pref:visible group-hover/pref:opacity-100 transition-opacity duration-150
                        absolute right-0 top-full mt-1.5 z-30 w-64 p-3 rounded-xl bg-white border border-slate-200 shadow-xl text-left pointer-events-none">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cfg.dot }} />
            <span className={`text-[11px] font-bold ${cfg.text}`}>Prefiltro: {cfg.label}{catLabel ? ` · ${catLabel}` : ''}</span>
            {confianza != null && <span className="text-[10px] text-slate-400 ml-auto tabular-nums">conf. {Math.round(confianza * 100)}%</span>}
          </div>
          {motivo && <p className="text-[11.5px] text-slate-600 leading-snug">{motivo}</p>}
        </div>
      )}
    </span>
  );
}

// ── Fila lista compacta ──────────────────────────────────────────────────────
function LicitacionListItem({
  alerta, onDelete, onMarcarLeida, onDescartar, onToggleSelect, onAsignar, selected = false, keywords = [],
}: {
  alerta: Alerta;
  onDelete: (id: number) => void;
  onMarcarLeida: (id: number) => void;
  onDescartar: (alerta: Alerta, descartar: boolean) => void;
  onToggleSelect: (id: number) => void;
  onAsignar: (alerta: Alerta) => void;
  selected?: boolean;
  keywords?: string[];
}) {
  const noLeida = !alerta.leida;

  return (
    <div
      onClick={() => noLeida && onMarcarLeida(alerta.id)}
      className={`group relative rounded-lg px-4 py-3 border transition-all cursor-pointer ${
        selected
          ? 'bg-indigo-100 border-indigo-300'
          : alerta.descartada
          ? 'bg-slate-100 border-slate-200'
          : 'bg-indigo-50 border-indigo-200 hover:bg-white'
      }`}>

      <div className="flex items-center gap-3">
        <button
          onClick={(e) => { e.stopPropagation(); onToggleSelect(alerta.id); }}
          title={selected ? 'Quitar de la selección' : 'Seleccionar para acciones en lote (asignar/descartar varias)'}
          className="flex-shrink-0 text-slate-400 hover:text-indigo-600 transition-colors"
        >
          {selected ? <CheckSquare size={16} className="text-indigo-600" /> : <Square size={16} />}
        </button>

        <div className="flex-shrink-0 w-32">
          <div className="flex items-center gap-1 mb-1">
            <TipoBadge codigo={alerta.licitacion_codigo} />
            <EstadoBadge estado={alerta.licitacion_estado} cierre={alerta.licitacion_cierre} />
          </div>
          <span className="text-[10px] font-mono text-slate-500">{alerta.licitacion_codigo}</span>
        </div>

        <Link
          href={`/licitacion/${encodeURIComponent(alerta.licitacion_codigo)}`}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 min-w-0"
        >
          <p className="text-[12px] font-semibold text-slate-900 truncate hover:text-indigo-600 transition-colors">
            <Resaltar texto={alerta.licitacion_nombre || alerta.licitacion_codigo} keywords={keywords} />
          </p>
          {alerta.licitacion_organismo && (
            <p className="text-[10px] text-slate-500 truncate">{alerta.licitacion_organismo}</p>
          )}
        </Link>

        <div className="flex-shrink-0 w-32 text-right">
          {alerta.licitacion_monto && alerta.licitacion_monto > 0 && (
            <p className="text-[11px] font-bold text-emerald-700">{fmt(alerta.licitacion_monto)}</p>
          )}
          <div className="mt-0.5">
            <DiasCountdown cierre={alerta.licitacion_cierre} />
          </div>
        </div>

        <div className="flex-shrink-0 flex items-center gap-1.5">
          {alerta.viabilidad_semaforo && (
            <ViabilidadBadge semaforo={alerta.viabilidad_semaforo} score={alerta.viabilidad_score} />
          )}
          {alerta.tiene_documentos && (
            <span title="Las bases y anexos ya están descargados en el sistema"
              className="inline-flex items-center gap-1 text-[9px] font-semibold text-teal-700 bg-teal-100 px-1.5 py-0.5 rounded-full border border-teal-200">
              <FileText size={8} /> Docs
            </span>
          )}
          {alerta.prefiltro_decision && (
            <PrefiltroBadge decision={alerta.prefiltro_decision} categoria={alerta.prefiltro_categoria} motivo={alerta.prefiltro_motivo} confianza={alerta.prefiltro_confianza} />
          )}
          {alerta.asignada && (
            <span title={`Asignada a ${alerta.asignado_nombre || 'un perfil del equipo'}`}
              className="inline-flex items-center gap-0.5 text-[9px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full border border-emerald-200">
              ✓
            </span>
          )}
        </div>

        <div className="flex-shrink-0 flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); onDescartar(alerta, !alerta.descartada); }}
            title={alerta.descartada ? 'Volver a mostrarla entre las activas del radar' : 'Sacarla de la vista base del radar (queda en el corte "Descartadas", reversible)'}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors border ${
              alerta.descartada
                ? 'bg-emerald-100 border-emerald-300 text-emerald-700 hover:bg-emerald-200'
                : 'bg-red-100 border-red-300 text-red-700 hover:bg-red-200'
            }`}
          >
            {alerta.descartada ? <Undo2 size={12} /> : <EyeOff size={12} />}
            {alerta.descartada ? 'Restaurar' : 'Descartar'}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onAsignar(alerta); }}
            title={alerta.asignada
              ? `Asignada a ${alerta.asignado_nombre || 'un perfil'} — moverla a otro perfil`
              : 'Asignar a un perfil del equipo: descarga sus documentos, corre la viabilidad IA y la marca como revisada'}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors border ${
              alerta.asignada
                ? 'bg-emerald-100 border-emerald-300 text-emerald-700 hover:bg-emerald-200'
                : 'bg-indigo-100 border-indigo-300 text-indigo-700 hover:bg-indigo-200'
            }`}
          >
            <UserPlus size={12} />
            {alerta.asignada ? 'Reasignar' : 'Asignar'}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(alerta.id); }}
            className="flex-shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
            title="Eliminar la alerta del radar de forma permanente (no se puede deshacer; para ocultarla usa Descartar)"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Card licitación ───────────────────────────────────────────────────────────
function LicitacionCard({
  alerta, onDelete, onMarcarLeida, onDescartar, onToggleSelect, onAsignar, selected = false, keywords = [],
}: {
  alerta: Alerta;
  onDelete: (id: number) => void;
  onMarcarLeida: (id: number) => void;
  onDescartar: (alerta: Alerta, descartar: boolean) => void;
  onToggleSelect: (id: number) => void;
  onAsignar: (alerta: Alerta) => void;
  selected?: boolean;
  keywords?: string[];
}) {
  const noLeida = !alerta.leida;

  // ── Acento dominante por VIABILIDAD (la señal de negocio principal) ───────────
  // La barra lateral de color fuerte + el tinte de fondo salen del semáforo de
  // viabilidad IA. Si todavía no hay viabilidad, cae al prefiltro; si no, neutro.
  // Así cada tarjeta se distingue de un vistazo por su nivel de oportunidad.
  const VIAB_ACCENT: Record<string, { rail: string; tint: string }> = {
    VERDE:     { rail: '#10b981', tint: '#ecfdf5' },
    AMARILLO:  { rail: '#eab308', tint: '#fefce8' },
    NARANJA:   { rail: '#f97316', tint: '#fff7ed' },
    ROJO:      { rail: '#ef4444', tint: '#fef2f2' },
    ROJO_DURO: { rail: '#b91c1c', tint: '#fee2e2' },
  };
  const PREF_ACCENT: Record<string, { rail: string; tint: string }> = {
    PASA:            { rail: '#10b981', tint: '#f0fdf4' },
    REVISION_HUMANA: { rail: '#f59e0b', tint: '#fffbeb' },
    EXCLUIDO:        { rail: '#94a3b8', tint: '#f8fafc' },
  };
  const accent =
    (alerta.viabilidad_semaforo && VIAB_ACCENT[alerta.viabilidad_semaforo]) ||
    (alerta.prefiltro_decision && PREF_ACCENT[alerta.prefiltro_decision]) ||
    { rail: noLeida ? '#6366f1' : '#cbd5e1', tint: '#ffffff' };

  const railColor = alerta.descartada ? '#cbd5e1' : alerta.asignada ? '#3b82f6' : accent.rail;
  const fondo     = alerta.descartada ? '#f8fafc' : alerta.asignada ? '#eff6ff' : accent.tint;

  return (
    <div
      style={{ background: fondo, borderLeftColor: railColor, borderLeftWidth: '5px' }}
      className={`
      group relative rounded-xl border transition-all duration-150
      hover:shadow-md hover:-translate-y-px
      ${selected ? 'ring-2 ring-indigo-400 border-indigo-300' : noLeida ? 'border-indigo-200 shadow-sm' : 'border-slate-200'}
      ${alerta.descartada ? 'opacity-75' : ''}
    `}>
      <div className="p-4 pl-[15px]">
        {/* Row 1: badges + dias */}
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Checkbox de selección múltiple */}
            <button
              onClick={() => onToggleSelect(alerta.id)}
              title={selected ? 'Quitar de la selección' : 'Seleccionar'}
              className="flex-shrink-0 text-slate-300 hover:text-indigo-600 transition-colors"
            >
              {selected ? <CheckSquare size={16} className="text-indigo-600" /> : <Square size={16} />}
            </button>
            {/* Punto no leído */}
            <button
              onClick={() => noLeida && onMarcarLeida(alerta.id)}
              title={noLeida ? 'Marcar como leída' : 'Leída'}
              className="flex-shrink-0"
            >
              {noLeida
                ? <span className="w-2 h-2 rounded-full bg-indigo-500 block hover:bg-indigo-400 transition-colors" />
                : <span className="w-2 h-2 rounded-full bg-slate-200 block" />
              }
            </button>
            <TipoBadge codigo={alerta.licitacion_codigo} />
            <EstadoBadge estado={alerta.licitacion_estado} cierre={alerta.licitacion_cierre} />
            <span className="text-[10px] font-mono text-slate-400">{alerta.licitacion_codigo}</span>
            {alerta.asignada && (() => {
              const c = colorAsesor(alerta.asignado_a);
              return (
                <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${c.bg} ${c.text} ${c.border}`} title={`Asignada a ${alerta.asignado_nombre || ''}`}>
                  <UserCheck size={10} /> {alerta.asignado_nombre || 'Asignada'}
                </span>
              );
            })()}
            {alerta.descartada && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-300">
                <EyeOff size={10} /> Descartada
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <PrefiltroBadge decision={alerta.prefiltro_decision} categoria={alerta.prefiltro_categoria} motivo={alerta.prefiltro_motivo} confianza={alerta.prefiltro_confianza} />
            <ViabilidadBadge semaforo={alerta.viabilidad_semaforo} score={alerta.viabilidad_score} area={alerta.viabilidad_area} informe={alerta.viabilidad_informe} />
            <DiasCountdown cierre={alerta.licitacion_cierre} />
          </div>
        </div>

        {/* Row 1.5: categoría + palabra clave que hizo match */}
        {(alerta.categoria_nombre || alerta.keyword_texto) && (
          <div className="flex items-center gap-1.5 flex-wrap mb-2.5">
            {alerta.categoria_nombre && (
              <span
                style={{
                  backgroundColor: (alerta.categoria_color || '#64748b') + '18',
                  color: alerta.categoria_color || '#64748b',
                  borderColor: (alerta.categoria_color || '#64748b') + '40',
                }}
                className="inline-flex items-center gap-1 text-[10.5px] font-bold px-2 py-0.5 rounded-full border"
              >
                <span style={{ backgroundColor: alerta.categoria_color || '#64748b' }} className="w-1.5 h-1.5 rounded-full" />
                {alerta.categoria_nombre}
              </span>
            )}
            {alerta.keyword_texto && (
              <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
                <Tag size={9} className="text-slate-400" /> {alerta.keyword_texto}
                {alerta.match_fuente && <span className="text-slate-400 font-normal">· {alerta.match_fuente}</span>}
              </span>
            )}
          </div>
        )}

        {/* Row 2: Nombre */}
        <Link
          href={`/licitacion/${encodeURIComponent(alerta.licitacion_codigo)}`}
          onClick={() => noLeida && onMarcarLeida(alerta.id)}
          className="block text-[15.5px] font-extrabold text-slate-900 hover:text-indigo-600 transition-colors leading-snug tracking-tight line-clamp-2 mb-2.5"
        >
          {alerta.licitacion_nombre
            ? <Resaltar texto={alerta.licitacion_nombre} keywords={keywords} />
            : alerta.licitacion_codigo}
        </Link>

        {/* Row 3: Organismo + Región */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2.5">
          {alerta.licitacion_organismo && (
            <span className="flex items-center gap-1.5 text-[12px] text-slate-600">
              <Building2 size={12} className="text-slate-400 flex-shrink-0" />
              <span className="line-clamp-1">{alerta.licitacion_organismo}</span>
            </span>
          )}
          {alerta.licitacion_region && (
            <span className="flex items-center gap-1.5 text-[12px] text-slate-500">
              <MapPin size={11} className="text-slate-400 flex-shrink-0" />
              {alerta.licitacion_region}
            </span>
          )}
        </div>

        {/* Row 4: Monto + Publicación + Cierre + Documentos */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-3">
          {alerta.licitacion_monto != null && alerta.licitacion_monto > 0 && (
            <span className="flex items-center gap-1.5 text-[13px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-100">
              <DollarSign size={12} className="flex-shrink-0" />
              {fmt(alerta.licitacion_monto)}
            </span>
          )}
          <span
            className="flex items-center gap-1.5 text-[12px] text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-lg border border-indigo-100"
            title={alerta.licitacion_fecha_publicacion ? 'Fecha de publicación (Mercado Público)' : 'La API no entregó fecha de publicación — se muestra la fecha en que llegó al sistema'}
          >
            <Zap size={10} className="flex-shrink-0" />
            Publicada: <strong className="ml-0.5">{fmtFechaCorta(alerta.licitacion_fecha_publicacion || alerta.created_at)}</strong>
          </span>
          {alerta.licitacion_cierre && (
            <span className="flex items-center gap-1.5 text-[12px] text-slate-500">
              <Calendar size={11} className="text-slate-400 flex-shrink-0" />
              Cierre: <strong className="text-slate-700">{fmtFechaCorta(alerta.licitacion_cierre)}</strong>
            </span>
          )}
          {!!alerta.tiene_documentos && (
            <span className="flex items-center gap-1 text-[11px] text-teal-700 bg-teal-50 border border-teal-100 px-2 py-0.5 rounded-full font-semibold">
              <FileText size={10} /> Documentos disponibles
            </span>
          )}
        </div>

        {/* Footer: acciones */}
        <div className="flex items-center justify-between pt-2.5 border-t border-slate-100">
          <div title={`Hace cuánto llegó esta licitación al radar (${fmtFechaCorta(alerta.created_at)})`}
            className="flex items-center gap-1 text-[10px] text-slate-400">
            <Clock size={9} /> Detectada {tiempoRelativo(alerta.created_at)}
          </div>
          <div className="flex items-center gap-1">
            <Link
              href={`/licitacion/${encodeURIComponent(alerta.licitacion_codigo)}`}
              onClick={() => noLeida && onMarcarLeida(alerta.id)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-semibold rounded-lg transition-colors"
            >
              Ver detalle <ExternalLink size={11} />
            </Link>
            <button
              onClick={() => onDescartar(alerta, !alerta.descartada)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-semibold rounded-lg border transition-colors ${alerta.descartada
                ? 'bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-white border-slate-200 text-slate-500 hover:bg-red-50 hover:border-red-200 hover:text-red-600'}`}
              title={alerta.descartada ? 'Volver a mostrarla entre las activas del radar' : 'Sacarla de la vista base del radar (queda en el corte "Descartadas", reversible)'}
            >
              {alerta.descartada ? <><Undo2 size={12} /> Restaurar</> : <><EyeOff size={12} /> Descartar</>}
            </button>
            <button
              onClick={() => onAsignar(alerta)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-semibold rounded-lg border transition-colors ${alerta.asignada
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                : 'bg-white border-slate-200 text-slate-500 hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-600'}`}
              title={alerta.asignada
                ? `Asignada a ${alerta.asignado_nombre || 'un perfil'} — moverla a otro perfil`
                : 'Asignar a un perfil del equipo: descarga sus documentos, corre la viabilidad IA y la marca como revisada'}
            >
              <UserPlus size={12} /> {alerta.asignada ? 'Reasignar' : 'Asignar'}
            </button>
            <button
              onClick={() => onDelete(alerta.id)}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
              title="Eliminar la alerta del radar de forma permanente (no se puede deshacer; para ocultarla usa Descartar)"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Memoizadas: con 50 tarjetas por página, un cambio puntual (marcar leída, seleccionar
// una, tipear en el buscador) ya no re-renderiza las otras 49.
const LicitacionListItemMemo = memo(LicitacionListItem);
const LicitacionCardMemo = memo(LicitacionCard);

// ── Skeleton card ──────────────────────────────────────────────────────────────
function CardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <div className="w-2 h-2 rounded-full bg-slate-200" />
          <div className="w-8 h-4 bg-slate-200 rounded-md" />
          <div className="w-16 h-4 bg-slate-200 rounded-full" />
        </div>
        <div className="w-20 h-5 bg-slate-200 rounded-lg" />
      </div>
      <div className="h-4 bg-slate-200 rounded w-3/4" />
      <div className="h-3.5 bg-slate-200 rounded w-1/2" />
      <div className="flex gap-3">
        <div className="h-7 w-28 bg-slate-200 rounded-lg" />
        <div className="h-5 w-24 bg-slate-200 rounded" />
      </div>
    </div>
  );
}

// ── Ayuda contextual: "?" con popover que explica qué hace cada control ───────
function InfoHint({ texto }: { texto: string }) {
  return (
    <span className="relative group/info inline-flex flex-shrink-0">
      <span className="w-[18px] h-[18px] rounded-full bg-slate-100 text-slate-400 text-[10px] font-bold flex items-center justify-center cursor-help border border-slate-200 group-hover/info:bg-indigo-50 group-hover/info:text-indigo-500 group-hover/info:border-indigo-200 transition-colors">?</span>
      <span className="invisible opacity-0 group-hover/info:visible group-hover/info:opacity-100 transition-opacity duration-150 absolute left-1/2 -translate-x-1/2 top-full mt-1.5 z-40 w-64 p-2.5 rounded-lg bg-slate-900 text-white text-[11px] leading-snug font-medium shadow-xl pointer-events-none">
        {texto}
      </span>
    </span>
  );
}

// Conteos del panel precalculados EN UNA SOLA PASADA (en RadarPage): antes cada botón
// del panel recorría TODAS las alertas por su cuenta (~20 pasadas completas por render).
interface ConteosFiltros {
  estados: Map<string, number>;       // clave en minúsculas (estado EFECTIVO)
  tipos: Map<string, number>;
  semaforos: Map<string, number>;
  decisiones: Map<string, number>;
  regiones: Map<string, number>;
  matchKeywords: Map<string, number>; // palabra clave que detectó cada alerta
}

// ── Panel de filtros (compacto: MISMOS filtros, agrupados en 2 filas) ─────────
function PanelFiltros({
  conteos, filtros, onChange, onClear, hayFiltros,
}: {
  conteos: ConteosFiltros;
  filtros: {
    texto: string; estados: string[]; tipos: string[]; region: string;
    dias: string; monto: string; conDocumentos: boolean;
    soloNoLeidas: boolean; orden: string; semaforos: string[]; keyword: string;
    decisiones: string[]; ocultarExcluidas: boolean;
    fechaDesde: string; fechaHasta: string;
  };
  onChange: (key: string, val: unknown) => void;
  onClear: () => void;
  hayFiltros: boolean;
}) {
  const estadoOpts = ESTADOS_CFG
    .filter(e => (conteos.estados.get(e.key.toLowerCase()) || 0) > 0)
    .map(e => ({ value: e.key, label: e.label, color: e.dot, count: conteos.estados.get(e.key.toLowerCase()) }));
  const semaforoOpts = SEMAFOROS_ORDEN
    .filter(k => (conteos.semaforos.get(k) || 0) > 0)
    .map(k => ({ value: k, label: SEMAFORO_CFG[k].label, color: SEMAFORO_CFG[k].dot, count: conteos.semaforos.get(k) }));
  const prefiltroOpts = PREFILTRO_ORDEN
    .filter(k => (conteos.decisiones.get(k) || 0) > 0)
    .map(k => ({ value: k, label: PREFILTRO_CFG[k].label, color: PREFILTRO_CFG[k].dot, count: conteos.decisiones.get(k) }));
  const tipoOpts = [...conteos.tipos.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([t, n]) => {
      const info = getTipoLicitacion(t);
      return { value: t, label: info ? `${t} · ${info.label}` : t, count: n };
    });
  const regionOpts = [...conteos.regiones.keys()].sort().map(r => ({ value: r, label: r }));
  const kwOpts = [...conteos.matchKeywords.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, n]) => ({ value: k, label: k, count: n }));

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-3">
      {/* Fila 1 — CLASIFICACIÓN: qué es cada licitación */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider w-[88px] flex-shrink-0">Clasificación</span>
        {estadoOpts.length > 0 && <>
          <MultiSelect label="Estado MP" icon={<FileText size={13} />} selected={filtros.estados}
            onChange={v => onChange('estados', v)} options={estadoOpts} />
          <InfoHint texto="Estado en Mercado Público. Una 'Publicada' cuyo cierre ya pasó se muestra y filtra como 'Cerrada'. Por defecto el radar muestra solo Publicadas." />
        </>}
        {semaforoOpts.length > 0 && <>
          <MultiSelect label="Viabilidad" icon={<Sparkles size={13} />} selected={filtros.semaforos}
            onChange={v => onChange('semaforos', v)} options={semaforoOpts} />
          <InfoHint texto="Semáforo del análisis IA que lee las bases y documentos (score 0-100). Solo lo tienen las licitaciones ya analizadas; pasa el mouse por el badge de una tarjeta para ver su resumen." />
        </>}
        {prefiltroOpts.length > 0 && <>
          <MultiSelect label="Prefiltro" icon={<Filter size={13} />} selected={filtros.decisiones}
            onChange={v => onChange('decisiones', v)} options={prefiltroOpts} />
          <InfoHint texto="Decisión automática de la Fase 0 según el perfil de negocio: Pasa (calza), Revisar (dudosa) o Excluida (obra civil, rubro ajeno, presupuesto bajo…). El motivo aparece al pasar el mouse por el badge." />
        </>}
        {tipoOpts.length > 1 && <>
          <MultiSelect label="Tipo" icon={<Tag size={13} />} selected={filtros.tipos}
            onChange={v => onChange('tipos', v)} options={tipoOpts} minWidth={260} />
          <InfoHint texto="Tipo de proceso según el código (LE, LP, LR, LS…): define el tramo de monto de la licitación. Por defecto se muestran LE/LP/LR/LS." />
        </>}
      </div>

      {/* Fila 2 — ALCANCE: cuánto, cuándo y dónde */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider w-[88px] flex-shrink-0">Alcance</span>
        <div title="Plazo hasta el cierre de ofertas. 'Ya vencidos' carga además el histórico completo.">
          <Select value={filtros.dias} onChange={v => onChange('dias', v)} icon={<Clock size={13} />}
            options={RANGOS_DIAS.map(r => ({ value: r.key, label: r.label }))} minWidth={170} />
        </div>
        <div title="Monto estimado de la licitación en pesos chilenos (las sin monto publicado solo aparecen con 'Cualquier monto').">
          <Select value={filtros.monto} onChange={v => onChange('monto', v)} icon={<DollarSign size={13} />}
            options={RANGOS_MONTO.map(r => ({ value: r.key, label: r.label }))} minWidth={160} />
        </div>
        {regionOpts.length > 0 && (
          <div title="Región del organismo comprador según Mercado Público.">
            <Select value={filtros.region} onChange={v => onChange('region', v)} icon={<MapPin size={13} />}
              options={[{ value: '', label: 'Todas las regiones' }, ...regionOpts]} minWidth={230} />
          </div>
        )}
        {kwOpts.length > 0 && <>
          <Select value={filtros.keyword} onChange={v => onChange('keyword', v)} icon={<Tag size={13} />}
            options={[{ value: '', label: 'Todas las palabras' }, ...kwOpts]} minWidth={230} />
          <InfoHint texto="Palabra clave del radar que detectó la licitación (el match puede venir del título, la descripción o los ítems)." />
        </>}
        {/* Rango de fecha de publicación */}
        <div className="inline-flex items-center gap-1.5 border border-slate-200 rounded-lg px-2 py-[5px] bg-white">
          <Calendar size={12} className="text-slate-400 flex-shrink-0" />
          <input type="date" value={filtros.fechaDesde} max={filtros.fechaHasta || undefined}
            onChange={e => onChange('fechaDesde', e.target.value)}
            className="text-[12px] text-slate-600 outline-none bg-transparent w-[118px]" />
          <span className="text-slate-300 text-[11px]">→</span>
          <input type="date" value={filtros.fechaHasta} min={filtros.fechaDesde || undefined}
            onChange={e => onChange('fechaHasta', e.target.value)}
            className="text-[12px] text-slate-600 outline-none bg-transparent w-[118px]" />
          {(filtros.fechaDesde || filtros.fechaHasta) && (
            <button onClick={() => { onChange('fechaDesde', ''); onChange('fechaHasta', ''); }}
              title="Limpiar fechas" className="text-slate-400 hover:text-red-500"><X size={12} /></button>
          )}
        </div>
        <InfoHint texto="Rango de la FECHA DE PUBLICACIÓN en Mercado Público. Si la API no entregó fecha, se usa el día en que la licitación llegó al radar." />
        <button
          onClick={() => onChange('conDocumentos', !filtros.conDocumentos)}
          className={`inline-flex items-center gap-1.5 text-[12px] px-2.5 py-[7px] rounded-lg border font-semibold transition-all ${
            filtros.conDocumentos ? 'bg-teal-50 text-teal-700 border-teal-300' : 'border-slate-200 text-slate-500 hover:border-slate-400'
          }`}
        >
          <FileText size={12} /> Con documentos
        </button>
        <InfoHint texto="Solo licitaciones cuyas bases y anexos ya están descargados en el sistema (se descargan al asignarla, o con el reintento automático cada 2 horas)." />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-100 flex-wrap">
        <p className="text-[11px] text-slate-400">Los filtros se combinan entre sí y quedan guardados mientras navegas por la app.</p>
        <button
          onClick={onClear}
          disabled={!hayFiltros}
          className={`inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-lg border font-semibold transition-all ${
            hayFiltros
              ? 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
              : 'text-slate-300 border-slate-100 cursor-not-allowed'
          }`}
        >
          <X size={12} /> Limpiar filtros
        </button>
      </div>
    </div>
  );
}
// KPI del embudo: una StatCard clicable que APLICA (o quita) su filtro al tablero.
function KpiFiltro({ activo, onClick, icon, label, value, sub, color, hint }: {
  activo: boolean; onClick: () => void; icon: React.ReactNode; label: string;
  value: number; sub?: string; color: string; hint: string;
}) {
  return (
    <button onClick={onClick} title={hint}
      className={`text-left w-full h-full rounded-2xl transition-all ${activo ? 'ring-2 ring-indigo-500 ring-offset-2' : ''}`}>
      <StatCard icon={icon} label={label} value={value} sub={sub} color={color} />
    </button>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
// ── Modal de asignación a un perfil del equipo ───────────────────────────────────
function AsignarModal({ usuarios, count, unaNombre = null, onClose, onConfirm, loading, usuarioActualId }: {
  usuarios: Usuario[]; count: number; unaNombre?: string | null; onClose: () => void; onConfirm: (usuarioId: number) => void; loading: boolean; usuarioActualId?: number;
}) {
  const [sel, setSel] = useState<number | null>(null);

  // Orden: perfiles normales primero (con el usuario actual al tope), luego admins al final.
  const usuariosOrdenados = useMemo(() => {
    const normales = usuarios.filter(u => u.rol !== 'admin');
    const admins   = usuarios.filter(u => u.rol === 'admin');
    // Dentro de normales: el usuario actual va primero.
    const yo    = normales.filter(u => u.id === usuarioActualId);
    const otros = normales.filter(u => u.id !== usuarioActualId);
    return [...yo, ...otros, ...admins];
  }, [usuarios, usuarioActualId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="min-w-0">
            <h3 className="text-[15px] font-bold text-slate-800">Asignar {count} licitación{count !== 1 ? 'es' : ''}</h3>
            <p className="text-[12px] text-slate-400 truncate">{unaNombre ? unaNombre : 'Elige el perfil del equipo'}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {usuariosOrdenados.length === 0 ? (
            <p className="text-[13px] text-slate-400 text-center py-8">No hay perfiles disponibles.</p>
          ) : usuariosOrdenados.map((u, idx) => {
            const esYo = u.id === usuarioActualId;
            const esAdmin = u.rol === 'admin';
            // Separador visual antes del primer admin (si los hay mezclados con normales).
            const anteriorEsNormal = idx > 0 && usuariosOrdenados[idx - 1].rol !== 'admin';
            const mostrarSeparador = esAdmin && anteriorEsNormal;
            const c = colorAsesor(u.id);
            return (
              <div key={u.id}>
                {mostrarSeparador && (
                  <div className="flex items-center gap-2 px-3 py-1.5 mt-1">
                    <div className="flex-1 h-px bg-slate-100" />
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Administradores</span>
                    <div className="flex-1 h-px bg-slate-100" />
                  </div>
                )}
                <button onClick={() => setSel(u.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${sel === u.id ? 'bg-indigo-50 ring-1 ring-indigo-300' : 'hover:bg-slate-50'}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold flex-shrink-0 border ${c.bg} ${c.text} ${c.border}`}>
                    {(u.nombre || u.email || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-slate-800 truncate">
                      {u.nombre || u.email}
                      {esYo && <span className="ml-1.5 text-[10px] font-normal text-indigo-400">(yo)</span>}
                      {esAdmin && <span className="ml-1.5 text-[10px] font-normal text-amber-500">admin</span>}
                    </p>
                    {u.nombre && <p className="text-[11px] text-slate-400 truncate">{u.email}</p>}
                  </div>
                  {sel === u.id && <CheckSquare size={16} className="text-indigo-600 ml-auto flex-shrink-0" />}
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 text-[13px] font-semibold text-slate-600 rounded-lg hover:bg-slate-100">Cancelar</button>
          <button onClick={() => sel != null && onConfirm(sel)} disabled={sel == null || loading}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />} Asignar
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RadarPage() {
  const { usuario } = useSession();
  const toast       = useToast();
  const confirmar   = useConfirm();

  const [keywords,      setKeywords]      = useState<PalabraClave[]>([]);
  const [alertas,       setAlertas]       = useState<Alerta[]>([]);
  const [noLeidas,      setNoLeidas]      = useState(0);
  const [loading,       setLoading]       = useState(true);
  const [loadingAlerts, setLoadingAlerts] = useState(true);
  // Histórico (vencidas): por rendimiento arranca en false → solo activas. Se activa bajo
  // demanda (botón "ver histórico" o filtro "Ya vencidos") y recarga trayendo también las vencidas.
  const [incluirVencidas, setIncluirVencidas] = useState(false);
  const [nuevaKw,       setNuevaKw]       = useState('');
  const [nuevaCat,      setNuevaCat]      = useState<string>(''); // categoría para la nueva keyword
  const [nuevaNegativa, setNuevaNegativa] = useState(false);      // ¿la nueva keyword es de exclusión?
  const [etiquetas,     setEtiquetas]     = useState<Etiqueta[]>([]);
  const [agregando,     setAgregando]     = useState(false);
  const [actualizando,  setActualizando]  = useState(false);
  // Texto de la fase en curso del botón "Actualizar" (intake → enriquecer → prefiltro).
  const [faseActual,    setFaseActual]     = useState<string | null>(null);
  const [ultimaAct,     setUltimaAct]     = useState<string | null>(null);
  const [tab,           setTab]           = useState<'radar' | 'keywords'>('radar');
  // El panel arranca PLEGADO: la barra de mando + chips activos ya dicen qué está filtrando.
  const [filtrosOpen,   setFiltrosOpen]   = useState(false);
  const [exportando,    setExportando]    = useState(false);
  const [vistaRadar,    setVistaRadar]    = useState<'tarjetas' | 'lista'>('tarjetas');
  // Explicador "¿Cómo funciona el radar?" (colapsado por defecto).
  const [ayudaOpen,     setAyudaOpen]     = useState(false);
  // Input del buscador con DEBOUNCE (250 ms): escribir ya no re-filtra ~2.000 alertas
  // ni re-renderiza las 50 tarjetas de la página EN CADA TECLA.
  const [textoInput,    setTextoInput]    = useState('');

  // Descarga de documentos de NEGOCIOS (asignadas activas, todos los perfiles). Sin gate de prefiltro.
  // Backlog de asignadas que quedaron sin docs (la descarga normal es AL ASIGNAR).
  const [descNegInfo,   setDescNegInfo]   = useState<{ pendientes: number; total: number } | null>(null);
  const [descNegActiva, setDescNegActiva] = useState(false);
  const [descNegStats,  setDescNegStats]  = useState({ procesadas: 0, exitosas: 0, errores: 0 });

  // Filtros
  const FILTROS_DEFAULT = {
    texto: '', estados: ESTADOS_ACTIVOS_DEFAULT, tipos: ['LE', 'LP', 'LR', 'LS'] as string[], region: '',
    dias: '', monto: '', conDocumentos: false, soloNoLeidas: false, orden: 'publicacion-desc',
    semaforos: [] as string[], keyword: '',
    decisiones: [] as string[], ocultarExcluidas: false,
    fechaDesde: '', fechaHasta: '',
    gestion: '', // '' = activas (oculta descartadas) | sin_asignar | asignadas | descartadas
  };
  const [filtros, setFiltros] = useState(FILTROS_DEFAULT);
  // Hidratado = ya leímos los filtros guardados; evita persistir el default antes de hidratar.
  const [hidratado, setHidratado] = useState(false);

  // Selección múltiple + asignación
  const [sel, setSel]                 = useState<Set<number>>(new Set());
  const [usuarios, setUsuarios]       = useState<Usuario[]>([]);
  const [modalAsignar, setModalAsignar] = useState(false);
  const [accionMasiva, setAccionMasiva] = useState(false);
  // Cuando se asigna UNA sola licitación desde su tarjeta (vs. la selección múltiple).
  const [asignarUna, setAsignarUna]     = useState<Alerta | null>(null);

  // Paginación de la VISUALIZACIÓN (cliente): los filtros operan sobre TODAS las
  // alertas; aquí solo recortamos cuántas tarjetas se pintan a la vez.
  const POR_PAGINA = 50;
  const [pagina, setPagina] = useState(1);

  const setFiltro = useCallback((key: string, val: unknown) => {
    setFiltros(prev => ({ ...prev, [key]: val }));
  }, []);

  const limpiarFiltros = useCallback(() => setFiltros(FILTROS_DEFAULT), []); // eslint-disable-line

  // Debounce del buscador → el filtro real (filtros.texto) se actualiza 250 ms después
  // de la última tecla. La sincronización inversa cubre "limpiar filtros" y los chips.
  useEffect(() => { setTextoInput(filtros.texto); }, [filtros.texto]);
  useEffect(() => {
    const t = setTimeout(() => {
      setFiltros(prev => (prev.texto === textoInput ? prev : { ...prev, texto: textoInput }));
    }, 250);
    return () => clearTimeout(t);
  }, [textoInput]);

  // ¿El filtro difiere del default? (los tipos y estados por defecto NO cuentan como filtro activo)
  const tiposEsDefault   = useMemo(() => JSON.stringify([...filtros.tipos].sort()) === JSON.stringify([...FILTROS_DEFAULT.tipos].sort()), [filtros.tipos]); // eslint-disable-line
  const estadosEsDefault = useMemo(() => JSON.stringify([...filtros.estados].sort()) === JSON.stringify([...ESTADOS_ACTIVOS_DEFAULT].sort()), [filtros.estados]);

  // Cuántos filtros están activos (para el badge del toggle, visible aun con el panel plegado).
  const numFiltrosActivos = useMemo(() => {
    let n = 0;
    if (filtros.texto) n++;
    if (!tiposEsDefault) n++;
    if (filtros.region) n++;
    if (filtros.dias) n++;
    if (filtros.monto) n++;
    if (filtros.conDocumentos) n++;
    if (filtros.soloNoLeidas) n++;
    if (filtros.keyword) n++;
    if (filtros.semaforos.length > 0) n++;
    if (filtros.decisiones.length > 0) n++;
    if (filtros.ocultarExcluidas) n++;
    if (filtros.fechaDesde || filtros.fechaHasta) n++;
    if (!estadosEsDefault) n++;
    return n;
  }, [filtros, tiposEsDefault, estadosEsDefault]);

  // ── Carga ─────────────────────────────────────────────────────────────────────
  const cargarKeywords = useCallback(async () => {
    try {
      const d = await fetch('/api/palabras-clave').then(r => r.json());
      if (d.success) {
        setKeywords(d.keywords || []);
        const fechas = (d.keywords || []).map((k: PalabraClave) => k.ultima_busqueda).filter(Boolean).sort().reverse();
        if (fechas[0]) setUltimaAct(fechas[0]);
      }
    } catch { /* silencioso */ }
    finally { setLoading(false); }
  }, []);

  // silencioso=true → no muestra el skeleton (refresco en segundo plano sobre datos ya pintados desde cache)
  // RENDIMIENTO: por defecto el radar pide solo las ACTIVAS (mucho más rápido). El histórico
  // (vencidas) se trae bajo demanda con ?incluirVencidas=1 al pulsar "ver histórico" o el
  // filtro "Ya vencidos".
  const cargarAlertas = useCallback(async (silencioso = false, incluir = false) => {
    if (!silencioso) setLoadingAlerts(true);
    try {
      const d = await fetch(incluir ? '/api/alertas?incluirVencidas=1' : '/api/alertas').then(r => r.json());
      if (d.success) { setAlertas(d.alertas || []); setNoLeidas(d.noLeidas || 0); }
    } catch { /* silencioso */ }
    finally { setLoadingAlerts(false); }
  }, []);

  const cargarEtiquetas = useCallback(async () => {
    try {
      const d = await fetch('/api/etiquetas').then(r => r.json());
      if (d.success) setEtiquetas(d.etiquetas || []);
    } catch { /* silencioso */ }
  }, []);

  // ── Hidratación al montar: restaura filtros guardados y pinta alertas cacheadas ──
  useEffect(() => {
    // 1) Filtros persistidos (sessionStorage) → se conservan al volver de una licitación.
    try {
      const raw = sessionStorage.getItem(SS_FILTROS);
      if (raw) setFiltros(prev => ({ ...prev, ...JSON.parse(raw) }));
    } catch { /* sin persistencia */ }
    setHidratado(true);

    // 2) Alertas cacheadas → pintan al instante; luego refrescamos en segundo plano.
    let teniaCache = false;
    try {
      const raw = sessionStorage.getItem(SS_ALERTAS);
      if (raw) {
        const c = JSON.parse(raw);
        if (Array.isArray(c.alertas) && c.alertas.length) {
          setAlertas(c.alertas);
          setNoLeidas(c.noLeidas || 0);
          setLoadingAlerts(false);
          teniaCache = true;
        }
      }
    } catch { /* sin cache */ }

    cargarKeywords();
    cargarEtiquetas();
    cargarAlertas(teniaCache); // si había cache, refresco silencioso (sin skeleton)
  }, [cargarKeywords, cargarAlertas, cargarEtiquetas]);

  // Persistir filtros cada vez que cambian (después de hidratar, para no pisar lo guardado).
  useEffect(() => {
    if (!hidratado) return;
    try { sessionStorage.setItem(SS_FILTROS, JSON.stringify(filtros)); } catch { /* cuota llena */ }
  }, [filtros, hidratado]);

  // Si el usuario filtra por "Ya vencidos", cargamos el histórico automáticamente (si no está).
  useEffect(() => {
    if (filtros.dias === 'venc' && !incluirVencidas) setIncluirVencidas(true);
  }, [filtros.dias, incluirVencidas]);

  // Recargar cuando cambia "ver histórico" (salta la primera corrida: el montaje ya cargó activas).
  const vencIniciado = useRef(false);
  useEffect(() => {
    if (!hidratado) return;
    if (!vencIniciado.current) { vencIniciado.current = true; return; }
    cargarAlertas(true, incluirVencidas);
  }, [incluirVencidas, hidratado, cargarAlertas]);

  // Mantener el cache de alertas en sync con el estado (para pintura instantánea al volver).
  // Aligeramos el cache omitiendo viabilidad_informe: es el campo más pesado (~0.5 MB en
  // total, solo para el popover de hover) y hacía que el payload superara el tope de 3.5 MB,
  // dejando el cache SIN guardar. Las tarjetas pintan igual al instante; el refetch en
  // segundo plano restaura el informe completo ~1-2 s después.
  // Debounce 1.5s: durante los loops de fondo `alertas` cambia cada pocos segundos y
  // serializar ~3.8MB en el hilo principal por cada lote producía jank visible.
  useEffect(() => {
    if (loadingAlerts) return;
    const t = setTimeout(() => {
      try {
        const ligeras = alertas.map(a => (a.viabilidad_informe ? { ...a, viabilidad_informe: null } : a));
        const s = JSON.stringify({ alertas: ligeras, noLeidas, ts: Date.now() });
        if (s.length < 3_800_000) sessionStorage.setItem(SS_ALERTAS, s); // ~3.8MB tope de seguridad
      } catch { /* cuota llena → degrada a fetch normal */ }
    }, 1_500);
    return () => clearTimeout(t);
  }, [alertas, noLeidas, loadingAlerts]);

  // ── Acciones ──────────────────────────────────────────────────────────────────
  // "Actualizar ahora" = las 3 fases del automático por hora, orquestadas EN EL CLIENTE
  // (secuenciales, con progreso y reanudables). No se hacen en una sola request porque el
  // intake solo ya toma ~60s y encadenar todo excede el tope de duración (Vercel corta a 60s).
  //   Paso 1: intake       → /api/radar/actualizar (admin; reusa cron/alertas server-side)
  //   Paso 2: enriquecer    → /api/radar/enriquecer-pendientes (admin; loop reanudable)
  //   Paso 3: prefiltro     → /api/prefiltro/analizar-pendientes (sesión; loop reanudable)
  const actualizarAhora = async () => {
    if (actualizando) return;
    setActualizando(true);
    let totalNuevas = 0;
    let intake: any = null;
    const MAX_ITER = 60; // tope de seguridad por fase (evita bucle infinito)
    try {
      // ── Paso 1/3: Intake (baja de MP + matchea keywords + inserta alertas) ──
      setFaseActual('Paso 1/3: buscando…');
      const res = await fetch('/api/radar/actualizar', { method: 'POST', signal: AbortSignal.timeout(120_000) });
      intake = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error('Error al actualizar', intake.error || `HTTP ${res.status}`); return; }
      totalNuevas += Number(intake.alertasNuevas || 0);

      // ── Paso 2/3: Enriquecer (ítems/categoría/fecha real + re-match) ──
      const excluir = new Set<string>();
      for (let i = 0; i < MAX_ITER; i++) {
        setFaseActual('Paso 2/3: enriqueciendo…');
        let r: any;
        try {
          r = await fetch('/api/radar/enriquecer-pendientes', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lote: 12, excluir: Array.from(excluir) }),
            signal: AbortSignal.timeout(290_000),
          }).then(x => x.json());
        } catch { break; } // timeout/red → cortar esta fase, seguir con prefiltro
        if (!r || r.error) break;
        totalNuevas += Number(r.alertasNuevas || 0);
        for (const p of (r.procesados || [])) if (!p.exito) excluir.add(p.codigo);
        if (typeof r.pendientes === 'number') setFaseActual(`Paso 2/3: enriqueciendo… ${r.pendientes} rest.`);
        if (r.completado || (r.pendientes ?? 0) === 0) break;
      }

      // ── Paso 3/3: Prefiltro (decide PASA / EXCLUIDO / REVISION) ──
      for (let i = 0; i < MAX_ITER; i++) {
        setFaseActual('Paso 3/3: prefiltrando…');
        let r: any;
        try {
          r = await fetch('/api/prefiltro/analizar-pendientes', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lote: 20 }),
            signal: AbortSignal.timeout(290_000),
          }).then(x => x.json());
        } catch { break; }
        if (!r || r.error) break;
        if (typeof r.pendientes === 'number') setFaseActual(`Paso 3/3: prefiltrando… ${r.pendientes} rest.`);
        if (r.completado || (r.pendientes ?? 0) === 0) break;
      }

      // ── Resumen ──
      if (totalNuevas > 0) {
        toast.success(
          `${totalNuevas} licitación${totalNuevas !== 1 ? 'es' : ''} nueva${totalNuevas !== 1 ? 's' : ''}`,
          `${intake.licitacionesTotales ?? '?'} analizadas · ${intake.keywordsProcesadas ?? '?'} palabras clave · enriquecido y prefiltrado`,
        );
      } else {
        toast.info('Radar actualizado', `${intake.licitacionesTotales ?? '?'} licitaciones · sin nuevas · enriquecido y prefiltrado`);
      }
      await Promise.all([cargarKeywords(), cargarAlertas()]);
      setUltimaAct(new Date().toISOString());
    } catch (err: unknown) {
      const isTimeout = (err as Error)?.name === 'TimeoutError' || String(err).includes('timeout');
      toast.error(
        isTimeout ? 'Tiempo de espera agotado' : 'Error de conexión',
        isTimeout ? 'El servidor tardó demasiado. Intenta de nuevo.' : 'Revisa la consola (F12)',
      );
    } finally { setActualizando(false); setFaseActual(null); }
  };

  const agregarKeyword = async (e: React.FormEvent) => {
    e.preventDefault();
    const kw = nuevaKw.trim().toLowerCase();
    if (!kw) return;
    setAgregando(true);
    try {
      const res  = await fetch('/api/palabras-clave', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keyword: kw, categoria_id: nuevaNegativa ? null : (nuevaCat || null), es_negativa: nuevaNegativa }) });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Error al agregar'); return; }
      setNuevaKw('');
      toast.success(nuevaNegativa ? `"${kw}" agregada como exclusión` : `"${kw}" agregada`);
      await cargarKeywords();
    } catch { toast.error('Error de conexión'); }
    finally { setAgregando(false); }
  };

  const toggleKeyword = async (id: number, activo: boolean) => {
    try {
      await fetch('/api/palabras-clave', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, activo: !activo }) });
      setKeywords(prev => prev.map(k => k.id === id ? { ...k, activo: !activo } : k));
    } catch { toast.error('Error al actualizar'); }
  };

  const cambiarCategoria = async (id: number, categoria_id: string) => {
    const catId = categoria_id ? parseInt(categoria_id, 10) : null;
    const et = etiquetas.find(e => e.id === catId);
    try {
      await fetch('/api/palabras-clave', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, categoria_id: catId }) });
      setKeywords(prev => prev.map(k => k.id === id
        ? { ...k, categoria_id: catId, categoria_nombre: et?.nombre ?? null, categoria_color: et?.color ?? null }
        : k));
    } catch { toast.error('Error al cambiar categoría'); }
  };

  const eliminarKeyword = async (id: number) => {
    const ok = await confirmar({
      titulo: '¿Eliminar esta palabra clave?',
      mensaje: 'Se eliminarán también todas sus alertas asociadas.',
      confirmarLabel: 'Eliminar',
      peligro: true,
    });
    if (!ok) return;
    try {
      await fetch(`/api/palabras-clave?id=${id}`, { method: 'DELETE' });
      setKeywords(prev => prev.filter(k => k.id !== id));
      toast.info('Palabra clave eliminada');
    } catch { toast.error('Error al eliminar'); }
  };

  const marcarTodasLeidas = async () => {
    try {
      await fetch('/api/alertas', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true }) });
      setAlertas(prev => prev.map(a => ({ ...a, leida: true })));
      setNoLeidas(0);
      toast.success('Todas marcadas como leídas');
    } catch { toast.error('Error'); }
  };

  // useCallback: estas dos bajan a cada tarjeta memoizada (React.memo) — si cambiaran
  // de identidad en cada render, la memoización no serviría de nada.
  const marcarLeida = useCallback(async (id: number) => {
    try {
      await fetch('/api/alertas', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [id] }) });
      setAlertas(prev => prev.map(a => a.id === id ? { ...a, leida: true } : a));
      setNoLeidas(prev => Math.max(0, prev - 1));
    } catch { /* silencioso */ }
  }, []);

  const eliminarAlerta = useCallback(async (id: number) => {
    const ok = await confirmar({
      titulo: '¿Eliminar esta alerta?',
      mensaje: 'La licitación desaparecerá del radar. Esta acción no se puede deshacer.',
      confirmarLabel: 'Eliminar',
      peligro: true,
    });
    if (!ok) return;
    try {
      await fetch(`/api/alertas?id=${id}`, { method: 'DELETE' });
      setAlertas(prev => prev.filter(a => a.id !== id));
      setSel(prev => { const n = new Set(prev); n.delete(id); return n; });
    } catch { toast.error('Error al eliminar'); }
  }, [confirmar, toast]);

  // ── Selección múltiple ──────────────────────────────────────────────────────────
  const toggleSel = useCallback((id: number) => {
    setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);
  const limpiarSel = useCallback(() => setSel(new Set()), []);

  // ── Descartar / restaurar (una o varias) ─────────────────────────────────────────
  const descartarCodigos = useCallback(async (codigos: string[], descartar: boolean) => {
    if (codigos.length === 0) return;
    setAccionMasiva(true);
    try {
      const res = await fetch('/api/radar/descartar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigos, descartar }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error('Error', data.error || `HTTP ${res.status}`); return; }
      const set = new Set(codigos);
      setAlertas(prev => prev.map(a => set.has(a.licitacion_codigo) ? { ...a, descartada: descartar } : a));
      limpiarSel();
      toast.success(descartar ? `${codigos.length} descartada(s)` : `${codigos.length} restaurada(s)`);
    } catch { toast.error('Error de conexión'); }
    finally { setAccionMasiva(false); }
  }, [toast, limpiarSel]);

  const onDescartarUna = useCallback((alerta: Alerta, descartar: boolean) => {
    descartarCodigos([alerta.licitacion_codigo], descartar);
  }, [descartarCodigos]);

  // ── Asignar a un perfil del equipo ───────────────────────────────────────────────
  // Carga la lista de perfiles (una sola vez) antes de abrir el modal.
  const cargarUsuarios = useCallback(async () => {
    if (usuarios.length > 0) return;
    try {
      const d = await fetch('/api/usuarios').then(r => r.json());
      if (d.success) setUsuarios(d.usuarios || []);
    } catch { /* el modal mostrará "sin perfiles" */ }
  }, [usuarios.length]);

  // Abrir modal para la SELECCIÓN múltiple.
  const abrirAsignar = useCallback(async () => {
    if (sel.size === 0) return;
    setAsignarUna(null);
    await cargarUsuarios();
    setModalAsignar(true);
  }, [sel.size, cargarUsuarios]);

  // Abrir modal para UNA sola licitación (botón de la tarjeta).
  const abrirAsignarUna = useCallback(async (alerta: Alerta) => {
    setAsignarUna(alerta);
    await cargarUsuarios();
    setModalAsignar(true);
  }, [cargarUsuarios]);

  const cerrarAsignar = useCallback(() => { setModalAsignar(false); setAsignarUna(null); }, []);

  const confirmarAsignar = useCallback(async (usuarioId: number) => {
    // Objetivo: la tarjeta puntual si se abrió desde una tarjeta; si no, la selección.
    const objetivo = asignarUna ? [asignarUna] : alertas.filter(a => sel.has(a.id));
    if (objetivo.length === 0) { cerrarAsignar(); return; }
    setAccionMasiva(true);
    const u = usuarios.find(x => x.id === usuarioId);
    const nombre = u?.nombre || u?.email || null;
    try {
      const resultados = await Promise.allSettled(objetivo.map(a =>
        fetch('/api/negocios', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            licitacion_codigo: a.licitacion_codigo, asignado_a: usuarioId,
            licitacion_nombre: a.licitacion_nombre, licitacion_organismo: a.licitacion_organismo,
            licitacion_monto: a.licitacion_monto, licitacion_cierre: a.licitacion_cierre,
            licitacion_estado: a.licitacion_estado, licitacion_tipo: a.licitacion_tipo,
            licitacion_region: a.licitacion_region,
          }),
        }).then(r => r.ok),
      ));
      const ok = resultados.filter(r => r.status === 'fulfilled' && r.value).length;
      const codigosOk = new Set(objetivo.map(a => a.licitacion_codigo));
      // Asignar = revisar: el backend marca la alerta como leída para todos, así que aquí
      // reflejamos lo mismo al instante (tarjeta leída + contador de no leídas hacia abajo).
      const reciénLeidas = objetivo.filter(a => !a.leida).length;
      setAlertas(prev => prev.map(a => codigosOk.has(a.licitacion_codigo)
        ? { ...a, asignada: true, asignado_a: usuarioId, asignado_nombre: nombre, leida: true }
        : a));
      if (reciénLeidas > 0) setNoLeidas(n => Math.max(0, n - reciénLeidas));
      if (!asignarUna) limpiarSel();
      cerrarAsignar();
      if (ok === objetivo.length) toast.success(`${ok} asignada(s) a ${nombre || 'el perfil'}`);
      else toast.error('Asignación parcial', `${ok}/${objetivo.length} asignadas`);
    } catch { toast.error('Error de conexión'); }
    finally { setAccionMasiva(false); }
  }, [asignarUna, alertas, sel, usuarios, toast, limpiarSel, cerrarAsignar]);

  // ── Derivados por alerta (UNA vez por carga, no por render/filtro) ────────────
  // tipo / estado efectivo / días al cierre se usaban en el filtro, los conteos y el
  // orden — recalculándose decenas de veces por alerta. Aquí quedan precalculados.
  const alertasDeriv = useMemo(() => alertas.map(a => ({
    a,
    tipo: extractTipoFromCodigo(a.licitacion_codigo),
    estado: (estadoEfectivoNombre(a.licitacion_estado, a.licitacion_cierre) || '').trim(),
    dias: diasAlCierre(a.licitacion_cierre),
  })), [alertas]);

  // Conteos para el panel de filtros — UNA sola pasada del arreglo.
  const conteos = useMemo<ConteosFiltros>(() => {
    const c: ConteosFiltros = {
      estados: new Map(), tipos: new Map(), semaforos: new Map(),
      decisiones: new Map(), regiones: new Map(), matchKeywords: new Map(),
    };
    const inc = (m: Map<string, number>, k: string | null | undefined) => { if (k) m.set(k, (m.get(k) || 0) + 1); };
    for (const d of alertasDeriv) {
      inc(c.estados, d.estado.toLowerCase());
      inc(c.tipos, d.tipo);
      inc(c.semaforos, d.a.viabilidad_semaforo);
      inc(c.decisiones, d.a.prefiltro_decision);
      inc(c.regiones, d.a.licitacion_region);
      inc(c.matchKeywords, d.a.keyword_texto);
    }
    return c;
  }, [alertasDeriv]);

  // Predicado ÚNICO de filtrado: lo usan la lista y el embudo, para que el número de
  // cada KPI sea EXACTAMENTE lo que la lista mostrará al hacer clic en él.
  const pasaFiltros = useCallback((d: (typeof alertasDeriv)[number], fil: typeof filtros): boolean => {
    const { a, tipo, estado, dias } = d;
    const q = fil.texto.toLowerCase();
    if (q) {
      // Busca en nombre, organismo Y código de licitación (ej: "1499887-11-LE26").
      if (!a.licitacion_nombre?.toLowerCase().includes(q) &&
          !a.licitacion_organismo?.toLowerCase().includes(q) &&
          !a.licitacion_codigo?.toLowerCase().includes(q)) return false;
    }
    if (fil.estados.length > 0 && !fil.estados.some(f => estado.toLowerCase() === f.toLowerCase())) return false;
    if (fil.tipos.length > 0 && (!tipo || !fil.tipos.includes(tipo))) return false;
    // La API a veces no entrega fecha de publicación → usamos created_at (cuándo llegó al sistema) como proxy.
    if (!dentroRangoPublicacion(a.licitacion_fecha_publicacion || a.created_at, fil.fechaDesde, fil.fechaHasta)) return false;
    if (fil.region && a.licitacion_region !== fil.region) return false;
    if (fil.monto && !matchMonto(a.licitacion_monto, fil.monto)) return false;
    if (fil.conDocumentos && !a.tiene_documentos) return false;
    if (fil.soloNoLeidas && a.leida) return false;
    if (fil.semaforos.length > 0 && !(a.viabilidad_semaforo && fil.semaforos.includes(a.viabilidad_semaforo))) return false;
    if (fil.decisiones.length > 0 && !(a.prefiltro_decision && fil.decisiones.includes(a.prefiltro_decision))) return false;
    if (fil.ocultarExcluidas && a.prefiltro_decision === 'EXCLUIDO') return false;
    // Estado de gestión. Por defecto ('') se ocultan las descartadas.
    if (fil.gestion === '') { if (a.descartada) return false; }
    else if (fil.gestion === 'no_leidas') { if (a.descartada || a.leida) return false; }
    else if (fil.gestion === 'sin_asignar') { if (a.descartada || a.asignada) return false; }
    else if (fil.gestion === 'asignadas') { if (a.descartada || !a.asignada) return false; }
    else if (fil.gestion === 'descartadas') { if (!a.descartada) return false; }
    else if (fil.gestion === 'excluidas_pref') { if (a.prefiltro_decision !== 'EXCLUIDO') return false; }
    if (fil.keyword && a.keyword_texto !== fil.keyword) return false;
    if (fil.dias) {
      if (fil.dias === 'venc') { if (dias === null || dias > 0) return false; }
      else {
        const max = parseInt(fil.dias);
        if (dias === null || dias <= 0 || dias > max) return false;
      }
    }
    return true;
  }, []);

  // Embudo del radar (KPIs clicables). Cada KPI se cuenta con los FILTROS ACTUALES más
  // su propio filtro (el mismo que aplica su clic): así "Sin asignar: N" siempre coincide
  // con las N filas que quedan al activarlo. Antes contaba sobre todo el radar y el
  // número no cuadraba con la lista (caso real: decía 247 y la lista mostraba 9).
  const embudo = useMemo(() => {
    const contar = (patch: Partial<typeof filtros>) => {
      const f = { ...filtros, ...patch };
      let n = 0;
      for (const d of alertasDeriv) if (pasaFiltros(d, f)) n++;
      return n;
    };
    return {
      noLeidas:   contar({ gestion: 'no_leidas' }),
      pasan:      contar({ decisiones: ['PASA'] }),
      viables:    contar({ semaforos: ['VERDE', 'AMARILLO'] }),
      cierran7:   contar({ dias: '7' }),
      sinAsignar: contar({ gestion: 'sin_asignar' }),
    };
  }, [alertasDeriv, filtros, pasaFiltros]);

  // ── Filtrado + ordenamiento (sobre los derivados precalculados) ───────────────
  const alertasFiltradas = useMemo(() => {
    let list = alertasDeriv.filter(d => pasaFiltros(d, filtros)).map(d => d.a);

    list = [...list].sort((a, b) => {
      if (filtros.orden === 'publicacion-desc') {
        // Fecha publicación; si falta, cuándo llegó al radar. NUNCA el cierre como proxy:
        // el cierre es una fecha FUTURA y colaba licitaciones viejas por encima de las
        // publicadas hoy (la lista no mostraba las más recientes primero).
        const dA = a.licitacion_fecha_publicacion || a.created_at;
        const dB = b.licitacion_fecha_publicacion || b.created_at;
        return new Date(dB).getTime() - new Date(dA).getTime();
      }
      if (filtros.orden === 'cierre-asc') {
        const dA = a.licitacion_cierre ? new Date(a.licitacion_cierre).getTime() : Infinity;
        const dB = b.licitacion_cierre ? new Date(b.licitacion_cierre).getTime() : Infinity;
        return dA - dB;
      }
      if (filtros.orden === 'relevancia-desc') return (b.match_score ?? -1) - (a.match_score ?? -1);
      if (filtros.orden === 'viabilidad-desc') return (b.viabilidad_score ?? -1) - (a.viabilidad_score ?? -1);
      if (filtros.orden === 'monto-desc') return (b.licitacion_monto ?? 0) - (a.licitacion_monto ?? 0);
      if (filtros.orden === 'monto-asc')  return (a.licitacion_monto ?? 0) - (b.licitacion_monto ?? 0);
      if (filtros.orden === 'noleidas')   return (a.leida ? 1 : 0) - (b.leida ? 1 : 0);
      return 0;
    });

    return list;
  }, [alertasDeriv, filtros, pasaFiltros]);

  // Desglose de POR QUÉ la lista muestra menos que el total cargado (ej: 228 de 2.067).
  // Atribuye cada licitación oculta a UNA causa (la primera que la excluye), para que la
  // suma de causas + visibles = total y el usuario entienda de dónde sale cada número.
  const desglose = useMemo(() => {
    const d = { descartadas: 0, noVigentes: 0, otroTipo: 0, excluidasPref: 0, otrosFiltros: 0 };
    for (const x of alertasDeriv) {
      if (pasaFiltros(x, filtros)) continue;
      if (filtros.gestion === '' && x.a.descartada) d.descartadas++;
      else if (filtros.estados.length > 0 && !filtros.estados.some(f => x.estado.toLowerCase() === f.toLowerCase())) d.noVigentes++;
      else if (filtros.tipos.length > 0 && (!x.tipo || !filtros.tipos.includes(x.tipo))) d.otroTipo++;
      else if (filtros.ocultarExcluidas && x.a.prefiltro_decision === 'EXCLUIDO') d.excluidasPref++;
      else d.otrosFiltros++;
    }
    return d;
  }, [alertasDeriv, filtros, pasaFiltros]);

  const desgloseTexto = useMemo(() => {
    const partes: string[] = [];
    if (desglose.noVigentes)    partes.push(`${desglose.noVigentes.toLocaleString('es-CL')} cerradas, vencidas o desiertas (el filtro Estado parte en "Publicada" vigente)`);
    if (desglose.otroTipo)      partes.push(`${desglose.otroTipo.toLocaleString('es-CL')} de otros tipos de proceso (fuera de LE/LP/LR/LS)`);
    if (desglose.descartadas)   partes.push(`${desglose.descartadas.toLocaleString('es-CL')} descartadas del radar`);
    if (desglose.excluidasPref) partes.push(`${desglose.excluidasPref.toLocaleString('es-CL')} excluidas por el prefiltro`);
    if (desglose.otrosFiltros)  partes.push(`${desglose.otrosFiltros.toLocaleString('es-CL')} por los demás filtros activos`);
    return `El radar tiene ${alertas.length.toLocaleString('es-CL')} licitaciones detectadas por tus palabras clave, pero la vista base muestra solo lo trabajable hoy. Ocultas: ${partes.join(' · ')}. Cambia los filtros o los cortes de gestión para verlas.`;
  }, [desglose, alertas.length]);

  // Paginación de la visualización (sobre el resultado ya filtrado/ordenado).
  const totalPaginas = Math.max(1, Math.ceil(alertasFiltradas.length / POR_PAGINA));
  const paginaSegura = Math.min(pagina, totalPaginas);
  const alertasPagina = useMemo(
    () => alertasFiltradas.slice((paginaSegura - 1) * POR_PAGINA, paginaSegura * POR_PAGINA),
    [alertasFiltradas, paginaSegura],
  );
  // Al cambiar filtros (cambia el total), volver a la página 1.
  useEffect(() => { setPagina(1); }, [filtros]);

  const activeKws = keywords.filter(k => k.activo).length;
  const keywordStrings = useMemo(() => keywords.filter(k => k.activo).map(k => k.keyword), [keywords]);

  // ── Descarga de documentos de NEGOCIOS (asignadas, todos los perfiles) ─────────
  const cargarInfoDescNeg = useCallback(async () => {
    try {
      const d = await fetch('/api/documentos/descargar-pendientes?origen=negocios').then(r => r.json());
      setDescNegInfo(d);
    } catch { /* silencioso */ }
  }, []);

  useEffect(() => { cargarInfoDescNeg(); }, [cargarInfoDescNeg]);

  // Loop de descarga de negocios: corre lote a lote mientras descNegActiva = true.
  useEffect(() => {
    if (!descNegActiva) return;
    let cancelado = false;

    const run = async () => {
      while (!cancelado) {
        try {
          const res = await fetch('/api/documentos/descargar-pendientes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lote: 3, origen: 'negocios' }),
          }).then(r => r.json());

          if (cancelado) break;

          if (res.procesados?.length) {
            const exitosos = res.procesados.filter((p: any) => p.exito).length;
            const errores  = res.procesados.filter((p: any) => !p.exito).length;
            setDescNegStats(prev => ({
              procesadas: prev.procesadas + res.procesados.length,
              exitosas:   prev.exitosas  + exitosos,
              errores:    prev.errores   + errores,
            }));
            setDescNegInfo(prev => prev ? { ...prev, pendientes: res.pendientes } : prev);
            const conDocs = res.procesados.filter((p: any) => p.exito && p.nuevos > 0);
            if (!cancelado && conDocs.length) {
              const set = new Set(conDocs.map((p: any) => p.codigo));
              setAlertas(prev => prev.map(a => set.has(a.licitacion_codigo) ? { ...a, tiene_documentos: 1 } : a));
            }
          }

          if (res.completado || res.pendientes === 0) {
            if (!cancelado) { setDescNegActiva(false); cargarInfoDescNeg(); }
            break;
          }
        } catch {
          if (!cancelado) await new Promise(r => setTimeout(r, 3000));
        }
      }
    };

    run();
    return () => { cancelado = true; };
  }, [descNegActiva, cargarInfoDescNeg]); // eslint-disable-line

  const iniciarDescNeg = () => {
    setDescNegStats({ procesadas: 0, exitosas: 0, errores: 0 });
    setDescNegActiva(true);
  };
  const detenerDescNeg = () => {
    setDescNegActiva(false);
    cargarInfoDescNeg();
  };

  // ── Exportar Excel ────────────────────────────────────────────────────────────
  // Exporta la VISTA ACTUAL del radar: `alertasFiltradas` respeta todos los filtros
  // activos (tipo, estado, gestión, prefiltro, viabilidad, búsqueda…) y el orden elegido,
  // pero SIN paginar (todas las filas que calzan con los filtros, no solo la página). Así
  // el Excel refleja exactamente lo que el usuario está viendo/acotando en pantalla.
  const exportarExcel = async () => {
    if (exportando || alertasFiltradas.length === 0) return;
    setExportando(true);
    try {
      const XLSX = await import('xlsx');
      const filas = alertasFiltradas.map(a => ({
        'Código':           a.licitacion_codigo,
        'Nombre':           a.licitacion_nombre,
        'Organismo':        a.licitacion_organismo,
        'Estado':           a.licitacion_estado || '',
        'Tipo':             getTipoLicitacion(extractTipoFromCodigo(a.licitacion_codigo))?.label || extractTipoFromCodigo(a.licitacion_codigo) || '',
        'Región':           a.licitacion_region || '',
        'Monto (CLP)':      a.licitacion_monto ?? '',
        'Cierre':           a.licitacion_cierre ? new Date(a.licitacion_cierre).toLocaleString('es-CL') : '',
        'Días restantes':   diasAlCierre(a.licitacion_cierre) ?? '',
        'Prefiltro':        a.prefiltro_decision ? (PREFILTRO_CFG[a.prefiltro_decision]?.label || a.prefiltro_decision) : '',
        'Prefiltro motivo': a.prefiltro_categoria ? (CATEGORIA_LABEL[a.prefiltro_categoria] || a.prefiltro_categoria) : '',
        'Viabilidad':       a.viabilidad_semaforo ? (SEMAFORO_CFG[a.viabilidad_semaforo]?.label || a.viabilidad_semaforo) : '',
        'Score viabilidad': a.viabilidad_score ?? '',
        'Área negocio':     a.viabilidad_area || '',
        'Tiene documentos': a.tiene_documentos ? 'Sí' : 'No',
        'Descartada':       a.descartada ? 'Sí' : 'No',
        'Asignada a':       a.asignado_nombre || '',
        'Leída':            a.leida ? 'Sí' : 'No',
        'Detectada':        a.created_at ? new Date(a.created_at).toLocaleString('es-CL') : '',
        'URL':              `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(a.licitacion_codigo)}`,
      }));
      const ws = XLSX.utils.json_to_sheet(filas);
      ws['!cols'] = [
        { wch: 18 }, { wch: 50 }, { wch: 32 }, { wch: 12 }, { wch: 34 },
        { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 12 },
        { wch: 14 }, { wch: 22 },
        { wch: 14 }, { wch: 14 }, { wch: 14 },
        { wch: 16 }, { wch: 12 }, { wch: 20 }, { wch: 8 },
        { wch: 18 }, { wch: 70 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Licitaciones');
      const hoy = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `radar-licitaciones-${hoy}.xlsx`);
      toast.success(`${filas.length} licitación${filas.length !== 1 ? 'es' : ''} exportada${filas.length !== 1 ? 's' : ''}`, 'Se descargó el Excel con los filtros actuales del radar.');
    } catch (e: unknown) {
      toast.error('Error al exportar', (e as Error)?.message || 'No se pudo generar el Excel');
    } finally { setExportando(false); }
  };

  // Acceso restringido: el Radar es para admin o usuarios con permiso acceso_radar.
  if (usuario && usuario.rol !== 'admin' && !usuario.permisos?.acceso_radar) {
    return (
      <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Radar' }]}>
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4">
            <Radar size={26} className="text-slate-400" />
          </div>
          <h3 className="text-[15px] font-bold text-slate-800 mb-1.5">Acceso restringido</h3>
          <p className="text-[13px] text-slate-400 max-w-xs">
            El Radar está disponible solo para administradores. Revisa tus licitaciones asignadas en <Link href="/negocios" className="text-indigo-600 font-semibold">Negocios</Link>.
          </p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Radar' }]}>
      <div className="p-4 sm:p-6 lg:p-8 h-full">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-600/25 flex-shrink-0">
              <Radar size={18} className="text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-slate-900">Radar</h1>
                {noLeidas > 0 && (
                  <>
                    <span className="bg-indigo-600 text-white text-[11px] font-bold px-2 py-0.5 rounded-full tabular-nums"
                      title={`${noLeidas.toLocaleString('es-CL')} licitaciones sin revisar`}>{noLeidas}</span>
                    <InfoHint texto={`Ojo: aquí hay DOS números distintos que cambian con cada actualización. El ${noLeidas.toLocaleString('es-CL')} de esta burbuja son las licitaciones VIGENTES que nadie ha revisado aún: baja al abrirlas, al asignarlas a un perfil o con "Marcar todas leídas", y las que vencen dejan de contar solas. El ${alertas.length.toLocaleString('es-CL')} de la pestaña "Licitaciones" es TODO lo detectado por tus palabras clave, incluidas cerradas, descartadas y excluidas; la lista de abajo muestra solo las trabajables hoy.`} />
                  </>
                )}
              </div>
              <p className="text-[12px] text-slate-400 mt-px flex items-center gap-1.5">
                <span>{activeKws} palabra{activeKws !== 1 ? 's' : ''} activa{activeKws !== 1 ? 's' : ''}</span>
                {ultimaAct && (
                  <span className="flex items-center gap-0.5">· <Clock size={9} className="mx-0.5" /> {tiempoRelativo(ultimaAct)}</span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Panel descarga NEGOCIOS (asignadas, todos los perfiles) — prioridad, sin gate */}
            {descNegInfo && descNegInfo.pendientes > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-[12px]">
                {descNegActiva ? (
                  <>
                    <Loader2 size={13} className="animate-spin text-emerald-600 flex-shrink-0" />
                    <span className="text-emerald-700 font-medium">
                      Negocios · {descNegStats.procesadas} descargadas · {descNegInfo.pendientes} pendientes
                      {descNegStats.errores > 0 && <span className="text-red-500"> · {descNegStats.errores} errores</span>}
                    </span>
                    <button onClick={detenerDescNeg} className="ml-1 text-emerald-700 hover:text-red-600 font-semibold">Detener</button>
                  </>
                ) : (
                  <>
                    <FileText size={13} className="text-emerald-600 flex-shrink-0" />
                    <span className="text-emerald-700 font-medium">
                      <strong>{descNegInfo.pendientes}</strong> asignadas sin documentos
                    </span>
                    <button
                      onClick={iniciarDescNeg}
                      title="Descarga los documentos de TODAS las licitaciones asignadas en Negocios (todos los perfiles) que aún no los tienen. Reanudable."
                      className="ml-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[11px] transition-colors"
                    >
                      Descargar docs de Negocios
                    </button>
                  </>
                )}
              </div>
            )}

            {(usuario?.rol === 'admin' || usuario?.permisos?.exportar) && (
            <button
              onClick={exportarExcel}
              disabled={exportando || alertasFiltradas.length === 0}
              title={`Exportar a Excel las ${alertasFiltradas.length.toLocaleString('es-CL')} licitaciones de la vista actual (con los filtros aplicados)`}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-all ${
                exportando || alertasFiltradas.length === 0
                  ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm shadow-emerald-600/30 hover:-translate-y-px'
              }`}
            >
              {exportando ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              <span className="hidden sm:inline">Exportar Excel</span>
            </button>
            )}
            {/* Solo admin: dispara el intake GLOBAL (todas las keywords de todos los perfiles),
                por eso NO se gatea por las keywords personales del admin (podían ser 0 → botón gris). */}
            {usuario?.rol === 'admin' && (
            <button
              onClick={actualizarAhora}
              disabled={actualizando}
              title="Corre el ciclo completo a demanda: 1) baja licitaciones nuevas de MP y matchea tus palabras clave, 2) enriquece cada una (ítems, categoría, fechas), 3) corre el prefiltro IA. Es lo mismo que hace el automático cada 4 horas."
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-all ${
                actualizando
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm shadow-indigo-600/30 hover:-translate-y-px'
              }`}
            >
              {actualizando ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
              {actualizando ? (faseActual || 'Actualizando…') : 'Actualizar ahora'}
            </button>
            )}
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="flex gap-0 mb-0 border-b border-slate-200">
          {([
            { key: 'radar',    label: 'Licitaciones', count: alertas.length },
            { key: 'keywords', label: 'Palabras clave', count: keywords.length },
          ] as const).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              title={t.key === 'radar'
                ? `${alertas.length.toLocaleString('es-CL')} licitaciones detectadas en total por tus palabras clave (incluye cerradas, vencidas, descartadas y excluidas). La burbuja junto al título "Radar" es otro número: las nuevas sin revisar.`
                : `${keywords.length} palabras clave configuradas (positivas + de exclusión). Aquí se administran y se ve cuántas licitaciones encontró cada una.`}
              className={`relative flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold transition-colors pb-[11px] ${
                tab === t.key ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {t.label}
              {t.count > 0 && (
                <span className={`text-[11px] px-1.5 py-px rounded-full font-bold tabular-nums ${
                  t.key === 'radar' && noLeidas > 0 ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'
                }`}>{t.count}</span>
              )}
              {tab === t.key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 rounded-full" />}
            </button>
          ))}
        </div>

        {/* ──────── TAB RADAR ──────── */}
        {tab === 'radar' && (
          <div className="pt-4 space-y-4">
            {loadingAlerts ? (
              <div className="space-y-3">
                {[1,2,3,4].map(i => <CardSkeleton key={i} />)}
              </div>
            ) : alertas.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center bg-white rounded-xl border border-slate-200">
                <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4">
                  <BellOff size={26} className="text-slate-400" />
                </div>
                <h3 className="text-[15px] font-bold text-slate-800 mb-1.5">Sin resultados aún</h3>
                <p className="text-[13px] text-slate-400 max-w-xs">
                  {keywords.length === 0
                    ? 'Agrega palabras clave y el Radar buscará automáticamente cada 4 horas'
                    : 'Pulsa "Actualizar ahora" para buscar licitaciones ahora mismo'
                  }
                </p>
                {keywords.length === 0 && (
                  <button onClick={() => setTab('keywords')}
                    className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-[13px] font-semibold hover:bg-indigo-500">
                    <Plus size={14} /> Agregar palabras clave
                  </button>
                )}
              </div>
            ) : (
              <>
                {/* ── Explicador: qué hace cada pieza del radar (colapsable) ── */}
                <div className="bg-white border border-slate-200 rounded-xl">
                  <button onClick={() => setAyudaOpen(o => !o)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-left">
                    <Sparkles size={14} className="text-indigo-500 flex-shrink-0" />
                    <span className="text-[12.5px] font-semibold text-slate-600">¿Cómo funciona el radar?</span>
                    <ChevronDown size={13} className={`text-slate-400 transition-transform ml-auto ${ayudaOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {ayudaOpen && (
                    <div className="px-4 pb-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      {[
                        { n: '1', t: 'Detección', d: 'Cada 4 horas se bajan las licitaciones nuevas de Mercado Público y se cruzan con tus palabras clave (pestaña "Palabras clave"). "Actualizar ahora" corre el ciclo completo a demanda.' },
                        { n: '2', t: 'Prefiltro (Fase 0)', d: 'Una IA liviana revisa cada detección contra el perfil de negocio y decide: Pasa, Revisar o Excluida — con su motivo visible al pasar el mouse por el badge.' },
                        { n: '3', t: 'Asignación y viabilidad', d: 'Al asignar una licitación a un perfil se descargan sus documentos y corre el análisis de viabilidad IA (semáforo + score 0-100). Desde ahí se trabaja en Negocios.' },
                        { n: '4', t: 'Gestión', d: 'Descarta lo que no sirve, opera en lote con la selección múltiple y filtra con los KPIs de arriba: son clicables.' },
                      ].map(p => (
                        <div key={p.n} className="rounded-lg bg-slate-50 border border-slate-100 p-3">
                          <p className="text-[11px] font-black text-indigo-600 mb-1">{p.n} · {p.t.toUpperCase()}</p>
                          <p className="text-[11.5px] text-slate-500 leading-snug">{p.d}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* ── Contador maestro: cuántas se muestran vs. cuántas hay, con el porqué.
                     Los números se recalculan en vivo con cada actualización del radar y
                     cada cambio de filtros, así que siempre cuadran con la lista. ── */}
                <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-slate-500">
                  <span>Mostrando</span>
                  <strong className="text-slate-800 text-[14px] tabular-nums">{alertasFiltradas.length.toLocaleString('es-CL')}</strong>
                  <span>licitación{alertasFiltradas.length !== 1 ? 'es' : ''}</span>
                  {alertasFiltradas.length < alertas.length && (
                    <>
                      <span>de las</span>
                      <strong className="text-slate-700 tabular-nums">{alertas.length.toLocaleString('es-CL')}</strong>
                      <span>detectadas en el radar</span>
                      <InfoHint texto={desgloseTexto} />
                      <span className="text-slate-400 text-[11.5px]">— pasa el mouse por el "?" para ver qué se oculta y por qué</span>
                    </>
                  )}
                </div>

                {/* ── Embudo del radar: KPIs CLICABLES (aplican su filtro al tablero) ── */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  <KpiFiltro icon={<Eye size={20} />} label="No leídas" value={embudo.noLeidas} color="#7c3aed"
                    sub="sin revisar aún" hint="Ver solo las licitaciones que nadie ha abierto"
                    activo={filtros.gestion === 'no_leidas'}
                    onClick={() => setFiltro('gestion', filtros.gestion === 'no_leidas' ? '' : 'no_leidas')} />
                  <KpiFiltro icon={<CheckCheck size={20} />} label="Pasan prefiltro" value={embudo.pasan} color="#10b981"
                    sub="calzan con el perfil" hint="Ver solo las que la Fase 0 marcó como PASA"
                    activo={filtros.decisiones.length === 1 && filtros.decisiones[0] === 'PASA'}
                    onClick={() => setFiltro('decisiones', filtros.decisiones.length === 1 && filtros.decisiones[0] === 'PASA' ? [] : ['PASA'])} />
                  <KpiFiltro icon={<Sparkles size={20} />} label="Viables (IA)" value={embudo.viables} color="#0d9488"
                    sub="semáforo verde o amarillo" hint="Ver solo las analizadas con viabilidad alta o media-alta"
                    activo={filtros.semaforos.length === 2 && filtros.semaforos.includes('VERDE') && filtros.semaforos.includes('AMARILLO')}
                    onClick={() => setFiltro('semaforos', filtros.semaforos.length === 2 && filtros.semaforos.includes('VERDE') && filtros.semaforos.includes('AMARILLO') ? [] : ['VERDE', 'AMARILLO'])} />
                  <KpiFiltro icon={<Flame size={20} />} label="Cierran ≤ 7 días" value={embudo.cierran7} color="#dc2626"
                    sub="urgentes esta semana" hint="Ver solo las que cierran dentro de 7 días"
                    activo={filtros.dias === '7'}
                    onClick={() => setFiltro('dias', filtros.dias === '7' ? '' : '7')} />
                  <KpiFiltro icon={<UserPlus size={20} />} label="Sin asignar" value={embudo.sinAsignar} color="#4f46e5"
                    sub="nadie las trabaja aún" hint="Ver solo las que no están asignadas a ningún perfil"
                    activo={filtros.gestion === 'sin_asignar'}
                    onClick={() => setFiltro('gestion', filtros.gestion === 'sin_asignar' ? '' : 'sin_asignar')} />
                </div>

                {/* ── Barra de mando (pegajosa): búsqueda + orden + vista + filtros + gestión ── */}
                <div className="sticky top-0 z-30 bg-white/95 backdrop-blur rounded-xl border border-slate-200 shadow-sm p-3 space-y-2.5">
                  {/* Fila 1: buscador (con debounce) + orden + vista + panel de filtros */}
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative flex-1 min-w-[220px]">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                      <input
                        type="text"
                        value={textoInput}
                        onChange={e => setTextoInput(e.target.value)}
                        title="Busca en el título, el organismo y el código de licitación. Se aplica junto con los demás filtros."
                        placeholder="Buscar por título, organismo o código (ej: 1499887-11-LE26)…"
                        className="w-full pl-9 pr-8 py-2 border border-slate-200 rounded-lg text-[13px] focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 outline-none transition-all bg-slate-50"
                      />
                      {textoInput && (
                        <button onClick={() => setTextoInput('')} title="Limpiar búsqueda"
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                          <X size={13} />
                        </button>
                      )}
                    </div>
                    <div title="Orden de la lista. 'Relevancia' usa el puntaje del match con tus palabras clave; 'Viabilidad' el score del análisis IA.">
                      <Select value={filtros.orden} onChange={v => setFiltro('orden', v)} icon={<ArrowUpDown size={13} />}
                        options={OPCIONES_ORDEN.map(o => ({ value: o.key, label: o.label }))} minWidth={215} />
                    </div>
                    <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
                      <button onClick={() => setVistaRadar('tarjetas')} title="Tarjetas con el detalle completo"
                        className={`px-3 py-1.5 text-[11px] font-semibold rounded transition-colors ${
                          vistaRadar === 'tarjetas' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                        }`}>
                        Tarjetas
                      </button>
                      <button onClick={() => setVistaRadar('lista')} title="Lista compacta (una línea por licitación)"
                        className={`px-3 py-1.5 text-[11px] font-semibold rounded transition-colors ${
                          vistaRadar === 'lista' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                        }`}>
                        Lista
                      </button>
                    </div>
                    <button
                      onClick={() => setFiltrosOpen(v => !v)}
                      title="Abre el panel completo de filtros (estado, viabilidad, prefiltro, tipo, plazo, monto, región, palabra, fechas, documentos). El número indica cuántos filtros están activos."
                      className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[12px] font-semibold transition-colors ${
                        filtrosOpen || numFiltrosActivos > 0
                          ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                      }`}>
                      <SlidersHorizontal size={13} />
                      Filtros
                      {numFiltrosActivos > 0 && (
                        <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-indigo-600 text-white text-[10px] font-bold">
                          {numFiltrosActivos}
                        </span>
                      )}
                      <ChevronDown size={12} className={`transition-transform ${filtrosOpen ? 'rotate-180' : ''}`} />
                    </button>
                  </div>

                  {/* Fila 2: cortes de gestión + acciones de la lista */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {/* Estado base: Activas (todo lo no descartado) */}
                    <button onClick={() => setFiltro('gestion', '')}
                      title="Vista base: todo lo no descartado (con los filtros de arriba aplicados)"
                      className={`text-[12px] font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                        filtros.gestion === ''
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-700'
                      }`}>
                      Activas
                    </button>
                    <span className="w-px h-5 bg-slate-200 mx-0.5" aria-hidden="true" />
                    {([
                      { key: 'no_leidas',      label: 'No leídas',       color: 'violet' },
                      { key: 'sin_asignar',    label: 'Sin asignar',     color: 'indigo' },
                      { key: 'asignadas',      label: 'Asignadas',       color: 'emerald' },
                      { key: 'descartadas',    label: 'Descartadas',     color: 'slate'  },
                      { key: 'excluidas_pref', label: 'Excluidas (prefiltro)', color: 'amber'  },
                    ] as const).map(g => {
                      const TITULOS_GESTION: Record<string, string> = {
                        no_leidas:      'Solo las que nadie ha abierto ni asignado todavía',
                        sin_asignar:    'Solo las que no están asignadas a ningún perfil del equipo',
                        asignadas:      'Solo las que ya tienen un perfil responsable trabajándolas',
                        descartadas:    'Lo que sacaste del radar con "Descartar" (puedes restaurarlas desde aquí)',
                        excluidas_pref: 'Lo que el prefiltro IA (Fase 0) dejó fuera automáticamente por no calzar con el perfil de negocio',
                      };
                      const activo = filtros.gestion === g.key;
                      const clsActivo =
                        g.color === 'emerald' ? 'bg-emerald-600 text-white border-emerald-600' :
                        g.color === 'violet'  ? 'bg-violet-600 text-white border-violet-600' :
                        g.color === 'slate'   ? 'bg-slate-600 text-white border-slate-600' :
                        g.color === 'amber'   ? 'bg-amber-500 text-white border-amber-500' :
                        'bg-indigo-600 text-white border-indigo-600';
                      return (
                        <button key={g.key} onClick={() => setFiltro('gestion', activo ? '' : g.key)}
                          title={TITULOS_GESTION[g.key]}
                          className={`text-[12px] font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                            activo ? clsActivo : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-700'
                          }`}>
                          {g.label}
                        </button>
                      );
                    })}
                    <InfoHint texto="Cortes rápidos de gestión: 'Activas' es la vista base (todo lo no descartado). 'Descartadas' muestra lo que sacaste del radar y 'Excluidas (prefiltro)' lo que la Fase 0 dejó fuera automáticamente." />

                    <div className="ml-auto flex items-center gap-3 flex-wrap">
                      <p className="text-[12px] text-slate-500">
                        <strong className="text-slate-800 text-[13px]">{alertasFiltradas.length}</strong>
                        {' '}licitación{alertasFiltradas.length !== 1 ? 'es' : ''}
                        {alertasFiltradas.length < alertas.length && (
                          <span className="text-slate-400"> de {alertas.length}</span>
                        )}
                      </p>
                      <button onClick={() => setIncluirVencidas(v => !v)} disabled={loadingAlerts}
                        title={incluirVencidas ? 'Mostrar solo licitaciones activas' : 'Cargar también las licitaciones vencidas (histórico completo)'}
                        className="flex items-center gap-1.5 text-[12px] text-slate-400 hover:text-indigo-600 transition-colors disabled:opacity-50">
                        <History size={13} /> {incluirVencidas ? 'Solo activas' : 'Ver histórico'}
                      </button>
                      {noLeidas > 0 && (
                        <button onClick={marcarTodasLeidas}
                          title="Marca como revisadas TODAS las no leídas del radar (deja la burbuja del título en 0). No las descarta ni las asigna: solo apaga el aviso de 'nueva'."
                          className="flex items-center gap-1.5 text-[12px] text-slate-400 hover:text-indigo-600 transition-colors">
                          <CheckCheck size={13} /> Marcar todas leídas
                        </button>
                      )}
                      {alertasPagina.length > 0 && (
                        <button
                          onClick={() => {
                            const ids = alertasPagina.map(a => a.id);
                            const todasSel = ids.every(id => sel.has(id));
                            setSel(prev => {
                              const n = new Set(prev);
                              if (todasSel) ids.forEach(id => n.delete(id));
                              else ids.forEach(id => n.add(id));
                              return n;
                            });
                          }}
                          title="Selecciona todas las tarjetas de esta página para asignarlas o descartarlas en lote"
                          className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-500 hover:text-indigo-600 transition-colors">
                          {alertasPagina.every(a => sel.has(a.id))
                            ? <><CheckSquare size={14} className="text-indigo-600" /> Quitar selección</>
                            : <><Square size={14} /> Seleccionar página ({alertasPagina.length})</>}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Fila 3: chips de TODO lo que está filtrando ahora (quitar de a uno) */}
                  {numFiltrosActivos > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100">
                      <span className="text-[11px] text-slate-400">Filtrando:</span>
                      {filtros.texto && (
                        <button onClick={() => setFiltro('texto', '')}
                          className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200 hover:opacity-75">
                          <Search size={10} /> “{filtros.texto}” <X size={11} />
                        </button>
                      )}
                      {!estadosEsDefault && (
                        <button onClick={() => setFiltro('estados', ESTADOS_ACTIVOS_DEFAULT)}
                          className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border bg-slate-50 text-slate-600 border-slate-200 hover:opacity-75">
                          Estado: {filtros.estados.length ? filtros.estados.join(', ') : 'todos'} <X size={11} />
                        </button>
                      )}
                      {!tiposEsDefault && (
                        <button onClick={() => setFiltro('tipos', FILTROS_DEFAULT.tipos)}
                          className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border bg-slate-50 text-slate-600 border-slate-200 hover:opacity-75">
                          Tipo: {filtros.tipos.length ? filtros.tipos.join(', ') : 'todos'} <X size={11} />
                        </button>
                      )}
                      {filtros.semaforos.map(s => (
                        <button key={s} onClick={() => setFiltro('semaforos', filtros.semaforos.filter(x => x !== s))}
                          className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border hover:opacity-75 ${SEMAFORO_CFG[s]?.bg} ${SEMAFORO_CFG[s]?.text} ${SEMAFORO_CFG[s]?.border}`}>
                          Viabilidad: {SEMAFORO_CFG[s]?.label || s} <X size={11} />
                        </button>
                      ))}
                      {filtros.decisiones.map(dv => (
                        <button key={dv} onClick={() => setFiltro('decisiones', filtros.decisiones.filter(x => x !== dv))}
                          className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border hover:opacity-75 ${PREFILTRO_CFG[dv]?.bg} ${PREFILTRO_CFG[dv]?.text} ${PREFILTRO_CFG[dv]?.border}`}>
                          Prefiltro: {PREFILTRO_CFG[dv]?.label || dv} <X size={11} />
                        </button>
                      ))}
                      {filtros.dias && (
                        <button onClick={() => setFiltro('dias', '')}
                          className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border bg-slate-50 text-slate-600 border-slate-200 hover:opacity-75">
                          {RANGOS_DIAS.find(r => r.key === filtros.dias)?.label} <X size={11} />
                        </button>
                      )}
                      {filtros.monto && (
                        <button onClick={() => setFiltro('monto', '')}
                          className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200 hover:opacity-75">
                          {RANGOS_MONTO.find(r => r.key === filtros.monto)?.label} <X size={11} />
                        </button>
                      )}
                      {filtros.region && (
                        <button onClick={() => setFiltro('region', '')}
                          className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border bg-slate-50 text-slate-600 border-slate-200 hover:opacity-75 max-w-[220px]">
                          <MapPin size={10} /> <span className="truncate">{filtros.region}</span> <X size={11} />
                        </button>
                      )}
                      {filtros.keyword && (
                        <button onClick={() => setFiltro('keyword', '')}
                          className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border bg-slate-50 text-slate-600 border-slate-200 hover:opacity-75">
                          <Tag size={10} /> {filtros.keyword} <X size={11} />
                        </button>
                      )}
                      {(filtros.fechaDesde || filtros.fechaHasta) && (
                        <button onClick={() => { setFiltro('fechaDesde', ''); setFiltro('fechaHasta', ''); }}
                          className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border bg-indigo-50 text-indigo-700 border-indigo-200 hover:opacity-75">
                          <Calendar size={10} /> Publicación: {filtros.fechaDesde || '…'} → {filtros.fechaHasta || '…'} <X size={11} />
                        </button>
                      )}
                      {filtros.conDocumentos && (
                        <button onClick={() => setFiltro('conDocumentos', false)}
                          className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border bg-teal-50 text-teal-700 border-teal-200 hover:opacity-75">
                          <FileText size={10} /> Con documentos <X size={11} />
                        </button>
                      )}
                      {filtros.soloNoLeidas && (
                        <button onClick={() => setFiltro('soloNoLeidas', false)}
                          className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border bg-violet-50 text-violet-700 border-violet-200 hover:opacity-75">
                          Solo no leídas <X size={11} />
                        </button>
                      )}
                      {filtros.ocultarExcluidas && (
                        <button onClick={() => setFiltro('ocultarExcluidas', false)}
                          className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border bg-slate-50 text-slate-600 border-slate-200 hover:opacity-75">
                          Ocultar excluidas <X size={11} />
                        </button>
                      )}
                      <button onClick={limpiarFiltros}
                        className="text-[11px] font-semibold text-slate-400 hover:text-red-600 underline ml-1">
                        Limpiar todo
                      </button>
                    </div>
                  )}

                  {/* Fila selección múltiple (acciones en lote) */}
                  {sel.size > 0 && (
                    <div className="flex items-center justify-between gap-3 flex-wrap bg-indigo-600 text-white rounded-lg px-3.5 py-2">
                      <span className="text-[13px] font-semibold">{sel.size} seleccionada{sel.size !== 1 ? 's' : ''}</span>
                      <div className="flex items-center gap-2">
                        <button onClick={abrirAsignar} disabled={accionMasiva}
                          title="Asignar TODAS las seleccionadas a un mismo perfil del equipo (descarga docs + viabilidad IA + quedan como revisadas)"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-indigo-700 text-[12px] font-bold rounded-lg hover:bg-indigo-50 disabled:opacity-60">
                          <UserPlus size={13} /> Asignar
                        </button>
                        <button onClick={() => descartarCodigos(alertas.filter(a => sel.has(a.id)).map(a => a.licitacion_codigo), true)} disabled={accionMasiva}
                          title="Descartar TODAS las seleccionadas del radar (reversible desde el corte 'Descartadas')"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500 text-white text-[12px] font-bold rounded-lg hover:bg-indigo-400 disabled:opacity-60">
                          <EyeOff size={13} /> Descartar
                        </button>
                        <button onClick={limpiarSel}
                          title="Deseleccionar todo (no cambia nada en las licitaciones)"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-white/80 text-[12px] font-semibold rounded-lg hover:bg-white/10">
                          <X size={13} /> Limpiar
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Panel de filtros completo (mismos filtros de siempre, compactos) */}
                {filtrosOpen && (
                  <PanelFiltros
                    conteos={conteos}
                    filtros={filtros}
                    onChange={setFiltro}
                    onClear={limpiarFiltros}
                    hayFiltros={numFiltrosActivos > 0}
                  />
                )}

                {/* Lista */}
                {alertasFiltradas.length === 0 ? (
                  <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
                    <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-3">
                      <Filter size={20} className="text-slate-400" />
                    </div>
                    <p className="text-[14px] font-semibold text-slate-700 mb-1">Sin resultados con estos filtros</p>
                    <p className="text-[12px] text-slate-400 mb-3">Prueba ajustando o limpiando los filtros</p>
                    <button onClick={limpiarFiltros}
                      className="text-[12px] text-indigo-600 hover:underline font-semibold">
                      Limpiar todos los filtros
                    </button>
                  </div>
                ) : (
                  <>
                    <div className={vistaRadar === 'lista' ? 'space-y-1' : 'space-y-3'}>
                      {alertasPagina.map((a, i) => (
                        <div key={a.id} className="stagger-item" style={{ '--stagger-i': Math.min(i, 12) } as React.CSSProperties}>
                          {vistaRadar === 'lista' ? (
                            <LicitacionListItemMemo
                              alerta={a}
                              onDelete={eliminarAlerta}
                              onMarcarLeida={marcarLeida}
                              onDescartar={onDescartarUna}
                              onToggleSelect={toggleSel}
                              onAsignar={abrirAsignarUna}
                              selected={sel.has(a.id)}
                              keywords={keywordStrings}
                            />
                          ) : (
                            <LicitacionCardMemo
                              alerta={a}
                              onDelete={eliminarAlerta}
                              onMarcarLeida={marcarLeida}
                              onDescartar={onDescartarUna}
                              onToggleSelect={toggleSel}
                              onAsignar={abrirAsignarUna}
                              selected={sel.has(a.id)}
                              keywords={keywordStrings}
                            />
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Controles de paginación */}
                    {totalPaginas > 1 && (
                      <div className="flex items-center justify-between gap-3 mt-5 pt-4 border-t border-slate-100 flex-wrap">
                        <p className="text-[12px] text-slate-500">
                          Mostrando{' '}
                          <strong className="text-slate-700">{(paginaSegura - 1) * POR_PAGINA + 1}</strong>–
                          <strong className="text-slate-700">{Math.min(paginaSegura * POR_PAGINA, alertasFiltradas.length)}</strong>
                          {' '}de <strong className="text-slate-700">{alertasFiltradas.length}</strong>
                        </p>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => { setPagina(p => Math.max(1, p - 1)); document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' }); }}
                            disabled={paginaSegura <= 1}
                            className="px-3 py-1.5 text-[12px] font-semibold rounded-lg border border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                          >
                            Anterior
                          </button>
                          <span className="px-3 py-1.5 text-[12px] font-semibold text-slate-700 tabular-nums">
                            {paginaSegura} / {totalPaginas}
                          </span>
                          <button
                            onClick={() => { setPagina(p => Math.min(totalPaginas, p + 1)); document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' }); }}
                            disabled={paginaSegura >= totalPaginas}
                            className="px-3 py-1.5 text-[12px] font-semibold rounded-lg border border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                          >
                            Siguiente
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* ──────── TAB KEYWORDS ──────── */}
        {tab === 'keywords' && (
          <div className="pt-4 max-w-2xl">
            {/* Agregar palabras clave: solo admin (las keywords son compartidas entre admins). */}
            {usuario?.rol === 'admin' && (
            <form onSubmit={agregarKeyword} className="mb-5">
              <div className="flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  {nuevaNegativa
                    ? <Ban size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-rose-400 pointer-events-none" />
                    : <Tag size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />}
                  <input
                    type="text"
                    value={nuevaKw}
                    onChange={e => setNuevaKw(e.target.value)}
                    placeholder={nuevaNegativa ? 'Palabra a EXCLUIR. Ej: "usado", "fotográfica", "arriendo"' : 'Ej: "materiales de construcción", "cancha", "tractor"'}
                    className={`w-full pl-9 pr-4 py-2.5 bg-white border rounded-xl text-[13px] placeholder:text-zinc-400 outline-none ${nuevaNegativa ? 'border-rose-200 focus:ring-2 focus:ring-rose-500/20 focus:border-rose-400' : 'border-zinc-200 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400'}`}
                    maxLength={100}
                  />
                </div>
                {!nuevaNegativa && (
                  <Select value={nuevaCat} onChange={setNuevaCat} minWidth={170}
                    options={[{ value: '', label: 'Sin categoría' }, ...etiquetas.map(e => ({ value: String(e.id), label: e.nombre, color: e.color }))]} />
                )}
                <button type="submit" disabled={agregando || !nuevaKw.trim()}
                  className={`flex items-center gap-2 px-4 py-2.5 text-white rounded-xl text-[13px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed shadow-sm ${nuevaNegativa ? 'bg-rose-600 hover:bg-rose-500' : 'bg-indigo-600 hover:bg-indigo-500'}`}>
                  {agregando ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  Agregar
                </button>
              </div>
              {/* Toggle: palabra positiva vs negativa (exclusión) */}
              <button type="button" onClick={() => setNuevaNegativa(v => !v)}
                title="Palabra NEGATIVA: en vez de detectar licitaciones, las excluye del radar aunque calcen con una palabra positiva (ej: 'usado', 'arriendo')."
                className={`mt-2 inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg border transition-colors ${nuevaNegativa ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-white text-slate-500 border-slate-200 hover:border-rose-200 hover:text-rose-600'}`}>
                <MinusCircle size={13} /> {nuevaNegativa ? 'Es palabra de exclusión (negativa)' : 'Marcar como palabra de exclusión'}
              </button>
            </form>
            )}

            <div className="flex items-start gap-3 bg-indigo-50 border border-blue-200/60 rounded-xl px-4 py-3.5 mb-5">
              <Sparkles size={15} className="text-blue-500 flex-shrink-0 mt-0.5" />
              <div className="text-[12.5px] text-blue-800 leading-relaxed space-y-1">
                <p><strong className="font-semibold">¿Cómo funciona el Radar?</strong></p>
                <p>Descarga licitaciones activas desde Mercado Público y busca tus palabras clave en el <strong>título</strong> y la <strong>descripción</strong>. Se ejecuta automáticamente cada 4 horas y los resultados se acumulan.</p>
              </div>
            </div>

            {loading ? (
              <div className="space-y-2">{[1,2,3].map(i => <CardSkeleton key={i} />)}</div>
            ) : keywords.length === 0 ? (
              <div className="flex flex-col items-center py-14 text-center">
                <div className="w-14 h-14 bg-zinc-100 rounded-2xl flex items-center justify-center mb-3">
                  <Search size={22} className="text-zinc-400" />
                </div>
                <p className="text-[14px] font-semibold text-zinc-800 mb-1">Sin palabras clave</p>
                <p className="text-[13px] text-zinc-400">Escribe arriba para agregar la primera</p>
              </div>
            ) : (
              <div className="space-y-4">
                {(() => {
                  const esNeg = (k: PalabraClave) => Number(k.es_negativa) === 1 || k.es_negativa === true;
                  const positivas = keywords.filter(k => !esNeg(k));
                  const negativas = keywords.filter(esNeg);
                  // Agrupar las palabras clave POSITIVAS en cajitas por categoría (línea de negocio).
                  const grupos = etiquetas
                    .map(e => ({ id: e.id, nombre: e.nombre, color: e.color, items: positivas.filter(k => k.categoria_id === e.id) }))
                    .filter(g => g.items.length > 0);
                  const sinCat = positivas.filter(k => !k.categoria_id);
                  if (sinCat.length > 0) grupos.push({ id: 0, nombre: 'Sin categoría', color: '#94a3b8', items: sinCat });

                  return <>
                  {grupos.map(grupo => (
                    <div key={grupo.id} className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-3">
                      {/* Cabecera de la cajita */}
                      <div className="flex items-center gap-2 px-1 pb-2.5">
                        <span style={{ backgroundColor: grupo.color }} className="w-2.5 h-2.5 rounded-full flex-shrink-0" />
                        <span className="text-[12.5px] font-bold uppercase tracking-wide" style={{ color: grupo.color }}>{grupo.nombre}</span>
                        <span className="text-[11px] text-zinc-400 font-medium">{grupo.items.length}</span>
                      </div>

                      {/* Keywords de la categoría */}
                      <div className="space-y-2">
                        {grupo.items.map(kw => (
                          <div key={kw.id} className={`flex items-center gap-3 bg-white rounded-xl border px-4 py-3 transition-all ${
                            kw.activo ? 'border-zinc-200 shadow-sm hover:shadow-md hover:-translate-y-px' : 'border-zinc-200/50 opacity-50'
                          }`}>
                            <button onClick={() => toggleKeyword(kw.id, kw.activo)}
                              className="flex-shrink-0 transition-transform hover:scale-105"
                              title={kw.activo ? 'Pausar' : 'Activar'}>
                              {kw.activo
                                ? <ToggleRight size={26} className="text-indigo-600" />
                                : <ToggleLeft  size={26} className="text-zinc-300" />}
                            </button>
                            <div className="flex-1 min-w-0">
                              <p className="text-[13.5px] font-semibold text-zinc-900">{kw.keyword}</p>
                              <p className="text-[11px] text-zinc-400 mt-0.5 flex items-center gap-2">
                                <span>{kw.total_encontradas > 0 ? `${kw.total_encontradas} encontradas` : 'Sin búsquedas aún'}</span>
                                {kw.ultima_busqueda && (
                                  <span className="inline-flex items-center gap-0.5 text-zinc-300">
                                    <Clock size={9} /> {tiempoRelativo(kw.ultima_busqueda)}
                                  </span>
                                )}
                              </p>
                            </div>
                            {kw.resultados_nuevos > 0 && (
                              <span className="bg-indigo-600 text-white text-[11px] font-bold px-2 py-0.5 rounded-full flex-shrink-0">
                                {kw.resultados_nuevos} nuevas
                              </span>
                            )}
                            {/* Reasignar categoría */}
                            <div title="Línea de negocio de esta palabra clave: colorea sus alertas y permite filtrar por categoría.">
                              <Select value={String(kw.categoria_id ?? '')} onChange={v => cambiarCategoria(kw.id, v)}
                                className="max-w-[150px]" minWidth={160} align="right"
                                buttonClassName="!px-2 !py-1 !text-[11px]"
                                options={[{ value: '', label: 'Sin categoría' }, ...etiquetas.map(e => ({ value: String(e.id), label: e.nombre, color: e.color }))]} />
                            </div>
                            <button onClick={() => eliminarKeyword(kw.id)}
                              title="Eliminar esta palabra clave y TODAS sus alertas asociadas (pide confirmación)"
                              className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50">
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}

                  {/* Cajita de PALABRAS NEGATIVAS (exclusión) */}
                  {negativas.length > 0 && (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50/50 p-3">
                      <div className="flex items-center gap-2 px-1 pb-1.5">
                        <Ban size={13} className="text-rose-500 flex-shrink-0" />
                        <span className="text-[12.5px] font-bold uppercase tracking-wide text-rose-600">Palabras de exclusión</span>
                        <span className="text-[11px] text-rose-400 font-medium">{negativas.length}</span>
                      </div>
                      <p className="text-[11.5px] text-rose-700/70 px-1 pb-2.5">Si una licitación contiene alguna de estas palabras (en título, descripción, ítems o rubro), <strong>se excluye</strong> aunque calce una palabra positiva.</p>
                      <div className="space-y-2">
                        {negativas.map(kw => (
                          <div key={kw.id} className={`flex items-center gap-3 bg-white rounded-xl border px-4 py-3 transition-all ${
                            kw.activo ? 'border-rose-200 shadow-sm hover:shadow-md hover:-translate-y-px' : 'border-rose-200/40 opacity-50'
                          }`}>
                            <button onClick={() => toggleKeyword(kw.id, kw.activo)}
                              className="flex-shrink-0 transition-transform hover:scale-105"
                              title={kw.activo ? 'Pausar exclusión' : 'Activar exclusión'}>
                              {kw.activo
                                ? <ToggleRight size={26} className="text-rose-600" />
                                : <ToggleLeft  size={26} className="text-zinc-300" />}
                            </button>
                            <div className="flex-1 min-w-0">
                              <p className="text-[13.5px] font-semibold text-zinc-900 flex items-center gap-1.5">
                                <Ban size={12} className="text-rose-400 flex-shrink-0" /> {kw.keyword}
                              </p>
                              <p className="text-[11px] text-zinc-400 mt-0.5">Excluye coincidencias</p>
                            </div>
                            <button onClick={() => eliminarKeyword(kw.id)}
                              title="Eliminar esta palabra de exclusión (pide confirmación)"
                              className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50">
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  </>;
                })()}
              </div>
            )}
          </div>
        )}
      </div>

      {modalAsignar && (
        <AsignarModal
          usuarios={usuarios}
          count={asignarUna ? 1 : sel.size}
          unaNombre={asignarUna?.licitacion_nombre || null}
          loading={accionMasiva}
          onClose={cerrarAsignar}
          onConfirm={confirmarAsignar}
          usuarioActualId={usuario?.id}
        />
      )}
    </AppLayout>
  );
}
