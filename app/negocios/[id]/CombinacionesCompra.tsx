'use client';

// ESCENARIOS DE COMPRA = TODAS LAS COMBINACIONES POSIBLES (pedido del usuario, 25-sep-2026). Cada combinación (una cotización
// por producto) es una tarjeta compacta; al abrirla, un modal muestra todo su detalle y permite elegirla. Los 4 escenarios
// clásicos (más rápido, mínimo precio, mínimos viajes, equilibrado) ya no son tarjetas aparte: son etiquetas sobre la combinación
// que les corresponde. Los números vienen calculados del servidor (enumerarCombinaciones en compras-auditor.ts).
import { useMemo, useState } from 'react';
import { IconCircleCheck as CheckCircle2, IconLoader2 as Loader2, IconAlertTriangle as AlertTriangle, IconX as X, IconTruck as Truck, IconClock as Clock, IconUsers as Users } from '@tabler/icons-react';

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
const cumpleDe = (c: string) => CUMPLE[c] || CUMPLE.INFERIOR_NEGOCIABLE;
type Orden = 'cumple_precio' | 'precio' | 'dias' | 'proveedores' | 'viajes';

export function CombinacionesCompra({ datos, elegidaClave, elegidoTipo, elegidoCostoGuardado, puedeOperar, eligiendo, onElegir }: {
  datos: DatosCombinaciones; elegidaClave: string | null; elegidoTipo: string | null; elegidoCostoGuardado: number | null;
  puedeOperar: boolean; eligiendo: string | null; onElegir: (clave: string, justificacion: string | null) => Promise<void>;
}) {
  const [orden, setOrden] = useState<Orden>('cumple_precio');
  const [abierta, setAbierta] = useState<string | null>(null);

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

  // Lo elegido puede ser una combinación (por clave) o uno de los 4 escenarios clásicos guardado antes: en ese caso se reconoce por etiqueta y monto.
  const esElegida = (c: Comb) => (elegidaClave != null ? elegidaClave === c.clave
    : elegidoTipo != null && c.etiquetas.includes(elegidoTipo) && elegidoCostoGuardado != null && Math.abs(c.costoTotal - elegidoCostoGuardado) <= 1);
  const seleccionada = lista.find(c => c.clave === abierta) || null;

  if (datos.combinaciones.length === 0 && datos.productosSinOferta.length === 0) return null;

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-bold text-zinc-400 uppercase px-0.5">Escenarios · todas las combinaciones posibles ({datos.totalPosibles})</p>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-[11.5px] text-zinc-500">Ordenar por
            <select value={orden} onChange={e => setOrden(e.target.value as Orden)} className="border border-zinc-200 rounded-lg px-2 py-1 text-[11.5px] text-zinc-700">
              <option value="cumple_precio">Mejor cumplimiento y luego precio</option><option value="precio">Precio total (menor a mayor)</option>
              <option value="dias">Plazo (menos días)</option><option value="proveedores">Menos proveedores</option><option value="viajes">Menos viajes</option>
            </select>
          </label>
          <a href="/logistica/fleteros" target="_blank" rel="noopener noreferrer" className="text-[11px] font-semibold text-teal-700 hover:text-teal-800">Ver fletero por zona →</a>
        </div>
      </div>
      {datos.productosSinOferta.length > 0 && (
        <p className="text-[11.5px] px-2 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-800">
          <AlertTriangle size={12} className="inline mr-1" />Sin cotización todavía (no entran a ninguna combinación): {datos.productosSinOferta.map(p => p.descripcion).join(', ')}.
        </p>
      )}
      {datos.truncado && <p className="text-[11px] text-zinc-500">Hay demasiadas combinaciones: se muestran las mejores por cumplimiento y precio, más la más rápida de cada producto.</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
        {lista.map((c, i) => {
          const elegida = esElegida(c);
          return (
            <button key={c.clave} onClick={() => setAbierta(c.clave)}
              className={`text-left bg-white rounded-xl border p-3 hover:shadow-sm transition ${elegida ? 'border-emerald-300 ring-1 ring-emerald-100' : c.etiquetas.includes('MAS_RAPIDO') ? 'border-teal-300 ring-1 ring-teal-100' : 'border-zinc-200'}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-[12px] font-bold text-zinc-800 leading-snug"><span className="text-zinc-400 mr-1">#{i + 1}</span>{c.proveedores.join(' + ')}</p>
                {elegida && <span className="shrink-0 flex items-center gap-1 text-[9.5px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full"><CheckCircle2 size={10} /> Elegida</span>}
              </div>
              <div className="flex flex-wrap gap-1 mt-1">
                {c.etiquetas.map(e => <span key={e} className="text-[9.5px] font-bold text-teal-700 bg-teal-50 border border-teal-200 px-1.5 py-0.5 rounded-full">{ETIQUETA[e] || e}</span>)}
                <span className={`text-[9.5px] font-bold border px-1.5 py-0.5 rounded-full ${cumpleDe(c.peorCumple).c}`}>{cumpleDe(c.peorCumple).t}</span>
              </div>
              <p className="text-[16px] font-bold text-zinc-900 mt-1.5 tabular-nums">{clp(c.costoTotal)}</p>
              <p className="text-[10.5px] text-zinc-400">{c.diferenciaVsMasBarata === 0 ? 'la más barata' : `+${clp(c.diferenciaVsMasBarata)} (${c.diferenciaPctVsMasBarata}%) sobre la más barata`}</p>
              <div className="flex items-center gap-3 mt-1.5 text-[10.5px] text-zinc-500">
                <span className="flex items-center gap-1"><Users size={11} />{c.nProveedores}</span>
                <span className="flex items-center gap-1"><Truck size={11} />{c.viajes} viaje(s)</span>
                <span className="flex items-center gap-1"><Clock size={11} />{c.diasEstimados != null ? `${c.diasEstimados} d` : 'sin plazo'}</span>
                {(c.avisos.length > 0 || c.fleteSinConfirmar) && <span className="flex items-center gap-1 text-amber-600"><AlertTriangle size={11} />{c.avisos.length}</span>}
              </div>
              <p className="text-[11px] font-semibold text-teal-700 mt-2">Ver detalle y elegir →</p>
            </button>
          );
        })}
      </div>

      {seleccionada && (
        <ModalCombinacion c={seleccionada} elegida={esElegida(seleccionada)} puedeOperar={puedeOperar} eligiendo={eligiendo === seleccionada.clave}
          onClose={() => setAbierta(null)} onElegir={async (j) => { await onElegir(seleccionada.clave, j); setAbierta(null); }} />
      )}
    </div>
  );
}

function ModalCombinacion({ c, elegida, puedeOperar, eligiendo, onClose, onElegir }: {
  c: Comb; elegida: boolean; puedeOperar: boolean; eligiendo: boolean; onClose: () => void; onElegir: (justificacion: string | null) => Promise<void>;
}) {
  const [just, setJust] = useState('');
  const esMasRapido = c.etiquetas.includes('MAS_RAPIDO');
  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-start justify-center p-3 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-zinc-100">
          <div>
            <p className="text-[14px] font-bold text-zinc-800">{c.proveedores.join(' + ')}</p>
            <div className="flex flex-wrap gap-1 mt-1">
              {c.etiquetas.map(e => <span key={e} className="text-[10px] font-bold text-teal-700 bg-teal-50 border border-teal-200 px-1.5 py-0.5 rounded-full">{ETIQUETA[e] || e}</span>)}
              <span className={`text-[10px] font-bold border px-1.5 py-0.5 rounded-full ${cumpleDe(c.peorCumple).c}`}>{cumpleDe(c.peorCumple).t}</span>
              {elegida && <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full"><CheckCircle2 size={10} /> Elegida</span>}
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-zinc-100"><X size={16} /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <Caja t="Mercadería" v={clp(c.costoMercaderia)} />
            <Caja t="Flete / logística" v={clp(c.costoLogistico)} extra={c.fleteSinConfirmar ? 'sin confirmar' : undefined} />
            <Caja t="Total" v={clp(c.costoTotal)} fuerte />
            <Caja t="Vs. la más barata" v={c.diferenciaVsMasBarata === 0 ? 'es la más barata' : `+${clp(c.diferenciaVsMasBarata)} (${c.diferenciaPctVsMasBarata}%)`} />
            <Caja t="Proveedores" v={String(c.nProveedores)} />
            <Caja t="Viajes" v={String(c.viajes)} />
            <Caja t="Plazo máximo" v={c.diasEstimados != null ? `${c.diasEstimados} día(s)` : 'sin declarar'} />
            <Caja t="Productos cubiertos" v={String(c.items.length)} />
          </div>

          {c.items.map(x => (
            <div key={x.productoId} className="rounded-lg border border-zinc-200 px-3 py-2.5 text-[11.5px]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-zinc-800">{x.descripcion}</p>
                <span className={`text-[10px] font-bold border px-1.5 py-0.5 rounded-full ${cumpleDe(x.cumple).c}`}>{cumpleDe(x.cumple).t}</span>
              </div>
              <p className="text-zinc-500 mt-0.5"><b className="text-zinc-700">{x.proveedor}</b> · cotización #{x.cotizacionId}</p>
              <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1 text-zinc-500">
                <span>Precio unitario: <b className="text-zinc-700">{clp(x.precioUnitario)}</b>{x.moneda !== 'CLP' && <span className="text-zinc-400"> ({x.moneda}{x.tipoCambioUsado ? ` a $${x.tipoCambioUsado}` : ''})</span>}</span>
                <span>Cantidad: <b className="text-zinc-700">{x.cantidad ?? '—'}</b></span>
                <span>Mercadería: <b className="text-zinc-700">{clp(x.subtotal)}</b></span>
                <span>Flete: <b className="text-zinc-700">{x.fleteMonto != null ? clp(x.fleteMonto) : x.incluyeFlete ? 'incluido' : '$0 sin confirmar'}</b></span>
                <span>Plazo: <b className="text-zinc-700">{x.plazoEntregaDias != null ? `${x.plazoEntregaDias} día(s)` : 'sin declarar'}</b></span>
                <span>Total ítem: <b className="text-zinc-800">{clp((x.subtotal ?? 0) + (x.fleteMonto ?? 0))}</b></span>
              </div>
              {x.detalleDesviacion && (
                <details className="mt-1.5 text-zinc-500"><summary className="cursor-pointer text-[11px] font-semibold text-zinc-600">Dictamen del auditor de cotizaciones</summary><p className="mt-1">{x.detalleDesviacion}</p></details>
              )}
            </div>
          ))}

          {c.avisos.length > 0 && <div className="space-y-1">{c.avisos.map((a, k) => <p key={k} className="text-[11.5px] text-amber-800 bg-amber-50 border border-amber-100 rounded px-2 py-1">• {a}</p>)}</div>}

          {puedeOperar && !elegida && (
            <div className="rounded-lg border border-zinc-200 p-3 space-y-2">
              <p className="text-[12px] font-semibold text-zinc-700">Elegir esta combinación</p>
              {!esMasRapido && <input value={just} onChange={e => setJust(e.target.value)} placeholder="¿Por qué eliges esta combinación en vez de Más rápido? (spec §8.10.4)" className="w-full text-[11.5px] border border-amber-300 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-amber-500" />}
              <div className="flex items-center gap-2">
                <button onClick={() => onElegir(esMasRapido ? null : just.trim())} disabled={eligiendo || (!esMasRapido && !just.trim())}
                  className="flex items-center gap-1 text-[12px] font-semibold text-white bg-zinc-800 hover:bg-zinc-900 disabled:opacity-50 px-3 py-1.5 rounded-lg">
                  {eligiendo ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Elegir esta combinación
                </button>
                <button onClick={onClose} className="text-[12px] text-zinc-500 hover:text-zinc-700">Cerrar</button>
              </div>
              <p className="text-[10.5px] text-zinc-400">Al elegirla se invalida una aprobación de compra previa y queda registrada para la aprobación.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Caja({ t, v, extra, fuerte }: { t: string; v: string; extra?: string; fuerte?: boolean }) {
  return (
    <div className="rounded bg-zinc-50 p-2"><p className="text-zinc-400">{t}</p>
      <p className={`font-bold tabular-nums ${fuerte ? 'text-zinc-900' : 'text-zinc-800'}`}>{v}{extra && <span className="ml-1 text-amber-600 font-semibold">{extra}</span>}</p></div>
  );
}
