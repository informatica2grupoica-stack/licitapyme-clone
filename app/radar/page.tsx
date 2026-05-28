'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import { useToast }  from '@/app/components/ui/toast';
import { useSession } from '@/app/lib/session-context';
import {
  Radar, Plus, Trash2, ExternalLink, Tag,
  CheckCheck, Building2, Calendar, DollarSign, Loader2,
  BellOff, UserPlus, X, Check, Clock, Search,
  Zap, ToggleLeft, ToggleRight, Sparkles, Filter,
  ChevronDown,
} from 'lucide-react';
import { extractTipoFromCodigo, getTipoLicitacion, TIPO_COLOR_CLASS } from '@/app/lib/tipos-licitacion';

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface PalabraClave {
  id:               number;
  keyword:          string;
  activo:           boolean;
  ultima_busqueda:  string | null;
  resultados_nuevos: number;
  total_encontradas: number;
  created_at:       string;
}

interface Alerta {
  id:                   number;
  keyword_texto:        string;
  licitacion_codigo:    string;
  licitacion_nombre:    string;
  licitacion_organismo: string;
  licitacion_monto:     number | null;
  licitacion_cierre:    string | null;
  licitacion_estado:    string | null;
  licitacion_region:    string | null;
  licitacion_tipo:      string | null;
  leida:                boolean;
  created_at:           string;
}

interface Usuario  { id: number; nombre: string | null; email: string; empresa: string | null; }
interface Etiqueta { id: number; nombre: string; color: string; }

// ── Estados disponibles para filtrar ─────────────────────────────────────────
const ESTADOS_FILTER = [
  { key: 'Publicada',  label: 'Publicada',  colorClass: 'bg-emerald-500', textClass: 'text-emerald-700', bgLight: 'bg-emerald-50 border-emerald-200',  dot: '#10b981' },
  { key: 'Desierta',   label: 'Desierta',   colorClass: 'bg-amber-500',   textClass: 'text-amber-700',   bgLight: 'bg-amber-50  border-amber-200',    dot: '#f59e0b' },
  { key: 'Suspendida', label: 'Suspendida', colorClass: 'bg-blue-500',    textClass: 'text-blue-700',    bgLight: 'bg-blue-50   border-blue-200',     dot: '#3b82f6' },
  { key: 'Cerrada',    label: 'Cerrada',    colorClass: 'bg-zinc-400',    textClass: 'text-zinc-500',    bgLight: 'bg-zinc-50   border-zinc-200',     dot: '#9ca3af' },
  { key: 'Adjudicada', label: 'Adjudicada', colorClass: 'bg-violet-500',  textClass: 'text-violet-700',  bgLight: 'bg-violet-50 border-violet-200',   dot: '#8b5cf6' },
  { key: 'Revocada',   label: 'Revocada',   colorClass: 'bg-red-400',     textClass: 'text-red-700',     bgLight: 'bg-red-50    border-red-200',      dot: '#f87171' },
];

// Por defecto solo mostrar las que se pueden licitar
const ESTADOS_ACTIVOS_DEFAULT = ['Publicada', 'Desierta', 'Suspendida'];

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatMonto(m: number | null): string {
  if (!m) return '';
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(m);
}

function tiempoRelativo(fecha: string): string {
  const d = Math.floor((Date.now() - new Date(fecha).getTime()) / 60000);
  if (d < 1)  return 'ahora';
  if (d < 60) return `${d}m`;
  const h = Math.floor(d / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function EstadoBadge({ estado }: { estado: string | null }) {
  if (!estado) return null;
  const cfg = ESTADOS_FILTER.find(e => e.key.toLowerCase() === estado.toLowerCase());
  if (!cfg) return (
    <span className="text-[10px] px-1.5 py-px rounded-full bg-zinc-100 text-zinc-500 font-medium whitespace-nowrap">
      {estado}
    </span>
  );
  return (
    <span className={`text-[10px] px-1.5 py-px rounded-full border font-medium whitespace-nowrap ${cfg.bgLight} ${cfg.textClass}`}>
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
    <span className={`inline-flex items-center text-white text-[10px] font-black px-1.5 py-0.5 rounded flex-shrink-0 ${bg}`}
      title={info?.label}>
      {tipo}
    </span>
  );
}

// ── Highlight keyword ─────────────────────────────────────────────────────────
function HighlightText({ text, keyword }: { text: string; keyword: string }) {
  if (!keyword || !text) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <strong className="font-bold text-blue-700 not-italic">{text.slice(idx, idx + keyword.length)}</strong>
      {text.slice(idx + keyword.length)}
    </>
  );
}

// ── Modal Asignar ─────────────────────────────────────────────────────────────
function ModalAsignar({
  alerta, usuarios, etiquetas, onClose, onSuccess,
}: {
  alerta: Alerta; usuarios: Usuario[]; etiquetas: Etiqueta[];
  onClose: () => void; onSuccess: () => void;
}) {
  const { success: toastOk, error: toastErr } = useToast();
  const [usuarioId, setUsuarioId]     = useState<number | ''>('');
  const [etiquetaIds, setEtiquetaIds] = useState<number[]>([]);
  const [guardando, setGuardando]     = useState(false);
  const [exito, setExito]             = useState(false);

  const toggleEtiqueta = (id: number) =>
    setEtiquetaIds(p => p.includes(id) ? p.filter(e => e !== id) : [...p, id]);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [onClose]);

  const asignar = async () => {
    if (!usuarioId) return;
    setGuardando(true);
    try {
      const res = await fetch('/api/negocios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licitacion_codigo:    alerta.licitacion_codigo,
          licitacion_nombre:    alerta.licitacion_nombre,
          licitacion_organismo: alerta.licitacion_organismo,
          licitacion_monto:     alerta.licitacion_monto,
          licitacion_cierre:    alerta.licitacion_cierre,
          licitacion_estado:    alerta.licitacion_estado,
          licitacion_region:    alerta.licitacion_region,
          licitacion_tipo:      alerta.licitacion_tipo,
          asignado_a:           usuarioId,
          etiqueta_ids:         etiquetaIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toastErr('Error al asignar', data.error || `HTTP ${res.status}`); return; }
      setExito(true);
      toastOk('Asignado correctamente', 'Aparecerá en el panel Negocios del usuario');
      setTimeout(onSuccess, 800);
    } catch {
      toastErr('Error de conexión');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl scale-in overflow-hidden">
        <div className="flex justify-center pt-3 sm:hidden"><div className="w-10 h-1 bg-zinc-200 rounded-full" /></div>
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-blue-600/10 rounded-lg flex items-center justify-center">
              <UserPlus size={15} className="text-blue-600" />
            </div>
            <div>
              <h3 className="text-[14px] font-bold text-zinc-900 leading-none">Asignar a perfil</h3>
              <p className="text-[11px] text-zinc-400 mt-0.5">Agrega al pipeline de negocios</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700">
            <X size={14} />
          </button>
        </div>
        <div className="px-5 pb-5 space-y-4">
          <div className="bg-zinc-50 border border-zinc-200/60 rounded-xl p-3.5">
            <p className="text-[13px] font-semibold text-zinc-900 line-clamp-2 mb-1.5">
              {alerta.licitacion_nombre || alerta.licitacion_codigo}
            </p>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500">
              <span className="font-mono text-blue-600 font-semibold">{alerta.licitacion_codigo}</span>
              {alerta.licitacion_organismo && <span className="truncate">{alerta.licitacion_organismo}</span>}
              {alerta.licitacion_monto != null && (
                <span className="font-semibold text-zinc-700">{formatMonto(alerta.licitacion_monto)}</span>
              )}
            </div>
          </div>
          {exito ? (
            <div className="flex flex-col items-center py-6 gap-3 slide-in-up">
              <div className="w-14 h-14 rounded-2xl bg-emerald-100 flex items-center justify-center">
                <Check size={26} className="text-emerald-600" strokeWidth={2.5} />
              </div>
              <div className="text-center">
                <p className="font-bold text-zinc-900 text-[14px]">¡Listo!</p>
                <p className="text-[12px] text-zinc-500 mt-0.5">Aparecerá en Negocios del usuario</p>
              </div>
            </div>
          ) : (<>
            <div>
              <label className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5 block">Usuario destino *</label>
              <div className="relative">
                <select
                  value={usuarioId}
                  onChange={e => setUsuarioId(e.target.value ? parseInt(e.target.value) : '')}
                  className="w-full px-3.5 py-2.5 bg-white border border-zinc-200 rounded-xl text-[13px] text-zinc-800 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 outline-none appearance-none pr-9"
                >
                  <option value="">Selecciona un usuario...</option>
                  {usuarios.map(u => (
                    <option key={u.id} value={u.id}>{u.nombre || u.email.split('@')[0]}{u.empresa ? ` — ${u.empresa}` : ''}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
              </div>
            </div>
            {etiquetas.length > 0 && (
              <div>
                <label className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5 block">Líneas de negocio</label>
                <div className="flex flex-wrap gap-1.5">
                  {etiquetas.map(et => {
                    const sel = etiquetaIds.includes(et.id);
                    return (
                      <button key={et.id} type="button" onClick={() => toggleEtiqueta(et.id)}
                        style={sel ? { backgroundColor: et.color + '18', color: et.color, borderColor: et.color + '60' } : {}}
                        className={`inline-flex items-center gap-1 text-[12px] px-3 py-1 rounded-full border font-medium transition-all ${
                          sel ? 'shadow-sm' : 'border-zinc-200 text-zinc-500 hover:border-zinc-300'
                        }`}>
                        {sel && <Check size={10} strokeWidth={3} />}
                        {et.nombre}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button onClick={onClose}
                className="flex-1 px-4 py-2.5 border border-zinc-200 text-zinc-600 rounded-xl text-[13px] font-semibold hover:bg-zinc-50">
                Cancelar
              </button>
              <button onClick={asignar} disabled={guardando || !usuarioId}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-[13px] font-semibold hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm">
                {guardando ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                Asignar
              </button>
            </div>
          </>)}
        </div>
      </div>
    </div>
  );
}

// ── Card de alerta ────────────────────────────────────────────────────────────
function AlertaCard({
  alerta, esAdmin, onDelete, onAsignar, onMarcarLeida,
}: {
  alerta:       Alerta;
  esAdmin:      boolean;
  onDelete:     (id: number) => void;
  onAsignar:    (a: Alerta) => void;
  onMarcarLeida:(id: number) => void;
}) {
  const diasCierre = alerta.licitacion_cierre
    ? Math.ceil((new Date(alerta.licitacion_cierre).getTime() - Date.now()) / 86400000)
    : null;

  return (
    <div className={`
      group relative bg-white border transition-all duration-150
      hover:shadow-sm hover:border-zinc-300
      ${!alerta.leida ? 'border-l-[3px] border-l-blue-500 border-zinc-200/80' : 'border-zinc-100'}
    `}>
      <div className="flex items-center gap-2.5 px-3 py-2 min-h-[52px]">

        {/* Punto leído/no leído */}
        <button
          onClick={() => !alerta.leida && onMarcarLeida(alerta.id)}
          className="flex-shrink-0 w-4 flex items-center justify-center"
          title={alerta.leida ? 'Leída' : 'Marcar como leída'}
        >
          {!alerta.leida
            ? <span className="w-2 h-2 rounded-full bg-blue-500 block hover:bg-blue-300 transition-colors" />
            : <span className="w-2 h-2 rounded-full bg-zinc-200 block" />
          }
        </button>

        {/* Tipo badge */}
        <TipoBadge codigo={alerta.licitacion_codigo} />

        {/* Contenido principal */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Link
              href={`/licitacion/${encodeURIComponent(alerta.licitacion_codigo)}`}
              className="text-[13px] font-semibold text-zinc-900 hover:text-blue-600 transition-colors line-clamp-1 leading-snug flex-1 min-w-0"
              onClick={() => !alerta.leida && onMarcarLeida(alerta.id)}
            >
              <HighlightText text={alerta.licitacion_nombre || alerta.licitacion_codigo} keyword={alerta.keyword_texto} />
            </Link>
            {/* Keyword badge */}
            <span className="hidden sm:inline text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded font-bold border border-blue-100 whitespace-nowrap flex-shrink-0">
              {alerta.keyword_texto}
            </span>
          </div>
          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0 mt-0.5">
            {alerta.licitacion_organismo && (
              <span className="flex items-center gap-1 text-[11px] text-zinc-400 truncate max-w-[200px]">
                <Building2 size={9} className="flex-shrink-0" />
                {alerta.licitacion_organismo}
              </span>
            )}
            {alerta.licitacion_monto != null && alerta.licitacion_monto > 0 && (
              <span className="flex items-center gap-0.5 text-[11px] text-zinc-600 font-semibold">
                <DollarSign size={9} />
                {formatMonto(alerta.licitacion_monto)}
              </span>
            )}
            {diasCierre !== null && (
              <span className={`flex items-center gap-0.5 text-[11px] font-semibold ${
                diasCierre <= 0   ? 'text-zinc-400' :
                diasCierre <= 3   ? 'text-red-500'  :
                diasCierre <= 7   ? 'text-amber-500' : 'text-zinc-400'
              }`}>
                <Calendar size={9} />
                {diasCierre <= 0 ? 'Cierre pasado' : `${diasCierre}d`}
              </span>
            )}
            <EstadoBadge estado={alerta.licitacion_estado} />
          </div>
        </div>

        {/* Acciones */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {esAdmin && (
            <button
              onClick={() => onAsignar(alerta)}
              className="flex items-center gap-1 px-2 py-1.5 bg-blue-600 text-white text-[11px] font-bold rounded-lg hover:bg-blue-500 transition-all"
              title="Asignar a negocio"
            >
              <UserPlus size={11} />
              <span className="hidden sm:inline">Asignar</span>
            </button>
          )}
          <Link
            href={`/licitacion/${encodeURIComponent(alerta.licitacion_codigo)}`}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
            title="Ver detalle"
          >
            <ExternalLink size={12} />
          </Link>
          <button
            onClick={() => onDelete(alerta.id)}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-300 hover:text-red-500 hover:bg-red-50 transition-colors"
            title="Eliminar"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
function CardSkeleton() {
  return (
    <div className="bg-white border border-zinc-100 px-4 py-3">
      <div className="flex gap-3 items-center">
        <div className="w-2 h-2 rounded-full bg-zinc-200 flex-shrink-0" />
        <div className="w-8 h-5 bg-zinc-200 rounded flex-shrink-0 skeleton" />
        <div className="flex-1 space-y-1.5">
          <div className="skeleton h-3 w-3/4 rounded" />
          <div className="skeleton h-2.5 w-1/2 rounded" />
        </div>
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function RadarPage() {
  const { usuario }  = useSession();
  const toast        = useToast();
  const esAdmin      = usuario?.rol === 'admin';

  const [keywords,      setKeywords]      = useState<PalabraClave[]>([]);
  const [alertas,       setAlertas]       = useState<Alerta[]>([]);
  const [noLeidas,      setNoLeidas]      = useState(0);
  const [usuarios,      setUsuarios]      = useState<Usuario[]>([]);
  const [etiquetas,     setEtiquetas]     = useState<Etiqueta[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [loadingAlerts, setLoadingAlerts] = useState(true);
  const [nuevaKw,       setNuevaKw]       = useState('');
  const [agregando,     setAgregando]     = useState(false);
  const [actualizando,  setActualizando]  = useState(false);
  const [ultimaAct,     setUltimaAct]     = useState<string | null>(null);
  const [tab,           setTab]           = useState<'radar' | 'keywords'>('radar');
  const [filtroKw,      setFiltroKw]      = useState('');
  const [filtroTipo,    setFiltroTipo]    = useState('');
  const [filtroEstados, setFiltroEstados] = useState<string[]>(ESTADOS_ACTIVOS_DEFAULT);
  const [mostrarTodos,  setMostrarTodos]  = useState(false);
  const [modalAlerta,   setModalAlerta]   = useState<Alerta | null>(null);

  // ── Carga ─────────────────────────────────────────────────────────────────
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

  const cargarAlertas = useCallback(async () => {
    setLoadingAlerts(true);
    try {
      const d = await fetch('/api/alertas?limit=500').then(r => r.json());
      if (d.success) { setAlertas(d.alertas || []); setNoLeidas(d.noLeidas || 0); }
    } catch { /* silencioso */ }
    finally { setLoadingAlerts(false); }
  }, []);

  const cargarUsuariosEtiquetas = useCallback(async () => {
    if (!esAdmin) return;
    const [resU, resE] = await Promise.all([fetch('/api/admin/usuarios'), fetch('/api/etiquetas')]);
    const [dU, dE] = await Promise.all([resU.json(), resE.json()]);
    if (dU.success) setUsuarios(dU.usuarios || []);
    if (dE.success) setEtiquetas(dE.etiquetas || []);
  }, [esAdmin]);

  useEffect(() => {
    cargarKeywords();
    cargarAlertas();
    cargarUsuariosEtiquetas();
  }, [cargarKeywords, cargarAlertas, cargarUsuariosEtiquetas]);

  // ── Acciones ──────────────────────────────────────────────────────────────
  const actualizarAhora = async () => {
    if (actualizando) return;
    setActualizando(true);
    try {
      const secret = process.env.NEXT_PUBLIC_CRON_SECRET || '7f3a9b2e1d8c4f6a0e5b7d3c9a2f1e8b4d7c0a3f6e9b2d5c8a1f4e7b0d3c6a9f';
      const res    = await fetch('/api/cron/alertas', {
        headers: { Authorization: `Bearer ${secret}` },
        signal:  AbortSignal.timeout(58_000),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error('Error al actualizar', data.error || `HTTP ${res.status}`);
      } else if (data.alertasNuevas > 0) {
        toast.success(
          `${data.alertasNuevas} licitación${data.alertasNuevas !== 1 ? 'es' : ''} nueva${data.alertasNuevas !== 1 ? 's' : ''}`,
          `${data.licitacionesTotales ?? data.licitacionesDescargadas ?? '?'} analizadas · ${data.keywordsProcesadas} palabras clave`,
        );
      } else {
        toast.info('Sin resultados nuevos', `${data.licitacionesTotales ?? '?'} licitaciones analizadas`);
      }
      await Promise.all([cargarKeywords(), cargarAlertas()]);
      setUltimaAct(new Date().toISOString());
    } catch (err) {
      toast.error('Error de conexión', 'Revisa la consola (F12)');
      console.error('[Radar] error:', err);
    } finally {
      setActualizando(false);
    }
  };

  const agregarKeyword = async (e: React.FormEvent) => {
    e.preventDefault();
    const kw = nuevaKw.trim().toLowerCase();
    if (!kw) return;
    setAgregando(true);
    try {
      const res  = await fetch('/api/palabras-clave', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keyword: kw }) });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Error al agregar'); return; }
      setNuevaKw('');
      toast.success(`"${kw}" agregada`);
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

  const eliminarKeyword = async (id: number) => {
    if (!confirm('¿Eliminar esta palabra clave y todas sus alertas?')) return;
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

  const marcarLeida = async (id: number) => {
    try {
      await fetch('/api/alertas', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [id] }) });
      setAlertas(prev => prev.map(a => a.id === id ? { ...a, leida: true } : a));
      setNoLeidas(prev => Math.max(0, prev - 1));
    } catch { /* silencioso */ }
  };

  const eliminarAlerta = async (id: number) => {
    try {
      await fetch(`/api/alertas?id=${id}`, { method: 'DELETE' });
      setAlertas(prev => prev.filter(a => a.id !== id));
    } catch { toast.error('Error al eliminar'); }
  };

  const toggleEstadoFiltro = (key: string) => {
    setFiltroEstados(prev =>
      prev.includes(key) ? prev.filter(e => e !== key) : [...prev, key]
    );
  };

  // ── Derivados ─────────────────────────────────────────────────────────────
  const alertasFiltradas = alertas.filter(a => {
    const matchKw     = !filtroKw    || a.keyword_texto === filtroKw;
    const tipoAlerta  = extractTipoFromCodigo(a.licitacion_codigo);
    const matchTipo   = !filtroTipo  || tipoAlerta === filtroTipo;
    const estadoNorm  = (a.licitacion_estado || '').trim();
    const matchEstado = mostrarTodos || filtroEstados.length === 0 || filtroEstados.some(f => estadoNorm.toLowerCase() === f.toLowerCase());
    return matchKw && matchTipo && matchEstado;
  });

  const alertasNoLeidas = alertasFiltradas.filter(a => !a.leida);
  const alertasLeidas   = alertasFiltradas.filter(a => a.leida);
  const kwsUnicas       = [...new Set(alertas.map(a => a.keyword_texto))].sort();
  const tiposEnAlertas  = [...new Set(alertas.map(a => extractTipoFromCodigo(a.licitacion_codigo)).filter(Boolean))].sort();
  const activeKws       = keywords.filter(k => k.activo).length;

  // Conteo por estado (sobre todas las alertas sin filtro de estado)
  const conteoEstados = ESTADOS_FILTER.reduce((acc, e) => {
    acc[e.key] = alertas.filter(a => (a.licitacion_estado || '').toLowerCase() === e.key.toLowerCase()).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Radar' }]}>
      <div className="p-4 sm:p-6 lg:p-8 h-full">

        {/* ── Header ────────────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center shadow-lg shadow-blue-600/25 flex-shrink-0">
              <Radar size={18} className="text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-zinc-900">Radar</h1>
                {noLeidas > 0 && (
                  <span className="bg-blue-600 text-white text-[11px] font-bold px-2 py-0.5 rounded-full tabular-nums">{noLeidas}</span>
                )}
              </div>
              <p className="text-[12px] text-zinc-400 mt-px flex items-center gap-1.5">
                <span>{activeKws} palabra{activeKws !== 1 ? 's' : ''} activa{activeKws !== 1 ? 's' : ''}</span>
                {ultimaAct && (
                  <span className="flex items-center gap-0.5">
                    <Clock size={9} /> {tiempoRelativo(ultimaAct)}
                  </span>
                )}
              </p>
            </div>
          </div>
          <button
            onClick={actualizarAhora}
            disabled={actualizando || activeKws === 0}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-all flex-shrink-0 ${
              actualizando || activeKws === 0
                ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-500 text-white shadow-sm shadow-blue-600/30 hover:-translate-y-px'
            }`}
          >
            {actualizando ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
            {actualizando ? 'Buscando…' : 'Actualizar ahora'}
          </button>
        </div>

        {/* ── Tabs ──────────────────────────────────────────────────────────── */}
        <div className="flex gap-0 mb-0 border-b border-zinc-200">
          {([
            { key: 'radar',    label: 'Licitaciones', count: alertas.length },
            { key: 'keywords', label: 'Palabras clave', count: keywords.length },
          ] as const).map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`relative flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold transition-colors pb-[11px] ${
                tab === t.key ? 'text-zinc-900' : 'text-zinc-400 hover:text-zinc-600'
              }`}
            >
              {t.label}
              {t.count > 0 && (
                <span className={`text-[11px] px-1.5 py-px rounded-full font-bold tabular-nums ${
                  t.key === 'radar' && noLeidas > 0 ? 'bg-blue-600 text-white' : 'bg-zinc-100 text-zinc-500'
                }`}>{t.count}</span>
              )}
              {tab === t.key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-zinc-900 rounded-full" />}
            </button>
          ))}
        </div>

        {/* ─────────────────── TAB RADAR ─────────────────────────────────── */}
        {tab === 'radar' && (
          <div className="pt-4">
            {loadingAlerts ? (
              <div className="space-y-px border border-zinc-100 rounded-xl overflow-hidden">
                {[1,2,3,4,5].map(i => <CardSkeleton key={i} />)}
              </div>
            ) : alertas.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center bg-white rounded-xl border border-zinc-100">
                <div className="w-16 h-16 bg-zinc-100 rounded-2xl flex items-center justify-center mb-4">
                  <BellOff size={26} className="text-zinc-400" />
                </div>
                <h3 className="text-[15px] font-bold text-zinc-800 mb-1.5">Sin resultados aún</h3>
                <p className="text-[13px] text-zinc-400 max-w-xs">
                  {keywords.length === 0
                    ? 'Agrega palabras clave y el Radar buscará automáticamente cada 4 horas'
                    : 'Pulsa "Actualizar ahora" para buscar licitaciones ahora mismo'
                  }
                </p>
                {keywords.length === 0 && (
                  <button onClick={() => setTab('keywords')}
                    className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl text-[13px] font-semibold hover:bg-blue-500">
                    <Plus size={14} /> Agregar palabras clave
                  </button>
                )}
              </div>
            ) : (
              <>
                {/* ── Panel de filtros ──────────────────────────────────────── */}
                <div className="bg-white border border-zinc-200 rounded-xl p-3 mb-3 space-y-3">

                  {/* Filtro por Estado */}
                  <div className="flex items-start gap-3 flex-wrap">
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider pt-0.5 whitespace-nowrap">
                      <Filter size={10} /> Estado
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {ESTADOS_FILTER.map(e => {
                        const cnt    = conteoEstados[e.key] || 0;
                        if (cnt === 0) return null;
                        const activo = mostrarTodos ? false : filtroEstados.includes(e.key);
                        return (
                          <button
                            key={e.key}
                            onClick={() => { setMostrarTodos(false); toggleEstadoFiltro(e.key); }}
                            className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border font-semibold transition-all ${
                              activo
                                ? `${e.colorClass} text-white border-transparent`
                                : 'bg-white border-zinc-200 text-zinc-500 hover:border-zinc-400'
                            }`}
                          >
                            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: activo ? 'rgba(255,255,255,0.8)' : e.dot }} />
                            {e.label}
                            <span className={`${activo ? 'text-white/70' : 'text-zinc-400'} tabular-nums`}>{cnt}</span>
                          </button>
                        );
                      })}
                      <button
                        onClick={() => setMostrarTodos(t => !t)}
                        className={`text-[11px] px-2.5 py-1 rounded-full border font-semibold transition-all ${
                          mostrarTodos
                            ? 'bg-zinc-800 text-white border-zinc-800'
                            : 'bg-white border-zinc-200 text-zinc-500 hover:border-zinc-400'
                        }`}
                      >
                        Todos · {alertas.length}
                      </button>
                    </div>
                  </div>

                  {/* Filtro por Tipo */}
                  {tiposEnAlertas.length > 1 && (
                    <div className="flex items-start gap-3 flex-wrap border-t border-zinc-100 pt-2.5">
                      <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider pt-0.5 whitespace-nowrap">Tipo</span>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          onClick={() => setFiltroTipo('')}
                          className={`text-[11px] px-2.5 py-0.5 rounded-full border font-bold transition-all ${
                            !filtroTipo ? 'bg-zinc-800 text-white border-zinc-800' : 'border-zinc-200 text-zinc-500 hover:border-zinc-400'
                          }`}
                        >
                          Todos
                        </button>
                        {tiposEnAlertas.map(t => {
                          const info = getTipoLicitacion(t);
                          const bg   = TIPO_COLOR_CLASS[t] || 'bg-gray-400';
                          const cnt  = alertas.filter(a => extractTipoFromCodigo(a.licitacion_codigo) === t).length;
                          return (
                            <button key={t} onClick={() => setFiltroTipo(filtroTipo === t ? '' : t)}
                              title={info?.label}
                              className={`text-[11px] px-2.5 py-0.5 rounded-full border font-bold transition-all ${
                                filtroTipo === t ? `${bg} text-white border-transparent` : 'border-zinc-200 text-zinc-500 hover:border-zinc-400'
                              }`}
                            >
                              {t} · {cnt}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Filtro por Keyword */}
                  {kwsUnicas.length > 1 && (
                    <div className="flex items-start gap-3 flex-wrap border-t border-zinc-100 pt-2.5">
                      <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider pt-0.5 whitespace-nowrap">
                        <Tag size={10} className="inline mr-0.5" />Keyword
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          onClick={() => setFiltroKw('')}
                          className={`text-[12px] px-2.5 py-0.5 rounded-full border font-semibold transition-all ${
                            !filtroKw ? 'bg-zinc-900 text-white border-zinc-900' : 'border-zinc-200 text-zinc-500 hover:border-zinc-400'
                          }`}
                        >
                          Todas
                        </button>
                        {kwsUnicas.map(kw => {
                          const cnt = alertas.filter(a => a.keyword_texto === kw).length;
                          const sel = filtroKw === kw;
                          return (
                            <button key={kw} onClick={() => setFiltroKw(sel ? '' : kw)}
                              className={`text-[12px] px-2.5 py-0.5 rounded-full border font-semibold transition-all ${
                                sel ? 'bg-blue-600 text-white border-blue-600' : 'border-zinc-200 text-zinc-500 hover:border-zinc-400'
                              }`}
                            >
                              {kw} · {cnt}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Barra de acciones ─────────────────────────────────────── */}
                <div className="flex items-center justify-between mb-2 px-1">
                  <p className="text-[12px] text-zinc-400">
                    <strong className="text-zinc-600">{alertasFiltradas.length}</strong> resultado{alertasFiltradas.length !== 1 ? 's' : ''}
                    {filtroKw && (
                      <span> · <button onClick={() => setFiltroKw('')} className="text-blue-600 hover:underline">quitar filtro</button></span>
                    )}
                  </p>
                  <div className="flex items-center gap-2">
                    {noLeidas > 0 && (
                      <button onClick={marcarTodasLeidas}
                        className="flex items-center gap-1.5 text-[12px] text-zinc-500 hover:text-blue-600 transition-colors">
                        <CheckCheck size={13} /> Marcar como leídas
                      </button>
                    )}
                  </div>
                </div>

                {/* ── Lista ─────────────────────────────────────────────────── */}
                {alertasFiltradas.length === 0 ? (
                  <div className="text-center py-16 bg-white rounded-xl border border-zinc-100">
                    <p className="text-[14px] font-semibold text-zinc-700 mb-1">Sin resultados con estos filtros</p>
                    <p className="text-[12px] text-zinc-400 mb-3">Prueba activando estados adicionales como "Cerrada" o "Adjudicada"</p>
                    <button onClick={() => setMostrarTodos(true)}
                      className="text-[12px] text-blue-600 hover:underline">
                      Ver todas las licitaciones
                    </button>
                  </div>
                ) : (
                  <div className="border border-zinc-200 rounded-xl overflow-hidden divide-y divide-zinc-100">
                    {alertasNoLeidas.map(a => (
                      <AlertaCard key={a.id} alerta={a} esAdmin={esAdmin}
                        onDelete={eliminarAlerta} onAsignar={setModalAlerta} onMarcarLeida={marcarLeida} />
                    ))}
                    {alertasLeidas.length > 0 && alertasNoLeidas.length > 0 && (
                      <div className="flex items-center gap-3 px-4 py-2 bg-zinc-50">
                        <div className="flex-1 h-px bg-zinc-200" />
                        <span className="text-[11px] text-zinc-400 font-medium flex-shrink-0">
                          {alertasLeidas.length} ya leída{alertasLeidas.length !== 1 ? 's' : ''}
                        </span>
                        <div className="flex-1 h-px bg-zinc-200" />
                      </div>
                    )}
                    {alertasLeidas.map(a => (
                      <AlertaCard key={a.id} alerta={a} esAdmin={esAdmin}
                        onDelete={eliminarAlerta} onAsignar={setModalAlerta} onMarcarLeida={marcarLeida} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ─────────────────── TAB KEYWORDS ──────────────────────────────── */}
        {tab === 'keywords' && (
          <div className="pt-4 max-w-2xl">

            {/* Form agregar */}
            <form onSubmit={agregarKeyword} className="flex gap-2 mb-5">
              <div className="relative flex-1">
                <Tag size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                <input
                  type="text"
                  value={nuevaKw}
                  onChange={e => setNuevaKw(e.target.value)}
                  placeholder='Ej: "materiales de construcción", "cancha", "tractor"'
                  className="w-full pl-9 pr-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-[13px] placeholder:text-zinc-400 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 outline-none"
                  maxLength={100}
                />
              </div>
              <button type="submit" disabled={agregando || !nuevaKw.trim()}
                className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-[13px] font-semibold hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm">
                {agregando ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Agregar
              </button>
            </form>

            {/* Info banner */}
            <div className="flex items-start gap-3 bg-blue-50 border border-blue-200/60 rounded-xl px-4 py-3.5 mb-5">
              <Sparkles size={15} className="text-blue-500 flex-shrink-0 mt-0.5" />
              <div className="text-[12.5px] text-blue-800 leading-relaxed space-y-1">
                <p><strong className="font-semibold">¿Cómo funciona el Radar?</strong></p>
                <p>Descarga licitaciones activas desde Mercado Público y busca tus palabras clave en el <strong>título</strong> y la <strong>descripción</strong> de cada licitación. La búsqueda es en mayúsculas y minúsculas al mismo tiempo.</p>
                <p className="text-blue-600">⚡ Se ejecuta automáticamente cada 4 horas. Los resultados se acumulan — nunca se borran los anteriores.</p>
                <p className="text-blue-500/80 text-[11.5px]">Nota: la descripción completa puede no estar disponible en todas las licitaciones según lo que devuelve la API oficial de Mercado Público.</p>
              </div>
            </div>

            {/* Keywords list */}
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
              <div className="space-y-2">
                {keywords.map(kw => (
                  <div key={kw.id} className={`flex items-center gap-3 bg-white rounded-xl border px-4 py-3 transition-all ${
                    kw.activo ? 'border-zinc-200 shadow-sm hover:shadow-md hover:-translate-y-px' : 'border-zinc-200/50 opacity-50'
                  }`}>
                    <button onClick={() => toggleKeyword(kw.id, kw.activo)}
                      className="flex-shrink-0 transition-transform hover:scale-105"
                      title={kw.activo ? 'Pausar' : 'Activar'}>
                      {kw.activo
                        ? <ToggleRight size={26} className="text-blue-600" />
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
                      <span className="bg-blue-600 text-white text-[11px] font-bold px-2 py-0.5 rounded-full flex-shrink-0">
                        {kw.resultados_nuevos} nuevas
                      </span>
                    )}
                    <button onClick={() => eliminarKeyword(kw.id)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal */}
      {modalAlerta && (
        <ModalAsignar
          alerta={modalAlerta}
          usuarios={usuarios}
          etiquetas={etiquetas}
          onClose={() => setModalAlerta(null)}
          onSuccess={() => {
            setModalAlerta(null);
            setAlertas(prev => prev.map(a => a.id === modalAlerta.id ? { ...a, leida: true } : a));
          }}
        />
      )}
    </AppLayout>
  );
}
