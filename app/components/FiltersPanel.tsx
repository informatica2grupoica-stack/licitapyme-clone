'use client';

import { useState } from 'react';
import { ESTADOS_LICITACION, REGIONES_CHILE } from '@/app/types/search.types';
import { Filter, ChevronDown, ChevronUp, X, SlidersHorizontal } from 'lucide-react';
import { TIPOS_LICITACION } from '@/app/lib/tipos-licitacion';

interface FilterValues {
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

interface FiltersPanelProps {
  filters: FilterValues;
  onChange: (filters: FilterValues) => void;
  onClear: () => void;
  onApply?: () => void;
}

const ESTADOS = Object.entries(ESTADOS_LICITACION).map(([key, label]) => ({
  key,
  label: label.replace(/^[^\w]+/, '').trim(),
}));

const ORDEN_OPTIONS = [
  { value: '', label: 'Por defecto' },
  { value: 'fecha_cierre_asc', label: 'Cierre: más próximo' },
  { value: 'fecha_cierre_desc', label: 'Cierre: más lejano' },
  { value: 'fecha_publicacion_desc', label: 'Publicación: más reciente' },
  { value: 'monto_desc', label: 'Monto: mayor a menor' },
  { value: 'monto_asc', label: 'Monto: menor a mayor' },
  { value: 'relevancia', label: 'Relevancia' },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-t border-gray-100 pt-3">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex justify-between items-center text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2"
      >
        {title}
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {open && children}
    </div>
  );
}

export function FiltersPanel({ filters, onChange, onClear, onApply }: FiltersPanelProps) {
  const [isOpen, setIsOpen] = useState(true);

  const hasActiveFilters =
    filters.estado.length > 0 || filters.tipo.length > 0 ||
    filters.montoMin || filters.montoMax ||
    filters.fechaDesde || filters.fechaHasta ||
    filters.organismo || filters.region || filters.tipoOrden;

  const activeCount = [
    filters.estado.length > 0,
    filters.tipo.length > 0,
    !!(filters.montoMin || filters.montoMax),
    !!(filters.fechaDesde || filters.fechaHasta),
    !!filters.organismo,
    !!filters.region,
    !!filters.tipoOrden,
  ].filter(Boolean).length;

  const toggleEstado = (key: string) => {
    const next = filters.estado.includes(key)
      ? filters.estado.filter(e => e !== key)
      : [...filters.estado, key];
    onChange({ ...filters, estado: next });
  };

  const toggleTipo = (key: string) => {
    const next = (filters.tipo || []).includes(key)
      ? (filters.tipo || []).filter(e => e !== key)
      : [...(filters.tipo || []), key];
    onChange({ ...filters, tipo: next });
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={15} className="text-gray-500" />
          <span className="text-sm font-semibold text-gray-800">Filtros</span>
          {activeCount > 0 && (
            <span className="px-1.5 py-0.5 text-xs bg-indigo-600 text-white rounded-full font-medium leading-none">
              {activeCount}
            </span>
          )}
        </div>
        {isOpen ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
      </button>

      {isOpen && (
        <div className="px-4 pb-4 space-y-1">
          {/* Limpiar */}
          {hasActiveFilters && (
            <button
              onClick={onClear}
              className="w-full flex items-center justify-center gap-1 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-lg transition-colors mb-2"
            >
              <X size={12} />
              Limpiar filtros
            </button>
          )}

          {/* Ordenamiento */}
          <Section title="Ordenar por">
            <select
              value={filters.tipoOrden}
              onChange={e => onChange({ ...filters, tipoOrden: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-indigo-500 bg-white"
            >
              {ORDEN_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Section>

          {/* Estado */}
          <Section title="Estado">
            <div className="space-y-1">
              {ESTADOS.map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 py-1 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={filters.estado.includes(key)}
                    onChange={() => toggleEstado(key)}
                    className="rounded border-gray-300 text-indigo-600 focus:ring-blue-500 w-3.5 h-3.5"
                  />
                  <span className="text-sm text-gray-600 group-hover:text-gray-900 transition-colors">{label}</span>
                </label>
              ))}
            </div>
          </Section>

          {/* Tipo de licitación */}
          <Section title="Tipo de licitación">
            <div className="space-y-0.5 max-h-52 overflow-y-auto pr-1">
              {TIPOS_LICITACION.map(t => (
                <label key={t.codigo} className="flex items-center gap-2 py-1 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={(filters.tipo || []).includes(t.codigo)}
                    onChange={() => toggleTipo(t.codigo)}
                    className="rounded border-gray-300 text-indigo-600 focus:ring-blue-500 w-3.5 h-3.5 flex-shrink-0"
                  />
                  <span
                    className="text-[10px] font-black px-1.5 py-0 rounded text-white flex-shrink-0"
                    style={{ backgroundColor: t.color }}
                  >
                    {t.codigo}
                  </span>
                  <span className="text-xs text-gray-600 group-hover:text-gray-900 truncate">{t.label}</span>
                </label>
              ))}
            </div>
          </Section>

          {/* Región */}
          <Section title="Región">
            <select
              value={filters.region}
              onChange={e => onChange({ ...filters, region: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-indigo-500 bg-white"
            >
              <option value="">Todas las regiones</option>
              {REGIONES_CHILE.map(r => (
                <option key={r} value={r}>{r.replace('Región de ', '').replace('Región del ', '').replace('Región Metropolitana de ', 'RM · ')}</option>
              ))}
            </select>
          </Section>

          {/* Monto */}
          <Section title="Monto estimado (CLP)">
            <div className="flex gap-2">
              <input
                type="number"
                placeholder="Mín"
                value={filters.montoMin}
                onChange={e => onChange({ ...filters, montoMin: e.target.value })}
                className="w-1/2 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-indigo-500"
              />
              <input
                type="number"
                placeholder="Máx"
                value={filters.montoMax}
                onChange={e => onChange({ ...filters, montoMax: e.target.value })}
                className="w-1/2 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-indigo-500"
              />
            </div>
          </Section>

          {/* Fechas */}
          <Section title="Fecha de cierre">
            <div className="space-y-2">
              <input
                type="date"
                value={filters.fechaDesde}
                onChange={e => onChange({ ...filters, fechaDesde: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-indigo-500"
                placeholder="Desde"
              />
              <input
                type="date"
                value={filters.fechaHasta}
                onChange={e => onChange({ ...filters, fechaHasta: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-indigo-500"
                placeholder="Hasta"
              />
            </div>
          </Section>

          {/* Organismo */}
          <Section title="Organismo comprador">
            <input
              type="text"
              placeholder="Ej: Ministerio de Salud..."
              value={filters.organismo}
              onChange={e => onChange({ ...filters, organismo: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-indigo-500"
            />
          </Section>

          {/* Aplicar */}
          {onApply && (
            <button
              onClick={onApply}
              className="w-full mt-2 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Aplicar filtros
            </button>
          )}
        </div>
      )}
    </div>
  );
}

