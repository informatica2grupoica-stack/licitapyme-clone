'use client';

import { useState, useRef, FormEvent } from 'react';
import { Search, X, Loader2 } from 'lucide-react';

interface SearchBarProps {
  onSearch: (query: string) => void;
  loading?: boolean;
  placeholder?: string;
  initialValue?: string;
}

export function SearchBar({ onSearch, loading = false, placeholder, initialValue = '' }: SearchBarProps) {
  const [query, setQuery] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSearch(query.trim());
  };

  const handleClear = () => {
    setQuery('');
    inputRef.current?.focus();
    onSearch('');
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl mx-auto">
      <div className="relative flex items-center bg-white rounded-xl shadow-xl overflow-hidden">
        <Search size={18} className="absolute left-4 text-gray-400 pointer-events-none flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={placeholder || 'Ej: servicios de aseo, computadores, 1509-5-LP23...'}
          className="flex-1 pl-11 pr-4 py-4 text-sm text-gray-900 placeholder-gray-400 bg-transparent focus:outline-none"
          disabled={loading}
          autoComplete="off"
        />
        {query && !loading && (
          <button
            type="button"
            onClick={handleClear}
            className="px-2 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={16} />
          </button>
        )}
        <button
          type="submit"
          disabled={loading}
          className="m-1.5 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2 flex-shrink-0"
        >
          {loading ? (
            <><Loader2 size={15} className="animate-spin" />Buscando</>
          ) : (
            <><Search size={15} />Buscar</>
          )}
        </button>
      </div>
      <p className="text-center text-xs text-slate-500 mt-2">
        Busca por nombre, categoría o código exacto de licitación
      </p>
    </form>
  );
}