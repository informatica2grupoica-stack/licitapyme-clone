'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import {
  Radar, Plus, Trash2, ExternalLink, AlertCircle, Tag,
  CheckCheck, Building2, Calendar, DollarSign, Loader2,
  ToggleLeft, ToggleRight, BellOff, UserPlus, X, Check,
  Clock, ChevronDown, Search,
} from 'lucide-react';

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface PalabraClave {
  id: number;
  keyword: string;
  activo: boolean;
  ultima_busqueda: string | null;
  resultados_nuevos: number;
  total_encontradas: number;
  created_at: string;
}

interface Alerta {
  id: number;
  keyword_texto: string;
  licitacion_codigo: string;
  licitacion_nombre: string;
  licitacion_organismo: string;
  licitacion_monto: number | null;
  licitacion_cierre: string | null;
  licitacion_estado: string | null;
  licitacion_region: string | null;
  licitacion_tipo: string | null;
  leida: boolean;
  created_at: string;
}

interface Usuario {
  id: number;
  nombre: string | null;
  email: string;
  empresa: string | null;
}

interface Etiqueta {
  id: number;
  nombre: string;
  color: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatMonto(monto: number | null): string {
  if (!monto) return '';
  return new Intl.NumberFormat('es-CL', {
    style: 'currency', currency: 'CLP', maximumFractionDigits: 0,
  }).format(monto);
}

function tiempoRelativo(fecha: string): string {
  const diff = Date.now() - new Date(fecha).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'hace un momento';
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `hace ${hrs} h`;
  return `hace ${Math.floor(hrs / 24)} d`;
}

// Deriva el tipo de licitación desde el código (e.g. "2743-23-LP26" → "LP")
function getTipoFromCodigo(codigo: string): string | null {
  const m = codigo.match(/-([A-Za-z]+)\d+$/);
  return m ? m[1].toUpperCase() : null;
}

function tipoBadge(codigo: string) {
  const tipo = getTipoFromCodigo(codigo);
  if (!tipo) return null;
  const map: Record<string, { bg: string; text: string }> = {
    'LE':  { bg: 'bg-red-100',    text: 'text-red-700'    },
    'LP':  { bg: 'bg-blue-100',   text: 'text-blue-700'   },
    'LQ':  { bg: 'bg-amber-100',  text: 'text-amber-700'  },
    'CO':  { bg: 'bg-purple-100', text: 'text-purple-700' },
    'SU':  { bg: 'bg-teal-100',   text: 'text-teal-700'   },
    'L1':  { bg: 'bg-pink-100',   text: 'text-pink-700'   },
  };
  const t2 = tipo.slice(0, 2);
  const style = map[t2] ?? { bg: 'bg-gray-100', text: 'text-gray-600' };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${style.bg} ${style.text}`}>
      {t2}
    </span>
  );
}

// ─── Modal Asignar ────────────────────────────────────────────────────────────
function ModalAsignar({
  alerta,
  usuarios,
  etiquetas,
  onClose,
  onSuccess,
}: {
  alerta: Alerta;
  usuarios: Usuario[];
  etiquetas: Etiqueta[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [usuarioId, setUsuarioId]     = useState<number | ''>('');
  const [etiquetaIds, setEtiquetaIds] = useState<number[]>([]);
  const [guardando, setGuardando]     = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [exito, setExito]             = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const toggleEtiqueta = (id: number) =>
    setEtiquetaIds(prev =>
      prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id]
    );

  const asignar = async () => {
    if (!usuarioId) { setError('Selecciona un usuario'); return; }
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch('/api/negocios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licitacion_codigo:     alerta.licitacion_codigo,
          licitacion_nombre:     alerta.licitacion_nombre,
          licitacion_organismo:  alerta.licitacion_organismo,
          licitacion_monto:      alerta.licitacion_monto,
          licitacion_cierre:     alerta.licitacion_cierre,
          licitacion_estado:     alerta.licitacion_estado,
          licitacion_region:     alerta.licitacion_region,
          licitacion_tipo:       alerta.licitacion_tipo,
          asignado_a:            usuarioId,
          etiqueta_ids:          etiquetaIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Error al asignar'); return; }
      setExito(true);
      setTimeout(onSuccess, 900);
    } catch {
      setError('Error de conexión');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div ref={ref} className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <UserPlus size={18} className="text-blue-600" />
            <h3 className="font-bold text-gray-900">Asignar a perfil</h3>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Licitación info */}
          <div className="bg-gray-50 rounded-xl p-3.5 text-sm">
            <p className="font-semibold text-gray-900 line-clamp-2 mb-1">
              {alerta.licitacion_nombre || alerta.licitacion_codigo}
            </p>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
              <span className="font-mono text-blue-600">{alerta.licitacion_codigo}</span>
              {alerta.licitacion_organismo && <span>{alerta.licitacion_organismo}</span>}
              {alerta.licitacion_monto && (
                <span className="font-medium text-gray-700">{formatMonto(alerta.licitacion_monto)}</span>
              )}
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">
              <AlertCircle size={14} /> {error}
            </div>
          )}

          {exito ? (
            <div className="flex flex-col items-center py-4 gap-2">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
                <Check size={24} className="text-green-600" />
              </div>
              <p className="font-semibold text-gray-800">¡Asignado correctamente!</p>
              <p className="text-sm text-gray-500">Aparecerá en el panel Negocios del usuario</p>
            </div>
          ) : (
            <>
              {/* Selector de usuario */}
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1.5 block">
                  Asignar a usuario *
                </label>
                <div className="relative">
                  <select
                    value={usuarioId}
                    onChange={e => setUsuarioId(e.target.value ? parseInt(e.target.value) : '')}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none appearance-none bg-white pr-8"
                  >
                    <option value="">Selecciona un usuario...</option>
                    {usuarios.map(u => (
                      <option key={u.id} value={u.id}>
                        {u.nombre || u.email.split('@')[0]} — {u.email}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>

              {/* Selector de etiquetas */}
              {etiquetas.length > 0 && (
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1.5 block">
                    Líneas de negocio (opcional)
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {etiquetas.map(et => {
                      const sel = etiquetaIds.includes(et.id);
                      return (
                        <button
                          key={et.id}
                          type="button"
                          onClick={() => toggleEtiqueta(et.id)}
                          style={sel
                            ? { backgroundColor: et.color + '20', color: et.color, borderColor: et.color }
                            : {}
                          }
                          className={`text-xs px-3 py-1 rounded-full border font-medium transition-all ${
                            sel
                              ? 'shadow-sm'
                              : 'border-gray-200 text-gray-500 hover:border-gray-300'
                          }`}
                        >
                          {sel && <span className="mr-1">✓</span>}
                          {et.nombre}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {!exito && (
          <div className="flex items-center gap-2 px-5 pb-5">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={asignar}
              disabled={guardando || !usuarioId}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300 transition-colors"
            >
              {guardando
                ? <Loader2 size={14} className="animate-spin" />
                : <UserPlus size={14} />
              }
              Asignar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tarjeta de alerta ────────────────────────────────────────────────────────
function AlertaCard({
  alerta,
  esAdmin,
  onDelete,
  onAsignar,
}: {
  alerta: Alerta;
  esAdmin: boolean;
  onDelete: (id: number) => void;
  onAsignar: (alerta: Alerta) => void;
}) {
  const diasCierre = alerta.licitacion_cierre
    ? Math.ceil((new Date(alerta.licitacion_cierre).getTime() - Date.now()) / 86400000)
    : null;

  return (
    <div className={`bg-white rounded-xl border px-4 py-3.5 flex items-start gap-3 transition-all group ${
      !alerta.leida ? 'border-blue-200 shadow-sm' : 'border-gray-100'
    }`}>
      {/* Punto no leído */}
      <div className="flex-shrink-0 mt-1.5">
        {!alerta.leida
          ? <span className="w-2 h-2 rounded-full bg-blue-500 block" />
          : <span className="w-2 h-2 rounded-full bg-transparent block" />
        }
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-1">
          <Link
            href={`/licitacion/${encodeURIComponent(alerta.licitacion_codigo)}`}
            className="text-sm font-semibold text-gray-900 hover:text-blue-600 transition-colors line-clamp-2"
          >
            {alerta.licitacion_nombre || alerta.licitacion_codigo}
          </Link>
          <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full whitespace-nowrap flex-shrink-0 font-medium border border-blue-100">
            {alerta.keyword_texto}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
          {tipoBadge(alerta.licitacion_codigo)}
          {alerta.licitacion_organismo && (
            <span className="flex items-center gap-1 truncate">
              <Building2 size={10} /> {alerta.licitacion_organismo}
            </span>
          )}
          {alerta.licitacion_monto && (
            <span className="flex items-center gap-1 text-gray-700 font-medium">
              <DollarSign size={10} /> {formatMonto(alerta.licitacion_monto)}
            </span>
          )}
          {diasCierre !== null && (
            <span className={`flex items-center gap-1 font-medium ${
              diasCierre <= 3 ? 'text-red-600' :
              diasCierre <= 7 ? 'text-orange-500' : 'text-gray-500'
            }`}>
              <Calendar size={10} />
              {diasCierre <= 0 ? 'Cerrada' : `${diasCierre}d`}
            </span>
          )}
          {alerta.licitacion_estado && (
            <span className={`px-1.5 py-0.5 rounded-full ${
              alerta.licitacion_estado === 'Publicada'
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-100 text-gray-600'
            }`}>
              {alerta.licitacion_estado}
            </span>
          )}
        </div>
      </div>

      {/* Acciones — siempre visibles */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {esAdmin && (
          <button
            onClick={() => onAsignar(alerta)}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors"
            title="Asignar a perfil"
          >
            <UserPlus size={12} />
            <span className="hidden sm:inline">Asignar</span>
          </button>
        )}
        <Link
          href={`/licitacion/${encodeURIComponent(alerta.licitacion_codigo)}`}
          className="p-1.5 hover:bg-blue-50 rounded-lg text-gray-400 hover:text-blue-600 transition-colors"
          title="Ver licitación"
        >
          <ExternalLink size={14} />
        </Link>
        <button
          onClick={() => onDelete(alerta.id)}
          className="p-1.5 hover:bg-red-50 rounded-lg text-gray-400 hover:text-red-500 transition-colors"
          title="Eliminar"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function RadarPage() {
  const { usuario } = useSession();
  const esAdmin = usuario?.rol === 'admin';

  const [keywords, setKeywords]       = useState<PalabraClave[]>([]);
  const [alertas, setAlertas]         = useState<Alerta[]>([]);
  const [noLeidas, setNoLeidas]       = useState(0);
  const [usuarios, setUsuarios]       = useState<Usuario[]>([]);
  const [etiquetas, setEtiquetas]     = useState<Etiqueta[]>([]);
  const [loading, setLoading]         = useState(true);
  const [loadingAlerts, setLoadingAlerts] = useState(true);
  const [nuevaKeyword, setNuevaKeyword]   = useState('');
  const [agregando, setAgregando]     = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [actualizando, setActualizando] = useState(false);
  const [ultimaActualizacion, setUltimaActualizacion] = useState<string | null>(null);
  const [tabActiva, setTabActiva]     = useState<'radar' | 'keywords'>('radar');
  const [filtroKeyword, setFiltroKeyword] = useState('');
  const [alertaAsignar, setAlertaAsignar] = useState<Alerta | null>(null);
  const [notificacion, setNotificacion] = useState<{ tipo: 'ok' | 'warn' | 'error'; mensaje: string } | null>(null);

  // ── Carga inicial ────────────────────────────────────────────────────────────
  const cargarKeywords = useCallback(async () => {
    try {
      const res  = await fetch('/api/palabras-clave');
      const data = await res.json();
      if (data.success) {
        setKeywords(data.keywords || []);
        // Última búsqueda = la más reciente de todas las keywords
        const fechas = (data.keywords || [])
          .map((k: PalabraClave) => k.ultima_busqueda)
          .filter(Boolean)
          .sort()
          .reverse();
        if (fechas.length > 0) setUltimaActualizacion(fechas[0]);
      }
    } catch { /* silencioso */ }
    finally { setLoading(false); }
  }, []);

  const cargarAlertas = useCallback(async () => {
    setLoadingAlerts(true);
    try {
      const res  = await fetch('/api/alertas?limit=200');
      const data = await res.json();
      if (data.success) {
        setAlertas(data.alertas || []);
        setNoLeidas(data.noLeidas || 0);
      }
    } catch { /* silencioso */ }
    finally { setLoadingAlerts(false); }
  }, []);

  const cargarUsuariosYEtiquetas = useCallback(async () => {
    if (!esAdmin) return;
    try {
      const [resU, resE] = await Promise.all([
        fetch('/api/admin/usuarios'),
        fetch('/api/etiquetas'),
      ]);
      const [dataU, dataE] = await Promise.all([resU.json(), resE.json()]);
      if (dataU.success) setUsuarios(dataU.usuarios || []);
      if (dataE.success) setEtiquetas(dataE.etiquetas || []);
    } catch { /* silencioso */ }
  }, [esAdmin]);

  useEffect(() => {
    cargarKeywords();
    cargarAlertas();
    cargarUsuariosYEtiquetas();
  }, [cargarKeywords, cargarAlertas, cargarUsuariosYEtiquetas]);

  // ── Acciones ─────────────────────────────────────────────────────────────────
  const actualizarAhora = async () => {
    setActualizando(true);
    setNotificacion(null);
    try {
      const secret = process.env.NEXT_PUBLIC_CRON_SECRET
        || '7f3a9b2e1d8c4f6a0e5b7d3c9a2f1e8b4d7c0a3f6e9b2d5c8a1f4e7b0d3c6a9f';

      console.log('[Radar] 🚀 Iniciando actualización manual...');

      const res  = await fetch('/api/cron/alertas', {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(58_000), // 58s max
      });
      const data = await res.json();

      console.log('[Radar] 📦 Respuesta del cron:', data);

      if (!res.ok) {
        const msg = data.error || `Error HTTP ${res.status}`;
        console.error('[Radar] ❌', msg);
        setNotificacion({ tipo: 'error', mensaje: msg });
      } else if (data.alertasNuevas > 0) {
        setNotificacion({
          tipo: 'ok',
          mensaje: `✅ ${data.alertasNuevas} licitación${data.alertasNuevas !== 1 ? 'es' : ''} nueva${data.alertasNuevas !== 1 ? 's' : ''} encontrada${data.alertasNuevas !== 1 ? 's' : ''} en ${data.keywordsProcesadas} palabras clave`,
        });
      } else {
        setNotificacion({
          tipo: 'warn',
          mensaje: `Sin resultados nuevos (${data.keywordsProcesadas} palabras clave buscadas${data.keywordsOmitidas > 0 ? `, ${data.keywordsOmitidas} omitidas por timeout` : ''})`,
        });
      }

      await cargarKeywords();
      await cargarAlertas();
      setUltimaActualizacion(new Date().toISOString());
      // Ocultar notificación después de 8 segundos
      setTimeout(() => setNotificacion(null), 8000);
    } catch (err) {
      console.error('[Radar] ❌ Error de red:', err);
      setNotificacion({ tipo: 'error', mensaje: 'Error de conexión. Revisa la consola del navegador (F12).' });
    } finally {
      setActualizando(false);
    }
  };

  const agregarKeyword = async (e: React.FormEvent) => {
    e.preventDefault();
    const kw = nuevaKeyword.trim().toLowerCase();
    if (!kw) return;
    setAgregando(true);
    setError(null);
    try {
      const res  = await fetch('/api/palabras-clave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: kw }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Error'); return; }
      setNuevaKeyword('');
      await cargarKeywords();
    } catch { setError('Error de conexión'); }
    finally { setAgregando(false); }
  };

  const toggleKeyword = async (id: number, activo: boolean) => {
    try {
      await fetch('/api/palabras-clave', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, activo: !activo }),
      });
      setKeywords(prev => prev.map(k => k.id === id ? { ...k, activo: !activo } : k));
    } catch { /* silencioso */ }
  };

  const eliminarKeyword = async (id: number) => {
    if (!confirm('¿Eliminar esta palabra clave y todas sus alertas?')) return;
    try {
      await fetch(`/api/palabras-clave?id=${id}`, { method: 'DELETE' });
      setKeywords(prev => prev.filter(k => k.id !== id));
    } catch { /* silencioso */ }
  };

  const marcarTodasLeidas = async () => {
    try {
      await fetch('/api/alertas', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      setAlertas(prev => prev.map(a => ({ ...a, leida: true })));
      setNoLeidas(0);
    } catch { /* silencioso */ }
  };

  const eliminarAlerta = async (id: number) => {
    try {
      await fetch(`/api/alertas?id=${id}`, { method: 'DELETE' });
      setAlertas(prev => prev.filter(a => a.id !== id));
    } catch { /* silencioso */ }
  };

  // ── Filtrado ─────────────────────────────────────────────────────────────────
  const alertasFiltradas = filtroKeyword
    ? alertas.filter(a => a.keyword_texto === filtroKeyword)
    : alertas;
  const alertasNoLeidas = alertasFiltradas.filter(a => !a.leida);
  const alertasLeidas   = alertasFiltradas.filter(a => a.leida);

  const keywordsUnicas = [...new Set(alertas.map(a => a.keyword_texto))].sort();
  const activeKeywords = keywords.filter(k => k.activo).length;

  return (
    <AppLayout breadcrumb={[
      { label: 'Dashboard', href: '/dashboard' },
      { label: 'Radar de licitaciones' },
    ]}>
      <div className="p-4 sm:p-6 lg:p-8 max-w-5xl">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2.5">
              <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center flex-shrink-0">
                <Radar size={18} className="text-white" />
              </div>
              Radar de licitaciones
              {noLeidas > 0 && (
                <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                  {noLeidas}
                </span>
              )}
            </h1>
            <p className="text-sm text-gray-500 mt-1 ml-11">
              Búsqueda automática por palabras clave · {activeKeywords} activa{activeKeywords !== 1 ? 's' : ''}
            </p>
            {ultimaActualizacion && (
              <p className="text-xs text-gray-400 mt-0.5 ml-11 flex items-center gap-1">
                <Clock size={11} />
                Última actualización: {tiempoRelativo(ultimaActualizacion)}
              </p>
            )}
          </div>

          <button
            onClick={actualizarAhora}
            disabled={actualizando || activeKeywords === 0}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors shadow-sm flex-shrink-0"
          >
            {actualizando
              ? <Loader2 size={15} className="animate-spin" />
              : <Radar size={15} />
            }
            Actualizar ahora
          </button>
        </div>

        {/* ── Notificación resultado ──────────────────────────────────────── */}
        {notificacion && (
          <div className={`flex items-start gap-2 px-4 py-3 rounded-xl text-sm mb-4 border ${
            notificacion.tipo === 'ok'    ? 'bg-green-50 border-green-200 text-green-800' :
            notificacion.tipo === 'warn'  ? 'bg-amber-50 border-amber-200 text-amber-800' :
                                            'bg-red-50 border-red-200 text-red-800'
          }`}>
            <span className="flex-1">{notificacion.mensaje}</span>
            <button onClick={() => setNotificacion(null)} className="flex-shrink-0 opacity-60 hover:opacity-100">
              <X size={14} />
            </button>
          </div>
        )}

        {/* ── Tabs ────────────────────────────────────────────────────────── */}
        <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl w-fit">
          {([
            { key: 'radar',    label: 'Licitaciones encontradas', count: noLeidas },
            { key: 'keywords', label: 'Palabras clave',           count: keywords.length },
          ] as const).map(tab => (
            <button
              key={tab.key}
              onClick={() => setTabActiva(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tabActiva === tab.key
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                  tab.key === 'radar' && noLeidas > 0
                    ? 'bg-red-500 text-white'
                    : 'bg-gray-200 text-gray-600'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ──────────────────── TAB RADAR ──────────────────────────────── */}
        {tabActiva === 'radar' && (
          <div>
            {loadingAlerts ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="bg-white rounded-xl border p-4 animate-pulse">
                    <div className="h-4 bg-gray-200 rounded w-2/3 mb-2" />
                    <div className="h-3 bg-gray-100 rounded w-1/2" />
                  </div>
                ))}
              </div>
            ) : alertas.length === 0 ? (
              <div className="text-center py-20 bg-white rounded-xl border border-gray-100">
                <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <BellOff size={28} className="text-blue-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-800 mb-2">Sin resultados aún</h3>
                <p className="text-gray-500 text-sm mb-4">
                  {keywords.length === 0
                    ? 'Agrega palabras clave y el sistema buscará licitaciones automáticamente'
                    : 'Haz clic en "Actualizar ahora" o espera el próximo ciclo automático'
                  }
                </p>
                {keywords.length === 0 ? (
                  <button
                    onClick={() => setTabActiva('keywords')}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                  >
                    <Plus size={15} /> Agregar palabras clave
                  </button>
                ) : (
                  <button
                    onClick={actualizarAhora}
                    disabled={actualizando}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300"
                  >
                    {actualizando ? <Loader2 size={15} className="animate-spin" /> : <Radar size={15} />}
                    Buscar ahora
                  </button>
                )}
              </div>
            ) : (
              <>
                {/* Filtros */}
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  {noLeidas > 0 && (
                    <button
                      onClick={marcarTodasLeidas}
                      className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline ml-auto"
                    >
                      <CheckCheck size={14} /> Marcar todas como leídas
                    </button>
                  )}
                </div>

                {/* Filtro por keyword */}
                {keywordsUnicas.length > 1 && (
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    <button
                      onClick={() => setFiltroKeyword('')}
                      className={`text-xs px-3 py-1 rounded-full border font-medium transition-colors ${
                        !filtroKeyword
                          ? 'bg-gray-800 text-white border-gray-800'
                          : 'border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      Todas ({alertas.length})
                    </button>
                    {keywordsUnicas.map(kw => {
                      const cnt = alertas.filter(a => a.keyword_texto === kw).length;
                      return (
                        <button
                          key={kw}
                          onClick={() => setFiltroKeyword(kw === filtroKeyword ? '' : kw)}
                          className={`text-xs px-3 py-1 rounded-full border font-medium transition-colors ${
                            filtroKeyword === kw
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'border-gray-200 text-gray-500 hover:border-gray-300'
                          }`}
                        >
                          {kw} ({cnt})
                        </button>
                      );
                    })}
                  </div>
                )}

                <div className="space-y-2">
                  {alertasNoLeidas.map(alerta => (
                    <AlertaCard
                      key={alerta.id}
                      alerta={alerta}
                      esAdmin={esAdmin}
                      onDelete={eliminarAlerta}
                      onAsignar={setAlertaAsignar}
                    />
                  ))}
                  {alertasLeidas.length > 0 && (
                    <>
                      {alertasNoLeidas.length > 0 && (
                        <p className="text-xs text-gray-400 font-medium pt-3 pb-1">Ya leídas</p>
                      )}
                      {alertasLeidas.map(alerta => (
                        <AlertaCard
                          key={alerta.id}
                          alerta={alerta}
                          esAdmin={esAdmin}
                          onDelete={eliminarAlerta}
                          onAsignar={setAlertaAsignar}
                        />
                      ))}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ──────────────────── TAB KEYWORDS ──────────────────────────── */}
        {tabActiva === 'keywords' && (
          <div>
            {/* Formulario agregar */}
            <form onSubmit={agregarKeyword} className="flex gap-2 mb-5">
              <div className="relative flex-1 max-w-md">
                <Tag size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={nuevaKeyword}
                  onChange={e => setNuevaKeyword(e.target.value)}
                  placeholder='p.ej. "computadores portátiles" o "servicios de aseo"'
                  className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  maxLength={100}
                />
              </div>
              <button
                type="submit"
                disabled={agregando || !nuevaKeyword.trim()}
                className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                {agregando ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                Agregar
              </button>
            </form>

            {error && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
                <AlertCircle size={15} /> {error}
              </div>
            )}

            <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 mb-5 text-sm text-blue-800">
              <strong>¿Cómo funciona el Radar?</strong> El sistema busca en Mercado Público cada 5 horas
              usando tus palabras clave en el título y descripción de las licitaciones. Cuando encuentra
              resultados nuevos aparecen en la pestaña <em>Licitaciones encontradas</em>
              {esAdmin && <>, donde puedes asignarlas directamente a tus perfiles.</>}.
            </div>

            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className="bg-white rounded-xl border p-4 animate-pulse">
                    <div className="h-4 bg-gray-200 rounded w-1/4" />
                  </div>
                ))}
              </div>
            ) : keywords.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-xl border border-gray-100">
                <Search size={28} className="text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 text-sm">No tienes palabras clave. Agrega la primera.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {keywords.map(kw => (
                  <div
                    key={kw.id}
                    className={`flex items-center gap-3 bg-white rounded-xl border px-4 py-3.5 transition-all ${
                      kw.activo ? 'border-gray-100 shadow-sm' : 'border-gray-100 opacity-60'
                    }`}
                  >
                    <button
                      onClick={() => toggleKeyword(kw.id, kw.activo)}
                      className="flex-shrink-0"
                      title={kw.activo ? 'Pausar' : 'Activar'}
                    >
                      {kw.activo
                        ? <ToggleRight size={28} className="text-green-500" />
                        : <ToggleLeft  size={28} className="text-gray-300" />
                      }
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800">{kw.keyword}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {kw.total_encontradas > 0
                          ? `${kw.total_encontradas} licitaciones encontradas`
                          : 'Sin búsquedas aún'
                        }
                        {kw.ultima_busqueda && (
                          <span className="ml-2 inline-flex items-center gap-0.5">
                            <Clock size={9} />
                            {tiempoRelativo(kw.ultima_busqueda)}
                          </span>
                        )}
                      </p>
                    </div>
                    {kw.resultados_nuevos > 0 && (
                      <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0">
                        {kw.resultados_nuevos} nuevas
                      </span>
                    )}
                    <button
                      onClick={() => eliminarKeyword(kw.id)}
                      className="p-1.5 hover:bg-red-50 rounded-lg text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
                      title="Eliminar"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Modal asignar ────────────────────────────────────────────────────── */}
      {alertaAsignar && (
        <ModalAsignar
          alerta={alertaAsignar}
          usuarios={usuarios}
          etiquetas={etiquetas}
          onClose={() => setAlertaAsignar(null)}
          onSuccess={() => {
            setAlertaAsignar(null);
            // Marcar como leída al asignar
            setAlertas(prev =>
              prev.map(a => a.id === alertaAsignar.id ? { ...a, leida: true } : a)
            );
          }}
        />
      )}
    </AppLayout>
  );
}
