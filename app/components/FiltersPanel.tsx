'use client';

import { useState } from 'react';
import { ESTADOS_LICITACION, REGIONES_CHILE } from '@/app/types/search.types';
import { Filter, ChevronDown, ChevronUp, X } from 'lucide-react';

interface FiltersPanelProps {
  filters: {
    estado: string[];
    montoMin: string;
    montoMax: string;
    fechaDesde: string;
    fechaHasta: string;
    organismo: string;
  };
  onChange: (filters: any) => void;
  onClear: () => void;
}

export function FiltersPanel({ filters, onChange, onClear }: FiltersPanelProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [showEstados, setShowEstados] = useState(false);

  const hasActiveFilters = () => {
    return filters.estado.length > 0 || 
           filters.montoMin || 
           filters.montoMax || 
           filters.fechaDesde || 
           filters.fechaHasta || 
           filters.organismo;
  };

  const handleEstadoChange = (estadoKey: string) => {
    const newEstados = filters.estado.includes(estadoKey)
      ? filters.estado.filter(e => e !== estadoKey)
      : [...filters.estado, estadoKey];
    onChange({ ...filters, estado: newEstados });
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      {/* Header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 flex justify-between items-center hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Filter size={18} className="text-gray-500" />
          <span className="font-medium text-gray-900">Filtros</span>
          {hasActiveFilters() && (
            <span className="ml-2 px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full">
              Activos
            </span>
          )}
        </div>
        {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>

      {isOpen && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-100 pt-4">
          {/* Limpiar filtros */}
          {hasActiveFilters() && (
            <button
              onClick={onClear}
              className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-sm text-red-600 bg-red-50 rounded-md hover:bg-red-100 transition-colors"
            >
              <X size={14} />
              Limpiar todos los filtros
            </button>
          )}

          {/* Estado de licitación */}
          <div>
            <button
              onClick={() => setShowEstados(!showEstados)}
              className="w-full flex justify-between items-center text-sm font-medium text-gray-700 mb-2"
            >
              <span>Estado de la licitación</span>
              {showEstados ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {showEstados && (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {Object.entries(ESTADOS_LICITACION).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 p-1 rounded">
                    <input
                      type="checkbox"
                      checked={filters.estado.includes(key)}
                      onChange={() => handleEstadoChange(key)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-gray-700">{label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Rango de montos */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Monto (CLP)
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                placeholder="Mínimo"
                value={filters.montoMin}
                onChange={(e) => onChange({ ...filters, montoMin: e.target.value })}
                className="w-1/2 px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
              <input
                type="number"
                placeholder="Máximo"
                value={filters.montoMax}
                onChange={(e) => onChange({ ...filters, montoMax: e.target.value })}
                className="w-1/2 px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          {/* Fecha de cierre */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Fecha de cierre
            </label>
            <div className="flex gap-2">
              <input
                type="date"
                placeholder="Desde"
                value={filters.fechaDesde}
                onChange={(e) => onChange({ ...filters, fechaDesde: e.target.value })}
                className="w-1/2 px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
              <input
                type="date"
                placeholder="Hasta"
                value={filters.fechaHasta}
                onChange={(e) => onChange({ ...filters, fechaHasta: e.target.value })}
                className="w-1/2 px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          {/* Organismo */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Organismo comprador
            </label>
            <input
              type="text"
              placeholder="Nombre del organismo..."
              value={filters.organismo}
              onChange={(e) => onChange({ ...filters, organismo: e.target.value })}
              className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Estadísticas */}
          <div className="pt-2 text-xs text-gray-500 border-t border-gray-100">
            <p>💡 Los filtros se aplican automáticamente</p>
          </div>
        </div>
      )}
    </div>
  );
}