'use client';

// RESUMEN COMPARATIVO — ¿coinciden lo costeado, el plan de compra de Licitank y lo comprado de verdad
// en Obuma? Por producto y por orden de compra, todo NETO. Solo lectura: lee /resumen-comparativo.
import { useEffect, useState } from 'react';
import { CompararOcModal } from './CompararOcModal';
import { GastoExtraModal } from './GastoExtraModal';
import { useToast } from '@/app/components/ui/toast';
import { IconLoader2 as Loader2, IconScale as Scale, IconAlertTriangle as Alerta, IconCircleCheck as Check } from '@tabler/icons-react';

interface Fila {
  productoId: number; producto: string; cantidad: number;
  ventaUnit: number | null; ventaNeto: number | null; costeoUnit: number | null; costeoNeto: number | null;
  planProveedor: string | null; planUnit: number | null; planNeto: number | null;
  obumaProveedor: string | null; obumaOc: string | null; obumaEstado: string | null; obumaSku: string | null;
  obumaUnit: number | null; obumaNeto: number | null; otroProveedor: boolean;
}
interface PorOc { ocFolio: string; proveedor: string | null; estado: string | null; planNeto: number | null; obumaNeto: number; facturadoNeto: number; facturas: number }
interface CuadreLado { obumaCantidad: number; obumaTotal: number; licitankCantidad: number; licitankTotal: number; diferencias: { concepto: string; monto: number; gastoPropio?: { descripcion: string; categoria: string } }[]; sinExplicar: number }
interface Resumen {
  cuadre: { proyectoFolio: number | null; proyectoNombre: string | null; oc: CuadreLado; facturas: CuadreLado; soloEnOc: string[]; cuadra: boolean } | null;
  filas: Fila[];
  lineasSinPlan: { ocFolio: string; proveedor: string | null; producto: string; sku: string | null; cantidad: number | null; neto: number | null }[];
  porOc: PorOc[];
  gastosExtra: { id: number; categoria: string; descripcion: string; monto: number; moneda: string; fecha: string | null; origen: 'licitank' | 'obuma' }[];
  totales: { venta: number; costeo: number; plan: number; obumaOc: number; facturado: number; gastosExtra: number; margenRealNeto: number; margenRealPct: number | null };
  avisos: string[];
}

const fmt = (n: number | null | undefined) => n == null ? '—'
  : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

/** Diferencia de A contra B (A − B) con su % y color: pagar más que la referencia es rojo, menos es verde. */
function Dif({ a, b }: { a: number | null; b: number | null }) {
  if (a == null || b == null || b === 0) return <span className="text-zinc-300">—</span>;
  const d = Math.round(a - b);
  const pct = Math.round(((a - b) / b) * 1000) / 10;
  if (Math.abs(pct) < 1) return <span className="text-zinc-500">≈ igual</span>;
  return <span className={`font-semibold ${d > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{d > 0 ? '+' : '−'}{fmt(Math.abs(d))} <span className="font-normal">({pct > 0 ? '+' : ''}{String(pct).replace('.', ',')}%)</span></span>;
}

export function ResumenComparativoCard({ negocioId }: { negocioId: number }) {
  const [r, setR] = useState<Resumen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comparando, setComparando] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [agregandoGasto, setAgregandoGasto] = useState<{ categoria: string; descripcion?: string; monto?: number } | null>(null);   // null = cerrado
  const [sincronizando, setSincronizando] = useState(false);
  const toast = useToast();

  // Corre YA la sincronización con Obuma (la misma del cron de las 07:45) y vuelve a armar el comparativo.
  const sincronizar = async () => {
    setSincronizando(true);
    try {
      const r = await fetch(`/api/compras/${negocioId}/sincronizar-obuma`, { method: 'POST' }).then(x => x.json());
      if (r.error) throw new Error(r.error);
      toast.success('Obuma sincronizado', `${r.resumen?.candidatas ?? 0} compra(s) de Obuma cruzadas con licitaciones nuestras.`);
      setVersion(v => v + 1);
    } catch (e: any) { toast.error('No se pudo sincronizar con Obuma', e.message); }
    finally { setSincronizando(false); }
  };

  useEffect(() => {
    let vivo = true;
    fetch(`/api/compras/${negocioId}/resumen-comparativo`).then(x => x.json())
      .then(d => { if (!vivo) return; if (d.success) setR(d.resumen); else setError(d.error || 'No se pudo armar el comparativo.'); })
      .catch(() => vivo && setError('No se pudo armar el comparativo.'));
    return () => { vivo = false; };
  }, [negocioId, version]);

  if (error) return <p className="px-1 py-2 text-[12px] text-rose-600">{error}</p>;
  if (!r) return <div className="flex items-center gap-2 text-[12px] text-zinc-400 py-3"><Loader2 size={14} className="animate-spin" /> Armando el comparativo…</div>;
  const t = r.totales;
  const coincide = r.avisos.length === 0;

  return (
    <div className="space-y-4" data-testid="resumen-comparativo">
      <div className={`rounded-xl border px-3 py-2.5 ${coincide ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/60'}`}>
        <p className={`text-[13px] font-bold flex items-center gap-1.5 ${coincide ? 'text-emerald-800' : 'text-amber-900'}`}>
          {coincide ? <Check size={15} /> : <Alerta size={15} />}
          {coincide ? 'Costeo, plan de Licitank y Obuma coinciden.' : `Hay ${r.avisos.length} cosa(s) que no coinciden — revisar`}
        </p>
        {r.avisos.length > 0 && <ul className="mt-1 list-disc pl-5 space-y-0.5 text-[12px] text-amber-900">{r.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>}
      </div>

      {r.cuadre && (
        <div className={`rounded-xl border px-3 py-2.5 ${r.cuadre.cuadra ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/60'}`} data-testid="cuadre-obuma">
          <p className="text-[12.5px] font-bold text-zinc-800">
            Cuadre con el proyecto en Obuma{r.cuadre.proyectoFolio ? ` · PR-${r.cuadre.proyectoFolio}` : ''} <span className="font-medium text-zinc-400">· con IVA, como lo muestra Obuma</span>
          </p>
          <div className="overflow-x-auto mt-1.5">
            <table className="w-full text-[12px] border-collapse">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wide text-zinc-500">
                  <th className="py-1 pr-3 font-semibold"> </th>
                  <th className="py-1 px-3 font-semibold text-right">En Obuma</th>
                  <th className="py-1 px-3 font-semibold text-right">En Licitank</th>
                  <th className="py-1 px-3 font-semibold text-right">Obuma − Licitank</th>
                  <th className="py-1 pl-3 font-semibold">Por qué</th>
                </tr>
              </thead>
              <tbody>
                {([['Órdenes de compra', r.cuadre.oc], ['Facturas', r.cuadre.facturas]] as const).map(([nombre, l]) => (
                  <tr key={nombre} className="border-t border-zinc-200/70 align-top">
                    <td className="py-1.5 pr-3 font-semibold text-zinc-800 whitespace-nowrap">{nombre}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums whitespace-nowrap">{fmt(l.obumaTotal)}<span className="block text-[10.5px] text-zinc-400">{l.obumaCantidad} documento(s)</span></td>
                    <td className="py-1.5 px-3 text-right tabular-nums whitespace-nowrap">{fmt(l.licitankTotal)}<span className="block text-[10.5px] text-zinc-400">{l.licitankCantidad} documento(s)</span></td>
                    <td className="py-1.5 px-3 text-right tabular-nums whitespace-nowrap font-semibold">{fmt(l.obumaTotal - l.licitankTotal)}</td>
                    <td className="py-1.5 pl-3 text-zinc-700">
                      {l.diferencias.length === 0 && Math.abs(l.sinExplicar) <= 2 && <span className="text-emerald-700 font-semibold">Cuadra exacto.</span>}
                      {l.diferencias.map((d, i) => (
                        <span key={i} className="block">
                          <span className="font-semibold tabular-nums">{d.monto >= 0 ? '+' : '−'} {fmt(Math.abs(d.monto))}</span> · {d.concepto}
                          {d.gastoPropio && <button type="button" onClick={() => setAgregandoGasto({ categoria: d.gastoPropio!.categoria, descripcion: d.gastoPropio!.descripcion, monto: Math.abs(d.monto) })} className="ml-2 text-[11px] font-semibold text-teal-700 hover:text-teal-900">Registrar en Gastos extra</button>}
                        </span>
                      ))}
                      {Math.abs(l.sinExplicar) > 2 && <span className="block font-semibold text-amber-800">{l.sinExplicar > 0 ? '+' : '−'} {fmt(Math.abs(l.sinExplicar))} sin explicar (puede faltar sincronizar con Obuma)</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {r.cuadre.soloEnOc.length > 0 && (
            <ul className="mt-1.5 list-disc pl-5 text-[11.5px] text-amber-900 space-y-0.5">{r.cuadre.soloEnOc.map((t, i) => <li key={i}>{t}</li>)}</ul>
          )}
          <p className="mt-1 text-[11px] text-zinc-500">{r.cuadre.cuadra ? 'Todo lo que Obuma tiene en este proyecto está en Licitank o está explicado arriba.' : 'Hay diferencias sin explicar: sincroniza con Obuma y, si siguen, avísame.'} Lo que Licitank deja fuera es porque Obuma lo tiene mal (OC anulada, factura duplicada o enlazada a la OC equivocada): se corrige en Obuma y aquí se actualiza solo.</p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
        {[
          ['Venta ganada', t.venta, 'text-zinc-800'],
          ['Costeado', t.costeo, 'text-zinc-800'],
          ['Plan en Licitank', t.plan, 'text-zinc-800'],
          ['OC en Obuma', t.obumaOc, 'text-sky-800'],
          ['Facturado', t.facturado, 'text-zinc-800'],
          ['Gastos extra', t.gastosExtra, 'text-zinc-800'],
        ].map(([n, v, c]) => (
          <div key={n as string} className="rounded-xl border border-zinc-100 bg-zinc-50/60 px-3 py-2">
            <p className="text-[10.5px] font-semibold text-zinc-500 uppercase tracking-wide flex items-center justify-between">
              {n as string}
              {n === 'Gastos extra' && (
                <button type="button" onClick={() => setAgregandoGasto({ categoria: '' })} title="Agregar un gasto extra" aria-label="Agregar gasto extra" data-testid="agregar-gasto-extra"
                  className="w-5 h-5 rounded-full bg-teal-600 hover:bg-teal-700 text-white text-[14px] leading-none flex items-center justify-center">+</button>
              )}
            </p>
            <p className={`text-[14px] font-bold mt-0.5 tabular-nums ${c}`}>{fmt(v as number)}</p>
            <p className="text-[10.5px] text-zinc-400">neto</p>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 flex-wrap text-[11.5px] text-zinc-500">
        <span>Las OC y facturas de Obuma se copian una vez al día (07:45). Si acabas de corregir algo allá:</span>
        <button type="button" onClick={sincronizar} disabled={sincronizando} className="inline-flex items-center gap-1.5 font-semibold text-indigo-700 hover:text-indigo-900 disabled:opacity-50" data-testid="sincronizar-obuma">
          {sincronizando && <Loader2 size={12} className="animate-spin" />} Sincronizar con Obuma ahora
        </button>
      </div>
      <p className="text-[12px] text-zinc-600">
        Margen real (OC de Obuma + gastos extra): <b className="text-zinc-800">{fmt(t.margenRealNeto)}</b>
        {t.margenRealPct != null && <> ({String(t.margenRealPct).replace('.', ',')}% de la venta)</>} · contra lo costeado: <Dif a={t.obumaOc + t.gastosExtra} b={t.costeo} />
      </p>

      <div>
        <p className="text-[10.5px] font-semibold text-zinc-500 uppercase tracking-wide mb-1 flex items-center gap-1.5"><Scale size={12} /> Por producto · todo neto</p>
        <div className="overflow-x-auto rounded-lg border border-zinc-100">
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr className="bg-zinc-50 text-left text-[10.5px] uppercase tracking-wide text-zinc-500">
                <th className="px-3 py-1.5 font-semibold">Producto</th>
                <th className="px-3 py-1.5 font-semibold text-right">Cant.</th>
                <th className="px-3 py-1.5 font-semibold text-right">Venta</th>
                <th className="px-3 py-1.5 font-semibold text-right">Costeo</th>
                <th className="px-3 py-1.5 font-semibold">Plan Licitank</th>
                <th className="px-3 py-1.5 font-semibold">Comprado en Obuma</th>
                <th className="px-3 py-1.5 font-semibold text-right">Obuma vs costeo</th>
              </tr>
            </thead>
            <tbody>
              {r.filas.map(f => (
                <tr key={f.productoId} className="border-t border-zinc-100 align-top">
                  <td className="px-3 py-1.5 font-semibold text-zinc-800 min-w-[170px]">{f.producto}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-zinc-700">{f.cantidad}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-zinc-700">{fmt(f.ventaNeto)}<span className="block text-[10.5px] text-zinc-400">{fmt(f.ventaUnit)} c/u</span></td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-zinc-700">{fmt(f.costeoNeto)}<span className="block text-[10.5px] text-zinc-400">{fmt(f.costeoUnit)} c/u</span></td>
                  <td className="px-3 py-1.5 tabular-nums text-zinc-700">
                    {f.planProveedor ? <>{fmt(f.planNeto)}<span className="block text-[10.5px] text-zinc-400">{f.planProveedor} · {fmt(f.planUnit)} c/u</span></> : <span className="text-zinc-300">sin plan</span>}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums text-zinc-700">
                    {f.obumaOc ? (
                      <>
                        {fmt(f.obumaNeto)}
                        <span className="block text-[10.5px] text-zinc-400">{f.obumaProveedor} · OC {f.obumaOc}{f.obumaEstado ? ` · ${f.obumaEstado}` : ''} · {fmt(f.obumaUnit)} c/u</span>
                        {f.obumaSku && <span className="block text-[10.5px] font-semibold text-indigo-600">SKU {f.obumaSku}</span>}
                        {f.otroProveedor && <span className="block text-[10.5px] font-semibold text-amber-700">⚠ proveedor distinto al plan</span>}
                      </>
                    ) : <span className="text-amber-700 font-semibold">sin OC en Obuma</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums"><Dif a={f.obumaNeto} b={f.costeoNeto} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-zinc-200 bg-zinc-50 font-semibold text-zinc-800">
                <td className="px-3 py-1.5" colSpan={2}>{r.filas.length} productos</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(t.venta)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(t.costeo)}</td>
                <td className="px-3 py-1.5 tabular-nums">{fmt(t.plan)}</td>
                <td className="px-3 py-1.5 tabular-nums">{fmt(r.filas.reduce((s, f) => s + (f.obumaNeto ?? 0), 0))}</td>
                <td className="px-3 py-1.5 text-right"><Dif a={r.filas.reduce((s, f) => s + (f.obumaNeto ?? 0), 0)} b={t.costeo} /></td>
              </tr>
            </tfoot>
          </table>
        </div>
        {r.lineasSinPlan.length > 0 && (
          <p className="mt-1 text-[11.5px] text-zinc-500">
            Además, en Obuma hay líneas que no son un producto del plan: {r.lineasSinPlan.map(l => `${l.producto.slice(0, 40)} (OC ${l.ocFolio}, ${fmt(l.neto)})`).join(' · ')}.
          </p>
        )}
      </div>

      <div data-testid="resumen-gastos-extra">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10.5px] font-semibold text-zinc-500 uppercase tracking-wide">Gastos extra del proyecto <span className="normal-case font-medium text-zinc-400">· se suman al costo real</span></p>
          <span className="inline-flex items-center gap-3">
            <button type="button" onClick={() => setAgregandoGasto({ categoria: 'Garantía de fiel cumplimiento' })} className="text-[11.5px] font-semibold text-zinc-500 hover:text-teal-700">+ Garantía</button>
            <button type="button" onClick={() => setAgregandoGasto({ categoria: '' })} className="text-[11.5px] font-semibold text-teal-700 hover:text-teal-900">+ Agregar gasto extra</button>
          </span>
        </div>
        {r.gastosExtra.length === 0 && <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-2 text-[12px] text-zinc-400">Sin gastos extra. Usa «+» para agregar uno (flete, garantía, horas extras…).</p>}
        {r.gastosExtra.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-zinc-100">
            <table className="w-full text-[12px] border-collapse">
              <thead>
                <tr className="bg-zinc-50 text-left text-[10.5px] uppercase tracking-wide text-zinc-500">
                  <th className="px-3 py-1.5 font-semibold">Categoría</th>
                  <th className="px-3 py-1.5 font-semibold">Descripción</th>
                  <th className="px-3 py-1.5 font-semibold">Fecha</th>
                  <th className="px-3 py-1.5 font-semibold text-right">Monto</th>
                </tr>
              </thead>
              <tbody>
                {r.gastosExtra.map(g => (
                  <tr key={g.id} className="border-t border-zinc-100">
                    <td className="px-3 py-1.5 font-semibold text-zinc-800 whitespace-nowrap">{g.categoria}</td>
                    <td className="px-3 py-1.5 text-zinc-700">{g.descripcion}{g.origen === 'obuma' && <span className="ml-1.5 text-[10px] font-semibold text-sky-700 bg-sky-50 border border-sky-200 px-1.5 py-0.5 rounded-full">desde Obuma</span>}</td>
                    <td className="px-3 py-1.5 text-zinc-600 whitespace-nowrap">{g.fecha ? g.fecha.split('-').reverse().join('-') : '—'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-zinc-800">{g.moneda === 'CLP' ? fmt(g.monto) : <span className="text-amber-700">{g.monto} {g.moneda} (no suma)</span>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-zinc-200 bg-zinc-50 font-semibold text-zinc-800">
                  <td className="px-3 py-1.5" colSpan={3}>{r.gastosExtra.length} gasto(s)</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmt(t.gastosExtra)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <div>
        <p className="text-[10.5px] font-semibold text-zinc-500 uppercase tracking-wide mb-1">Por orden de compra · plan contra Obuma contra factura</p>
        <div className="overflow-x-auto rounded-lg border border-zinc-100">
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr className="bg-zinc-50 text-left text-[10.5px] uppercase tracking-wide text-zinc-500">
                <th className="px-3 py-1.5 font-semibold">OC</th>
                <th className="px-3 py-1.5 font-semibold">Proveedor</th>
                <th className="px-3 py-1.5 font-semibold">Estado</th>
                <th className="px-3 py-1.5 font-semibold text-right">Plan</th>
                <th className="px-3 py-1.5 font-semibold text-right">OC Obuma</th>
                <th className="px-3 py-1.5 font-semibold text-right">Facturado</th>
                <th className="px-3 py-1.5 font-semibold text-right">OC − factura</th>
                <th className="px-3 py-1.5 font-semibold text-right">Ver</th>
              </tr>
            </thead>
            <tbody>
              {r.porOc.map(o => (
                <tr key={o.ocFolio} className="border-t border-zinc-100">
                  <td className="px-3 py-1.5 tabular-nums text-zinc-600 whitespace-nowrap">OC {o.ocFolio}</td>
                  <td className="px-3 py-1.5 font-semibold text-zinc-800">{o.proveedor || '—'}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap"><span className="text-[10.5px] font-semibold text-sky-700 bg-sky-50 border border-sky-200 px-1.5 py-0.5 rounded-full">{o.estado || '—'}</span></td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-zinc-700">{fmt(o.planNeto)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-zinc-700">{fmt(o.obumaNeto)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-zinc-700">{o.facturas ? fmt(o.facturadoNeto) : <span className="text-amber-700 font-semibold">sin factura</span>}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{o.facturas ? <Dif a={o.obumaNeto} b={o.facturadoNeto} /> : <span className="text-zinc-300">—</span>}</td>
                  <td className="px-3 py-1.5 text-right whitespace-nowrap"><button type="button" onClick={() => setComparando(o.ocFolio)} className="text-[11.5px] font-semibold text-indigo-700 hover:text-indigo-900" data-testid={`comparar-${o.ocFolio}`}>Comparar</button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-zinc-200 bg-zinc-50 font-semibold text-zinc-800">
                <td className="px-3 py-1.5" colSpan={3}>{r.porOc.length} OC</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.porOc.reduce((s, o) => s + (o.planNeto ?? 0), 0))}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(t.obumaOc)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(t.facturado)}</td>
                <td className="px-3 py-1.5" />
                <td className="px-3 py-1.5" />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="mt-1 text-[11px] text-zinc-400">«Comparar» abre, lado a lado, la cotización del plan, la OC de Obuma y la factura de esa orden.</p>
      </div>
      {agregandoGasto !== null && <GastoExtraModal negocioId={negocioId} categoriaInicial={agregandoGasto.categoria || undefined} descripcionInicial={agregandoGasto.descripcion} montoInicial={agregandoGasto.monto} onCerrar={() => setAgregandoGasto(null)} onGuardado={() => { setAgregandoGasto(null); setVersion(v => v + 1); }} />}
      {comparando && <CompararOcModal negocioId={negocioId} ocFolio={comparando} onCerrar={() => setComparando(null)} />}
    </div>
  );
}
