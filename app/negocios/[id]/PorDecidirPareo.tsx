'use client';
// «Por decidir»: líneas de cotización de OTRO modelo o marca que podrían servir para un producto. El pareo no las asigna solo (no sabe si el equivalente
// cumple); aquí una persona decide en un clic: Sí sirve (se asigna y queda como equivalencia de la empresa), Solo aquí (se asigna en este negocio) o No sirve.
import { useCallback, useEffect, useState } from 'react';
import { IconChevronDown as ChevronDown, IconCheck as Check, IconX as X, IconLoader2 as Loader2 } from '@tabler/icons-react';
import { useToast } from '@/app/components/ui/toast';

interface Caso {
  clave: string; cotizacionId: number; proveedor: string;
  lineaTexto: string; lineaCantidad: number | null; lineaUnidad: string | null; precioNeto: number;
  productoId: number; productoDescripcion: string; productoCantidad: number | null;
  precioActual: number | null; proveedorActual: string | null; ahorro: number | null; diferencias: string[];
}
type Decision = 'SI_SIRVE' | 'NO_SIRVE' | 'SOLO_AQUI';
const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;

export function PorDecidirPareo({ negocioId, onCambio }: { negocioId: number; onCambio?: () => void | Promise<void> }) {
  const toast = useToast();
  const [casos, setCasos] = useState<Caso[] | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [trabajando, setTrabajando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/compras/${negocioId}/por-decidir`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar');
      setCasos(data.casos);
    } catch (e: any) { setCasos([]); toast.error('No se pudo cargar la lista por decidir', e.message); }
  }, [negocioId]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { cargar(); }, [cargar]);

  const decidir = async (c: Caso, decision: Decision) => {
    setTrabajando(`${c.clave}:${decision}`);
    try {
      const res = await fetch(`/api/compras/${negocioId}/por-decidir`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clave: c.clave, decision }) });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo guardar');
      setCasos(data.casos);
      if (decision === 'NO_SIRVE') toast.info('Anotado: no sirve', 'No se vuelve a ofrecer.');
      else toast.success('Asignada', data.equivalenciaCreada ? `«${data.equivalenciaCreada}» quedó como equivalencia de tu empresa.` : decision === 'SOLO_AQUI' ? 'Solo en este negocio.' : undefined);
      await onCambio?.();
    } catch (e: any) { toast.error('No se pudo guardar', e.message); } finally { setTrabajando(null); }
  };

  if (casos === null || casos.length === 0) return null;
  return (
    <div className="px-4 py-2 border-b border-zinc-100">
      <button onClick={() => setAbierto(a => !a)} aria-expanded={abierto} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-tinta hover:text-tinta-2">
        <ChevronDown size={14} className={`transition-transform ${abierto ? '' : '-rotate-90'}`} />
        Por decidir ({casos.length})
        <span className="text-xs font-normal text-tinta-3">· cotizaciones de otro modelo o marca que podrían servir</span>
      </button>
      {abierto && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-tinta-3">El sistema no asigna solo un modelo distinto al que piden las bases. Si sirve, dilo aquí: «Sí sirve» queda como equivalencia de tu empresa para los próximos negocios; «Solo aquí» vale únicamente para este.</p>
          <ul className="space-y-2">
            {casos.map(c => (
              <li key={c.clave} className="border border-zinc-200 rounded-lg p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-wide text-tinta-3">Piden</p>
                    <p className="text-[13px] text-tinta">{c.productoDescripcion}</p>
                    <p className="text-xs text-tinta-3">{c.productoCantidad ?? '?'} un.{c.precioActual != null ? ` · hoy lo mejor es ${clp(c.precioActual)}${c.proveedorActual ? ` (${c.proveedorActual})` : ''}` : ' · todavía sin precio'}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-wide text-tinta-3">Ofrece {c.proveedor}</p>
                    <p className="text-[13px] text-tinta">{c.lineaTexto}</p>
                    <p className="text-xs text-tinta-3"><span className="font-medium text-tinta">{clp(c.precioNeto)}</span> neto c/u{c.ahorro != null && c.ahorro > 0 ? <> · <span className="text-emerald-700 font-medium">ahorra {clp(c.ahorro)}</span></> : null}</p>
                  </div>
                </div>
                <p className="mt-2 text-xs text-tinta-2">
                  {c.diferencias.length > 0 ? <>Cambia: {c.diferencias.join(' · ')}. </> : null}
                  <span className="text-tinta-3">Es otro modelo o marca: verifica con la ficha que cumple lo que piden las bases.</span>
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {([['SI_SIRVE', 'Sí sirve', Check], ['SOLO_AQUI', 'Sirve solo aquí', Check], ['NO_SIRVE', 'No sirve', X]] as const).map(([d, texto, Icono]) => (
                    <button key={d} onClick={() => decidir(c, d)} disabled={trabajando !== null}
                      className={`inline-flex items-center gap-1.5 h-8 text-[13px] font-medium px-3 rounded-lg border disabled:opacity-50 ${d === 'SI_SIRVE' ? 'bg-zinc-900 text-white border-zinc-900 hover:bg-zinc-800' : 'text-tinta-2 border-zinc-200 hover:bg-zinc-50'}`}>
                      {trabajando === `${c.clave}:${d}` ? <Loader2 size={13} className="animate-spin" /> : <Icono size={13} />}{texto}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
