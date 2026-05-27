'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import {
  Star, ExternalLink, Trash2, Search, Building2, Calendar,
  DollarSign, MapPin, RefreshCw, Filter, AlertCircle, FileText,
} from 'lucide-react';

interface Favorito {
  id: number;
  codigo: string;
  nombre: string;
  organismo: string;
  monto_total: number | null;
  monto_estimado: number | null;
  moneda: string;
  fecha_cierre: string | null;
  estado: string | null;
  tipo_licitacion: string | null;
  region: string | null;
  created_at: string;
}

const ESTADO_COLOR: Record<string, string> = {
  'Publicada':    'bg-green-100 text-green-700',
  'Adjudicada':   'bg-blue-100 text-blue-700',
  'Cerrada':      'bg-gray-100 text-gray-600',
  'Desierta':     'bg-red-100 text-red-600',
  'Suspendida':   'bg-yellow-100 text-yellow-700',
  'Revocada':     'bg-orange-100 text-orange-700',
};

function formatMonto(monto: number | null, moneda = 'CLP'): string {
  if (!monto) return '—';
  if (moneda === 'CLP') {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(monto);
  }
  return `${moneda} ${monto.toLocaleString()}`;
}

function diasHastaCierre(fecha: string | null): { dias: number; label: string; color: string } | null {
  if (!fecha) return null;
  const hoy = new Date();
  const cierre = new Date(fecha);
  const diff = Math.ceil((cierre.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return { dias: diff, label: 'Vencida', color: 'text-gray-400' };
  if (diff === 0) return { dias: 0, label: 'Vence hoy', color: 'text-red-600 font-semibold' };
  if (diff <= 3) return { dias: diff, label: `${diff}d`, color: 'text-red-500 font-semibold' };
  if (diff <= 7) return { dias: diff, label: `${diff}d`, color: 'text-orange-500' };
  return { dias: diff, label: `${diff}d`, color: 'text-gray-500' };
}

export default function FavoritosPage() {
  const [favoritos, setFavoritos] = useState<Favorito[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [eliminando, setEliminando] = useState<string | null>(null);

  const cargarFavoritos = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/favorites');
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setFavoritos(data.favorites || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar favoritos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargarFavoritos(); }, [cargarFavoritos]);

  const eliminarFavorito = async (codigo: string) => {
    setEliminando(codigo);
    try {
      await fetch(`/api/favorites?codigo=${encodeURIComponent(codigo)}`, { method: 'DELETE' });
      setFavoritos(prev => prev.filter(f => f.codigo !== codigo));
    } catch {
      // silencioso
    } finally {
      setEliminando(null);
    }
  };

  const favoritosFiltrados = favoritos.filter(f =>
    search === '' ||
    f.nombre?.toLowerCase().includes(search.toLowerCase()) ||
    f.organismo?.toLowerCase().includes(search.toLowerCase()) ||
    f.codigo?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Favoritos' }]}>
      <div className="p-4 sm:p-6 lg:p-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Star size={24} className="text-amber-500 fill-amber-500" />
              Mis favoritos
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {loading ? 'Cargando...' : `${favoritos.length} licitacion${favoritos.length !== 1 ? 'es' : ''} guardada${favoritos.length !== 1 ? 's' : ''}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              <Search size={15} /> Buscar licitaciones
            </Link>
            <button
              onClick={cargarFavoritos}
              className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors"
              title="Actualizar"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Buscador interno */}
        {favoritos.length > 0 && (
          <div className="relative mb-4">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filtrar por nombre, organismo o código..."
              className="w-full max-w-md pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
            {search && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                {favoritosFiltrados.length} resultado{favoritosFiltrados.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm mb-4">
            <AlertCircle size={16} />
            {error}
            <button onClick={cargarFavoritos} className="ml-auto text-red-600 hover:underline">Reintentar</button>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
                <div className="h-3 bg-gray-100 rounded w-1/2" />
              </div>
            ))}
          </div>
        )}

        {/* Lista de favoritos */}
        {!loading && !error && (
          <>
            {favoritosFiltrados.length === 0 ? (
              <div className="text-center py-20 bg-white rounded-xl border border-gray-100">
                <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Star size={28} className="text-amber-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-800 mb-2">
                  {search ? 'Sin resultados para ese filtro' : 'No tienes favoritos aún'}
                </h3>
                <p className="text-gray-500 text-sm mb-6">
                  {search
                    ? 'Intenta con otras palabras clave'
                    : 'Busca licitaciones y guárdalas con la estrella ★'
                  }
                </p>
                {!search && (
                  <Link
                    href="/"
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                  >
                    <Search size={15} /> Ir al buscador
                  </Link>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {favoritosFiltrados.map(fav => {
                  const cierre = diasHastaCierre(fav.fecha_cierre);
                  const estadoClass = ESTADO_COLOR[fav.estado || ''] || 'bg-gray-100 text-gray-600';
                  const monto = formatMonto(fav.monto_total || fav.monto_estimado, fav.moneda);

                  return (
                    <div
                      key={fav.codigo}
                      className="bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md hover:border-gray-200 transition-all p-4 sm:p-5"
                    >
                      <div className="flex items-start gap-3">
                        {/* Ícono */}
                        <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
                          <FileText size={18} className="text-blue-600" />
                        </div>

                        {/* Contenido */}
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <Link
                                href={`/licitacion/${encodeURIComponent(fav.codigo)}`}
                                className="text-sm font-semibold text-gray-900 hover:text-blue-600 transition-colors line-clamp-2 block"
                              >
                                {fav.nombre || 'Sin nombre'}
                              </Link>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                                {fav.organismo && (
                                  <span className="flex items-center gap-1 text-xs text-gray-500">
                                    <Building2 size={11} /> {fav.organismo}
                                  </span>
                                )}
                                {fav.region && (
                                  <span className="flex items-center gap-1 text-xs text-gray-500">
                                    <MapPin size={11} /> {fav.region}
                                  </span>
                                )}
                                {monto !== '—' && (
                                  <span className="flex items-center gap-1 text-xs text-gray-600 font-medium">
                                    <DollarSign size={11} /> {monto}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Estado + acciones */}
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {fav.estado && (
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${estadoClass}`}>
                                  {fav.estado}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Footer */}
                          <div className="flex flex-wrap items-center justify-between gap-2 mt-3 pt-3 border-t border-gray-50">
                            <div className="flex items-center gap-3 text-xs text-gray-400">
                              {fav.fecha_cierre && (
                                <span className="flex items-center gap-1">
                                  <Calendar size={11} />
                                  Cierre: {new Date(fav.fecha_cierre).toLocaleDateString('es-CL')}
                                  {cierre && (
                                    <span className={`ml-1 ${cierre.color}`}>
                                      ({cierre.label})
                                    </span>
                                  )}
                                </span>
                              )}
                              <span>Código: {fav.codigo}</span>
                            </div>

                            <div className="flex items-center gap-1">
                              <Link
                                href={`/licitacion/${encodeURIComponent(fav.codigo)}`}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded-lg transition-colors font-medium"
                              >
                                <ExternalLink size={12} /> Ver detalle
                              </Link>
                              <button
                                onClick={() => eliminarFavorito(fav.codigo)}
                                disabled={eliminando === fav.codigo}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                                title="Quitar de favoritos"
                              >
                                <Trash2 size={12} />
                                {eliminando === fav.codigo ? '...' : 'Quitar'}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
