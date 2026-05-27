'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import { useToast }  from '@/app/components/ui/toast';
import { useSession } from '@/app/lib/session-context';
import {
  Radar, Plus, Trash2, ExternalLink, AlertCircle, Tag,
  CheckCheck, Building2, Calendar, DollarSign, Loader2,
  BellOff, UserPlus, X, Check, Clock, ChevronDown, Search,
  Zap, ToggleLeft, ToggleRight, Sparkles,
} from 'lucide-react';

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

interface Usuario {
  id:      number;
  nombre:  string | null;
  email:   string;
  empresa: string | null;
}

interface Etiqueta {
  id:     number;
  nombre: string;
  color:  string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatMonto(m: number | null): string {
  if (!m) return '';
  return new Intl.NumberFormat('es-CL', {
    style: 'currency', currency: 'CLP', maximumFractionDigits: 0,
  }).format(m);
}

function tiempoRelativo(fecha: string): string {
  const d = Math.floor((Date.now() - new Date(fecha).getTime()) / 60000);
  if (d < 1)  return 'hace un momento';
  if (d < 60) return `hace ${d} min`;
  const h = Math.floor(d / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

function getTipoFromCodigo(codigo: string): string | null {
  const m = codigo.match(/-([A-Za-z]+)\d+$/);
  return m ? m[1].toUpperCase() : null;
}

const TIPO_STYLES: Record<string, { dot: string; label: string }> = {
  LE: { dot: 'bg-red-400',    label: 'Licitación Privada' },
  LP: { dot: 'bg-blue-400',   label: 'Licitación Pública' },
  LQ: { dot: 'bg-amber-400',  label: 'L. Menor Cuantía' },
  CO: { dot: 'bg-purple-400', label: 'Convenio Marco' },
  SU: { dot: 'bg-teal-400',   label: 'Subasta Inversa' },
  L1: { dot: 'bg-pink-400',   label: 'L. Ínfima Cuantía' },
};

function TipoBadge({ codigo }: { codigo: string }) {
  const tipo = getTipoFromCodigo(codigo);
  if (!tipo) return null;
  const t2    = tipo.slice(0, 2);
  const style = TIPO_STYLES[t2] ?? { dot: 'bg-zinc-400', label: tipo };
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-500">
      <span className={`w-1.5 h-1.5 rounded-full ${style.dot} flex-shrink-0`} />
      {t2}
    </span>
  );
}

// ── Modal Asignar ─────────────────────────────────────────────────────────────
function ModalAsignar({
  alerta,
  usuarios,
  etiquetas,
  onClose,
  onSuccess,
}: {
  alerta:    Alerta;
  usuarios:  Usuario[];
  etiquetas: Etiqueta[];
  onClose:   () => void;
  onSuccess: () => void;
}) {
  const { success: toastOk, error: toastErr } = useToast();
  const [usuarioId, setUsuarioId]     = useState<number | ''>('');
  const [etiquetaIds, setEtiquetaIds] = useState<number[]>([]);
  const [guardando, setGuardando]     = useState(false);
  const [exito, setExito]             = useState(false);

  const toggleEtiqueta = (id: number) =>
    setEtiquetaIds(p => p.includes(id) ? p.filter(e => e !== id) : [...p, id]);

  // Cerrar con Escape
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
      if (!res.ok) {
        toastErr('Error al asignar', data.error || `HTTP ${res.status}`);
        return;
      }
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

        {/* Handle (mobile) */}
        <div className="flex justify-center pt-3 sm:hidden">
          <div className="w-10 h-1 bg-zinc-200 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-blue-600/10 rounded-lg flex items-center justify-center">
              <UserPlus size={15} className="text-blue-600" />
            </div>
            <div>
              <h3 className="text-[14px] font-bold text-zinc-900 leading-none">Asignar a perfil</h3>
              <p className="text-[11px] text-zinc-400 mt-0.5">Agrega esta oportunidad al pipeline</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700 transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-4">
          {/* Licitación info */}
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
            {/* Selector usuario */}
            <div>
              <label className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5 block">
                Usuario destino *
              </label>
              <div className="relative">
                <select
                  value={usuarioId}
                  onChange={e => setUsuarioId(e.target.value ? parseInt(e.target.value) : '')}
                  className="w-full px-3.5 py-2.5 bg-white border border-zinc-200 rounded-xl text-[13px] text-zinc-800 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 outline-none appearance-none pr-9 transition-colors"
                >
                  <option value="">Selecciona un usuario...</option>
                  {usuarios.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.nombre || u.email.split('@')[0]}{u.empresa ? ` — ${u.empresa}` : ''}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
              </div>
            </div>

            {/* Etiquetas */}
            {etiquetas.length > 0 && (
              <div>
                <label className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5 block">
                  Líneas de negocio
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {etiquetas.map(et => {
                    const sel = etiquetaIds.includes(et.id);
                    return (
                      <button
                        key={et.id}
                        type="button"
                        onClick={() => toggleEtiqueta(et.id)}
                        style={sel ? {
                          backgroundColor: et.color + '18',
                          color:           et.color,
                          borderColor:     et.color + '60',
                        } : {}}
                        className={`inline-flex items-center gap-1 text-[12px] px-3 py-1 rounded-full border font-medium transition-all ${
                          sel
                            ? 'shadow-sm'
                            : 'border-zinc-200 text-zinc-500 hover:border-zinc-300 hover:text-zinc-700'
                        }`}
                      >
                        {sel && <Check size={10} strokeWidth={3} />}
                        {et.nombre}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2.5 border border-zinc-200 text-zinc-600 rounded-xl text-[13px] font-semibold hover:bg-zinc-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={asignar}
                disabled={guardando || !usuarioId}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-[13px] font-semibold hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm shadow-blue-600/20"
              >
                {guardando
                  ? <Loader2 size={14} className="animate-spin" />
                  : <UserPlus size={14} />
                }
                Asignar
              </button>
            </div>
          </>)}
        </div>
      </div>
    </div>
  );
}

// ── AlertaCard ────────────────────────────────────────────────────────────────
function AlertaCard({
  alerta,
  esAdmin,
  onDelete,
  onAsignar,
}: {
  alerta:   Alerta;
  esAdmin:  boolean;
  onDelete: (id: number) => void;
  onAsignar: (a: Alerta) => void;
}) {
  const diasCierre = alerta.licitacion_cierre
    ? Math.ceil((new Date(alerta.licitacion_cierre).getTime() - Date.now()) / 86400000)
    : null;

  return (
    <div className={`
      group relative bg-white rounded-xl border transition-all duration-200
      hover:shadow-md hover:-translate-y-px
      ${!alerta.leida
        ? 'border-zinc-200 shadow-sm border-l-[3px] border-l-blue-500'
        : 'border-zinc-200/70'
      }
    `}>
      <div className="flex items-start gap-3 px-4 py-3.5">
        {/* Punto no leído */}
        <div className="flex-shrink-0 mt-[6px]">
          {!alerta.leida
            ? <span className="w-1.5 h-1.5 rounded-full bg-blue-500 block shadow-sm shadow-blue-500/60" />
            : <span className="w-1.5 h-1.5 block" />
          }
        </div>

        <div className="flex-1 min-w-0">
          {/* Título + keyword */}
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <Link
              href={`/licitacion/${encodeURIComponent(alerta.licitacion_codigo)}`}
              className="text-[13.5px] font-semibold text-zinc-900 hover:text-blue-600 transition-colors line-clamp-2 leading-snug"
            >
              {alerta.licitacion_nombre || alerta.licitacion_codigo}
            </Link>
            <span className="text-[11px] px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full font-semibold border border-blue-100 whitespace-nowrap flex-shrink-0">
              {alerta.keyword_texto}
            </span>
          </div>

          {/* Meta */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <TipoBadge codigo={alerta.licitacion_codigo} />

            {alerta.licitacion_organismo && (
              <span className="flex items-center gap-1 text-[12px] text-zinc-400 truncate max-w-[200px]">
                <Building2 size={11} className="flex-shrink-0" />
                {alerta.licitacion_organismo}
              </span>
            )}

            {alerta.licitacion_monto != null && (
              <span className="flex items-center gap-1 text-[12px] text-zinc-600 font-semibold">
                <DollarSign size={11} />
                {formatMonto(alerta.licitacion_monto)}
              </span>
            )}

            {diasCierre !== null && (
              <span className={`flex items-center gap-1 text-[12px] font-semibold ${
                diasCierre <= 0 ? 'text-zinc-400' :
                diasCierre <= 3 ? 'text-red-500' :
                diasCierre <= 7 ? 'text-amber-500' :
                                  'text-zinc-400'
              }`}>
                <Calendar size={11} />
                {diasCierre <= 0 ? 'Cerrada' : `${diasCierre}d`}
              </span>
            )}

            {alerta.licitacion_estado && (
              <span className={`text-[11px] px-1.5 py-px rounded-full font-medium ${
                alerta.licitacion_estado.toLowerCase().includes('public')
                  ? 'bg-emerald-50 text-emerald-600 border border-emerald-200/60'
                  : 'bg-zinc-100 text-zinc-500'
              }`}>
                {alerta.licitacion_estado}
              </span>
            )}
          </div>
        </div>

        {/* Acciones */}
        <div className="flex items-center gap-1 flex-shrink-0 ml-1">
          {esAdmin && (
            <button
              onClick={() => onAsignar(alerta)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-600 text-white text-[12px] font-semibold rounded-lg hover:bg-blue-500 transition-all shadow-sm shadow-blue-600/20"
            >
              <UserPlus size={12} />
              <span className="hidden sm:inline">Asignar</span>
            </button>
          )}
          <Link
            href={`/licitacion/${encodeURIComponent(alerta.licitacion_codigo)}`}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
          >
            <ExternalLink size={13} />
          </Link>
          <button
            onClick={() => onDelete(alerta.id)}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 transition-colors"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
function CardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-zinc-200/70 px-4 py-3.5">
      <div className="flex gap-3 items-start">
        <div className="w-1.5 h-1.5 rounded-full bg-zinc-200 mt-1.5 flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="skeleton h-3.5 w-3/4 rounded" />
          <div className="skeleton h-3 w-1/2 rounded" />
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

  const [keywords,   setKeywords]   = useState<PalabraClave[]>([]);
  const [alertas,    setAlertas]    = useState<Alerta[]>([]);
  const [noLeidas,   setNoLeidas]   = useState(0);
  const [usuarios,   setUsuarios]   = useState<Usuario[]>([]);
  const [etiquetas,  setEtiquetas]  = useState<Etiqueta[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [loadingAlerts, setLoadingAlerts] = useState(true);
  const [nuevaKw,    setNuevaKw]    = useState('');
  const [agregando,  setAgregando]  = useState(false);
  const [actualizando, setActualizando] = useState(false);
  const [ultimaAct,  setUltimaAct]  = useState<string | null>(null);
  const [tab,        setTab]        = useState<'radar' | 'keywords'>('radar');
  const [filtroKw,   setFiltroKw]   = useState('');
  const [modalAlerta, setModalAlerta] = useState<Alerta | null>(null);

  // ── Carga ────────────────────────────────────────────────────────────────────
  const cargarKeywords = useCallback(async () => {
    try {
      const d = await fetch('/api/palabras-clave').then(r => r.json());
      if (d.success) {
        setKeywords(d.keywords || []);
        const fechas = (d.keywords || [])
          .map((k: PalabraClave) => k.ultima_busqueda).filter(Boolean).sort().reverse();
        if (fechas[0]) setUltimaAct(fechas[0]);
      }
    } catch { /* silencioso */ }
    finally { setLoading(false); }
  }, []);

  const cargarAlertas = useCallback(async () => {
    setLoadingAlerts(true);
    try {
      const d = await fetch('/api/alertas?limit=200').then(r => r.json());
      if (d.success) { setAlertas(d.alertas || []); setNoLeidas(d.noLeidas || 0); }
    } catch { /* silencioso */ }
    finally { setLoadingAlerts(false); }
  }, []);

  const cargarUsuariosEtiquetas = useCallback(async () => {
    if (!esAdmin) return;
    const [resU, resE] = await Promise.all([
      fetch('/api/admin/usuarios'), fetch('/api/etiquetas'),
    ]);
    const [dU, dE] = await Promise.all([resU.json(), resE.json()]);
    if (dU.success) setUsuarios(dU.usuarios || []);
    if (dE.success) setEtiquetas(dE.etiquetas || []);
  }, [esAdmin]);

  useEffect(() => {
    cargarKeywords();
    cargarAlertas();
    cargarUsuariosEtiquetas();
  }, [cargarKeywords, cargarAlertas, cargarUsuariosEtiquetas]);

  // ── Acciones ─────────────────────────────────────────────────────────────────
  const actualizarAhora = async () => {
    if (actualizando) return;
    setActualizando(true);
    try {
      const secret = process.env.NEXT_PUBLIC_CRON_SECRET
        || '7f3a9b2e1d8c4f6a0e5b7d3c9a2f1e8b4d7c0a3f6e9b2d5c8a1f4e7b0d3c6a9f';

      const res  = await fetch('/api/cron/alertas', {
        headers: { Authorization: `Bearer ${secret}` },
        signal:  AbortSignal.timeout(58_000),
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error('Error al actualizar', data.error || `HTTP ${res.status}`);
      } else if (data.alertasNuevas > 0) {
        toast.success(
          `${data.alertasNuevas} licitación${data.alertasNuevas !== 1 ? 'es' : ''} nueva${data.alertasNuevas !== 1 ? 's' : ''}`,
          `${data.licitacionesDescargadas} analizadas · ${data.keywordsProcesadas} palabras clave`,
        );
      } else {
        toast.info(
          'Sin resultados nuevos',
          `${data.licitacionesDescargadas ?? '?'} licitaciones analizadas · ${data.keywordsProcesadas} palabras clave`,
        );
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
      const res  = await fetch('/api/palabras-clave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: kw }),
      });
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
      await fetch('/api/palabras-clave', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id, activo: !activo }),
      });
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
      await fetch('/api/alertas', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      setAlertas(prev => prev.map(a => ({ ...a, leida: true })));
      setNoLeidas(0);
      toast.success('Todas marcadas como leídas');
    } catch { toast.error('Error'); }
  };

  const eliminarAlerta = async (id: number) => {
    try {
      await fetch(`/api/alertas?id=${id}`, { method: 'DELETE' });
      setAlertas(prev => prev.filter(a => a.id !== id));
    } catch { toast.error('Error al eliminar'); }
  };

  // ── Derivados ─────────────────────────────────────────────────────────────────
  const alertasFiltradas  = filtroKw ? alertas.filter(a => a.keyword_texto === filtroKw) : alertas;
  const alertasNoLeidas   = alertasFiltradas.filter(a => !a.leida);
  const alertasLeidas     = alertasFiltradas.filter(a => a.leida);
  const kwsUnicas         = [...new Set(alertas.map(a => a.keyword_texto))].sort();
  const activeKws         = keywords.filter(k => k.activo).length;

  return (
    <AppLayout breadcrumb={[
      { label: 'Dashboard', href: '/dashboard' },
      { label: 'Radar' },
    ]}>
      <div className="p-5 sm:p-7 max-w-4xl">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-7">
          <div className="flex items-center gap-3.5">
            {/* Icon */}
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center shadow-lg shadow-blue-600/25 flex-shrink-0">
              <Radar size={18} className="text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-[20px] font-bold text-zinc-900 tracking-tight">
                  Radar
                </h1>
                {noLeidas > 0 && (
                  <span className="bg-blue-600 text-white text-[11px] font-bold px-2 py-0.5 rounded-full tabular-nums">
                    {noLeidas}
                  </span>
                )}
              </div>
              <p className="text-[13px] text-zinc-400 mt-px">
                {activeKws} palabra{activeKws !== 1 ? 's' : ''} activa{activeKws !== 1 ? 's' : ''}
                {ultimaAct && (
                  <span className="ml-2 inline-flex items-center gap-1">
                    <Clock size={10} />
                    {tiempoRelativo(ultimaAct)}
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* Update button */}
          <button
            onClick={actualizarAhora}
            disabled={actualizando || activeKws === 0}
            className={`
              inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold
              transition-all duration-200 flex-shrink-0
              ${actualizando || activeKws === 0
                ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-500 text-white shadow-sm shadow-blue-600/30 hover:shadow-blue-500/40 hover:-translate-y-px'
              }
            `}
          >
            {actualizando
              ? <Loader2 size={14} className="animate-spin" />
              : <Zap size={14} />
            }
            {actualizando ? 'Buscando…' : 'Actualizar ahora'}
          </button>
        </div>

        {/* ── Tabs ────────────────────────────────────────────────────────── */}
        <div className="flex gap-0 mb-6 border-b border-zinc-200">
          {([
            { key: 'radar',    label: 'Licitaciones',  count: noLeidas },
            { key: 'keywords', label: 'Palabras clave', count: keywords.length },
          ] as const).map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`
                relative flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold
                transition-colors pb-[11px]
                ${tab === t.key ? 'text-zinc-900' : 'text-zinc-400 hover:text-zinc-600'}
              `}
            >
              {t.label}
              {t.count > 0 && (
                <span className={`text-[11px] px-1.5 py-px rounded-full font-bold tabular-nums ${
                  t.key === 'radar' && noLeidas > 0
                    ? 'bg-blue-600 text-white'
                    : 'bg-zinc-100 text-zinc-500'
                }`}>
                  {t.count}
                </span>
              )}
              {/* Active underline */}
              {tab === t.key && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-zinc-900 rounded-full" />
              )}
            </button>
          ))}
        </div>

        {/* ─────────────────── TAB RADAR ─────────────────────────────────── */}
        {tab === 'radar' && (
          <div>
            {loadingAlerts ? (
              <div className="space-y-2">
                {[1, 2, 3, 4].map(i => <CardSkeleton key={i} />)}
              </div>
            ) : alertas.length === 0 ? (
              /* Empty state */
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-16 h-16 bg-zinc-100 rounded-2xl flex items-center justify-center mb-4">
                  <BellOff size={26} className="text-zinc-400" />
                </div>
                <h3 className="text-[15px] font-bold text-zinc-800 mb-1.5">Sin resultados aún</h3>
                <p className="text-[13px] text-zinc-400 max-w-xs">
                  {keywords.length === 0
                    ? 'Agrega palabras clave y el Radar buscará automáticamente cada 4 horas'
                    : 'Pulsa "Actualizar ahora" para buscar licitaciones en este momento'
                  }
                </p>
                {keywords.length === 0 && (
                  <button
                    onClick={() => setTab('keywords')}
                    className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl text-[13px] font-semibold hover:bg-blue-500 transition-colors shadow-sm"
                  >
                    <Plus size={14} /> Agregar palabras clave
                  </button>
                )}
              </div>
            ) : (
              <>
                {/* Barra de acciones */}
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[12px] text-zinc-400">
                    {alertasFiltradas.length} resultado{alertasFiltradas.length !== 1 ? 's' : ''}
                    {filtroKw && <span> · <button onClick={() => setFiltroKw('')} className="text-blue-600 hover:underline">Ver todos</button></span>}
                  </p>
                  {noLeidas > 0 && (
                    <button
                      onClick={marcarTodasLeidas}
                      className="flex items-center gap-1.5 text-[12px] text-zinc-500 hover:text-blue-600 transition-colors"
                    >
                      <CheckCheck size={13} /> Marcar como leídas
                    </button>
                  )}
                </div>

                {/* Chips de filtro por keyword */}
                {kwsUnicas.length > 1 && (
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    <button
                      onClick={() => setFiltroKw('')}
                      className={`text-[12px] px-3 py-1 rounded-full border font-semibold transition-all ${
                        !filtroKw
                          ? 'bg-zinc-900 text-white border-zinc-900'
                          : 'border-zinc-200 text-zinc-500 hover:border-zinc-400 hover:text-zinc-700'
                      }`}
                    >
                      Todas · {alertas.length}
                    </button>
                    {kwsUnicas.map(kw => {
                      const cnt = alertas.filter(a => a.keyword_texto === kw).length;
                      const sel = filtroKw === kw;
                      return (
                        <button
                          key={kw}
                          onClick={() => setFiltroKw(sel ? '' : kw)}
                          className={`text-[12px] px-3 py-1 rounded-full border font-semibold transition-all ${
                            sel
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'border-zinc-200 text-zinc-500 hover:border-zinc-400 hover:text-zinc-700'
                          }`}
                        >
                          {kw} · {cnt}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Lista de alertas */}
                <div className="space-y-2">
                  {alertasNoLeidas.map(a => (
                    <AlertaCard key={a.id} alerta={a} esAdmin={esAdmin}
                      onDelete={eliminarAlerta} onAsignar={setModalAlerta} />
                  ))}

                  {alertasLeidas.length > 0 && (
                    <>
                      {alertasNoLeidas.length > 0 && (
                        <div className="flex items-center gap-3 py-2">
                          <div className="flex-1 h-px bg-zinc-200" />
                          <span className="text-[11px] text-zinc-400 font-medium flex-shrink-0">Ya leídas</span>
                          <div className="flex-1 h-px bg-zinc-200" />
                        </div>
                      )}
                      {alertasLeidas.map(a => (
                        <AlertaCard key={a.id} alerta={a} esAdmin={esAdmin}
                          onDelete={eliminarAlerta} onAsignar={setModalAlerta} />
                      ))}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ─────────────────── TAB KEYWORDS ──────────────────────────────── */}
        {tab === 'keywords' && (
          <div>
            {/* Form agregar */}
            <form onSubmit={agregarKeyword} className="flex gap-2 mb-5">
              <div className="relative flex-1 max-w-sm">
                <Tag size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                <input
                  type="text"
                  value={nuevaKw}
                  onChange={e => setNuevaKw(e.target.value)}
                  placeholder='p.ej. "maquinaria pesada" o "servicios TI"'
                  className="w-full pl-9 pr-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-[13px] placeholder:text-zinc-400 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 outline-none transition-all"
                  maxLength={100}
                />
              </div>
              <button
                type="submit"
                disabled={agregando || !nuevaKw.trim()}
                className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-[13px] font-semibold hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm shadow-blue-600/20"
              >
                {agregando ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Agregar
              </button>
            </form>

            {/* Info banner */}
            <div className="flex items-start gap-3 bg-blue-50 border border-blue-200/60 rounded-xl px-4 py-3.5 mb-5">
              <Sparkles size={15} className="text-blue-500 flex-shrink-0 mt-px" />
              <p className="text-[12.5px] text-blue-800 leading-relaxed">
                <strong className="font-semibold">¿Cómo funciona?</strong>{' '}
                El Radar descarga licitaciones de los últimos 7 días desde Mercado Público y filtra
                por tus palabras clave en título y descripción. Se ejecuta cada 4 horas automáticamente.
              </p>
            </div>

            {/* Keywords list */}
            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <CardSkeleton key={i} />)}
              </div>
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
                  <div
                    key={kw.id}
                    className={`flex items-center gap-3 bg-white rounded-xl border px-4 py-3.5 transition-all ${
                      kw.activo
                        ? 'border-zinc-200 shadow-sm hover:shadow-md hover:-translate-y-px'
                        : 'border-zinc-200/50 opacity-50'
                    }`}
                  >
                    {/* Toggle */}
                    <button
                      onClick={() => toggleKeyword(kw.id, kw.activo)}
                      className="flex-shrink-0 transition-transform hover:scale-105"
                      title={kw.activo ? 'Pausar' : 'Activar'}
                    >
                      {kw.activo
                        ? <ToggleRight size={26} className="text-blue-600" />
                        : <ToggleLeft  size={26} className="text-zinc-300" />
                      }
                    </button>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-[13.5px] font-semibold text-zinc-900 tracking-tight">
                        {kw.keyword}
                      </p>
                      <p className="text-[11.5px] text-zinc-400 mt-0.5 flex items-center gap-2">
                        <span>
                          {kw.total_encontradas > 0
                            ? `${kw.total_encontradas} encontrada${kw.total_encontradas !== 1 ? 's' : ''}`
                            : 'Sin búsquedas aún'
                          }
                        </span>
                        {kw.ultima_busqueda && (
                          <span className="inline-flex items-center gap-0.5 text-zinc-300">
                            <Clock size={9} />
                            {tiempoRelativo(kw.ultima_busqueda)}
                          </span>
                        )}
                      </p>
                    </div>

                    {/* Badge nuevas */}
                    {kw.resultados_nuevos > 0 && (
                      <span className="bg-blue-600 text-white text-[11px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 tabular-nums">
                        {kw.resultados_nuevos} nuevas
                      </span>
                    )}

                    {/* Eliminar */}
                    <button
                      onClick={() => eliminarKeyword(kw.id)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
                    >
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
            setAlertas(prev =>
              prev.map(a => a.id === modalAlerta.id ? { ...a, leida: true } : a)
            );
          }}
        />
      )}
    </AppLayout>
  );
}
