'use client';

import { useState, useCallback, useEffect, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useSession } from '@/app/lib/session-context';
import { AppLayout } from '@/app/components/AppLayout';
import { SearchBar } from '@/app/components/SearchBar';
import { ResultsGrid } from '@/app/components/ResultsGrid';
import { FiltersPanel } from '@/app/components/FiltersPanel';
import { SearchRequest, Oportunidad } from '@/app/types/search.types';
import { Search, TrendingUp, Building2, FileText, Star, RefreshCw } from 'lucide-react';

interface Filters {
  estado: string[];
  tipo: string[];
  montoMin: string;
  montoMax: string;
  fechaDesde: string;
  fechaHasta: string;
  organismo: string;
  region: string;
  tipoOrden: string;
}

const FILTERS_DEFAULT: Filters = {
  estado: [],
  tipo: [],
  montoMin: '',
  montoMax: '',
  fechaDesde: '',
  fechaHasta: '',
  organismo: '',
  region: '',
  tipoOrden: '',
};

function HomeContent() {
  const searchParams = useSearchParams();
  // El Buscador es solo para admin. El usuario normal se redirige a Negocios.
  const { usuario, cargando: cargandoSesion } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (!cargandoSesion && usuario && usuario.rol !== 'admin') router.replace('/negocios');
  }, [cargandoSesion, usuario, router]);
  const [opportunities, setOpportunities] = useState<Oportunidad[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalResults, setTotalResults] = useState(0);
  const [lastQuery, setLastQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [favoriteCodes, setFavoriteCodes] = useState<Set<string>>(new Set());
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [dataSource, setDataSource] = useState('');
  const [filters, setFilters] = useState<Filters>(FILTERS_DEFAULT);
  const [hasSearched, setHasSearched] = useState(false);

  // Ref para detectar cambios reales en filtros (evita loop al montar)
  const prevFiltersRef = useRef<string>('');

  useEffect(() => {
    loadFavorites();
    if (searchParams.get('favoritos') === 'true') setShowFavoritesOnly(true);
    prevFiltersRef.current = JSON.stringify(FILTERS_DEFAULT);
  }, []);

  // Auto-aplica filtros cuando cambian (solo si ya se realizó al menos una búsqueda)
  useEffect(() => {
    const serialized = JSON.stringify(filters);
    if (prevFiltersRef.current === '' || prevFiltersRef.current === serialized) return;
    prevFiltersRef.current = serialized;
    if (hasSearched) {
      executeSearch(lastQuery, 1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const loadFavorites = async () => {
    try {
      const res = await fetch('/api/favorites');
      const data = await res.json();
      if (data.success && data.favorites) {
        setFavoriteCodes(new Set(data.favorites.map((f: any) => f.codigo)));
      }
    } catch { /* silencioso */ }
  };

  const executeSearch = useCallback(async (query: string, page: number = 1) => {
    setLoading(true);
    setError(null);
    setHasSearched(true);

    try {
      const request: SearchRequest = {
        consulta: query,
        pagina: page,
        resultados_por_pagina: 20,
        filtro_estado: filters.estado.length > 0 ? filters.estado as any : undefined,
        filtro_tipo: filters.tipo?.length > 0 ? filters.tipo : undefined,
        filtro_monto_min: filters.montoMin ? parseInt(filters.montoMin) : undefined,
        filtro_monto_max: filters.montoMax ? parseInt(filters.montoMax) : undefined,
        filtro_fecha_cierre_desde: filters.fechaDesde || undefined,
        filtro_fecha_cierre_hasta: filters.fechaHasta || undefined,
        filtro_organismos: filters.organismo ? [filters.organismo] : undefined,
        filtro_regiones: filters.region ? [filters.region] : undefined,
        tipo_orden: (filters.tipoOrden || undefined) as any,
      };

      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!res.ok) throw new Error('Error en la búsqueda');
      const data = await res.json();
      let resultados: Oportunidad[] = data.resultados || [];

      if (showFavoritesOnly && favoriteCodes.size > 0) {
        resultados = resultados.filter(r => favoriteCodes.has(r.codigo));
      }

      setOpportunities(resultados);
      setTotalResults(showFavoritesOnly ? resultados.length : (data.meta?.total_resultados || 0));
      setTotalPages(data.meta?.total_paginas || 1);
      setCurrentPage(page);
      setDataSource(data.meta?.fuente_datos || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
      setOpportunities([]);
    } finally {
      setLoading(false);
    }
  }, [filters, showFavoritesOnly, favoriteCodes]);

  const handleSearch = (query: string) => {
    setLastQuery(query);
    executeSearch(query, 1);
  };

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) executeSearch(lastQuery, page);
  };

  const handleClearFilters = () => {
    setFilters(FILTERS_DEFAULT);
    if (lastQuery) executeSearch(lastQuery, 1);
  };

  const handleFavoriteToggle = () => {
    loadFavorites();
    if (lastQuery) executeSearch(lastQuery, currentPage);
  };

  const hasActiveFilters = Object.values(filters).some(v =>
    Array.isArray(v) ? v.length > 0 : v !== ''
  );

  // No-admin: no renderizar el buscador (el efecto de arriba ya redirige a /negocios).
  if (!cargandoSesion && usuario && usuario.rol !== 'admin') {
    return (
      <AppLayout breadcrumb={[{ label: 'Buscador' }]}>
        <div className="p-10 text-center text-sm text-slate-500">Redirigiendo…</div>
      </AppLayout>
    );
  }

  return (
    <AppLayout breadcrumb={[{ label: 'Buscador' }]}>
      {/* Hero */}
      <div className="bg-gradient-to-br from-[#1e1b4b] via-[#312e81] to-[#1e3a8a] py-14 px-4 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.15)_0%,transparent_60%)]" />
        <div className="max-w-3xl mx-auto text-center relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/20 text-indigo-200 text-xs font-semibold mb-6 backdrop-blur-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Datos en tiempo real · API Mercado Público oficial
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4 leading-tight tracking-tight">
            Oportunidades de{' '}
            <span className="text-indigo-300">Licitación</span>
          </h1>
          <p className="text-indigo-200 text-lg mb-8">
            Accede a todas las licitaciones de Chile en un solo lugar.
            Busca, filtra y analiza de forma inteligente.
          </p>
          <SearchBar onSearch={handleSearch} loading={loading} />
        </div>
      </div>

      {/* Stats bar */}
      <div className="bg-[#0a0f1e] border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Building2 size={14} className="text-indigo-400" />
                <span><strong className="text-slate-200">850</strong> organismos</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <TrendingUp size={14} className="text-emerald-400" />
                <span><strong className="text-slate-200">118.000+</strong> proveedores</span>
              </div>
              {dataSource && (
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <FileText size={14} className="text-purple-400" />
                  <span className="text-slate-300">{dataSource}</span>
                </div>
              )}
            </div>
            {hasSearched && totalResults > 0 && (
              <span className="text-sm text-slate-400">
                <strong className="text-slate-200">{totalResults}</strong> resultados
                {lastQuery && <span className="ml-1">para &ldquo;{lastQuery}&rdquo;</span>}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Main content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Sidebar filtros */}
          <aside className="lg:w-72 flex-shrink-0 space-y-4">
            <FiltersPanel
              filters={filters}
              onChange={setFilters}
              onClear={handleClearFilters}
              onApply={() => { setHasSearched(true); executeSearch(lastQuery, 1); }}
            />

            {/* Favoritos toggle */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <button
                onClick={() => {
                  setShowFavoritesOnly(!showFavoritesOnly);
                  if (lastQuery) executeSearch(lastQuery, 1);
                }}
                className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-[13px] transition-all ${
                  showFavoritesOnly
                    ? 'bg-amber-500 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <Star size={14} className={showFavoritesOnly ? 'fill-white' : ''} />
                {showFavoritesOnly ? 'Mostrando favoritos' : 'Solo favoritos'}
              </button>
              {favoriteCodes.size > 0 && (
                <p className="text-center text-xs text-slate-400 mt-2">
                  {favoriteCodes.size} guardados
                </p>
              )}
            </div>
          </aside>

          {/* Resultados */}
          <div className="flex-1 min-w-0">
            {/* Controles superiores */}
            {hasSearched && !loading && (
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  {totalResults > 0 && (
                    <span className="text-sm text-gray-600">
                      <strong>{totalResults}</strong> resultado{totalResults !== 1 ? 's' : ''}
                      {lastQuery && <span className="text-gray-400"> · &ldquo;{lastQuery}&rdquo;</span>}
                    </span>
                  )}
                  {hasActiveFilters && (
                    <button
                      onClick={handleClearFilters}
                      className="text-xs text-indigo-600 hover:underline"
                    >
                      Limpiar filtros
                    </button>
                  )}
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handlePageChange(currentPage - 1)}
                      disabled={currentPage <= 1}
                      className="px-3 py-1.5 text-[13px] rounded-lg bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      ←
                    </button>
                    <span className="px-3 py-1.5 text-[13px] bg-white border border-slate-200 rounded-lg text-slate-600">
                      {currentPage} / {totalPages}
                    </span>
                    <button
                      onClick={() => handlePageChange(currentPage + 1)}
                      disabled={currentPage >= totalPages}
                      className="px-3 py-1.5 text-[13px] rounded-lg bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      →
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm mb-4 flex items-center gap-2">
                <span>Error: {error}</span>
                <button
                  onClick={() => executeSearch(lastQuery, currentPage)}
                  className="ml-auto flex items-center gap-1 text-red-600 hover:text-red-800"
                >
                  <RefreshCw size={14} />
                  Reintentar
                </button>
              </div>
            )}

            {/* Grid */}
            <ResultsGrid
              opportunities={opportunities}
              loading={loading}
              onFavoriteToggle={handleFavoriteToggle}
            />

            {/* Estado vacío inicial */}
            {!hasSearched && !loading && (
              <div className="text-center py-20 bg-white rounded-xl border border-slate-200 shadow-sm fade-in">
                <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Search size={28} className="text-indigo-400" />
                </div>
                <h3 className="text-[15px] font-bold text-slate-800 mb-2">
                  Busca licitaciones
                </h3>
                <p className="text-slate-500 text-[13px] max-w-sm mx-auto">
                  Escribe el nombre de un producto, servicio o el código exacto de la licitación
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {['computadores', 'servicios de aseo', 'mantención', 'obras civiles'].map(q => (
                    <button
                      key={q}
                      onClick={() => handleSearch(q)}
                      className="px-3 py-1.5 rounded-full bg-slate-100 hover:bg-indigo-100 hover:text-indigo-700 text-[12px] font-medium text-slate-600 transition-colors border border-slate-200 hover:border-indigo-200"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Sin resultados */}
            {hasSearched && !loading && !error && opportunities.length === 0 && (
              <div className="text-center py-16 bg-white rounded-xl border border-slate-200 shadow-sm fade-in">
                <Search size={32} className="text-slate-300 mx-auto mb-4" />
                <h3 className="text-[15px] font-bold text-slate-700 mb-2">
                  Sin resultados para &ldquo;{lastQuery}&rdquo;
                </h3>
                <p className="text-slate-400 text-[13px]">
                  Prueba con otras palabras clave o ajusta los filtros
                </p>
              </div>
            )}

            {/* Paginación inferior */}
            {totalPages > 1 && !loading && (
              <div className="mt-6 flex justify-center gap-1.5">
                <button onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage <= 1}
                  className="px-4 py-2 text-[13px] font-medium rounded-xl bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  ← Anterior
                </button>
                <span className="px-4 py-2 text-[13px] font-bold bg-indigo-600 text-white rounded-xl">
                  {currentPage} / {totalPages}
                </span>
                <button onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage >= totalPages}
                  className="px-4 py-2 text-[13px] font-medium rounded-xl bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  Siguiente →
                </button>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-[#0a0f1e] border-t border-white/5 mt-auto">
        <div className="max-w-7xl mx-auto px-4 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-slate-500 text-sm">
            © {new Date().getFullYear()} ICA Licitaciones · Datos de{' '}
            <a
              href="https://www.mercadopublico.cl"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-400 hover:text-white transition-colors"
            >
              Mercado Público
            </a>
          </p>
          <p className="text-slate-600 text-xs">
            API v1 · ChileCompra
          </p>
        </div>
      </footer>
    </AppLayout>
  );
}

export default function Home() {
  return (
    <Suspense>
      <HomeContent />
    </Suspense>
  );
}
