'use client';

// TODAS LAS COMBINACIONES DE COMPRA (pedido del usuario, 25-sep-2026). Los 4 escenarios clásicos son
// heurísticas que muchas veces coinciden; acá se muestra cada forma posible de comprar (una cotización por
// producto), con su costo desglosado, viajes, plazo, proveedores y avisos, para ordenarlas y elegir con
// datos. Los números vienen calculados del servidor (enumerarCombinaciones en compras-auditor.ts).
import { useMemo, useState } from 'react';
import { IconChevronDown as ChevronDown, IconChevronUp as ChevronUp, IconCircleCheck as CheckCircle2, IconLoader2 as Loader2, IconAlertTriangle as AlertTriangle } from '@tabler/icons-react';

export interface ItemComb {
  productoId: number; descripcion: string; cotizacionId: number; proveedor: string; cumple: string; detalleDesviacion: string | null;
  moneda: string; tipoCambioUsado: number | null; precioUnitario: number | null; cantidad: number | null; subtotal: number | null;
  plazoEntregaDias: number | null; incluyeFlete: boolean | null; fleteMonto: number | null;
}
export interface Comb {
  clave: string; costoMercaderia: number; costoLogistico: number; costoTotal: number; diasEstimados: number | null; viajes: number;
  nProveedores: number; proveedores: string[]; peorCumple: string; fleteSinConfirmar: boolean; items: ItemComb[]; etiquetas: string[];
  diferenciaVsMasBarata: number; diferenciaPctVsMasBarata: number | null; avisos: string[];
}
export interface DatosCombinaciones {
  combinaciones: Comb[]; totalPosibles: number; truncado: boolean; productosSinOferta: Array<{ productoId: number; descripcion: string }>; productosCubiertos: number;
}

const clp = (n: number | null | undefined) => (n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n));
const ETIQUETA: Record<string, string> = { MAS_RAPIDO: 'Más rápido', MINIMO_PRECIO: 'Mínimo precio', MINIMOS_VIAJES: 'Mínimos viajes', EQUILIBRADO: 'Equilibrado' };
const CUMPLE: Record<string, { t: string; c: string }> = {
  CUMPLE: { t: 'Cumple', c: 'text-emerald-700 bg-emerald-50 border-emerald-200' }, MEJORA: { t: 'Mejora', c: 'text-teal-700 bg-teal-50 border-teal-200' },
  INFERIOR_NEGOCIABLE: { t: 'Inferior (negociable)', c: 'text-amber-700 bg-amber-50 border-amber-200' }, INFERIOR_INSALVABLE: { t: 'Inferior (insalvable)', c: 'text-rose-700 bg-rose-50 border-rose-200' },
  NO_ES_EL_PRODUCTO: { t: 'No es el producto', c: 'text-rose-700 bg-rose-50 border-rose-200' },
};
type Orden = 'cumple_precio' | 'precio' | 'dias' | 'proveedores' | 'viajes';

export function CombinacionesCompra({ datos, elegidaClave, puedeOperar, eligiendo, onElegir }: {
  datos: DatosCombinaciones; elegidaClave: string | null; puedeOperar: boolean; eligiendo: string | null;
  onElegir: (clave: string, justificacion: string | null, esMasRapido: boolean) => Promise<void>;
}) {
  const [abierta, setAbierta] = useState(false);
  const [orden, setOrden] = useState<Orden>('cumple_precio');
  const [detalle, setDetalle] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [just, setJust] = useState('');
  const [verTodas, setVerTodas] = useState(false);

  const lista = useMemo(() => {
    const xs = [...datos.combinaciones];
    const tier = (c: string) => ({ CUMPLE: 0, MEJORA: 0, INFERIOR_NEGOCIABLE: 1, INFERIOR_INSALVABLE: 2 } as Record<string, number>)[c] ?? 3;
    switch (orden) {
      case 'precio': xs.sort((a, b) => a.costoTotal - b.costoTotal); break;
      case 'dias': xs.sort((a, b) => (a.diasEstimados ?? 999) - (b.diasEstimados ?? 999) || a.costoTotal - b.costoTotal); break;
      case 'proveedores': xs.sort((a, b) => a.nProveedores - b.nProveedores || a.costoTotal - b.costoTotal); break;
      case 'viajes': xs.sort((a, b) => a.viajes - b.viajes || a.costoTotal - b.costoTotal); break;
      default: xs.sort((a, b) => tier(a.peorCumple) - tier(b.peorCumple) || a.costoTotal - b.costoTotal);
    }
    return xs;
  }, [datos.combinaciones, orden]);
  const visibles = verTodas ? lista : lista.slice(0, 8);

  if (datos.combinaciones.length === 0 && datos.productosSinOferta.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
      <button onClick={() => setAbierta(a => !a)} className="w-full flex items-center justify-between gap-2 px-3.5 py-3 hover:bg-zinc-50/70 text-left">
        <span>
          <span className="block text-[12.5px] font-bold text-zinc-800">Todas las combinaciones posibles ({datos.totalPosibles})</span>
          <span className="block text-[11px] text-zinc-500">Cada forma de comprar: una cotización por producto. Ordénalas, compáralas y elige con el detalle completo.</span>
        </span>
        {abierta ? <ChevronUp size={15} className="text-zinc-400" /> : <ChevronDown size={15} className="text-zinc-400" />}
      </button>
      {abierta && (
        <div className="px-3.5 pb-3.5 space-y-2.5 border-t border-zinc-100 pt-2.5">
          {datos.productosSinOferta.length > 0 && (
            <p className="text-[11.5px] px-2 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-800">
              <AlertTriangle size={12} className="inline mr-1" />Sin cotización todavía (no entran a ninguna combinación): {datos.productosSinOferta.map(p => p.descripcion).join(', ')}.
            </p>
          )}
          {datos.truncado && <p className="text-[11px] text-zinc-500">Hay demasiadas combinaciones: se muestran las mejores por cumplimiento y precio, más la más rápida de cada producto.</p>}
          <div className="flex items-center gap-2 text-[11.5px]">
            <span className="text-zinc-500">Ordenar por</span>
            <select value={orden} onChange={e => setOrden(e.target.value as Orden)} className="border border-zinc-200 rounded-lg px-2 py-1 text-[11.5px]">
              <option value="cumple_precio">Mejor cumplimiento y luego precio</option><option value="precio">Precio total (menor a mayor)</option>
              <option value="dias">Plazo (menos días)</option><option value="proveedores">Menos proveedores</option><option value="viajes">Menos viajes</option>
            </select>
          </div>
          {visibles.map((c, i) => {
            const esElegida = elegidaClave === c.clave; const abre = detalle === c.clave;
            return (
              <div key={c.clave} className={`rounded-lg border ${esElegida ? 'border-emerald-300 ring-1 ring-emerald-100' : 'border-zinc-200'}`}>
                <button onClick={() => setDetalle(abre ? null : c.clave)} className="w-full text-left px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-[11px] font-bold text-zinc-400 w-5">#{i + 1}</span>
                  <span className="flex-1 min-w-[180px]">
                    <span className="block text-[12px] font-semibold text-zinc-800">{c.proveedores.join(' + ')}</span>
                    <span className="block text-[10.5px] text-zinc-400">{c.nProveedores} proveedor(es) · {c.viajes} viaje(s) · {c.diasEstimados != null ? `${c.diasEstimados} día(s) máx.` : 'plazo sin declarar'}</span>
                  </span>
                  {c.etiquetas.map(e => <span key={e} className="text-[9.5px] font-bold text-teal-700 bg-teal-50 border border-teal-200 px-1.5 py-0.5 rounded-full">{ETIQUETA[e] || e}</span>)}
                  {esElegida && <span className="flex items-center gap-1 text-[9.5px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full"><CheckCircle2 size={10} /> Elegida</span>}
                  <span className={`text-[9.5px] font-bold border px-1.5 py-0.5 rounded-full ${(CUMPLE[c.peorCumple] || CUMPLE.INFERIOR_NEGOCIABLE).c}`}>{(CUMPLE[c.peorCumple] || { t: c.peorCumple }).t}</span>
                  <span className="text-right">
                    <span className="block text-[14px] font-bold text-zinc-900 tabular-nums">{clp(c.costoTotal)}</span>
                    <span className="block text-[10.5px] text-zinc-400">{c.diferenciaVsMasBarata === 0 ? 'la más barata' : `+${clp(c.diferenciaVsMasBarata)} (${c.diferenciaPctVsMasBarata}%)`}</span>
                  </span>
                  {abre ? <ChevronUp size={14} className="text-zinc-400" /> : <ChevronDown size={14} className="text-zinc-400" />}
                </button>
                {abre && (
                  <div className="px-3 pb-3 pt-1 border-t border-zinc-100 space-y-2">
                    <div className="grid grid-cols-3 gap-2 text-[11px]">
                      <div className="rounded bg-zinc-50 p-2"><p className="text-zinc-400">Mercadería</p><p className="font-bold text-zinc-800 tabular-nums">{clp(c.costoMercaderia)}</p></div>
                      <div className="rounded bg-zinc-50 p-2"><p className="text-zinc-400">Flete / logística</p><p className="font-bold text-zinc-800 tabular-nums">{clp(c.costoLogistico)}{c.fleteSinConfirmar && <span className="ml-1 text-amber-600 font-semibold">sin confirmar</span>}</p></div>
                      <div className="rounded bg-zinc-50 p-2"><p className="text-zinc-400">Total</p><p className="font-bold text-zinc-900 tabular-nums">{clp(c.costoTotal)}</p></div>
                    </div>
                    {c.items.map(x => (
                      <div key={x.productoId} className="rounded-lg bg-zinc-50/70 px-2.5 py-2 text-[11px]">
                        <p className="font-semibold text-zinc-800">{x.descripcion}</p>
                        <p className="text-zinc-500"><b className="text-zinc-700">{x.proveedor}</b> · cotización #{x.cotizacionId} · <span className={`px-1 py-0.5 rounded border text-[10px] font-semibold ${(CUMPLE[x.cumple] || CUMPLE.INFERIOR_NEGOCIABLE).c}`}>{(CUMPLE[x.cumple] || { t: x.cumple }).t}</span></p>
                        <div className="mt-1 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-0.5 text-zinc-500">
                          <span>Precio unit.: <b className="text-zinc-700">{clp(x.precioUnitario)}</b>{x.moneda !== 'CLP' && <span className="text-zinc-400"> ({x.moneda}{x.tipoCambioUsado ? ` a $${x.tipoCambioUsado}` : ''})</span>}</span>
                          <span>Cantidad: <b className="text-zinc-700">{x.cantidad ?? '—'}</b></span>
                          <span>Mercadería: <b className="text-zinc-700">{clp(x.subtotal)}</b></span>
                          <span>Plazo: <b className="text-zinc-700">{x.plazoEntregaDias != null ? `${x.plazoEntregaDias} día(s)` : 'sin declarar'}</b></span>
                          <span>Flete: <b className="text-zinc-700">{x.fleteMonto != null ? clp(x.fleteMonto) : x.incluyeFlete ? 'incluido' : '$0 sin confirmar'}</b></span>
                        </div>
                        {x.detalleDesviacion && <p className="mt-1 text-zinc-500">Auditor: {x.detalleDesviacion}</p>}
                      </div>
                    ))}
                    {c.avisos.length > 0 && <div className="space-y-0.5">{c.avisos.map((a, k) => <p key={k} className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded px-2 py-1">• {a}</p>)}</div>}
                    {puedeOperar && !esElegida && confirmando !== c.clave && (
                      <button onClick={() => { if (c.etiquetas.includes('MAS_RAPIDO')) onElegir(c.clave, null, true); else { setConfirmando(c.clave); setJust(''); } }} disabled={!!eligiendo}
                        className="flex items-center gap-1 text-[11px] font-semibold text-white bg-zinc-800 hover:bg-zinc-900 disabled:opacity-50 px-2.5 py-1.5 rounded-lg">
                        {eligiendo === c.clave ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Elegir esta combinación
                      </button>
                    )}
                    {puedeOperar && confirmando === c.clave && (
                      <div className="space-y-1.5">
                        <input value={just} onChange={e => setJust(e.target.value)} placeholder="¿Por qué eliges esta combinación en vez de Más rápido? (spec §8.10.4)" className="w-full text-[11px] border border-amber-300 rounded-lg px-2 py-1.5 outline-none" />
                        <div className="flex gap-2">
                          <button onClick={() => onElegir(c.clave, just.trim(), false).then(() => { setConfirmando(null); setJust(''); })} disabled={!just.trim() || !!eligiendo} className="text-[11px] font-semibold text-white bg-amber-600 disabled:opacity-50 px-2.5 py-1.5 rounded-lg">Confirmar</button>
                          <button onClick={() => setConfirmando(null)} className="text-[11px] text-zinc-400">Cancelar</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {lista.length > 8 && <button onClick={() => setVerTodas(v => !v)} className="text-[11.5px] font-semibold text-teal-700">{verTodas ? 'Ver menos' : `Ver las ${lista.length} combinaciones`}</button>}
        </div>
      )}
    </div>
  );
}
