'use client';

import { useState, useCallback, useEffect } from 'react';
import { SearchBar } from '@/app/components/SearchBar';
import { ResultsGrid } from '@/app/components/ResultsGrid';
import { FiltersPanel } from '@/app/components/FiltersPanel';
import { SearchRequest, Oportunidad } from '@/app/types/search.types';

export default function Home() {
  const [opportunities, setOpportunities] = useState<Oportunidad[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalResults, setTotalResults] = useState(0);
  const [lastQuery, setLastQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [favoriteCodes, setFavoriteCodes] = useState<Set<string>>(new Set());
  
  const [filters, setFilters] = useState({
    estado: [] as string[],
    montoMin: '',
    montoMax: '',
    fechaDesde: '',
    fechaHasta: '',
    organismo: ''
  });

  // Cargar favoritos al inicio
  useEffect(() => {
    loadFavorites();
  }, []);

  const loadFavorites = async () => {
    try {
      const response = await fetch('/api/favorites');
      const data = await response.json();
      if (data.success && data.favorites) {
        setFavoriteCodes(new Set(data.favorites.map((f: any) => f.codigo)));
      }
    } catch (error) {
      console.error('Error al cargar favoritos:', error);
    }
  };

  const executeSearch = useCallback(async (query: string, page: number = 1) => {
    setLoading(true);
    setError(null);
    
    try {
      const request: SearchRequest = {
        consulta: query,
        pagina: page,
        resultados_por_pagina: 20,
        filtro_estado: filters.estado.length > 0 ? filters.estado as any : undefined,
        filtro_monto_min: filters.montoMin ? parseInt(filters.montoMin) : undefined,
        filtro_monto_max: filters.montoMax ? parseInt(filters.montoMax) : undefined,
        filtro_fecha_cierre_desde: filters.fechaDesde || undefined,
        filtro_fecha_cierre_hasta: filters.fechaHasta || undefined,
        filtro_organismos: filters.organismo ? [filters.organismo] : undefined
      };
      
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
      });
      
      if (!response.ok) {
        throw new Error('Error en la búsqueda');
      }
      
      const data = await response.json();
      let resultados = data.resultados || [];
      
      // Filtrar solo favoritos si está activado
      if (showFavoritesOnly && favoriteCodes.size > 0) {
        resultados = resultados.filter((r: Oportunidad) => favoriteCodes.has(r.codigo));
      }
      
      setOpportunities(resultados);
      setTotalResults(showFavoritesOnly ? resultados.length : data.meta?.total_resultados || 0);
      setTotalPages(data.meta?.total_paginas || 1);
      setCurrentPage(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
      setOpportunities([]);
    } finally {
      setLoading(false);
    }
  }, [filters, showFavoritesOnly, favoriteCodes]);

  const handleSearch = async (query: string) => {
    setLastQuery(query);
    await executeSearch(query, 1);
  };

  const handleFavoriteToggle = () => {
    loadFavorites();
    if (lastQuery) {
      executeSearch(lastQuery, currentPage);
    }
  };

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      executeSearch(lastQuery, newPage);
    }
  };

  const handleClearFilters = () => {
    setFilters({
      estado: [],
      montoMin: '',
      montoMax: '',
      fechaDesde: '',
      fechaHasta: '',
      organismo: ''
    });
    if (lastQuery) {
      executeSearch(lastQuery, 1);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Licitaciones Chile
          </h1>
          <p className="text-gray-600">
            Buscador de oportunidades de licitación en Mercado Público
          </p>
        </div>

        <SearchBar onSearch={handleSearch} loading={loading} />

        <div className="mt-8 flex flex-col lg:flex-row gap-6">
          {/* Panel de filtros */}
          <aside className="lg:w-80 flex-shrink-0">
            <FiltersPanel 
              filters={filters}
              onChange={setFilters}
              onClear={handleClearFilters}
            />
            
            {/* Botón de solo favoritos */}
            <div className="mt-4 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <button
                onClick={() => {
                  setShowFavoritesOnly(!showFavoritesOnly);
                  if (lastQuery) {
                    executeSearch(lastQuery, 1);
                  }
                }}
                className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-md transition-colors ${
                  showFavoritesOnly 
                    ? 'bg-yellow-500 text-white hover:bg-yellow-600'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <span>⭐</span>
                {showFavoritesOnly ? 'Mostrando solo favoritos' : 'Ver solo favoritos'}
              </button>
              {favoriteCodes.size > 0 && (
                <p className="text-xs text-gray-500 text-center mt-2">
                  {favoriteCodes.size} licitaciones guardadas
                </p>
              )}
            </div>
          </aside>

          {/* Resultados */}
          <div className="flex-1">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                Error: {error}
              </div>
            )}

            {!loading && !error && totalResults > 0 && (
              <div className="mb-4 flex justify-between items-center flex-wrap gap-2">
                <div className="text-sm text-gray-600">
                  {totalResults} resultados encontrados
                  {lastQuery && ` para "${lastQuery}"`}
                  {showFavoritesOnly && ' (solo favoritos)'}
                </div>
                
                {!showFavoritesOnly && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handlePageChange(currentPage - 1)}
                      disabled={currentPage <= 1 || loading}
                      className="px-3 py-1 text-sm bg-blue-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
                    >
                      ← Anterior
                    </button>
                    <span className="px-3 py-1 text-sm bg-gray-200 rounded">
                      Pág. {currentPage} de {totalPages}
                    </span>
                    <button
                      onClick={() => handlePageChange(currentPage + 1)}
                      disabled={currentPage >= totalPages || loading}
                      className="px-3 py-1 text-sm bg-blue-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
                    >
                      Siguiente →
                    </button>
                  </div>
                )}
              </div>
            )}

            <ResultsGrid 
              opportunities={opportunities} 
              loading={loading}
              onFavoriteToggle={handleFavoriteToggle}
            />

            {!loading && !error && totalResults === 0 && lastQuery && (
              <div className="text-center py-12 bg-white rounded-lg shadow">
                <p className="text-gray-600">No se encontraron resultados para "{lastQuery}"</p>
                <p className="text-sm text-gray-400 mt-1">Prueba con otras palabras clave</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}