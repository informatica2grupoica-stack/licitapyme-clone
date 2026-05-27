'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import {
  Bell, Plus, Trash2, Search, ExternalLink, RefreshCw,
  AlertCircle, Tag, CheckCheck, Building2, Calendar,
  DollarSign, Loader2, ToggleLeft, ToggleRight, BellOff,
} from 'lucide-react';

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
  leida: boolean;
  created_at: string;
}

function formatMonto(monto: number | null): string {
  if (!monto) return '';
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(monto);
}

export default function AlertasPage() {
  const [keywords, setKeywords]   = useState<PalabraClave[]>([]);
  const [alertas, setAlertas]     = useState<Alerta[]>([]);
  const [noLeidas, setNoLeidas]   = useState(0);
  const [loading, setLoading]     = useState(true);
  const [loadingAlerts, setLoadingAlerts] = useState(true);
  const [nuevaKeyword, setNuevaKeyword] = useState('');
  const [agregando, setAgregando] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [buscandoAhora, setBuscandoAhora] = useState(false);
  const [tabActiva, setTabActiva] = useState<'alertas' | 'keywords'>('alertas');

  const cargarKeywords = useCallback(async () => {
    try {
      const res = await fetch('/api/palabras-clave');
      const data = await res.json();
      if (data.success) setKeywords(data.keywords || []);
    } catch { /* silencioso */ }
    finally { setLoading(false); }
  }, []);

  const cargarAlertas = useCallback(async () => {
    setLoadingAlerts(true);
    try {
      const res = await fetch('/api/alertas?limit=100');
      const data = await res.json();
      if (data.success) {
        setAlertas(data.alertas || []);
        setNoLeidas(data.noLeidas || 0);
      }
    } catch { /* silencioso */ }
    finally { setLoadingAlerts(false); }
  }, []);

  useEffect(() => {
    cargarKeywords();
    cargarAlertas();
  }, [cargarKeywords, cargarAlertas]);

  const agregarKeyword = async (e: React.FormEvent) => {
    e.preventDefault();
    const kw = nuevaKeyword.trim().toLowerCase();
    if (!kw) return;
    setAgregando(true);
    setError(null);
    try {
      const res = await fetch('/api/palabras-clave', {
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
      setAlertas(prev => prev.filter(a => a.id !== id));
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

  const buscarAhora = async () => {
    setBuscandoAhora(true);
    try {
      const secret = process.env.NEXT_PUBLIC_CRON_SECRET || '';
      await fetch('/api/cron/alertas', {
        headers: { Authorization: `Bearer ${secret}` },
      });
      await cargarKeywords();
      await cargarAlertas();
    } catch { /* silencioso */ }
    finally { setBuscandoAhora(false); }
  };

  const alertasNoLeidas = alertas.filter(a => !a.leida);
  const alertasLeidas   = alertas.filter(a => a.leida);

  return (
    <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Alertas y búsqueda automática' }]}>
      <div className="p-4 sm:p-6 lg:p-8 max-w-5xl">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Bell size={24} className="text-blue-600" />
              Alertas automáticas
              {noLeidas > 0 && (
                <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                  {noLeidas}
                </span>
              )}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Define palabras clave y el sistema buscará licitaciones nuevas cada 6 horas
            </p>
          </div>
          <button
            onClick={buscarAhora}
            disabled={buscandoAhora || keywords.filter(k => k.activo).length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {buscandoAhora ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
            Buscar ahora
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl w-fit">
          {([
            { key: 'alertas', label: 'Licitaciones encontradas', count: noLeidas },
            { key: 'keywords', label: 'Mis palabras clave', count: keywords.length },
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
                  tab.key === 'alertas' && tab.count > 0
                    ? 'bg-red-500 text-white'
                    : 'bg-gray-200 text-gray-600'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── TAB: ALERTAS ── */}
        {tabActiva === 'alertas' && (
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
                <h3 className="text-lg font-semibold text-gray-800 mb-2">Sin alertas aún</h3>
                <p className="text-gray-500 text-sm mb-4">
                  {keywords.length === 0
                    ? 'Agrega palabras clave y el sistema buscará licitaciones automáticamente'
                    : 'El sistema buscará licitaciones nuevas con tus palabras clave en el próximo ciclo'
                  }
                </p>
                {keywords.length === 0 && (
                  <button
                    onClick={() => setTabActiva('keywords')}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                  >
                    <Plus size={15} /> Agregar palabras clave
                  </button>
                )}
              </div>
            ) : (
              <>
                {noLeidas > 0 && (
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-gray-500">
                      <strong className="text-gray-800">{noLeidas}</strong> nueva{noLeidas !== 1 ? 's' : ''} sin leer
                    </span>
                    <button
                      onClick={marcarTodasLeidas}
                      className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
                    >
                      <CheckCheck size={14} /> Marcar todas como leídas
                    </button>
                  </div>
                )}

                <div className="space-y-2">
                  {/* No leídas primero */}
                  {alertasNoLeidas.map(alerta => (
                    <AlertaCard key={alerta.id} alerta={alerta} onDelete={eliminarAlerta} />
                  ))}
                  {/* Leídas */}
                  {alertasLeidas.length > 0 && (
                    <>
                      {alertasNoLeidas.length > 0 && (
                        <p className="text-xs text-gray-400 font-medium pt-2 pb-1">Ya leídas</p>
                      )}
                      {alertasLeidas.map(alerta => (
                        <AlertaCard key={alerta.id} alerta={alerta} onDelete={eliminarAlerta} />
                      ))}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── TAB: KEYWORDS ── */}
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

            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-5 text-sm text-blue-800">
              <strong>¿Cómo funciona?</strong> El sistema busca en Mercado Público cada 6 horas usando tus palabras clave.
              Cuando encuentra licitaciones nuevas, aparecen en la pestaña <em>Licitaciones encontradas</em>.
              Puedes tener hasta 10 palabras clave activas.
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
                <Tag size={28} className="text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 text-sm">No tienes palabras clave aún. Agrega la primera.</p>
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
                        : <ToggleLeft size={28} className="text-gray-300" />
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
                          <span> · Última búsqueda: {new Date(kw.ultima_busqueda).toLocaleDateString('es-CL')}</span>
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
    </AppLayout>
  );
}

// ── Componente de tarjeta de alerta ──────────────────────────────────────────
function AlertaCard({ alerta, onDelete }: { alerta: Alerta; onDelete: (id: number) => void }) {
  return (
    <div className={`bg-white rounded-xl border px-4 py-3.5 flex items-start gap-3 transition-all ${
      !alerta.leida ? 'border-blue-200 shadow-sm' : 'border-gray-100'
    }`}>
      {!alerta.leida && (
        <span className="w-2 h-2 rounded-full bg-blue-500 mt-2 flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <Link
            href={`/licitacion/${encodeURIComponent(alerta.licitacion_codigo)}`}
            className="text-sm font-semibold text-gray-900 hover:text-blue-600 transition-colors line-clamp-2"
          >
            {alerta.licitacion_nombre || alerta.licitacion_codigo}
          </Link>
          <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full whitespace-nowrap flex-shrink-0 font-medium">
            {alerta.keyword_texto}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-gray-500">
          {alerta.licitacion_organismo && (
            <span className="flex items-center gap-1">
              <Building2 size={11} /> {alerta.licitacion_organismo}
            </span>
          )}
          {alerta.licitacion_monto && (
            <span className="flex items-center gap-1 text-gray-600 font-medium">
              <DollarSign size={11} /> {formatMonto(alerta.licitacion_monto)}
            </span>
          )}
          {alerta.licitacion_cierre && (
            <span className="flex items-center gap-1">
              <Calendar size={11} /> {new Date(alerta.licitacion_cierre).toLocaleDateString('es-CL')}
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
      <div className="flex items-center gap-1 flex-shrink-0">
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
