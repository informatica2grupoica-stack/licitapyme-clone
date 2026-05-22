// src/app/components/ResultsGrid.tsx
'use client';

import Link from 'next/link';
import { Oportunidad, ESTADOS_LICITACION } from '@/app/types/search.types';
import { Calendar, Building2, DollarSign, Clock, Star, StarOff, ExternalLink } from 'lucide-react';
import { useFavorites } from '@/app/hooks/useFavorites';
import { useState } from 'react';

interface ResultsGridProps {
  opportunities: Oportunidad[];
  loading?: boolean;
  onFavoriteToggle?: () => void;
}

export function ResultsGrid({ opportunities, loading = false, onFavoriteToggle }: ResultsGridProps) {
  const { isFavorite, toggleFavorite } = useFavorites();
  const [toggling, setToggling] = useState<string | null>(null);

  const handleToggleFavorite = async (opp: Oportunidad) => {
    setToggling(opp.codigo);
    const success = await toggleFavorite({
      codigo: opp.codigo,
      nombre: opp.nombre,
      organismo: opp.organismo,
      monto_total: opp.monto_total,
      fecha_cierre: opp.fecha_cierre,
      estado: opp.estado
    });
    setToggling(null);
    if (success && onFavoriteToggle) {
      onFavoriteToggle();
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white rounded-lg shadow p-6 animate-pulse">
            <div className="h-5 bg-gray-200 rounded w-3/4 mb-3"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
            <div className="h-4 bg-gray-200 rounded w-1/3"></div>
          </div>
        ))}
      </div>
    );
  }

  if (opportunities.length === 0) {
    return (
      <div className="text-center py-12 bg-white rounded-lg shadow">
        <div className="text-6xl mb-4">🔍</div>
        <p className="text-gray-600">No se encontraron resultados</p>
        <p className="text-sm text-gray-400 mt-1">Intenta con otras palabras clave</p>
      </div>
    );
  }

  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'Fecha no disponible';
    const date = new Date(dateStr);
    return date.toLocaleDateString('es-CL', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const formatCurrency = (amount?: number) => {
    if (!amount) return 'Monto no especificado';
    return new Intl.NumberFormat('es-CL', { 
      style: 'currency', 
      currency: 'CLP',
      maximumFractionDigits: 0
    }).format(amount);
  };

  const getEstadoInfo = (estado: string) => {
    const label = ESTADOS_LICITACION[estado] || 'Estado desconocido';
    const color = estado === '5' ? 'bg-green-100 text-green-800' :
                  estado === '6' ? 'bg-gray-100 text-gray-800' :
                  estado === '8' ? 'bg-blue-100 text-blue-800' :
                  'bg-yellow-100 text-yellow-800';
    return { label, color };
  };

  return (
    <div className="space-y-4">
      {opportunities.map((opp) => {
        const estadoInfo = getEstadoInfo(opp.estado);
        const fav = isFavorite(opp.codigo);
        const isToggling = toggling === opp.codigo;
        
        return (
          <div key={opp.codigo} className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-all duration-200 fade-in">
            {/* Header con código y estado */}
            <div className="flex justify-between items-start mb-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  {/* Título con enlace a detalle */}
                  <Link 
                    href={`/licitacion/${opp.codigo}`} 
                    className="hover:text-blue-600 transition-colors"
                  >
                    <h3 className="text-lg font-semibold text-gray-900 hover:text-blue-600">
                      {opp.nombre}
                    </h3>
                  </Link>
                  {/* Botón de favorito */}
                  <button
                    onClick={() => handleToggleFavorite(opp)}
                    disabled={isToggling}
                    className="p-1 hover:bg-gray-100 rounded-full transition-colors"
                    title={fav ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                  >
                    {fav ? (
                      <Star className="w-5 h-5 text-yellow-500 fill-yellow-500" />
                    ) : (
                      <StarOff className="w-5 h-5 text-gray-400 hover:text-gray-600" />
                    )}
                  </button>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <span>Código: {opp.codigo}</span>
                </div>
              </div>
              <span className={`px-2 py-1 text-xs font-medium rounded-full ${estadoInfo.color}`}>
                {estadoInfo.label}
              </span>
            </div>
            
            {/* Descripción */}
            {opp.descripcion && (
              <p className="text-sm text-gray-600 mb-4 line-clamp-2">
                {opp.descripcion}
              </p>
            )}
            
            {/* Grid de información */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2 text-gray-600">
                <Building2 size={16} className="flex-shrink-0" />
                <span className="truncate">{opp.organismo}</span>
              </div>
              
              <div className="flex items-center gap-2 text-gray-600">
                <DollarSign size={16} className="flex-shrink-0" />
                <span className="font-medium">{formatCurrency(opp.monto_total)}</span>
              </div>
              
              <div className="flex items-center gap-2 text-gray-600">
                <Calendar size={16} className="flex-shrink-0" />
                <span>Cierre: {formatDate(opp.fecha_cierre)}</span>
              </div>
              
              {opp.dias_cierre !== undefined && opp.dias_cierre > 0 && (
                <div className="flex items-center gap-2">
                  <Clock size={16} className="flex-shrink-0 text-orange-500" />
                  <span className="text-orange-600 font-medium">
                    {opp.dias_cierre} días para cerrar
                  </span>
                </div>
              )}
            </div>
            
            {/* Score de relevancia */}
            {opp.score !== undefined && opp.score > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-600 rounded-full transition-all"
                      style={{ width: `${(opp.score || 0) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500">
                    {Math.round((opp.score || 0) * 100)}% relevancia
                  </span>
                </div>
                
                {opp.url && (
                  <a 
                    href={opp.url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 transition-colors"
                  >
                    <ExternalLink size={16} />
                  </a>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}