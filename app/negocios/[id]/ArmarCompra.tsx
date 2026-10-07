'use client';

// ARMAR LA COMPRA — reemplaza a la lista de cientos de combinaciones. Tres bloques, de arriba hacia abajo:
//   1. Recomendadas: pocas (todo a un proveedor, más barata, más rápida, equilibrada), cada una con su razón; «Usar esta» las marca en la matriz.
//   2. Tu compra: lo que vas eligiendo en la matriz, con su costo, plazo, viajes y avisos; «Elegir esta compra» la deja para aprobación.
//   3. Compra elegida → costeo: la compra elegida se carga al costeo («Costo unit. REAL» de cada línea) con un clic y a la vista.
import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { IconCircleCheck as CheckCircle2, IconLoader2 as Loader2, IconAlertTriangle as AlertTriangle, IconTruck as Truck, IconClock as Clock, IconUsers as Users, IconArrowRight as Arrow, IconScale as Scale } from '@tabler/icons-react';

export interface ItemComb { productoId: number; descripcion: string; cotizacionId: number; proveedor: string; precioUnitario: number | null; cantidad: number | null; subtotal: number | null }
export interface Comb {
  clave: string; costoMercaderia: number; costoLogistico: number; costoTotal: number; diasEstimados: number | null; viajes: number;
  nProveedores: number; proveedores: string[]; peorCumple: string; fleteSinConfirmar: boolean; items: ItemComb[]; etiquetas: string[]; avisos: string[];
}
export interface Recomendada { comb: Comb; etiquetas: string[] }
export interface EvaluacionCompra { combinacion: Comb | null; faltan: Array<{ productoId: number; descripcion: string }>; sinOferta: Array<{ productoId: number; descripcion: string }>; errores: string[] }
interface LineaTraslado { productoId: number; descripcion: string; proveedor: string; costoNeto: number; incluido: boolean; anterior: number | null; estado: 'CARGA' | 'IGUAL' | 'SIN_FILA' | 'SIN_LINK' }

const clp = (n: number | null | undefined) => (n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n));
const RAZON: Record<string, { t: string; c: string }> = {
  UN_PROVEEDOR: { t: 'Todo a un proveedor', c: 'text-sky-800 bg-sky-50 border-sky-200' },
  EQUILIBRADA: { t: 'Equilibrada', c: 'text-teal-800 bg-teal-50 border-teal-200' },
  MAS_RAPIDA: { t: 'Más rápida', c: 'text-indigo-800 bg-indigo-50 border-indigo-200' },
  MAS_BARATA: { t: 'Más barata', c: 'text-emerald-800 bg-emerald-50 border-emerald-200' },
};
const seleccionDe = (c: Comb): Record<number, number> => Object.fromEntries(c.items.map(i => [i.productoId, i.cotizacionId]));
const mismaSeleccion = (a: Record<number, number>, b: Record<number, number>) => { const ka = Object.keys(a), kb = Object.keys(b); return ka.length === kb.length && ka.every(k => a[Number(k)] === b[Number(k)]); };

export function ArmarCompra({ negocioId, recomendadas, elegida, compra, setCompra, evaluacion, evaluando, puedeOperar, onElegida }: {
  negocioId: number; recomendadas: Recomendada[]; elegida: Comb | null; compra: Record<number, number>; setCompra: (s: Record<number, number>) => void;
  evaluacion: EvaluacionCompra | null; evaluando: boolean; puedeOperar: boolean; onElegida: () => Promise<void>;
}) {
  const toast = useToast();
  const [just, setJust] = useState('');
  const [eligiendo, setEligiendo] = useState(false);
  const [plan, setPlan] = useState<{ hayCompraElegida: boolean; lineas: LineaTraslado[]; aviso: string | null } | null>(null);
  const [cargando, setCargando] = useState(false);

  const seleccionElegida = elegida ? seleccionDe(elegida) : null;
  const esLaElegida = !!seleccionElegida && mismaSeleccion(compra, seleccionElegida);
  const comb = evaluacion?.combinacion ?? null;
  const esMasRapida = !!comb && comb.etiquetas.includes('MAS_RAPIDO');
  const n = Object.keys(compra).length;

  const cargarPlan = useCallback(async () => {
    try {
      const r = await fetch(`/api/compras/${negocioId}/costeo-compra`);
      const d = await r.json();
      if (d.success) setPlan({ hayCompraElegida: d.hayCompraElegida, lineas: d.lineas || [], aviso: d.aviso ?? null });
    } catch { /* sin plan: el panel no se muestra */ }
  }, [negocioId]);
  useEffect(() => { if (elegida) cargarPlan(); else setPlan(null); }, [elegida?.clave, cargarPlan]);   // eslint-disable-line react-hooks/exhaustive-deps

  const elegir = async () => {
    setEligiendo(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/escenarios`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: 'SELECCION', seleccion: compra, justificacion: esMasRapida ? null : just.trim() }),
      });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'No se pudo elegir');
      toast.success('Compra elegida', 'Queda lista para pedir la aprobación.');
      setJust('');
      await onElegida();
    } catch (e: any) { toast.error('No se pudo elegir la compra', e.message); } finally { setEligiendo(false); }
  };

  const cargarAlCosteo = async () => {
    setCargando(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/costeo-compra`, { method: 'POST' });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'No se pudo cargar');
      setPlan({ hayCompraElegida: d.hayCompraElegida, lineas: d.lineas || [], aviso: d.aviso ?? null });
      toast.success('Cargado al costeo', `${d.cargadas} línea(s) con su costo real y respaldo.`);
      await onElegida();
    } catch (e: any) { toast.error('No se pudo cargar al costeo', e.message); } finally { setCargando(false); }
  };

  return (
    <div className="space-y-3">
      {recomendadas.length > 0 && (
        <div className="bg-white rounded-xl border border-zinc-200 p-3.5 space-y-2.5">
          <div>
            <p className="text-[14px] font-bold text-zinc-900">Compras recomendadas</p>
            <p className="text-[12.5px] text-zinc-500">Las pocas formas que vale la pena mirar. «Usar esta» las marca en la matriz de arriba, donde puedes cambiar cualquier producto a mano.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
            {recomendadas.map(({ comb: c, etiquetas }) => {
              const activa = mismaSeleccion(compra, seleccionDe(c));
              return (
                <div key={c.clave} className={`rounded-xl border p-3 ${activa ? 'border-teal-500 ring-1 ring-teal-200 bg-teal-50/30' : 'border-zinc-200 bg-white'}`}>
                  <div className="flex flex-wrap gap-1">
                    {etiquetas.map(e => <span key={e} className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full border ${RAZON[e]?.c}`}>{RAZON[e]?.t ?? e}</span>)}
                  </div>
                  <p className="text-[12.5px] font-semibold text-zinc-800 mt-1.5 leading-snug">{c.proveedores.join(' + ')}</p>
                  <p className="text-[18px] font-bold text-zinc-900 tabular-nums">{clp(c.costoTotal)}</p>
                  <div className="flex items-center gap-3 mt-1 text-[12px] text-zinc-500">
                    <span className="flex items-center gap-1"><Users size={12} />{c.nProveedores}</span>
                    <span className="flex items-center gap-1"><Truck size={12} />{c.viajes}</span>
                    <span className="flex items-center gap-1"><Clock size={12} />{c.diasEstimados != null ? `${c.diasEstimados} d` : 'sin plazo'}</span>
                    {c.avisos.length > 0 && <span className="flex items-center gap-1 text-amber-600"><AlertTriangle size={12} />{c.avisos.length}</span>}
                  </div>
                  <button type="button" onClick={() => setCompra(seleccionDe(c))} disabled={activa}
                    className="mt-2 text-[12px] font-semibold text-teal-700 hover:text-teal-900 disabled:text-zinc-400">{activa ? 'Es la que estás armando' : 'Usar esta'}</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className={`rounded-xl border-2 p-3.5 ${n === 0 ? 'border-dashed border-zinc-200 bg-zinc-50/50' : 'border-teal-200 bg-white'}`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-[14px] font-bold text-zinc-900">Tu compra</p>
            {n === 0 && <p className="text-[12.5px] text-zinc-500 mt-0.5">Todavía no elegiste nada. Toca un precio en la matriz, usa «Comprar todo aquí» o «Usar esta» en una recomendada.</p>}
          </div>
          {n > 0 && puedeOperar && (
            <button type="button" onClick={() => setCompra({})} className="text-[12px] font-semibold text-zinc-500 hover:text-zinc-800">Empezar de nuevo</button>
          )}
        </div>

        {n > 0 && (
          <div className="mt-2 space-y-2">
            {evaluando && !comb && <p className="text-[12.5px] text-zinc-400 flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Calculando…</p>}
            {evaluacion?.errores.map((e, i) => <p key={i} className="text-[12.5px] text-rose-800 bg-rose-50 border border-rose-100 rounded px-2 py-1">{e}</p>)}
            {comb && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[12px]">
                  <Caja t="Mercadería" v={clp(comb.costoMercaderia)} />
                  <Caja t="Flete" v={clp(comb.costoLogistico)} nota={comb.fleteSinConfirmar ? 'sin confirmar' : undefined} />
                  <Caja t="Total" v={clp(comb.costoTotal)} fuerte />
                  <Caja t="Proveedores / viajes" v={`${comb.nProveedores} / ${comb.viajes}`} />
                  <Caja t="Plazo mayor" v={comb.diasEstimados != null ? `${comb.diasEstimados} días` : 'sin declarar'} />
                </div>
                <ul className="text-[12.5px] text-zinc-700 space-y-0.5">
                  {comb.items.map(i => <li key={i.productoId} className="flex justify-between gap-3"><span className="truncate">{i.descripcion}</span><span className="whitespace-nowrap"><b className="font-semibold">{i.proveedor}</b> · {clp(i.precioUnitario)}</span></li>)}
                </ul>
                {comb.avisos.map((a, i) => <p key={i} className="text-[12px] text-amber-800 bg-amber-50 border border-amber-100 rounded px-2 py-1">• {a}</p>)}
              </>
            )}
            {evaluacion && evaluacion.faltan.length > 0 && (
              <p className="text-[12.5px] text-amber-800 bg-amber-50 border border-amber-100 rounded px-2 py-1">Falta elegir proveedor para: {evaluacion.faltan.map(f => f.descripcion.slice(0, 45)).join(', ')}.</p>
            )}
            {evaluacion && evaluacion.sinOferta.length > 0 && (
              <p className="text-[12.5px] text-rose-800 bg-rose-50 border border-rose-100 rounded px-2 py-1">Nadie cotizó todavía: {evaluacion.sinOferta.map(f => f.descripcion.slice(0, 45)).join(', ')}.</p>
            )}

            {esLaElegida ? (
              <p className="flex items-center gap-1.5 text-[13px] font-semibold text-emerald-700"><CheckCircle2 size={15} /> Esta es la compra elegida: pide su aprobación en el paso siguiente.</p>
            ) : puedeOperar && comb && evaluacion && evaluacion.faltan.length === 0 && evaluacion.errores.length === 0 && (
              <div className="space-y-1.5 pt-1">
                {!esMasRapida && (
                  <input value={just} onChange={e => setJust(e.target.value)} placeholder="¿Por qué esta compra y no la más rápida? (queda registrado)"
                    className="w-full text-[12.5px] border border-amber-300 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-amber-500" />
                )}
                <button type="button" onClick={elegir} disabled={eligiendo || (!esMasRapida && !just.trim())}
                  className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-3.5 py-2 rounded-lg">
                  {eligiendo ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Elegir esta compra
                </button>
                <p className="text-[11.5px] text-zinc-400">Al elegirla se invalida una aprobación de compra previa.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {elegida && plan && plan.hayCompraElegida && (
        <div className="bg-white rounded-xl border border-zinc-200 p-3.5 space-y-2">
          <div className="flex items-start gap-2">
            <Scale size={16} className="text-zinc-400 mt-0.5" />
            <div>
              <p className="text-[14px] font-bold text-zinc-900">Cargar esta compra al costeo</p>
              <p className="text-[12.5px] text-zinc-500">Pone el costo neto de cada proveedor elegido en «Costo unit. REAL» del costeo, con su cotización como respaldo. No toca nada más del costeo. El flete no se carga aquí: va como gasto extra.</p>
            </div>
          </div>
          {plan.aviso && <p className="text-[12.5px] text-amber-800">{plan.aviso}</p>}
          {plan.lineas.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead><tr className="text-left text-zinc-400 text-[11px] uppercase"><th className="py-1 pr-3">Producto</th><th className="py-1 pr-3">Proveedor</th><th className="py-1 pr-3">Hoy en el costeo</th><th className="py-1 pr-3">Se carga</th><th className="py-1">Estado</th></tr></thead>
                <tbody>
                  {plan.lineas.map(l => (
                    <tr key={l.productoId} className="border-t border-zinc-100">
                      <td className="py-1.5 pr-3 max-w-[260px] truncate" title={l.descripcion}>{l.descripcion}</td>
                      <td className="py-1.5 pr-3">{l.proveedor}</td>
                      <td className="py-1.5 pr-3 text-zinc-500">{l.anterior != null ? clp(l.anterior) : 'vacío'}</td>
                      <td className="py-1.5 pr-3 font-semibold">{clp(l.costoNeto)}{l.incluido && <span className="text-[11px] font-normal text-sky-700"> (incluido)</span>}</td>
                      <td className="py-1.5">
                        {l.estado === 'CARGA' && <span className="text-teal-700 font-semibold">se cargará</span>}
                        {l.estado === 'IGUAL' && <span className="text-emerald-700">ya está cargado</span>}
                        {l.estado === 'SIN_FILA' && <span className="text-amber-700">no encuentro la fila del costeo</span>}
                        {l.estado === 'SIN_LINK' && <span className="text-amber-700">falta el respaldo (archivo de la cotización)</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {puedeOperar && plan.lineas.some(l => l.estado === 'CARGA') && (
            <button type="button" onClick={cargarAlCosteo} disabled={cargando}
              className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-white bg-zinc-800 hover:bg-zinc-900 disabled:opacity-50 px-3.5 py-2 rounded-lg">
              {cargando ? <Loader2 size={14} className="animate-spin" /> : <Arrow size={14} />} Cargar al costeo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Caja({ t, v, nota, fuerte }: { t: string; v: string; nota?: string; fuerte?: boolean }) {
  return (
    <div className="rounded-lg bg-zinc-50 px-2.5 py-1.5"><p className="text-zinc-400 text-[11px]">{t}</p>
      <p className={`tabular-nums ${fuerte ? 'font-bold text-zinc-900 text-[14px]' : 'font-semibold text-zinc-800'}`}>{v}{nota && <span className="ml-1 text-amber-600 font-semibold text-[11px]">{nota}</span>}</p></div>
  );
}
