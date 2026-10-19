'use client';

// LO DE COMPRAS POR APROBAR, AGRUPADO POR LICITACIÓN dentro de /aprobaciones: una sola tarjeta por licitación con todo lo que Compras
// mandó a aprobar de ella (compra completa, margen, compras rápidas, corregidos, renuncias). Antes cada cosa era una tarjeta aparte y
// la misma licitación salía repetida. Tocar la tarjeta (o «Abrir en Compras») lleva al paso exacto donde se decide; la compra rápida
// además se aprueba o rechaza aquí mismo.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconBolt as Bolt, IconScale as Scale, IconPercentage as Pct, IconRefresh as Refresh, IconDoorExit as Salida, IconArrowRight as Flecha, IconLoader2 as Loader2, IconCheck as Check, IconX as X } from '@tabler/icons-react';
import type { ItemBandejaCompras, TipoItemCompras } from '@/app/lib/compras-bandeja-aprobacion';

const TIPO: Record<TipoItemCompras, { etiqueta: string; Icono: typeof Bolt; caja: string; chip: string }> = {
  COMPRA_RAPIDA: { etiqueta: 'Compra rápida', Icono: Bolt, caja: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300', chip: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30' },
  COMPRA: { etiqueta: 'Cuadro comparativo', Icono: Scale, caja: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300', chip: 'bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/30' },
  MARGEN: { etiqueta: 'Margen', Icono: Pct, caja: 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300', chip: 'bg-teal-50 text-teal-800 border-teal-200 dark:bg-teal-500/10 dark:text-teal-300 dark:border-teal-500/30' },
  PRODUCTO_CORREGIDO: { etiqueta: 'Corregido, a revisar', Icono: Refresh, caja: 'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300', chip: 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/30' },
  RENUNCIA: { etiqueta: 'Renuncia a una línea', Icono: Salida, caja: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300', chip: 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30' },
};
// Orden dentro de la licitación: primero lo que bloquea la compra completa.
const ORDEN: TipoItemCompras[] = ['COMPRA', 'MARGEN', 'COMPRA_RAPIDA', 'PRODUCTO_CORREGIDO', 'RENUNCIA'];

/** Minutos desde que se pidió («AAAA-MM-DD HH:mm:ss», hora de Chile); null si no se puede leer. */
export function minutosEsperando(fecha: string | null): number | null {
  if (!fecha) return null;
  const t = Date.parse(fecha.replace(' ', 'T'));
  return Number.isNaN(t) ? null : Math.max(0, Math.round((Date.now() - t) / 60000));
}
function hace(min: number | null): string {
  if (min == null) return '';
  if (min < 2) return 'recién';
  if (min < 60) return `hace ${min} min`;
  if (min < 60 * 24) return `hace ${Math.round(min / 60)} h`;
  const d = Math.round(min / 1440);
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
}
const iniciales = (n: string | null) => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]!.toUpperCase()).join('');

/** Agrupa los ítems por licitación: la que lleva más tiempo esperando primero. */
export function agruparPorLicitacion(items: ItemBandejaCompras[]): Array<{ negocioId: number; items: ItemBandejaCompras[] }> {
  const por = new Map<number, ItemBandejaCompras[]>();
  for (const i of items) por.set(i.negocioId, [...(por.get(i.negocioId) ?? []), i]);
  const espera = (xs: ItemBandejaCompras[]) => Math.max(...xs.map(x => minutosEsperando(x.solicitadoAt) ?? 0));
  return [...por.entries()]
    .map(([negocioId, xs]) => ({ negocioId, items: [...xs].sort((a, b) => ORDEN.indexOf(a.tipo) - ORDEN.indexOf(b.tipo)) }))
    .sort((a, b) => espera(b.items) - espera(a.items));
}

function FilaPendiente({ item, onResuelto }: { item: ItemBandejaCompras; onResuelto: (id: string, decision: 'APROBAR' | 'RECHAZAR') => void }) {
  const router = useRouter();
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState<'APROBAR' | 'RECHAZAR' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = TIPO[item.tipo];
  const espera = minutosEsperando(item.solicitadoAt);

  const decidir = async (decision: 'APROBAR' | 'RECHAZAR') => {
    setGuardando(decision); setError(null);
    try {
      const res = await fetch(`/api/compras/${item.negocioId}/compra-rapida`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productoId: item.productoId, decision, comentario: decision === 'RECHAZAR' ? motivo : null }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo guardar');
      onResuelto(item.id, decision);
    } catch (e: any) { setError(e.message); setGuardando(null); }
  };

  const hechos = item.hechos.length > 0 ? item.hechos : [{ etiqueta: 'Detalle', valor: item.detalle }];
  return (
    <div className="px-4 py-3.5" data-testid={`aprob-compras-${item.id}`}>
      <div className="flex items-start gap-3">
        <span className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${t.caja}`}><t.Icono size={18} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[11.5px] font-bold px-2.5 py-0.5 rounded-full border ${t.chip}`}>{t.etiqueta}</span>
            <span className="text-[12px] text-zinc-400">{item.solicitadoPorNombre ? <>lo mandó <b className="text-zinc-600 dark:text-zinc-300 font-semibold">{item.solicitadoPorNombre}</b></> : 'mandado a aprobar'}{item.solicitadoAt ? ` · ${hace(espera)}` : ''}</span>
          </div>
          <p className="text-[14.5px] font-bold text-zinc-900 dark:text-zinc-100 leading-snug mt-1">{item.titulo}</p>
          <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5">
            {hechos.map(h => (
              <div key={h.etiqueta} className={`min-w-0 ${h.valor.length > 50 ? 'basis-full' : ''}`}>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{h.etiqueta}</dt>
                <dd className="text-[13.5px] font-semibold text-zinc-800 dark:text-zinc-100 leading-snug break-words">{h.valor}</dd>
              </div>
            ))}
          </dl>

          {item.accionRapida && !rechazando && (
            <div className="flex items-center gap-2 mt-3">
              <button type="button" onClick={() => decidir('APROBAR')} disabled={guardando != null}
                className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 px-4 py-2 rounded-xl shadow-sm">
                {guardando === 'APROBAR' ? <Loader2 size={14} className="animate-spin" /> : <Check size={15} />}{item.yaComprada ? 'Ratificar' : 'Aprobar'}
              </button>
              <button type="button" onClick={() => setRechazando(true)} disabled={guardando != null}
                className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-rose-700 border border-rose-300 hover:bg-rose-50 dark:text-rose-300 dark:border-rose-500/40 dark:hover:bg-rose-500/10 disabled:opacity-50 px-4 py-2 rounded-xl">
                <X size={14} /> Rechazar
              </button>
              <button type="button" onClick={() => router.push(item.ruta)} className="text-[13px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline px-1">Ver el producto</button>
            </div>
          )}
          {item.accionRapida && rechazando && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="¿Por qué se rechaza? (obligatorio)" autoFocus
                className="flex-1 min-w-[220px] text-[13.5px] border border-rose-300 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-rose-300 bg-white dark:bg-zinc-950 dark:text-zinc-100" />
              <button type="button" onClick={() => decidir('RECHAZAR')} disabled={guardando != null || !motivo.trim()} className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-40 px-4 py-2 rounded-xl">
                {guardando === 'RECHAZAR' && <Loader2 size={14} className="animate-spin" />}Confirmar rechazo</button>
              <button type="button" onClick={() => { setRechazando(false); setMotivo(''); }} className="text-[13px] text-zinc-500 px-2 py-2">Cancelar</button>
            </div>
          )}
          {error && <p className="text-[12.5px] text-rose-600 mt-2">{error}</p>}
        </div>
      </div>
    </div>
  );
}

export function GrupoAprobacionCompras({ items, onResuelto }: { items: ItemBandejaCompras[]; onResuelto: (id: string, decision: 'APROBAR' | 'RECHAZAR') => void }) {
  const router = useRouter();
  const primero = items[0];
  // Se lleva a la fase de aprobación de la licitación; si solo hay rápidas, al primer producto.
  const rutaGrupo = (items.find(i => !i.accionRapida) ?? primero).ruta;
  const esperaMax = Math.max(...items.map(i => minutosEsperando(i.solicitadoAt) ?? 0));
  const antiguo = esperaMax >= 60 * 24;
  const solicitantes = Array.from(new Set(items.map(i => i.solicitadoPorNombre).filter((v): v is string => !!v)));
  const hayNoRapidas = items.some(i => !i.accionRapida);

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden" data-testid={`aprob-grupo-${primero.negocioId}`}>
      {/* Encabezado: la licitación (una sola vez) */}
      <div className="px-4 py-3.5 bg-zinc-50/70 dark:bg-white/[0.03] border-b border-zinc-100 dark:border-white/[0.06] flex items-start gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <span className="font-mono text-[12px] font-semibold bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-300 px-2 py-0.5 rounded-md">{primero.licitacionCodigo}</span>
          <p className="text-[15.5px] font-bold text-zinc-900 dark:text-zinc-100 leading-snug mt-1.5">{primero.licitacionNombre || primero.licitacionCodigo}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
          <span className="text-[12.5px] font-bold px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/30">{items.length} {items.length === 1 ? 'cosa por aprobar' : 'cosas por aprobar'}</span>
          {antiguo && <span className="text-[12.5px] font-bold px-3 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30">Espera {hace(esperaMax).replace('hace ', '')}</span>}
        </div>
      </div>

      {/* Lo pendiente de esa licitación */}
      <div className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
        {items.map(i => <FilaPendiente key={i.id} item={i} onResuelto={onResuelto} />)}
      </div>

      {/* Pie: un solo botón para ir a decidir en Compras */}
      <div className="px-4 py-3 border-t border-zinc-100 dark:border-white/[0.06] flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="flex-shrink-0 w-7 h-7 rounded-full bg-zinc-200 dark:bg-white/10 text-zinc-600 dark:text-zinc-300 text-[11px] font-bold flex items-center justify-center" aria-hidden>{iniciales(solicitantes[0] ?? null)}</span>
          <p className="text-[12.5px] text-zinc-500 dark:text-zinc-400 truncate">{solicitantes.length > 0 ? <>Lo manda <b className="text-zinc-700 dark:text-zinc-200">{solicitantes.join(', ')}</b></> : 'Mandado a aprobar'}</p>
        </div>
        <button type="button" onClick={() => router.push(rutaGrupo)}
          className={`inline-flex items-center gap-1.5 text-[13.5px] font-semibold px-4 py-2 rounded-xl shadow-sm ${hayNoRapidas ? 'text-white bg-indigo-600 hover:bg-indigo-700' : 'text-indigo-700 bg-indigo-50 hover:bg-indigo-100 dark:text-indigo-300 dark:bg-indigo-500/10'}`}>
          {hayNoRapidas ? 'Revisar y aprobar en Compras' : 'Abrir en Compras'} <Flecha size={15} />
        </button>
      </div>
    </div>
  );
}
