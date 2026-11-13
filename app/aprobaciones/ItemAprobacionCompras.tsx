'use client';

// LO DE COMPRAS POR APROBAR, AGRUPADO POR LICITACIÓN dentro de /aprobaciones: una sola tarjeta por licitación con todo lo que Compras
// mandó a aprobar de ella (compra completa, margen, compras rápidas, corregidos, renuncias). Antes cada cosa era una tarjeta aparte y
// la misma licitación salía repetida. Tocar «Revisar y aprobar en Compras» lleva al paso exacto donde se decide; la compra rápida
// además se aprueba o rechaza aquí mismo.
// 13-nov-2026 (skill licitank-ui): tipo = ícono gris + texto, sin pastillas de colores; cada fila dice DÓNDE se aprueba.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { IconBolt as Bolt, IconScale as Scale, IconPercentage as Pct, IconRefresh as Refresh, IconDoorExit as Salida, IconArrowRight as Flecha, IconLoader2 as Loader2, IconCheck as Check, IconX as X } from '@tabler/icons-react';
import type { ItemBandejaCompras, TipoItemCompras } from '@/app/lib/compras-bandeja-aprobacion';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Estado } from '@/app/components/ui/kit/Tarjeta';
import { item as itemMov } from '@/app/components/ui/kit/movimiento';

const TIPO: Record<TipoItemCompras, { etiqueta: string; Icono: typeof Bolt; donde: string }> = {
  COMPRA_RAPIDA: { etiqueta: 'Compra rápida', Icono: Bolt, donde: 'Se aprueba aquí' },
  COMPRA: { etiqueta: 'Cuadro comparativo', Icono: Scale, donde: 'Se aprueba en Compras' },
  MARGEN: { etiqueta: 'Margen', Icono: Pct, donde: 'Se aprueba en Compras' },
  PRODUCTO_CORREGIDO: { etiqueta: 'Producto corregido', Icono: Refresh, donde: 'Se revisa en Compras' },
  RENUNCIA: { etiqueta: 'Renuncia a una línea', Icono: Salida, donde: 'Se decide en Compras' },
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
    <div className="px-4 py-3.5 border-t border-linea dark:border-slate-800" data-testid={`aprob-compras-${item.id}`}>
      <div className="flex items-start gap-3 flex-wrap">
        <span className="flex-shrink-0 w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-center"><t.Icono size={16} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-tinta-2 dark:text-slate-400">
            <span className="font-medium text-tinta dark:text-slate-200">{t.etiqueta}</span>
            {item.solicitadoPorNombre && <> · lo mandó {item.solicitadoPorNombre}</>}
            {item.solicitadoAt && <> · {hace(espera)}</>}
          </p>
          <p className="text-[14px] font-semibold tracking-tight text-tinta dark:text-slate-50 leading-snug mt-0.5">{item.titulo}</p>
          <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
            {hechos.map(h => (
              <div key={h.etiqueta} className={`min-w-0 ${h.valor.length > 50 ? 'basis-full' : ''}`}>
                <dt className="text-[11px] text-tinta-2/80 dark:text-slate-400">{h.etiqueta}</dt>
                <dd className="mt-0.5 text-[13px] font-semibold tabular-nums text-tinta dark:text-slate-100 leading-snug break-words">{h.valor}</dd>
              </div>
            ))}
          </dl>
        </div>

        {item.accionRapida && !rechazando && (
          <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
            <Boton variante="fantasma" tamano="sm" onClick={() => router.push(item.ruta)}>Ver producto</Boton>
            <Boton variante="fantasma" tamano="sm" onClick={() => setRechazando(true)} disabled={guardando != null} icono={<X size={14} />}>Rechazar</Boton>
            <Boton variante="primario" tamano="sm" onClick={() => decidir('APROBAR')} disabled={guardando != null}
              icono={guardando === 'APROBAR' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}>{item.yaComprada ? 'Ratificar' : 'Aprobar'}</Boton>
          </div>
        )}
        {!item.accionRapida && <p className="flex-shrink-0 ml-auto text-xs text-tinta-3 dark:text-slate-500 self-center">{t.donde}</p>}
      </div>

      {item.accionRapida && rechazando && (
        <div className="mt-3 ml-11 flex items-center gap-2 flex-wrap">
          <input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="¿Por qué se rechaza? (obligatorio)" autoFocus
            className="flex-1 min-w-[220px] text-[13px] border border-linea dark:border-slate-700 rounded-lg px-3 h-8 outline-none focus:ring-2 focus:ring-red-300 bg-white dark:bg-slate-950 dark:text-slate-100" />
          <Boton variante="peligro" tamano="sm" onClick={() => decidir('RECHAZAR')} disabled={guardando != null || !motivo.trim()}
            icono={guardando === 'RECHAZAR' ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}>Rechazar</Boton>
          <Boton variante="fantasma" tamano="sm" onClick={() => { setRechazando(false); setMotivo(''); }}>Cancelar</Boton>
        </div>
      )}
      {error && <p className="text-[12.5px] text-urgente mt-2 ml-11">{error}</p>}
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
    <motion.div variants={itemMov} layout className="bg-white dark:bg-slate-900 border border-linea dark:border-slate-800 rounded-xl shadow-tarjeta overflow-hidden" data-testid={`aprob-grupo-${primero.negocioId}`}>
      {/* Encabezado: la licitación (una sola vez) */}
      <div className="px-4 pt-4 pb-3.5 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-tinta-2 dark:text-slate-400"><span className="font-mono font-medium text-tinta dark:text-slate-300">{primero.licitacionCodigo}</span></p>
          <p className="text-[15px] font-semibold tracking-tight text-tinta dark:text-slate-50 leading-snug mt-1">{primero.licitacionNombre || primero.licitacionCodigo}</p>
          <p className="mt-1.5 text-[13px] text-tinta-2 dark:text-slate-400">
            <b className="font-semibold text-tinta dark:text-slate-100 tabular-nums">{items.length}</b> {items.length === 1 ? 'cosa por aprobar' : 'cosas por aprobar'}
          </p>
        </div>
        <span className={`flex-shrink-0 text-[12.5px] font-medium mt-0.5 ${antiguo ? 'text-urgente dark:text-red-400' : 'text-tinta-2 dark:text-slate-400'}`}>
          <Estado color={antiguo ? '#dc2626' : '#94a3b8'}>{antiguo ? `Espera ${hace(esperaMax).replace('hace ', '')}` : `Llegó ${hace(esperaMax)}`}</Estado>
        </span>
      </div>

      {/* Lo pendiente de esa licitación */}
      {items.map(i => <FilaPendiente key={i.id} item={i} onResuelto={onResuelto} />)}

      {/* Pie: quién lo manda y un solo botón para ir a decidir en Compras */}
      <div className="px-4 py-3 border-t border-linea dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/30 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-semibold flex items-center justify-center" aria-hidden>{iniciales(solicitantes[0] ?? null)}</span>
          <p className="text-xs text-tinta-2 dark:text-slate-400 truncate">{solicitantes.length > 0 ? <>Lo manda <b className="font-medium text-tinta dark:text-slate-200">{solicitantes.join(', ')}</b></> : 'Mandado a aprobar'}</p>
        </div>
        <Boton variante={hayNoRapidas ? 'primario' : 'secundario'} onClick={() => router.push(rutaGrupo)}>
          {hayNoRapidas ? 'Revisar y aprobar en Compras' : 'Abrir en Compras'} <Flecha size={15} />
        </Boton>
      </div>
    </motion.div>
  );
}
