'use client';

// Guía de despacho en Obuma (solo Inversiones Claro, la única empresa con Obuma). Se elige una OC de Obuma del negocio y se arma un
// BORRADOR: productos, SKU y cantidades de la OC, con el precio de VENTA del costeo (no el de compra). Solo desde el borrador se crea.
// Hoy la creación real NO está habilitada (falta confirmar con Obuma): el botón queda apagado y lo explica.
import { useEffect, useState } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { IconLoader2 as Loader2, IconTruckDelivery as Truck } from '@tabler/icons-react';

interface Oc { folio: string; proveedor: string; total: number; lineas: number }
interface Linea { productoIdObuma: string; sku: string | null; nombre: string; cantidad: number; precioCompraNeto: number; precioNeto: number | null; origenPrecio: 'costeo' | 'manual' | null; subtotalNeto: number }
interface Guia { folioOc: string; lineas: Linea[]; totalNeto: number; faltanPrecios: number }

const clp = (n: number) => '$' + Math.round(n).toLocaleString('es-CL');

export function GuiaDespachoObumaCard({ negocioId }: { negocioId: number }) {
  const toast = useToast();
  const [ocs, setOcs] = useState<Oc[] | null>(null);
  const [habilitada, setHabilitada] = useState(false);
  const [folio, setFolio] = useState('');
  const [guia, setGuia] = useState<Guia | null>(null);
  const [manual, setManual] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState(false);
  const url = `/api/compras/${negocioId}/guia-despacho-obuma`;

  useEffect(() => {
    fetch(url).then(r => r.json()).then(d => {
      if (d?.success) { setOcs(d.ocs); setHabilitada(!!d.creacionHabilitada); if (d.ocs.length === 1) setFolio(d.ocs[0].folio); } else setOcs([]);
    }).catch(() => setOcs([]));
  }, [url]);

  const preciosManual = () => Object.fromEntries(Object.entries(manual).map(([k, v]) => [k, Number(v.replace(/[^\d]/g, '')) || 0]).filter(([, v]) => (v as number) > 0));

  const llamar = async (enviar: boolean) => {
    setOcupado(true);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folioOc: folio, preciosManual: preciosManual(), enviar }) });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'No se pudo.');
      setGuia(d.guia);
      if (enviar) toast.success('Guía creada', `Folio ${d.envio?.folio}${d.envio?.simulada ? ' (simulada)' : ''}`);
    } catch (e: any) { toast.error(enviar ? 'No se pudo crear la guía' : 'No se pudo armar el borrador', e.message); }
    finally { setOcupado(false); }
  };

  if (ocs === null) return null;

  if (ocs.length === 0) return (
    <section className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50/60 p-4">
      <div className="flex items-center gap-2"><Truck size={18} className="text-zinc-400" /><h3 className="text-[14px] font-semibold text-zinc-700">Guía de despacho en Obuma</h3></div>
      <p className="mt-1 text-[12.5px] text-zinc-500">Este negocio aún no tiene una orden de compra de Obuma con folio. Cuando la tenga (créala en «Compra y logística» o anota su N°), aquí podrás armar la guía con sus productos y SKU.</p>
    </section>
  );

  // Total en vivo con lo que se va escribiendo a mano (el servidor lo vuelve a calcular al recargar o crear).
  const precioDe = (l: Linea) => l.precioNeto ?? (Number((manual[l.productoIdObuma] || '').replace(/[^\d]/g, '')) || null);
  const faltan = guia ? guia.lineas.filter(l => precioDe(l) == null).length : 0;
  const total = guia ? guia.lineas.reduce((s, l) => s + (precioDe(l) ?? 0) * l.cantidad, 0) : 0;

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 space-y-3">
      <div className="flex items-center gap-2"><Truck size={18} className="text-teal-700" /><h3 className="text-[14px] font-semibold text-zinc-900">Guía de despacho en Obuma</h3></div>
      <p className="text-[12.5px] text-zinc-500">Se arma con los productos y SKU de una orden de compra de Obuma de este negocio, con el <b>precio de venta</b> del costeo.</p>
      <div className="flex flex-wrap items-center gap-2">
        <select value={folio} onChange={e => { setFolio(e.target.value); setGuia(null); setManual({}); }}
          className="text-[13px] px-3 py-2 rounded-lg border border-zinc-300 bg-white min-w-[260px]">
          <option value="">Elige la orden de compra…</option>
          {ocs.map(o => <option key={o.folio} value={o.folio}>OC {o.folio} · {o.proveedor} · {o.lineas} líneas</option>)}
        </select>
        <button onClick={() => llamar(false)} disabled={!folio || ocupado}
          className="inline-flex items-center gap-2 text-[13px] font-semibold px-3.5 py-2 rounded-lg border border-zinc-300 text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">
          {ocupado && <Loader2 size={14} className="animate-spin" />} {guia ? 'Actualizar borrador' : 'Ver borrador'}
        </button>
      </div>
      {guia && (
        <div className="space-y-2">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-amber-700">Borrador · aún no se envía a Obuma</p>
          <div className="overflow-x-auto rounded-lg border border-zinc-200">
            <table className="w-full text-[12.5px]">
              <thead className="bg-zinc-50 text-zinc-500 text-left"><tr>
                <th className="px-3 py-2">SKU Obuma</th><th className="px-3 py-2">Producto</th><th className="px-3 py-2 text-right">Cant.</th>
                <th className="px-3 py-2 text-right">Precio venta neto</th><th className="px-3 py-2 text-right">Subtotal</th>
              </tr></thead>
              <tbody>{guia.lineas.map(l => {
                const p = precioDe(l);
                return (
                  <tr key={l.productoIdObuma} className={`border-t border-zinc-100 ${l.precioNeto == null ? 'bg-amber-50/50' : ''}`}>
                    <td className="px-3 py-1.5">{l.sku || '—'}</td>
                    <td className="px-3 py-1.5">{l.nombre}<span className="block text-[11px] text-zinc-400">Compra: {clp(l.precioCompraNeto)} c/u</span></td>
                    <td className="px-3 py-1.5 text-right">{l.cantidad}</td>
                    <td className="px-3 py-1.5 text-right">
                      {l.origenPrecio === 'costeo' ? clp(l.precioNeto!) : (
                        <input inputMode="numeric" value={manual[l.productoIdObuma] ?? ''} placeholder="No está en el costeo"
                          onChange={e => setManual(m => ({ ...m, [l.productoIdObuma]: e.target.value }))}
                          className="w-36 text-right tabular-nums border border-amber-300 rounded-md px-2 py-1 bg-white outline-none focus:ring-1 focus:ring-teal-500" />
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right font-semibold">{p != null ? clp(p * l.cantidad) : '—'}</td>
                  </tr>
                );
              })}</tbody>
              <tfoot><tr className="border-t border-zinc-200 bg-zinc-50"><td colSpan={4} className="px-3 py-2 font-semibold">Total neto (venta)</td><td className="px-3 py-2 text-right font-semibold">{clp(total)}</td></tr></tfoot>
            </table>
          </div>
          {faltan > 0 && <p className="text-[12.5px] text-amber-700">{faltan} producto(s) no tienen precio de venta en el costeo: escríbelo a mano o corrígelo en el costeo y actualiza el borrador.</p>}
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => llamar(true)} disabled={!habilitada || faltan > 0 || ocupado}
              className="inline-flex items-center gap-2 text-[13px] font-semibold px-3.5 py-2 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">
              Crear guía en Obuma
            </button>
            {!habilitada && <span className="text-[12px] text-zinc-500">Todavía no se pueden crear guías desde aquí: falta que Obuma confirme que su API acepta guías (tipo 52). Por ahora usa este borrador para hacerla en Obuma.</span>}
          </div>
        </div>
      )}
    </section>
  );
}
