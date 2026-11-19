'use client';
// Equivalencias de la empresa para el pareo de cotizaciones: «HST 300» = «electrofusión (equivale a Elektra Light 160)».
// Se guardan por empresa (API /api/compras/[negocioId]/equivalencias) y el pareo las usa al repartir las líneas entre los productos.
import { useState } from 'react';
import { IconChevronDown as ChevronDown, IconTrash as Trash2, IconPlus as Plus } from '@tabler/icons-react';
import { useToast } from '@/app/components/ui/toast';

interface Equivalencia { id: number; patron: string; familia: string }

export function EquivalenciasPareo({ negocioId }: { negocioId: number }) {
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [lista, setLista] = useState<Equivalencia[] | null>(null);
  const [patron, setPatron] = useState('');
  const [familia, setFamilia] = useState('');
  const [guardando, setGuardando] = useState(false);

  const llamar = async (init?: RequestInit, query = '') => {
    const res = await fetch(`/api/compras/${negocioId}/equivalencias${query}`, init);
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo completar');
    setLista(data.equivalencias);
  };
  const alternar = () => {
    const abrir = !abierto;
    setAbierto(abrir);
    if (abrir && lista === null) llamar().catch(e => toast.error('No se pudieron cargar las equivalencias', e.message));
  };

  const agregar = async () => {
    setGuardando(true);
    try {
      await llamar({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ patron, familia }) });
      setPatron(''); setFamilia('');
    } catch (e: any) { toast.error('No se pudo guardar', e.message); } finally { setGuardando(false); }
  };
  const quitar = async (id: number) => {
    try { await llamar({ method: 'DELETE' }, `?id=${id}`); } catch (e: any) { toast.error('No se pudo borrar', e.message); }
  };

  return (
    <div className="px-4 py-2 border-b border-zinc-100">
      <button onClick={alternar} aria-expanded={abierto} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-tinta-2 hover:text-tinta">
        <ChevronDown size={14} className={`transition-transform ${abierto ? '' : '-rotate-90'}`} />
        Equivalencias de tu empresa{lista ? ` (${lista.length})` : ''}
      </button>
      {abierto && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-tinta-3">Enséñale al pareo qué modelos o marcas son lo mismo para ustedes. Ej.: «HST 300» = «electrofusión 20-160 mm (equivale a Elektra Light 160)». Sirve para todos los negocios de la empresa.</p>
          {lista === null ? <p className="text-xs text-tinta-3">Cargando…</p> : lista.length === 0 ? <p className="text-xs text-tinta-3">Todavía no hay equivalencias.</p> : (
            <ul className="divide-y divide-zinc-100 border border-zinc-200 rounded-lg">
              {lista.map(e => (
                <li key={e.id} className="flex items-center gap-3 px-3 py-1.5 text-[13px]">
                  <span className="font-medium text-tinta shrink-0">{e.patron}</span>
                  <span className="text-tinta-3">=</span>
                  <span className="text-tinta-2 flex-1 min-w-0 truncate" title={e.familia}>{e.familia}</span>
                  <button onClick={() => quitar(e.id)} aria-label={`Quitar la equivalencia de ${e.patron}`} className="text-tinta-3 hover:text-red-600"><Trash2 size={14} /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input value={patron} onChange={e => setPatron(e.target.value)} maxLength={120} placeholder="Modelo o palabra (ej. HST 300)" aria-label="Modelo o palabra"
              className="h-8 w-56 text-[13px] border border-zinc-200 rounded-lg px-2.5" />
            <input value={familia} onChange={e => setFamilia(e.target.value)} maxLength={300} placeholder="Es lo mismo que… (ej. electrofusión, equivale a Elektra Light 160)" aria-label="Familia a la que equivale"
              className="h-8 flex-1 min-w-64 text-[13px] border border-zinc-200 rounded-lg px-2.5" />
            <button onClick={agregar} disabled={guardando || !patron.trim() || !familia.trim()}
              className="inline-flex items-center gap-1.5 h-8 text-[13px] font-medium text-tinta-2 hover:text-tinta border border-zinc-200 hover:bg-zinc-50 disabled:opacity-50 px-3 rounded-lg">
              <Plus size={13} />Agregar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
