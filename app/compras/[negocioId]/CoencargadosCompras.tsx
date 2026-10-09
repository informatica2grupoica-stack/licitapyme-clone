'use client';

// OTROS ENCARGADOS DEL NEGOCIO (migration-142). El principal sigue siendo quien se eligió al asignar; aquí se suman más personas que
// también se hacen cargo: abren y operan el negocio igual que el principal. Solo admin o jefe de ventas pueden sumarlos o sacarlos.
import { useState } from 'react';
import { IconUserPlus as UserPlus, IconLoader2 as Loader2, IconCheck as Check } from '@tabler/icons-react';
import { useToast } from '@/app/components/ui/toast';

export function CoencargadosCompras({ negocioId, principalId, coencargados, candidatos, puedeEditar, onCambio }: {
  negocioId: number; principalId: number | null;
  coencargados: Array<{ id: number; nombre: string | null }>;
  candidatos: Array<{ id: number; nombre: string | null; carga: number }>;
  puedeEditar: boolean; onCambio: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [elegidos, setElegidos] = useState<Set<number>>(new Set());
  const [guardando, setGuardando] = useState(false);

  const abrir = () => { setElegidos(new Set(coencargados.map(c => c.id))); setAbierto(true); };
  const alternar = (id: number) => setElegidos(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const guardar = async () => {
    setGuardando(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/asignar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ coencargadoIds: [...elegidos] }) });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo guardar');
      toast.success('Encargados actualizados');
      setAbierto(false);
      await onCambio();
    } catch (e: any) { toast.error('No se pudieron guardar los encargados', e.message); }
    finally { setGuardando(false); }
  };

  const opciones = candidatos.filter(c => c.id !== principalId);
  return (
    <div className="flex items-center gap-1.5 flex-wrap" data-testid="coencargados">
      {coencargados.map(c => <span key={c.id} className="font-semibold text-zinc-700 bg-zinc-100 border border-zinc-200 rounded-full px-2 py-0.5 text-[11.5px]">{c.nombre || `Usuario ${c.id}`}</span>)}
      {puedeEditar && !abierto && (
        <button type="button" onClick={abrir} className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-700 hover:text-teal-900">
          <UserPlus size={12} /> {coencargados.length ? 'Cambiar otros encargados' : 'Sumar otro encargado'}
        </button>
      )}
      {abierto && (
        <div className="basis-full mt-1.5 rounded-lg border border-zinc-200 bg-zinc-50 p-2.5">
          <p className="text-[11.5px] font-semibold text-zinc-600 mb-1.5">Elige a todos los que se hacen cargo junto al encargado principal</p>
          <div className="flex flex-wrap gap-1.5">
            {opciones.map(c => {
              const on = elegidos.has(c.id);
              return (
                <button key={c.id} type="button" onClick={() => alternar(c.id)} aria-pressed={on}
                  className={`inline-flex items-center gap-1 text-[11.5px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${on ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-100'}`}>
                  {on && <Check size={12} />} {c.nombre || `Usuario ${c.id}`} <span className={on ? 'opacity-80 font-normal' : 'text-zinc-400 font-normal'}>({c.carga})</span>
                </button>
              );
            })}
            {opciones.length === 0 && <span className="text-[11.5px] text-zinc-400">No hay más personas disponibles.</span>}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <button type="button" onClick={guardar} disabled={guardando} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-2.5 py-1.5 rounded-lg">
              {guardando ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Guardar
            </button>
            <button type="button" onClick={() => setAbierto(false)} disabled={guardando} className="text-[11.5px] text-zinc-500 hover:text-zinc-700">Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
