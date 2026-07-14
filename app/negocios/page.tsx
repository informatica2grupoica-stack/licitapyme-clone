'use client';

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useConfirm } from '@/app/components/ui/confirm';
import { useToast } from '@/app/components/ui/toast';
import {
  Briefcase, Plus, Search, ExternalLink, Trash2,
  Calendar, DollarSign, Building2, AlertCircle, Loader2,
  ChevronDown, X, RefreshCw, Users, List, LayoutGrid,
  CalendarDays, ChevronLeft, ChevronRight, ArrowRight, FileText,
  SlidersHorizontal, MapPin, Clock, Check, Download, ArrowUpNarrowWide, ArrowDownWideNarrow, Trophy,
} from 'lucide-react';
import dayjs from 'dayjs';
import { getEstadoPipeline, ESTADOS_PIPELINE } from '@/app/lib/pipeline';
import { estadoEfectivoNombre } from '@/app/lib/estado-mp';
import { extractTipoFromCodigo, getTipoLicitacion, TIPO_COLOR_CLASS, TIPOS_LICITACION } from '@/app/lib/tipos-licitacion';
import { colorUsuario, inicialesUsuario } from '@/app/lib/user-color';
import { semaforoRevision } from '@/app/lib/asignacion';

interface Etiqueta { id: number; nombre: string; color: string; }


interface Negocio {
  id: number;
  licitacion_codigo: string;
  licitacion_nombre: string;
  licitacion_organismo: string;
  licitacion_monto: number | null;
  licitacion_cierre: string | null;
  licitacion_estado: string | null;
  licitacion_tipo: string | null;
  licitacion_region: string | null;
  estado_pipeline: string | null;
  monto_ofertado: number;
  usuario_nombre: string;
  usuario_email: string;
  etiquetas: Etiqueta[];
  comentarios_count: number;
  created_at: string;
  updated_at: string;
  tiene_documentos?: number;
  viabilidad_semaforo?: string | null;
  viabilidad_score?: number | null;
}

interface Usuario { id: number; nombre: string; email: string; }
interface Carga { usuario_id: number; nombre?: string; email?: string; total: number; descartadas?: number; vencidas?: number; resueltas?: number; porEstado?: Record<string, number>; }

// Estados del pipeline que "cierran el ciclo": ya no cuentan como carga vigente ni salen
// en el calendario/semana (son historia, no trabajo pendiente).
const RESUELTOS_NEGOCIO = new Set(['POSTULADA', 'DESCARTADA', 'ADJUDICADA', 'POSIBLE_ADJ', 'PERDIDA']);

// Semáforo de viabilidad (colores/labels compactos para las tarjetas).
const SEMAFORO: Record<string, { label: string; color: string; bg: string; text: string }> = {
  VERDE:     { label: 'Viable',     color: '#10b981', bg: 'bg-emerald-50', text: 'text-emerald-700' },
  AMARILLO:  { label: 'Media-alta', color: '#eab308', bg: 'bg-yellow-50',  text: 'text-yellow-700' },
  NARANJA:   { label: 'Media',      color: '#f97316', bg: 'bg-orange-50',  text: 'text-orange-700' },
  ROJO:      { label: 'Baja',       color: '#ef4444', bg: 'bg-red-50',     text: 'text-red-700' },
  ROJO_DURO: { label: 'Descartar',  color: '#b91c1c', bg: 'bg-red-100',    text: 'text-red-800' },
};

// Todos los tipos ordenados por uso típico (públicos primero)
const TIPOS_FILTRO = TIPOS_LICITACION.map(t => t.codigo);

function PipelineBadge({ estadoId }: { estadoId: string | null }) {
  const e = getEstadoPipeline(estadoId || 'ASIGNADO');
  if (!e) return null;
  return (
    <span
      style={{ backgroundColor: e.color + '18', color: e.color, borderColor: e.color + '40' }}
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-bold border"
    >
      <span style={{ backgroundColor: e.color }} className="w-1 h-1 rounded-full flex-shrink-0" />
      {e.label}
    </span>
  );
}

// Estilo por estado MP terminal (mismos colores que el detalle del negocio) + Ganada.
const ESTADO_MP_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  Cerrada:    { bg: '#f1f5f9', color: '#475569', border: '#e2e8f0' },
  Desierta:   { bg: '#ffedd5', color: '#c2410c', border: '#fed7aa' },
  Adjudicada: { bg: '#e0e7ff', color: '#4338ca', border: '#c7d2fe' },
  Revocada:   { bg: '#fee2e2', color: '#b91c1c', border: '#fecaca' },
  Suspendida: { bg: '#fef9c3', color: '#a16207', border: '#fde68a' },
  Ganada:     { bg: '#dcfce7', color: '#15803d', border: '#bbf7d0' },
};
// Badge del estado REAL en Mercado Público. Solo se muestra cuando es TERMINAL (Cerrada/Desierta/
// Adjudicada/Revocada/Suspendida) — así el dueño ve de un vistazo las que MP ya resolvió; las
// activas (Publicada) no lo muestran para no ensuciar la tarjeta. El estado se refresca desde la
// API (refrescar-estados.ts) y aquí solo se lee la columna vía el helper efectivo.
//
// Caso GANADA (en Negocios): si MP marca "Adjudicada" y la licitación es NUESTRA —la postulamos
// (POSTULADA) o ya está adjudicada a nosotros (ADJUDICADA)— se muestra "Ganada" en verde. La
// verificación fina por RUT (ganamos vs. terceros) vive en Postuladas; aquí basta con que sea
// nuestra postulada adjudicada. Una Adjudicada que NO es nuestra postulada se muestra "Adjudicada".
function EstadoMpBadge({ estado, cierre, pipeline }: { estado: string | null; cierre?: string | null; pipeline?: string | null }) {
  const nombre = estadoEfectivoNombre(estado, cierre);
  if (!nombre || nombre === 'Publicada') return null;
  const esNuestra = pipeline === 'POSTULADA' || pipeline === 'ADJUDICADA';
  const label = (nombre === 'Adjudicada' && esNuestra) ? 'Ganada' : nombre;
  const st = ESTADO_MP_STYLE[label] || { bg: '#f1f5f9', color: '#475569', border: '#e2e8f0' };
  return (
    <span
      style={{ backgroundColor: st.bg, color: st.color, borderColor: st.border }}
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-bold border"
    >
      {label === 'Ganada' && <Trophy size={10} />}
      {label}
    </span>
  );
}

function formatMonto(n: number | null): string {
  if (!n) return '$0';
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
}

function diasRestantes(fecha: string | null): string {
  if (!fecha) return '';
  const diff = Math.ceil((new Date(fecha).getTime() - Date.now()) / 86400000);
  if (diff < 0) return 'Vencida';
  if (diff === 0) return 'Hoy';
  return `${diff}d`;
}

// ── Modal para asignar nueva licitación ──────────────────────────────────────
function ModalAsignar({
  open, onClose, onSuccess, usuarios, etiquetas,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  usuarios: Usuario[];
  etiquetas: Etiqueta[];
}) {
  const [form, setForm] = useState({
    codigo: '', asignado_a: '', etiqueta_ids: [] as number[],
  });
  const [buscando, setBuscando] = useState(false);
  const [licitacion, setLicitacion] = useState<any>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const buscarLicitacion = async () => {
    if (!form.codigo.trim()) return;
    setBuscando(true);
    setError('');
    setLicitacion(null);
    try {
      const res = await fetch(`/api/licitacion-completa/${encodeURIComponent(form.codigo.trim())}`);
      const data = await res.json();
      if (!res.ok || !data.licitacion) throw new Error(data.error || 'No encontrada');
      setLicitacion(data.licitacion);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBuscando(false);
    }
  };

  const guardar = async () => {
    if (!form.codigo || !form.asignado_a) {
      setError('Código y usuario son requeridos'); return;
    }
    setGuardando(true);
    try {
      const res = await fetch('/api/negocios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licitacion_codigo: form.codigo.trim(),
          asignado_a: parseInt(form.asignado_a),
          etiqueta_ids: form.etiqueta_ids,
          licitacion_nombre: licitacion?.nombre,
          licitacion_organismo: licitacion?.organismo,
          licitacion_monto: licitacion?.monto_estimado || licitacion?.monto_total,
          licitacion_cierre: licitacion?.fecha_cierre,
          licitacion_estado: licitacion?.estado,
          licitacion_tipo: licitacion?.tipo_licitacion,
          licitacion_region: licitacion?.region,
          licitacion_descripcion: licitacion?.descripcion,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onSuccess();
      onClose();
      setForm({ codigo: '', asignado_a: '', etiqueta_ids: [] });
      setLicitacion(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Plus size={20} className="text-indigo-600" /> Asignar licitación
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-gray-400">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-3 py-2.5 rounded-lg text-sm">
              <AlertCircle size={15} /> {error}
            </div>
          )}

          {/* Buscar código */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Código de licitación</label>
            <div className="flex gap-2">
              <input
                value={form.codigo}
                onChange={e => setForm(p => ({ ...p, codigo: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && buscarLicitacion()}
                placeholder="ej: 1234-56-LE26"
                className="flex-1 px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
              />
              <button
                onClick={buscarLicitacion}
                disabled={buscando}
                className="px-4 py-2.5 bg-slate-100 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {buscando ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
              </button>
            </div>
          </div>

          {/* Preview licitación */}
          {licitacion && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm">
              <p className="font-semibold text-gray-900 line-clamp-2">{licitacion.nombre}</p>
              <p className="text-gray-500 mt-0.5">{licitacion.organismo}</p>
              <p className="text-indigo-600 font-medium mt-1">
                {formatMonto(licitacion.monto_estimado || licitacion.monto_total)}
              </p>
            </div>
          )}

          {/* Asignar a */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Asignar a usuario</label>
            <select
              value={form.asignado_a}
              onChange={e => setForm(p => ({ ...p, asignado_a: e.target.value }))}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <option value="">Seleccionar usuario...</option>
              {usuarios.map(u => (
                <option key={u.id} value={u.id}>{u.nombre || u.email}</option>
              ))}
            </select>
          </div>

          {/* Etiquetas */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Líneas de negocio</label>
            <div className="flex flex-wrap gap-2">
              {etiquetas.map(et => {
                const sel = form.etiqueta_ids.includes(et.id);
                return (
                  <button
                    key={et.id}
                    onClick={() => setForm(p => ({
                      ...p,
                      etiqueta_ids: sel
                        ? p.etiqueta_ids.filter(x => x !== et.id)
                        : [...p.etiqueta_ids, et.id],
                    }))}
                    style={sel ? { backgroundColor: et.color, borderColor: et.color } : {}}
                    className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                      sel ? 'text-white' : 'bg-white border-slate-200 text-gray-600 hover:border-gray-400'
                    }`}
                  >
                    {et.nombre}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="px-6 pb-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-slate-100 rounded-lg transition-colors">
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando || !form.codigo || !form.asignado_a}
            className="flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:bg-gray-300 transition-colors"
          >
            {guardando ? <Loader2 size={14} className="animate-spin" /> : null}
            Asignar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Tarjeta compacta de negocio (vista agrupada por categoría) ────────────────
function NegocioCard({ neg, isAdmin, onEliminar }: {
  neg: Negocio; isAdmin: boolean; onEliminar: (id: number) => void;
}) {
  const tipo  = extractTipoFromCodigo(neg.licitacion_codigo || '');
  const tipoBg = TIPO_COLOR_CLASS[tipo] || 'bg-gray-400';
  const dias = diasRestantes(neg.licitacion_cierre);
  const diasCls = dias === 'Vencida' ? 'text-gray-400'
    : dias.replace('d', '') !== '' && parseInt(dias) <= 3 ? 'text-red-500 font-semibold'
    : parseInt(dias) <= 7 ? 'text-orange-500' : 'text-gray-500';
  const col = colorUsuario(neg.usuario_email || neg.usuario_nombre);
  const sem = (neg.estado_pipeline || '') !== 'DESCARTADA' ? semaforoRevision(neg.updated_at) : null;
  return (
    <Link
      href={`/negocios/${neg.id}`}
      style={{ borderLeftColor: col, borderLeftWidth: 3 }}
      className="block bg-white rounded-xl border border-slate-200 p-3 hover:border-indigo-300 hover:shadow-sm transition-all group"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-mono text-gray-500 font-semibold">{neg.licitacion_codigo}</p>
        <div className="flex items-center gap-1" onClick={e => e.preventDefault()}>
          {tipo && <span className={`${tipoBg} text-white text-[10px] px-1.5 py-0.5 rounded font-bold`}>{tipo}</span>}
          {isAdmin && (
            <button onClick={e => { e.preventDefault(); onEliminar(neg.id); }}
              className="p-1 hover:bg-red-50 rounded text-gray-300 hover:text-red-500 transition-colors">
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>
      <p className="text-[13px] text-gray-800 font-medium line-clamp-2 mt-1 group-hover:text-indigo-600 transition-colors">
        {neg.licitacion_nombre || 'Sin nombre'}
      </p>
      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
        <PipelineBadge estadoId={neg.estado_pipeline} />
        <EstadoMpBadge estado={neg.licitacion_estado} cierre={neg.licitacion_cierre} />
        {neg.viabilidad_semaforo && SEMAFORO[neg.viabilidad_semaforo] && (
          <span
            style={{ borderColor: SEMAFORO[neg.viabilidad_semaforo].color + '40' }}
            className={`inline-flex items-center gap-1 text-[9.5px] font-bold px-1.5 py-0.5 rounded-full border ${SEMAFORO[neg.viabilidad_semaforo].bg} ${SEMAFORO[neg.viabilidad_semaforo].text}`}
            title={`Viabilidad: ${SEMAFORO[neg.viabilidad_semaforo].label}`}
          >
            <span style={{ background: SEMAFORO[neg.viabilidad_semaforo].color }} className="w-1.5 h-1.5 rounded-full" />
            {SEMAFORO[neg.viabilidad_semaforo].label}{neg.viabilidad_score != null ? ` ${neg.viabilidad_score}` : ''}
          </span>
        )}
        {neg.tiene_documentos ? (
          <span className="inline-flex items-center gap-1 text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-100" title="Tiene documentos descargados">
            <FileText size={9} /> Docs
          </span>
        ) : null}
        {isAdmin && (
          <span className="inline-flex items-center gap-1 text-[10px] text-gray-500 font-medium">
            <span style={{ background: col }} className="inline-flex items-center justify-center w-4 h-4 rounded-full text-white text-[8px] font-bold">
              {inicialesUsuario(neg.usuario_nombre, neg.usuario_email)}
            </span>
            {neg.usuario_nombre || neg.usuario_email}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-50 gap-2">
        <span className="text-[12px] text-gray-700 font-medium truncate">{formatMonto(neg.licitacion_monto)}</span>
        {dias && <span className={`text-[11px] flex-shrink-0 ${diasCls}`}>{dias}</span>}
      </div>
      {sem && (
        <div className="flex items-center justify-between gap-2 mt-1.5 text-[10px]">
          {neg.created_at && (
            <span className="text-slate-400 inline-flex items-center gap-1" title={`Asignada el ${dayjs(neg.created_at).format('DD/MM/YYYY HH:mm')}`}>
              <Clock size={10} /> Asignada {dayjs(neg.created_at).format('DD/MM/YY')}
            </span>
          )}
          <span className={`ml-auto inline-flex items-center gap-1 font-bold px-1.5 py-0.5 rounded-full ${sem.bg} ${sem.text}`}
            title={`${sem.dias} día${sem.dias === 1 ? '' : 's'} sin cambio de estado`}>
            <span style={{ background: sem.color }} className="w-1.5 h-1.5 rounded-full" />
            {sem.etiqueta} sin cambios
          </span>
        </div>
      )}
    </Link>
  );
}

// ── Fila de lista (vista "lista") — mismo layout limpio y alineado que el Radar,
// pero con los datos del negocio (perfil, pipeline, semáforo de frescura). Segmentos
// de ancho fijo → todo queda en columnas alineadas (a diferencia de la tabla anterior).
function NegocioListItem({ neg, isAdmin, onEliminar }: {
  neg: Negocio; isAdmin: boolean; onEliminar: (id: number) => void;
}) {
  const tipo   = extractTipoFromCodigo(neg.licitacion_codigo || '');
  const tipoBg = TIPO_COLOR_CLASS[tipo] || 'bg-gray-400';
  const col    = colorUsuario(neg.usuario_email || neg.usuario_nombre);
  const descartada = (neg.estado_pipeline || '') === 'DESCARTADA';
  const dias   = diasRestantes(neg.licitacion_cierre);
  const diasCls = dias === 'Vencida' ? 'text-slate-400'
    : (parseInt(dias) <= 3 ? 'text-red-600 font-semibold' : parseInt(dias) <= 7 ? 'text-orange-500' : 'text-slate-400');
  const viab   = neg.viabilidad_semaforo ? SEMAFORO[neg.viabilidad_semaforo] : null;
  const sem    = !descartada ? semaforoRevision(neg.updated_at) : null;
  const iniciales = inicialesUsuario(neg.usuario_nombre, neg.usuario_email);

  return (
    <Link
      href={`/negocios/${neg.id}`}
      style={{ borderLeftColor: descartada ? '#DC2626' : col, borderLeftWidth: 3 }}
      className={`group relative flex items-center gap-3 rounded-lg pl-3.5 pr-3 py-2.5 border transition-all ${
        descartada ? 'bg-red-50/40 border-red-200 hover:bg-red-50' : 'bg-white border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30'
      }`}
    >
      {/* Tipo + código (+ perfil para admin) */}
      <div className="flex-shrink-0 w-36">
        <div className="flex items-center gap-1 mb-1">
          {tipo && <span className={`${tipoBg} text-white text-[9px] font-black px-1.5 py-0.5 rounded`}>{tipo}</span>}
          <span className="text-[10px] font-mono text-slate-500 truncate" title={neg.licitacion_codigo}>{neg.licitacion_codigo}</span>
        </div>
        {isAdmin && (
          <span className="inline-flex items-center gap-1 text-[10px] text-slate-400 max-w-full truncate" title={neg.usuario_nombre || neg.usuario_email}>
            <span style={{ background: col }} className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-white text-[7px] font-bold flex-shrink-0">{iniciales}</span>
            <span className="truncate">{neg.usuario_nombre || neg.usuario_email}</span>
          </span>
        )}
      </div>

      {/* Nombre + organismo + pipeline/etiquetas */}
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-semibold text-slate-900 truncate group-hover:text-indigo-600 transition-colors" title={neg.licitacion_nombre}>
          {neg.licitacion_nombre || neg.licitacion_codigo}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <PipelineBadge estadoId={neg.estado_pipeline} />
          <EstadoMpBadge estado={neg.licitacion_estado} cierre={neg.licitacion_cierre} pipeline={neg.estado_pipeline} />
          {neg.licitacion_organismo && (
            <span className="text-[10.5px] text-slate-500 truncate max-w-[240px]" title={neg.licitacion_organismo}>{neg.licitacion_organismo}</span>
          )}
          {neg.etiquetas.slice(0, 2).map(et => (
            <span key={et.id} style={{ backgroundColor: et.color + '20', color: et.color, borderColor: et.color + '40' }}
              className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold border flex-shrink-0">{et.nombre}</span>
          ))}
        </div>
      </div>

      {/* Monto + cierre (fecha + hora Chile) */}
      <div className="flex-shrink-0 w-32 text-right hidden sm:block">
        <p className="text-[11.5px] font-bold text-emerald-700">{formatMonto(neg.licitacion_monto)}</p>
        {neg.monto_ofertado > 0 && <p className="text-[9.5px] text-slate-400">Ofertó {formatMonto(neg.monto_ofertado)}</p>}
        {neg.licitacion_cierre && (
          <p className="text-[10px] text-slate-500 mt-0.5">
            {new Date(neg.licitacion_cierre).toLocaleDateString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit' })}
            {' · '}
            {new Date(neg.licitacion_cierre).toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit' })}
            {' '}<span className={diasCls}>({dias})</span>
          </p>
        )}
      </div>

      {/* Badges: viabilidad + docs + semáforo de frescura */}
      <div className="flex-shrink-0 hidden lg:flex items-center justify-end gap-1.5 w-44">
        {viab && (
          <span style={{ backgroundColor: viab.color + '18', color: viab.color, borderColor: viab.color + '40' }}
            className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full border flex-shrink-0" title={`Viabilidad: ${viab.label}`}>
            <span style={{ background: viab.color }} className="w-1.5 h-1.5 rounded-full" />
            {viab.label}{neg.viabilidad_score != null ? ` ${neg.viabilidad_score}` : ''}
          </span>
        )}
        {neg.tiene_documentos ? (
          <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-teal-700 bg-teal-50 border border-teal-100 px-1.5 py-0.5 rounded-full flex-shrink-0">
            <FileText size={9} /> Docs
          </span>
        ) : null}
        {sem && (
          <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${sem.bg} ${sem.text}`}
            title={`${sem.dias} día${sem.dias === 1 ? '' : 's'} sin cambio de estado`}>
            <span style={{ background: sem.color }} className="w-1.5 h-1.5 rounded-full" />
            {sem.etiqueta}
          </span>
        )}
      </div>

      {/* Acciones */}
      <div className="flex-shrink-0 flex items-center gap-1" onClick={e => e.preventDefault()}>
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 group-hover:text-indigo-700">
          Ver <ArrowRight size={12} />
        </span>
        {isAdmin && (
          <button onClick={e => { e.preventDefault(); onEliminar(neg.id); }}
            className="p-1.5 rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
            title="Quitar de Negocios">
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </Link>
  );
}

// ── Vista calendario (por fecha de cierre) ───────────────────────────────────────
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function VistaCalendario({ negocios, onAbrirDia }: { negocios: Negocio[]; onAbrirDia: (key: string) => void }) {
  const [mes, setMes] = useState(() => dayjs().startOf('month'));

  const porDia = useMemo(() => {
    const m = new Map<string, Negocio[]>();
    for (const n of negocios) {
      if (!n.licitacion_cierre) continue;
      const k = dayjs(n.licitacion_cierre).format('YYYY-MM-DD');
      (m.get(k) || m.set(k, []).get(k)!).push(n);
    }
    return m;
  }, [negocios]);

  const inicio = mes.startOf('month');
  const offset = (inicio.day() + 6) % 7; // lunes = 0
  const gridStart = inicio.subtract(offset, 'day');
  const dias = Array.from({ length: 42 }, (_, i) => gridStart.add(i, 'day'));
  const hoy = dayjs().format('YYYY-MM-DD');

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => setMes(m => m.subtract(1, 'month'))} aria-label="Mes anterior" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"><ChevronLeft size={18} /></button>
        <span className="text-lg font-bold text-slate-800">{MESES[mes.month()]} {mes.year()}</span>
        <button onClick={() => setMes(m => m.add(1, 'month'))} aria-label="Mes siguiente" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"><ChevronRight size={18} /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {SEMANA.map(d => <div key={d} className="text-center text-[11px] font-bold text-slate-400 py-1">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {dias.map(d => {
          const k = d.format('YYYY-MM-DD');
          const items = porDia.get(k) || [];
          const fueraMes = d.month() !== mes.month();
          const esHoy = k === hoy;
          return (
            <button key={k} disabled={items.length === 0} onClick={() => items.length && onAbrirDia(k)}
              className={`min-h-[70px] rounded-lg border p-1.5 text-left align-top transition-colors ${fueraMes ? 'bg-slate-50/40 border-transparent' : 'border-slate-100'} ${items.length ? 'hover:border-indigo-300 hover:bg-indigo-50/50 cursor-pointer' : 'cursor-default'}`}>
              <div className="flex items-center justify-between">
                <span className={esHoy ? 'bg-indigo-600 text-white rounded-full w-5 h-5 inline-flex items-center justify-center text-[11px] font-bold' : `text-[12px] ${fueraMes ? 'text-slate-300' : 'text-slate-600'}`}>{d.date()}</span>
                {items.length > 0 && <span className="text-[10px] font-bold text-indigo-600 tabular-nums">{items.length}</span>}
              </div>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {items.slice(0, 6).map((n, i) => (
                  <span key={i}
                    title={`${n.usuario_nombre || n.usuario_email}${n.estado_pipeline === 'DESCARTADA' ? ' · Descartada' : n.estado_pipeline === 'POSTULADA' ? ' · Postulada' : ''}`}
                    style={{ background: n.estado_pipeline === 'DESCARTADA' ? '#DC2626' : n.estado_pipeline === 'POSTULADA' ? '#059669' : colorUsuario(n.usuario_email || n.usuario_nombre) }}
                    className="w-2 h-2 rounded-full" />
                ))}
                {items.length > 6 && <span className="text-[8px] text-slate-400 leading-none self-center">+{items.length - 6}</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Tarjeta de carga de trabajo por perfil (con mini-gráfico por tipo) ────────────
function CargaCard({ c, nombre, email, activo, isAdmin, onClick }: {
  c: Carga; nombre: string | null; email: string | null; activo: boolean; isAdmin: boolean; onClick: () => void;
}) {
  const col = colorUsuario(email || c.usuario_id);
  // Desglose por ESTADO del pipeline (Asignado, En proceso, ...) sobre las VIGENTES.
  const estados = Object.entries(c.porEstado || {})
    .map(([id, n]) => ({ id, n, cfg: getEstadoPipeline(id) }))
    .sort((a, b) => b.n - a.n);
  const colorEstado = (id: string) => getEstadoPipeline(id)?.color || '#94a3b8';
  return (
    <div
      onClick={isAdmin ? onClick : undefined}
      style={{ borderColor: activo ? col : undefined, borderWidth: activo ? 2 : 1, cursor: isAdmin ? 'pointer' : 'default' }}
      className={`bg-white rounded-lg border border-slate-200 p-3 ${isAdmin ? 'transition-shadow hover:shadow-sm' : ''}`}
    >
      <div className={`flex items-center justify-between gap-2 ${estados.length ? 'mb-2' : ''}`}>
        <div className="flex items-center gap-2 min-w-0">
          <span style={{ background: col }} className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-white text-[11px] font-bold flex-shrink-0">
            {inicialesUsuario(nombre, email)}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{nombre || email || 'Tú'}</p>
            <p className="text-xs text-slate-400">
              vigentes
              {(c.vencidas ?? 0) > 0 && (
                <span> · <span className="text-amber-500">{c.vencidas} vencida{c.vencidas !== 1 ? 's' : ''}</span></span>
              )}
              {(c.descartadas ?? 0) > 0 && (
                <span> · <span className="text-rose-400">{c.descartadas} descartada{c.descartadas !== 1 ? 's' : ''}</span></span>
              )}
            </p>
          </div>
        </div>
        <span style={{ color: col }} className="text-2xl font-black tabular-nums flex-shrink-0 leading-none">{c.total}</span>
      </div>
      {estados.length > 0 && (
        <>
          <div className="flex h-2 rounded overflow-hidden">
            {estados.map(({ id, n }) => (
              <div key={id} style={{ width: `${(n / c.total) * 100}%`, background: colorEstado(id) }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-2 mt-1.5">
            {estados.slice(0, 6).map(({ id, n, cfg }) => (
              <span key={id} className="inline-flex items-center gap-1 text-[10.5px] text-gray-600">
                <span style={{ background: colorEstado(id) }} className="w-2 h-2 rounded-sm flex-shrink-0" />
                <strong>{cfg?.label || id}</strong> {n}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Clave de sessionStorage: persiste los filtros para que al volver de un negocio
// (o de una licitación) el panel conserve búsqueda, vista y filtros aplicados.
// v2: los filtros de estado/tipo/líneas pasaron de un valor a MÚLTIPLES (arrays).
const SS_NEG_FILTROS = 'negocios:filtros:v2';

// Filtro de SELECCIÓN MÚLTIPLE (dropdown con checkboxes). Reemplaza al <select> de un solo valor:
// permite marcar varios estados/tipos/líneas a la vez. Cierra al hacer clic fuera.
function MultiSelect({ label, options, selected, onChange }: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const cerrar = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', cerrar);
    return () => document.removeEventListener('mousedown', cerrar);
  }, [open]);
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);
  const n = selected.length;
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 px-3 py-2 border rounded-lg text-sm outline-none transition-colors ${n ? 'border-indigo-300 bg-indigo-50 text-indigo-700 font-semibold' : 'border-slate-200 text-slate-600 hover:border-slate-400'}`}>
        {label}
        {n > 0 && <span className="text-[11px] font-bold bg-indigo-600 text-white rounded-full px-1.5 leading-5">{n}</span>}
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 min-w-[210px] max-h-72 overflow-auto bg-white border border-slate-200 rounded-lg shadow-lg p-1">
          {options.length === 0 ? (
            <p className="text-xs text-slate-400 px-2 py-1.5">Sin opciones</p>
          ) : options.map(o => {
            const on = selected.includes(o.value);
            return (
              <button key={o.value} type="button" onClick={() => toggle(o.value)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50 text-sm text-left">
                <span className={`w-4 h-4 flex-shrink-0 rounded border flex items-center justify-center ${on ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300'}`}>
                  {on && <Check size={11} className="text-white" />}
                </span>
                <span className="text-slate-700">{o.label}</span>
              </button>
            );
          })}
          {n > 0 && (
            <button type="button" onClick={() => onChange([])}
              className="w-full text-left text-[11px] text-red-500 hover:bg-red-50 rounded-md px-2 py-1.5 mt-0.5">
              Limpiar selección
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Mini tarjeta para el calendario semanal ──────────────────────────────────
function NegocioMiniCard({ neg, onClick }: { neg: Negocio; onClick: () => void }) {
  const tipo   = extractTipoFromCodigo(neg.licitacion_codigo || '');
  const tipoBg = TIPO_COLOR_CLASS[tipo] || 'bg-gray-400';
  const col    = colorUsuario(neg.usuario_email || neg.usuario_nombre);
  const dias   = neg.licitacion_cierre
    ? Math.ceil((new Date(neg.licitacion_cierre).getTime() - Date.now()) / 86400000)
    : null;
  const pipeline = getEstadoPipeline(neg.estado_pipeline || 'ASIGNADO');
  const descartada = (neg.estado_pipeline || '') === 'DESCARTADA';
  const postulada = (neg.estado_pipeline || '') === 'POSTULADA';
  const viab     = neg.viabilidad_semaforo ? SEMAFORO[neg.viabilidad_semaforo] : null;
  const iniciales = inicialesUsuario(neg.usuario_nombre, neg.usuario_email);
  const nombrePerfil = neg.usuario_nombre || neg.usuario_email || '';
  // Semáforo de frescura: días sin cambio de estado (no aplica a descartadas).
  const sem = !descartada ? semaforoRevision(neg.updated_at) : null;

  return (
    <button
      onClick={onClick}
      style={{ borderLeftColor: descartada ? '#DC2626' : col, borderLeftWidth: 3 }}
      className={`w-full text-left border rounded-lg p-2.5 hover:shadow-sm transition-all group ${
        descartada ? 'bg-red-50 border-red-300 hover:border-red-400' : 'bg-white border-slate-200 hover:border-indigo-300'
      }`}
    >
      {/* Tipo + código + días */}
      <div className="flex items-center gap-1.5 mb-1.5">
        {tipo && <span className={`${tipoBg} text-white text-[9px] font-black px-1.5 py-0.5 rounded flex-shrink-0`}>{tipo}</span>}
        <span className="text-[10px] font-mono text-slate-400 truncate" title={neg.licitacion_codigo}>{neg.licitacion_codigo}</span>
        {postulada ? (
          <span className="ml-auto text-[9px] font-bold flex-shrink-0 text-emerald-600">Postulada</span>
        ) : dias !== null && (
          <span className={`ml-auto text-[9px] font-bold flex-shrink-0 ${dias <= 0 ? 'text-slate-400' : dias <= 1 ? 'text-red-600' : dias <= 3 ? 'text-orange-500' : 'text-slate-400'}`}>
            {dias <= 0 ? 'Vencida' : `${dias}d`}
          </span>
        )}
      </div>

      {/* Estado REAL en Mercado Público (refrescado desde la API). Solo si es terminal:
          Cerrada/Desierta/Adjudicada/Revocada/Suspendida, o "Ganada" si es nuestra postulada
          adjudicada. Así en la semana se ve de un vistazo cuáles ya resolvió MP. */}
      <div className="mb-1.5 empty:hidden">
        <EstadoMpBadge estado={neg.licitacion_estado} cierre={neg.licitacion_cierre} pipeline={neg.estado_pipeline} />
      </div>

      {/* Hora de cierre — el calendario agrupa por día; aquí se ve la HORA exacta. */}
      {neg.licitacion_cierre && (
        <div className="flex items-center gap-1 mb-1.5 text-[9.5px] font-semibold text-slate-500">
          <Clock size={10} className="text-slate-400" />
          Cierra {dayjs(neg.licitacion_cierre).format('HH:mm')} h
        </div>
      )}

      {/* Nombre */}
      <p className="text-[11.5px] font-semibold text-slate-800 line-clamp-2 leading-snug mb-1.5 group-hover:text-indigo-700 transition-colors" title={neg.licitacion_nombre}>
        {neg.licitacion_nombre || neg.licitacion_codigo}
      </p>

      {/* Organismo */}
      {neg.licitacion_organismo && (
        <p className="text-[10px] text-slate-400 truncate mb-2" title={neg.licitacion_organismo}>
          {neg.licitacion_organismo}
        </p>
      )}

      {/* Monto */}
      {neg.licitacion_monto != null && neg.licitacion_monto > 0 && (
        <p className="text-[11px] font-bold text-emerald-700 mb-1.5">
          {formatMonto(neg.licitacion_monto)}
        </p>
      )}

      {/* Viabilidad + documentos */}
      {(viab || neg.tiene_documentos) && (
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          {viab && (
            <span style={{ backgroundColor: viab.color + '18', color: viab.color, borderColor: viab.color + '40' }}
              className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full border flex-shrink-0">
              <span style={{ background: viab.color }} className="w-1.5 h-1.5 rounded-full" />
              {viab.label}
            </span>
          )}
          {neg.tiene_documentos ? (
            <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-teal-700 bg-teal-50 border border-teal-100 px-1.5 py-0.5 rounded-full flex-shrink-0">
              <FileText size={9} /> Docs
            </span>
          ) : null}
        </div>
      )}

      {/* Perfil asignado + pipeline */}
      <div className="flex items-center justify-between gap-1.5 pt-1.5 border-t border-slate-50">
        <span className="flex items-center gap-1.5 min-w-0">
          <span style={{ background: col }} className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[8px] font-bold flex-shrink-0">
            {iniciales}
          </span>
          <span className="text-[10px] text-slate-500 truncate" title={nombrePerfil}>{nombrePerfil}</span>
        </span>
        {pipeline && (
          <span style={{ backgroundColor: pipeline.color + '18', color: pipeline.color, borderColor: pipeline.color + '40' }}
            className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border flex-shrink-0">
            {pipeline.label}
          </span>
        )}
      </div>

      {/* Asignación + semáforo de frescura (días sin cambio de estado) */}
      {sem && (
        <div className="flex items-center justify-between gap-1.5 mt-1.5 pt-1.5 border-t border-slate-50 text-[9px]">
          {neg.created_at && (
            <span className="text-slate-400" title={`Asignada el ${dayjs(neg.created_at).format('DD/MM/YYYY HH:mm')}`}>
              Asignada {dayjs(neg.created_at).format('DD/MM')}
            </span>
          )}
          <span className={`ml-auto inline-flex items-center gap-1 font-bold px-1.5 py-0.5 rounded-full ${sem.bg} ${sem.text}`}
            title={`${sem.dias} día${sem.dias === 1 ? '' : 's'} sin cambio de estado`}>
            <span style={{ background: sem.color }} className="w-1.5 h-1.5 rounded-full" />
            {sem.etiqueta}
          </span>
        </div>
      )}
    </button>
  );
}

// ── Modal de detalle para el calendario semanal ───────────────────────────────
interface NegocioDetalle {
  licitacion_descripcion?: string | null;
  viabilidad_informe?: { resumen?: string; recomendacion?: string; ventaja_competitiva?: string; riesgos?: string[] } | null;
  viabilidad_area?: string | null;
  documentos?: { nombre_archivo: string; url_local?: string; url_original?: string; size_bytes?: number; categoria?: string }[];
  total_documentos?: number;
}

function NegocioDetalleModal({ negocio: neg, isAdmin, onClose }: { negocio: Negocio; isAdmin: boolean; onClose: () => void }) {
  const [extra, setExtra]       = useState<NegocioDetalle | null>(null);
  const [loadingEx, setLoadingEx] = useState(true);
  const [descExpandida, setDescExpandida] = useState(false);

  useEffect(() => {
    fetch(`/api/negocios/${neg.id}`)
      .then(r => r.json())
      .then(d => { if (d.success) setExtra(d.negocio); })
      .catch(() => {})
      .finally(() => setLoadingEx(false));
  }, [neg.id]);

  // Escape cierra (el clic fuera ya está en el overlay).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const tipo   = extractTipoFromCodigo(neg.licitacion_codigo || '');
  const tipoBg = TIPO_COLOR_CLASS[tipo] || 'bg-gray-400';
  const col    = colorUsuario(neg.usuario_email || neg.usuario_nombre);
  const dias   = neg.licitacion_cierre
    ? Math.ceil((new Date(neg.licitacion_cierre).getTime() - Date.now()) / 86400000)
    : null;
  const e = getEstadoPipeline(neg.estado_pipeline || 'ASIGNADO');
  const viab = neg.viabilidad_semaforo ? SEMAFORO[neg.viabilidad_semaforo] : null;
  const inf  = extra?.viabilidad_informe;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}
      role="dialog" aria-modal="true" aria-label={neg.licitacion_nombre || 'Detalle del negocio'}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden" onClick={ev => ev.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start gap-3 px-6 py-4 border-b border-slate-100 flex-shrink-0" style={{ borderLeft: `4px solid ${col}` }}>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              {tipo && <span className={`${tipoBg} text-white text-[10px] font-black px-2 py-0.5 rounded-md`}>{tipo}</span>}
              {e && (
                <span style={{ backgroundColor: e.color + '18', color: e.color, borderColor: e.color + '40' }}
                  className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border">
                  <span style={{ backgroundColor: e.color }} className="w-1.5 h-1.5 rounded-full" /> {e.label}
                </span>
              )}
              <span className="text-[11px] font-mono text-slate-400">{neg.licitacion_codigo}</span>
            </div>
            <h3 className="text-[15px] font-bold text-slate-900 leading-snug">{neg.licitacion_nombre || neg.licitacion_codigo}</h3>
          </div>
          <button onClick={onClose} className="flex-shrink-0 p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-5 space-y-4">

          {/* Organismo + región */}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {neg.licitacion_organismo && (
              <div className="flex items-center gap-1.5 text-[13px] text-slate-600">
                <Building2 size={13} className="text-slate-400 flex-shrink-0" />
                <span>{neg.licitacion_organismo}</span>
              </div>
            )}
            {neg.licitacion_region && (
              <div className="flex items-center gap-1.5 text-[12px] text-slate-500">
                <MapPin size={12} className="text-slate-400 flex-shrink-0" /> {neg.licitacion_region}
              </div>
            )}
          </div>

          {/* Datos clave en grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {neg.licitacion_monto != null && neg.licitacion_monto > 0 && (
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                <p className="text-[10px] text-emerald-600 font-semibold uppercase tracking-wide mb-0.5">Presupuesto</p>
                <p className="text-[14px] font-bold text-emerald-800">{formatMonto(neg.licitacion_monto)}</p>
              </div>
            )}
            {neg.licitacion_cierre && (
              <div className={`rounded-xl p-3 border ${dias !== null && dias <= 3 ? 'bg-red-50 border-red-100' : dias !== null && dias <= 7 ? 'bg-amber-50 border-amber-100' : 'bg-slate-50 border-slate-100'}`}>
                <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide mb-0.5">Cierre</p>
                <p className="text-[13px] font-bold text-slate-800">
                  {new Date(neg.licitacion_cierre).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })}
                </p>
                {dias !== null && (
                  <p className={`text-[11px] font-semibold mt-0.5 ${dias <= 0 ? 'text-slate-400' : dias <= 3 ? 'text-red-600' : dias <= 7 ? 'text-amber-600' : 'text-slate-500'}`}>
                    {dias <= 0 ? 'Vencida' : `${dias} días restantes`}
                  </p>
                )}
              </div>
            )}
            {neg.monto_ofertado > 0 && (
              <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3">
                <p className="text-[10px] text-indigo-600 font-semibold uppercase tracking-wide mb-0.5">Monto ofertado</p>
                <p className="text-[13px] font-bold text-indigo-800">{formatMonto(neg.monto_ofertado)}</p>
              </div>
            )}
          </div>

          {/* Viabilidad */}
          {viab && (
            <div className={`rounded-xl border p-3.5 space-y-2 ${viab.bg}`} style={{ borderColor: viab.color + '40' }}>
              <div className="flex items-center gap-2">
                <span style={{ background: viab.color }} className="w-2.5 h-2.5 rounded-full flex-shrink-0" />
                <span className={`text-[13px] font-bold ${viab.text}`}>
                  Viabilidad: {viab.label}
                  {neg.viabilidad_score != null && <span className="opacity-70 font-semibold"> · {neg.viabilidad_score}/100</span>}
                </span>
                {extra?.viabilidad_area && (
                  <span className="ml-auto text-[11px] text-slate-500 bg-white/60 px-2 py-0.5 rounded-full border border-white/80">
                    {extra.viabilidad_area}
                  </span>
                )}
              </div>
              {loadingEx && !inf && (
                <p className="text-[11px] text-slate-400 flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> Cargando análisis…</p>
              )}
              {inf?.resumen && (
                <p className="text-[13.5px] text-slate-700 leading-relaxed">{inf.resumen}</p>
              )}
              {inf?.ventaja_competitiva && (
                <div className="bg-white/60 rounded-lg px-3 py-2 border border-emerald-100">
                  <p className="text-[11px] font-bold text-emerald-700 mb-0.5">Ventaja competitiva</p>
                  <p className="text-[13px] text-emerald-800 leading-relaxed">{inf.ventaja_competitiva}</p>
                </div>
              )}
              {inf?.recomendacion && (
                <div className="bg-white/60 rounded-lg px-3 py-2 border border-indigo-100">
                  <p className="text-[11px] font-bold text-indigo-700 mb-0.5">Recomendación</p>
                  <p className="text-[13px] text-indigo-800 leading-relaxed">{inf.recomendacion}</p>
                </div>
              )}
              {inf?.riesgos && inf.riesgos.length > 0 && (
                <div className="bg-white/60 rounded-lg px-3 py-2 border border-red-100">
                  <p className="text-[11px] font-bold text-red-700 mb-1">Riesgos</p>
                  <ul className="space-y-1">
                    {inf.riesgos.map((r: string, i: number) => (
                      <li key={i} className="text-[13px] text-red-700 leading-relaxed">• {r}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Descripción */}
          {!loadingEx && extra?.licitacion_descripcion && (
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">Descripción</p>
              <p className={`text-[13.5px] text-slate-600 leading-relaxed ${descExpandida ? '' : 'line-clamp-4'}`}>{extra.licitacion_descripcion}</p>
              {extra.licitacion_descripcion.length > 320 && (
                <button onClick={() => setDescExpandida(v => !v)}
                  className="mt-1 text-[12px] font-semibold text-indigo-600 hover:text-indigo-800">
                  {descExpandida ? 'Ver menos' : 'Ver más'}
                </button>
              )}
            </div>
          )}

          {/* Documentos */}
          {!loadingEx && extra && (extra.total_documentos ?? 0) > 0 && (
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2">
                Documentos <span className="text-indigo-600">({extra.total_documentos})</span>
              </p>
              <div className="space-y-1.5">
                {(extra.documentos || []).slice(0, 8).map((doc, i) => (
                  <div key={i} className="flex items-center gap-2.5 px-3 py-2 bg-slate-50 border border-slate-100 rounded-lg">
                    <FileText size={13} className="text-indigo-500 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11.5px] font-medium text-slate-700 truncate" title={doc.nombre_archivo}>
                        {doc.nombre_archivo}
                      </p>
                      {(doc.categoria || doc.size_bytes) && (
                        <p className="text-[10px] text-slate-400">
                          {doc.categoria && <span className="capitalize">{doc.categoria}</span>}
                          {doc.size_bytes && doc.categoria && ' · '}
                          {doc.size_bytes && `${(doc.size_bytes / 1024).toFixed(0)} KB`}
                        </p>
                      )}
                    </div>
                    {doc.url_local && (
                      <a href={doc.url_local} target="_blank" rel="noopener noreferrer"
                        className="flex-shrink-0 p-1 rounded text-slate-400 hover:text-indigo-600 transition-colors"
                        onClick={e => e.stopPropagation()}>
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                ))}
                {(extra.total_documentos ?? 0) > 8 && (
                  <p className="text-[11px] text-slate-400 pl-1">+{(extra.total_documentos ?? 0) - 8} documentos más</p>
                )}
              </div>
            </div>
          )}
          {!loadingEx && extra && (extra.total_documentos ?? 0) === 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-100 rounded-lg text-[11.5px] text-slate-400">
              <FileText size={13} /> Sin documentos descargados
            </div>
          )}

          {/* Etiquetas */}
          {neg.etiquetas.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {neg.etiquetas.map(et => (
                <span key={et.id} style={{ backgroundColor: et.color + '20', color: et.color, borderColor: et.color + '40' }}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full border">
                  <span style={{ backgroundColor: et.color }} className="w-1.5 h-1.5 rounded-full" /> {et.nombre}
                </span>
              ))}
            </div>
          )}

          {/* Asignado a */}
          {isAdmin && (neg.usuario_nombre || neg.usuario_email) && (
            <div className="flex items-center gap-2.5 px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl">
              <span style={{ background: col }} className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0">
                {inicialesUsuario(neg.usuario_nombre, neg.usuario_email)}
              </span>
              <div>
                <p className="text-[12px] font-semibold text-slate-700">{neg.usuario_nombre || neg.usuario_email}</p>
                <p className="text-[10px] text-slate-400">Responsable asignado</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-slate-100 flex-shrink-0">
          <button onClick={onClose} className="text-[13px] font-semibold text-slate-500 hover:text-slate-700 transition-colors">
            Cerrar
          </button>
          <Link
            href={`/negocios/${neg.id}`}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold rounded-xl transition-colors"
            onClick={onClose}
          >
            Abrir negocio <ArrowRight size={13} />
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── Vista calendario semanal ──────────────────────────────────────────────────
function VistaSemana({ negocios, onAbrirNegocio }: { negocios: Negocio[]; onAbrirNegocio: (n: Negocio) => void }) {
  const [semana, setSemana] = useState<Date>(() => {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diff);
    monday.setHours(0, 0, 0, 0);
    return monday;
  });

  const dias = useMemo(() => Array.from({ length: 5 }, (_, i) => {
    const d = new Date(semana);
    d.setDate(semana.getDate() + i);
    return d;
  }), [semana]);

  const fmtKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const porDia = useMemo(() => {
    const m = new Map<string, Negocio[]>();
    for (const n of negocios) {
      if (!n.licitacion_cierre) continue;
      const k = fmtKey(new Date(n.licitacion_cierre));
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(n);
    }
    return m;
  }, [negocios]);

  const hoyKey  = fmtKey(new Date());
  const prevSem = () => { const d = new Date(semana); d.setDate(d.getDate() - 7); setSemana(d); };
  const nextSem = () => { const d = new Date(semana); d.setDate(d.getDate() + 7); setSemana(d); };

  const DIAS_NOMBRES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];
  const totalSem = dias.reduce((acc, d) => acc + (porDia.get(fmtKey(d))?.length || 0), 0);

  return (
    <div>
      {/* Navegación */}
      <div className="flex items-center justify-between mb-4 bg-white border border-slate-200 rounded-xl px-4 py-3">
        <button onClick={prevSem} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors" title="Semana anterior">
          <ChevronLeft size={18} />
        </button>
        <div className="text-center">
          <p className="text-[13px] font-bold text-slate-800">
            {dias[0].toLocaleDateString('es-CL', { day: 'numeric', month: 'long' })} — {dias[4].toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
          {totalSem > 0 && (
            <p className="text-[11px] text-slate-400 mt-0.5">{totalSem} cierre{totalSem !== 1 ? 's' : ''} esta semana</p>
          )}
        </div>
        <button onClick={nextSem} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors" title="Semana siguiente">
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Grid 5 columnas */}
      <div className="grid grid-cols-5 gap-3">
        {dias.map((dia, i) => {
          const k     = fmtKey(dia);
          const items = porDia.get(k) || [];
          const esHoy = k === hoyKey;

          return (
            <div key={k} className={`rounded-xl border flex flex-col ${esHoy ? 'border-indigo-300 bg-indigo-50/20' : 'border-slate-200 bg-white'}`}>
              {/* Header día */}
              <div className={`px-3 py-2.5 border-b flex-shrink-0 ${esHoy ? 'border-indigo-200 bg-indigo-50/50' : 'border-slate-100'}`}>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{DIAS_NOMBRES[i]}</p>
                <div className="flex items-baseline justify-between">
                  <p className={`text-lg font-black leading-tight ${esHoy ? 'text-indigo-600' : 'text-slate-800'}`}>
                    {dia.getDate()}
                    <span className="text-[10px] font-normal text-slate-400 ml-1">
                      {dia.toLocaleDateString('es-CL', { month: 'short' })}
                    </span>
                  </p>
                  {items.length > 0 && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${esHoy ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>
                      {items.length}
                    </span>
                  )}
                </div>
              </div>

              {/* Licitaciones del día */}
              <div className="p-2 space-y-2 flex-1 min-h-[180px]">
                {items.length === 0 ? (
                  <p className="text-[10px] text-slate-300 text-center pt-6">Sin cierres</p>
                ) : (
                  items.map(n => (
                    <NegocioMiniCard key={n.id} neg={n} onClick={() => onAbrirNegocio(n)} />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
function NegociosContent() {
  const { usuario } = useSession();
  const confirmar = useConfirm();
  const toast = useToast();
  const isAdmin = usuario?.rol === 'admin';

  const [negocios, setNegocios]     = useState<Negocio[]>([]);
  const [usuarios, setUsuarios]     = useState<Usuario[]>([]);
  const [etiquetas, setEtiquetas]   = useState<Etiqueta[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [search, setSearch]         = useState('');
  // Filtro por perfil/usuario: SELECCIÓN MÚLTIPLE por email (cliente). El admin carga todos
  // los negocios y filtra aquí, así compone con el resto de filtros y con el exportador.
  const [filtroUsuarios, setFiltroUsuarios] = useState<string[]>([]);
  const [filtroEtiqueta, setFiltroEtiqueta] = useState<string[]>([]);
  const [filtroTipo, setFiltroTipo]         = useState<string[]>([]);
  const [filtroEstado, setFiltroEstado]     = useState<string[]>([]);
  const [filtroRegion, setFiltroRegion]     = useState<string[]>([]);
  // Rango por FECHA DE CIERRE (YYYY-MM-DD; '' = sin límite).
  const [filtroFechaDesde, setFiltroFechaDesde] = useState('');
  const [filtroFechaHasta, setFiltroFechaHasta] = useState('');
  const [showModal, setShowModal]       = useState(false);
  const [vista, setVista]               = useState<'lista' | 'calendario' | 'semana'>('semana');
  // Orden de la vista LISTA por fecha de cierre: false = próxima a cerrar primero (asc).
  const [ordenCierreDesc, setOrdenCierreDesc] = useState(false);
  const [carga, setCarga]               = useState<Carga[]>([]);
  const [diaSel, setDiaSel]             = useState<string | null>(null);
  const [negocioModal, setNegocioModal] = useState<Negocio | null>(null);
  const [yaActualizado, setYaActualizado] = useState(false);
  const [filtrosOpen, setFiltrosOpen]   = useState(false);
  const [exportando, setExportando]     = useState(false);
  // Refresco de estados MP en curso (badge sutil "actualizando…"; no bloquea la vista).
  const [refrescandoEstados, setRefrescandoEstados] = useState(false);
  // Evita re-disparar el refresco de fondo más de una vez por montaje.
  const estadosRefrescados = useRef(false);
  // Hidratado = ya restauramos los filtros guardados; evita persistir el default antes.
  const [hidratado, setHidratado]       = useState(false);

  // Restaurar filtros guardados al montar (persisten al volver de un negocio/licitación).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SS_NEG_FILTROS);
      if (raw) {
        const f = JSON.parse(raw);
        if (typeof f.search === 'string')        setSearch(f.search);
        if (Array.isArray(f.filtroUsuarios)) setFiltroUsuarios(f.filtroUsuarios.map(String));
        if (Array.isArray(f.filtroEtiqueta)) setFiltroEtiqueta(f.filtroEtiqueta.map(String));
        if (Array.isArray(f.filtroTipo))     setFiltroTipo(f.filtroTipo.map(String));
        if (Array.isArray(f.filtroEstado))   setFiltroEstado(f.filtroEstado.map(String));
        if (Array.isArray(f.filtroRegion))   setFiltroRegion(f.filtroRegion.map(String));
        if (typeof f.filtroFechaDesde === 'string') setFiltroFechaDesde(f.filtroFechaDesde);
        if (typeof f.filtroFechaHasta === 'string') setFiltroFechaHasta(f.filtroFechaHasta);
        if (f.vista === 'lista' || f.vista === 'calendario' || f.vista === 'semana') setVista(f.vista);
        if (typeof f.ordenCierreDesc === 'boolean') setOrdenCierreDesc(f.ordenCierreDesc);
      }
    } catch { /* sin persistencia */ }
    setHidratado(true);
  }, []);

  // Persistir los filtros cada vez que cambian (después de hidratar, para no pisar lo guardado).
  useEffect(() => {
    if (!hidratado) return;
    try {
      sessionStorage.setItem(SS_NEG_FILTROS, JSON.stringify({ search, filtroUsuarios, filtroEtiqueta, filtroTipo, filtroEstado, filtroRegion, filtroFechaDesde, filtroFechaHasta, vista, ordenCierreDesc }));
    } catch { /* cuota llena */ }
  }, [hidratado, search, filtroUsuarios, filtroEtiqueta, filtroTipo, filtroEstado, filtroRegion, filtroFechaDesde, filtroFechaHasta, vista, ordenCierreDesc]);

  const cargar = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      // Se cargan TODOS los negocios visibles según el rol (admin = todos); el filtro por
      // perfil es en cliente (multi-select) para que componga con el resto de filtros.
      const [negRes, etRes] = await Promise.all([
        fetch('/api/negocios'),
        fetch('/api/etiquetas'),
      ]);
      const negData = await negRes.json();
      const etData = await etRes.json();
      if (!negData.success) throw new Error(negData.error);
      setNegocios(negData.negocios || []);
      setUsuarios(negData.usuarios || []);
      setCarga(negData.carga || []);
      if (etData.success) setEtiquetas(etData.etiquetas || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setYaActualizado(true);
    }
  }, []);

  // Solo cargar DESPUÉS de restaurar los filtros guardados. Si no, al montar se dispara
  // una carga con el filtro vacío (todos) y otra con el filtro restaurado (filtrados): la
  // primera puede resolver última y pisar a la segunda → se ven "todos" con el filtro
  // marcado. Esperar a `hidratado` deja una sola carga, ya con el filtro correcto.
  useEffect(() => { if (hidratado) cargar(); }, [cargar, hidratado]);

  // Refresco AUTORITATIVO de estados desde la API de MP para las asignadas vivas. Jala Cerrada/
  // Desierta/Adjudicada/Revocada/Suspendida (y "Ganada" cuando es nuestra postulada adjudicada) y,
  // si hubo cambios, recarga en silencio para pintar los badges. `force` salta el throttle (botón
  // manual). Best-effort: si MP no responde, la vista sigue con lo cacheado.
  const REFRESCO_MS = 2 * 60 * 60 * 1000; // 2 horas
  const refrescarEstadosMP = useCallback(async (force = false) => {
    if (refrescandoEstados) return;
    if (!force) {
      try {
        const last = Number(localStorage.getItem('neg_estados_mp_last') || 0);
        if (Date.now() - last < REFRESCO_MS) return; // aún fresco → no gasta API
      } catch { /* sin storage: sigue */ }
    }
    setRefrescandoEstados(true);
    try {
      const res = await fetch('/api/negocios/refrescar-estados', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      try { localStorage.setItem('neg_estados_mp_last', String(Date.now())); } catch { /* cuota */ }
      if (data?.success && (data.actualizadas ?? 0) > 0) {
        await cargar(true); // recarga silenciosa: los badges cambian sin parpadeo de "Cargando…"
      }
    } catch { /* nunca bloquea la vista */ }
    finally { setRefrescandoEstados(false); }
  }, [cargar, refrescandoEstados, REFRESCO_MS]);

  // Al abrir la vista (tras la primera carga), dispara el refresco en BACKGROUND, acotado a 2h.
  // La vista ya mostró lo cacheado; esto solo actualiza los badges cuando MP resolvió algo.
  useEffect(() => {
    if (!yaActualizado || estadosRefrescados.current) return;
    estadosRefrescados.current = true;
    refrescarEstadosMP(false);
  }, [yaActualizado, refrescarEstadosMP]);

  const eliminar = async (id: number) => {
    const ok = await confirmar({
      titulo: '¿Quitar esta licitación?',
      mensaje: 'Se quitará del panel de negocios. Podrás volver a asignarla después.',
      confirmarLabel: 'Quitar',
      peligro: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/negocios/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setNegocios(prev => prev.filter(n => n.id !== id));
      toast.info('Licitación removida del panel');
    } catch {
      toast.error('No se pudo quitar la licitación');
    }
  };

  const negociosFiltrados = useMemo(() => {
    const q = search.toLowerCase();
    return negocios.filter(n => {
      const matchSearch = q === '' ||
        n.licitacion_nombre?.toLowerCase().includes(q) ||
        n.licitacion_codigo?.toLowerCase().includes(q) ||
        n.licitacion_organismo?.toLowerCase().includes(q);
      const matchEt = filtroEtiqueta.length === 0 ||
        n.etiquetas.some(e => filtroEtiqueta.includes(String(e.id)));
      const tipoDelCodigo = extractTipoFromCodigo(n.licitacion_codigo || '');
      const matchTipo = filtroTipo.length === 0 || filtroTipo.includes(tipoDelCodigo);
      const matchEstado = filtroEstado.length === 0 || filtroEstado.includes(n.estado_pipeline || 'ASIGNADO');
      const matchUsuario = filtroUsuarios.length === 0 || (!!n.usuario_email && filtroUsuarios.includes(n.usuario_email));
      const matchRegion = filtroRegion.length === 0 || (!!n.licitacion_region && filtroRegion.includes(n.licitacion_region));
      // Rango por fecha de cierre (inclusive). Sin cierre → se excluye si hay filtro de fecha.
      const cierre = n.licitacion_cierre ? dayjs(n.licitacion_cierre) : null;
      const matchDesde = !filtroFechaDesde || (!!cierre && !cierre.isBefore(dayjs(filtroFechaDesde), 'day'));
      const matchHasta = !filtroFechaHasta || (!!cierre && !cierre.isAfter(dayjs(filtroFechaHasta), 'day'));
      return matchSearch && matchEt && matchTipo && matchEstado && matchUsuario && matchRegion && matchDesde && matchHasta;
    });
  }, [negocios, search, filtroEtiqueta, filtroTipo, filtroEstado, filtroUsuarios, filtroRegion, filtroFechaDesde, filtroFechaHasta]);

  // VIGENTES: para el calendario/semana solo interesan las que siguen "vivas": cierre no
  // vencido y sin resolver (fuera descartadas, postuladas, adjudicadas y ya vencidas).
  const negociosVigentes = useMemo(() => {
    const ahora = Date.now();
    return negociosFiltrados.filter(n => {
      const estado = n.estado_pipeline || 'ASIGNADO';
      if (RESUELTOS_NEGOCIO.has(estado)) return false;
      const cierreMs = n.licitacion_cierre ? new Date(n.licitacion_cierre).getTime() : NaN;
      if (!Number.isNaN(cierreMs) && cierreMs < ahora) return false; // vencida
      return true;
    });
  }, [negociosFiltrados]);

  // CALENDARIO (semana/mes): las VIGENTES + las POSTULADAS. Las postuladas ya se ofertaron
  // (no son trabajo pendiente), pero el usuario quiere VERLAS en el calendario por su fecha de
  // cierre; entran aunque estén vencidas (la oferta se hace antes del cierre). El resto de
  // resueltas (descartada/adjudicada/perdida) sigue fuera. La vista LISTA las muestra todas.
  const negociosCalendario = useMemo(() => {
    const ahora = Date.now();
    return negociosFiltrados.filter(n => {
      const estado = n.estado_pipeline || 'ASIGNADO';
      if (estado === 'POSTULADA') return !!n.licitacion_cierre; // postuladas SÍ, con fecha de cierre
      if (RESUELTOS_NEGOCIO.has(estado)) return false;
      const cierreMs = n.licitacion_cierre ? new Date(n.licitacion_cierre).getTime() : NaN;
      if (!Number.isNaN(cierreMs) && cierreMs < ahora) return false; // vencida
      return true;
    });
  }, [negociosFiltrados]);

  // LISTA: ordena por fecha de cierre. Por defecto la más próxima a cerrar primero (asc);
  // el botón invierte a la que cierra más lejos primero (desc). Las sin cierre van al final.
  const negociosLista = useMemo(() => {
    const arr = [...negociosFiltrados];
    arr.sort((a, b) => {
      const ta = a.licitacion_cierre ? new Date(a.licitacion_cierre).getTime() : NaN;
      const tb = b.licitacion_cierre ? new Date(b.licitacion_cierre).getTime() : NaN;
      const na = Number.isNaN(ta), nb = Number.isNaN(tb);
      if (na && nb) return 0;
      if (na) return 1;   // sin cierre siempre al final
      if (nb) return -1;
      return ordenCierreDesc ? tb - ta : ta - tb;
    });
    return arr;
  }, [negociosFiltrados, ordenCierreDesc]);

  // ── Exportar Excel ────────────────────────────────────────────────────────────
  // Exporta la VISTA ACTUAL (negociosFiltrados: respeta búsqueda y filtros activos), una
  // fila por licitación. Incluye el estado EFECTIVO de MP (Publicada vencida → Cerrada).
  const exportarExcel = async () => {
    if (exportando) return;
    if (negociosFiltrados.length === 0) {
      toast.error('No hay licitaciones para exportar', 'Ajusta o limpia los filtros e inténtalo de nuevo.');
      return;
    }
    setExportando(true);
    try {
      const XLSX = await import('xlsx');
      const filas = negociosFiltrados.map(n => ({
        'Código':            n.licitacion_codigo,
        'Nombre':            n.licitacion_nombre || '',
        'Organismo':         n.licitacion_organismo || '',
        'Tipo':              extractTipoFromCodigo(n.licitacion_codigo || '') || '',
        'Estado MP':         estadoEfectivoNombre(n.licitacion_estado, n.licitacion_cierre) || '',
        'Estado gestión':    getEstadoPipeline(n.estado_pipeline || 'ASIGNADO')?.label || n.estado_pipeline || '',
        'Monto (CLP)':       n.licitacion_monto ?? '',
        'Monto ofertado':    n.monto_ofertado ?? '',
        'Cierre':            n.licitacion_cierre ? new Date(n.licitacion_cierre).toLocaleString('es-CL') : '',
        'Región':            n.licitacion_region || '',
        'Líneas de negocio': (n.etiquetas || []).map(e => e.nombre).join(', '),
        'Asignada a':        n.usuario_nombre || n.usuario_email || '',
        'URL':               `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(n.licitacion_codigo)}`,
      }));
      const ws = XLSX.utils.json_to_sheet(filas);
      ws['!cols'] = [
        { wch: 18 }, { wch: 48 }, { wch: 30 }, { wch: 8 }, { wch: 12 },
        { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 20 }, { wch: 20 },
        { wch: 28 }, { wch: 22 }, { wch: 60 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Negocios');
      const hoy = new Date().toLocaleDateString('es-CL').replace(/\//g, '-');
      XLSX.writeFile(wb, `negocios-${hoy}.xlsx`);
      toast.success(`Exportadas ${filas.length} licitación${filas.length !== 1 ? 'es' : ''}`, 'Se descargó el Excel con los filtros actuales.');
    } catch (e) {
      console.error('[negocios] exportar Excel falló:', e);
      toast.error('No se pudo exportar el Excel', String((e as any)?.message || e));
    } finally {
      setExportando(false);
    }
  };

  // Tipos presentes (para el select de filtro), en orden canónico.
  const tiposPresentes = useMemo(() => {
    const s = new Set<string>();
    for (const n of negocios) { const t = extractTipoFromCodigo(n.licitacion_codigo || ''); if (t) s.add(t); }
    return TIPOS_FILTRO.filter(t => s.has(t));
  }, [negocios]);

  // Regiones presentes (para el filtro múltiple de región).
  const regionesPresentes = useMemo(() => {
    const s = new Set<string>();
    for (const n of negocios) { if (n.licitacion_region) s.add(n.licitacion_region); }
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'es'));
  }, [negocios]);

  const ESTADO_COLOR: Record<string, string> = {
    'Publicada': 'bg-green-100 text-green-700',
    'Adjudicada': 'bg-blue-100 text-blue-700',
    'Cerrada': 'bg-slate-100 text-gray-500',
  };

  // Licitaciones que cierran el día seleccionado (para el modal del calendario).
  const itemsDia = diaSel
    ? negociosFiltrados.filter(n => n.licitacion_cierre && dayjs(n.licitacion_cierre).format('YYYY-MM-DD') === diaSel)
    : [];

  return (
    <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Negocios' }]}>
      <div className="p-4 sm:p-6 lg:p-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Briefcase size={24} className="text-indigo-600" /> Negocios
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {loading ? 'Cargando...' : `${negociosFiltrados.length} licitacion${negociosFiltrados.length !== 1 ? 'es' : ''} asignada${negociosFiltrados.length !== 1 ? 's' : ''}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => { setYaActualizado(false); await cargar(); refrescarEstadosMP(true); }}
              disabled={loading || refrescandoEstados}
              title="Recargar y consultar Mercado Público (Cerrada/Desierta/Adjudicada/Revocada) para las asignadas"
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-all ${
                loading || refrescandoEstados ? 'bg-slate-100 text-slate-400 cursor-not-allowed' :
                yaActualizado ? 'bg-red-50 border border-red-200 text-red-600 hover:bg-red-100' :
                'bg-emerald-600 text-white hover:bg-emerald-500 shadow-sm'
              }`}
            >
              <RefreshCw size={14} className={loading || refrescandoEstados ? 'animate-spin' : ''} />
              {loading ? 'Cargando…' : refrescandoEstados ? 'Estados MP…' : yaActualizado ? 'Actualizado ✓' : 'Actualizar'}
            </button>
            <button
              onClick={exportarExcel}
              disabled={exportando}
              title="Exportar a Excel las licitaciones con los filtros actuales"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {exportando ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              Exportar
            </button>
            {isAdmin && (
              <button
                onClick={() => setShowModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
              >
                <Plus size={15} /> Asignar licitación
              </button>
            )}
          </div>
        </div>

        {/* Carga de trabajo por perfil (recuadros con mini-gráfico por tipo) */}
        {carga.length > 0 && (
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">
                {isAdmin ? 'Carga de trabajo por perfil' : 'Tu carga de trabajo'}
              </span>
              {isAdmin && filtroUsuarios.length > 0 && (
                <button onClick={() => setFiltroUsuarios([])} className="text-xs text-indigo-600 hover:underline font-semibold">Ver todos</button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {carga.map(c => {
                const nombre = c.nombre || (c.usuario_id === usuario?.id ? usuario?.nombre : null) || null;
                const email  = c.email  || (c.usuario_id === usuario?.id ? usuario?.email  : null) || null;
                const activo = !!email && filtroUsuarios.includes(email);
                return (
                  <CargaCard
                    key={c.usuario_id} c={c} nombre={nombre} email={email}
                    activo={activo} isAdmin={isAdmin}
                    onClick={() => { if (!email) return; setFiltroUsuarios(prev => prev.includes(email) ? prev.filter(x => x !== email) : [...prev, email]); }}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Barra de herramientas: vistas + filtros */}
        <div className="mb-4 space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            {/* Selector de vista */}
            <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
              {([
                { key: 'semana',      label: 'Semana',      icon: <CalendarDays size={13} /> },
                { key: 'lista',       label: 'Lista',       icon: <List size={13} /> },
                { key: 'calendario',  label: 'Mes',         icon: <Calendar size={13} /> },
              ] as const).map(v => (
                <button
                  key={v.key}
                  onClick={() => setVista(v.key)}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                    vista === v.key ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {v.icon} {v.label}
                </button>
              ))}
            </div>

            {/* Orden por fecha de cierre (solo vista lista) */}
            {vista === 'lista' && (
              <button
                onClick={() => setOrdenCierreDesc(v => !v)}
                title={ordenCierreDesc ? 'Ordenado: cierra más lejos primero — clic para invertir' : 'Ordenado: próxima a cerrar primero — clic para invertir'}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border bg-white text-slate-600 border-slate-200 hover:border-slate-400 transition-colors"
              >
                {ordenCierreDesc ? <ArrowDownWideNarrow size={13} /> : <ArrowUpNarrowWide size={13} />}
                Cierre: {ordenCierreDesc ? 'más lejano' : 'más próximo'}
              </button>
            )}

            {/* Filtros toggle + limpiar */}
            <div className="flex items-center gap-2">
              {(search || filtroUsuarios.length || filtroEtiqueta.length || filtroTipo.length || filtroEstado.length || filtroRegion.length || filtroFechaDesde || filtroFechaHasta) ? (
                <button
                  onClick={() => { setSearch(''); setFiltroUsuarios([]); setFiltroEtiqueta([]); setFiltroTipo([]); setFiltroEstado([]); setFiltroRegion([]); setFiltroFechaDesde(''); setFiltroFechaHasta(''); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
                >
                  <X size={12} /> Limpiar filtros
                </button>
              ) : null}
              <button
                onClick={() => setFiltrosOpen(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                  filtrosOpen ? 'bg-indigo-50 text-indigo-600 border-indigo-200' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                }`}
              >
                <SlidersHorizontal size={12} /> Filtros
                <ChevronDown size={11} className={`transition-transform ${filtrosOpen ? 'rotate-180' : ''}`} />
              </button>
            </div>
          </div>

          {/* Panel de filtros colapsable */}
          {filtrosOpen && (
            <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap gap-2">
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar..."
                  className="pl-8 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none w-48"
                />
              </div>
              {isAdmin && usuarios.length > 0 && (
                <MultiSelect
                  label={filtroUsuarios.length ? 'Perfiles' : 'Todos los perfiles'}
                  options={usuarios.map(u => ({ value: u.email, label: u.nombre || u.email }))}
                  selected={filtroUsuarios}
                  onChange={setFiltroUsuarios}
                />
              )}
              {etiquetas.length > 0 && (
                <MultiSelect
                  label={filtroEtiqueta.length ? 'Líneas' : 'Todas las líneas'}
                  options={etiquetas.map(e => ({ value: String(e.id), label: e.nombre }))}
                  selected={filtroEtiqueta}
                  onChange={setFiltroEtiqueta}
                />
              )}
              <MultiSelect
                label={filtroTipo.length ? 'Tipos' : 'Todos los tipos'}
                options={tiposPresentes.map(t => ({ value: t, label: `${t} · ${getTipoLicitacion(t)?.label || t}` }))}
                selected={filtroTipo}
                onChange={setFiltroTipo}
              />
              <MultiSelect
                label={filtroEstado.length ? 'Estados' : 'Todos los estados'}
                options={ESTADOS_PIPELINE.map(e => ({ value: e.id, label: e.label }))}
                selected={filtroEstado}
                onChange={setFiltroEstado}
              />
              {regionesPresentes.length > 0 && (
                <MultiSelect
                  label={filtroRegion.length ? 'Regiones' : 'Todas las regiones'}
                  options={regionesPresentes.map(r => ({ value: r, label: r }))}
                  selected={filtroRegion}
                  onChange={setFiltroRegion}
                />
              )}
              {/* Rango por fecha de cierre */}
              <div className="flex items-center gap-1.5 border border-slate-200 rounded-lg px-2.5 py-1">
                <Calendar size={13} className="text-slate-400 flex-shrink-0" />
                <span className="text-[11px] font-semibold text-slate-500">Cierre</span>
                <input type="date" value={filtroFechaDesde} onChange={e => setFiltroFechaDesde(e.target.value)}
                  max={filtroFechaHasta || undefined}
                  className="text-[12px] text-slate-700 bg-transparent outline-none w-[118px]" title="Cierre desde" />
                <span className="text-slate-300">–</span>
                <input type="date" value={filtroFechaHasta} onChange={e => setFiltroFechaHasta(e.target.value)}
                  min={filtroFechaDesde || undefined}
                  className="text-[12px] text-slate-700 bg-transparent outline-none w-[118px]" title="Cierre hasta" />
                {(filtroFechaDesde || filtroFechaHasta) && (
                  <button onClick={() => { setFiltroFechaDesde(''); setFiltroFechaHasta(''); }}
                    title="Quitar rango de fecha" className="text-slate-400 hover:text-red-600 flex-shrink-0"><X size={12} /></button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm mb-4">
            <AlertCircle size={16} /> {error}
            <button onClick={() => cargar()} className="ml-auto hover:underline">Reintentar</button>
          </div>
        )}

        {/* Tabla */}
        {!loading && !error && (
          negociosFiltrados.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-xl border border-slate-100">
              <Briefcase size={36} className="text-gray-300 mx-auto mb-3" />
              <h3 className="text-lg font-semibold text-gray-700 mb-2">
                {search || filtroEtiqueta.length || filtroTipo.length || filtroEstado.length ? 'Sin resultados' : 'No hay licitaciones asignadas'}
              </h3>
              <p className="text-sm text-gray-400">
                {isAdmin
                  ? 'Usa "Asignar licitación" para agregar un proyecto al panel'
                  : 'El administrador aún no te ha asignado licitaciones'
                }
              </p>
            </div>
          ) : vista === 'semana' ? (
            /* ── Vista calendario semanal (vigentes + postuladas) ── */
            <VistaSemana negocios={negociosCalendario} onAbrirNegocio={setNegocioModal} />
          ) : vista === 'calendario' ? (
            /* ── Vista calendario mensual (vigentes + postuladas) ── */
            <VistaCalendario negocios={negociosCalendario} onAbrirDia={setDiaSel} />
          ) : (
            <div className="space-y-1.5">
              {negociosLista.map(neg => (
                <NegocioListItem key={neg.id} neg={neg} isAdmin={isAdmin} onEliminar={eliminar} />
              ))}
            </div>
          )
        )}

        {/* Skeleton loading */}
        {loading && (
          <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="px-4 py-4 border-b border-gray-50 animate-pulse flex gap-4">
                <div className="h-4 bg-gray-200 rounded w-24" />
                <div className="h-4 bg-slate-100 rounded flex-1" />
                <div className="h-4 bg-slate-100 rounded w-32" />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal del día del calendario */}
      {!!diaSel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
              <p className="font-bold text-slate-800">
                Cierres del {dayjs(diaSel).format('DD/MM/YYYY')}
                <span className="text-sm font-normal text-slate-400 ml-2">· {itemsDia.length} licitación{itemsDia.length !== 1 ? 'es' : ''}</span>
              </p>
              <button onClick={() => setDiaSel(null)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="overflow-y-auto p-4 space-y-2">
              {itemsDia.map(neg => {
                const col = colorUsuario(neg.usuario_email || neg.usuario_nombre);
                const tipo = extractTipoFromCodigo(neg.licitacion_codigo || '');
                return (
                  <div key={neg.id} className="bg-white border border-slate-200 rounded-lg p-3" style={{ borderLeft: `3px solid ${col}` }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span className="text-xs font-mono text-slate-400">{neg.licitacion_codigo}</span>
                          {tipo && <span className="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-semibold">{tipo}</span>}
                          <PipelineBadge estadoId={neg.estado_pipeline} />
                          <EstadoMpBadge estado={neg.licitacion_estado} cierre={neg.licitacion_cierre} />
                        </div>
                        <p className="text-sm font-semibold text-slate-800 line-clamp-2">{neg.licitacion_nombre || 'Sin nombre'}</p>
                        {neg.licitacion_organismo && <p className="text-xs text-slate-400 truncate mt-0.5">{neg.licitacion_organismo}</p>}
                        <div className="flex items-center gap-3 mt-1.5">
                          <span className="text-xs font-bold text-teal-700">{formatMonto(neg.licitacion_monto)}</span>
                          {isAdmin && (
                            <span className="flex items-center gap-1 text-xs text-slate-400">
                              <span style={{ background: col }} className="inline-flex items-center justify-center w-4 h-4 rounded-full text-white text-[8px] font-bold">
                                {inicialesUsuario(neg.usuario_nombre, neg.usuario_email)}
                              </span>
                              {neg.usuario_nombre || neg.usuario_email}
                            </span>
                          )}
                        </div>
                      </div>
                      <Link href={`/negocios/${neg.id}`} onClick={() => setDiaSel(null)}
                        className="flex-shrink-0 flex items-center gap-1 text-xs px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg font-medium hover:bg-indigo-100 transition-colors">
                        Entrar <ArrowRight size={13} />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {negocioModal && (
        <NegocioDetalleModal negocio={negocioModal} isAdmin={isAdmin} onClose={() => setNegocioModal(null)} />
      )}

      {isAdmin && (
        <ModalAsignar
          open={showModal}
          onClose={() => setShowModal(false)}
          onSuccess={() => cargar()}
          usuarios={usuarios}
          etiquetas={etiquetas}
        />
      )}
    </AppLayout>
  );
}

export default function NegociosPage() {
  return <Suspense><NegociosContent /></Suspense>;
}

