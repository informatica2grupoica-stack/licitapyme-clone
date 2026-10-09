'use client';

// QUÉ PRODUCTOS TIENEN COTIZACIÓN Y CUÁLES NO. La matriz de precios solo aparece cuando ya hay cotizaciones; esta lista está siempre y
// pone adelante lo que falta por cotizar, con lo costeado de cada ítem como referencia.
import { useState } from 'react';
import { IconCircleCheck as Ok, IconAlertTriangle as Falta } from '@tabler/icons-react';

const clp = (n: number | null | undefined) => n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
const corto = (d: string) => d.split(' - ')[0];

export function CoberturaCotizaciones({ productos, cotizaciones, costeado }: {
  productos: Array<{ id: number; descripcion: string; cantidad?: number | null }>;
  cotizaciones: Array<{ id: number; proveedorNombre: string; items: Array<{ productoId: number; precioUnitario: number | null }> }>;
  costeado: Record<number, number | null>;
}) {
  const [soloFaltan, setSoloFaltan] = useState(false);
  if (productos.length === 0) return null;
  const filas = productos.map((p, i) => {
    const cot = cotizaciones.filter(c => c.items.some(it => it.productoId === p.id));
    const precios = cot.map(c => c.items.find(it => it.productoId === p.id)?.precioUnitario).filter((x): x is number => x != null);
    return { p, n: i + 1, proveedores: [...new Set(cot.map(c => c.proveedorNombre))], mejor: precios.length ? Math.min(...precios) : null };
  });
  const sin = filas.filter(f => f.proveedores.length === 0);
  const visibles = soloFaltan ? sin : filas;

  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden" data-testid="cobertura-cotizaciones">
      <div className="flex items-center gap-2 flex-wrap px-4 py-3 bg-zinc-50 border-b border-zinc-100">
        <p className="text-[13.5px] font-bold text-zinc-700">Productos y su cotización</p>
        {sin.length > 0
          ? <span className="text-[11.5px] font-bold px-2 py-0.5 rounded-full border bg-rose-50 text-rose-700 border-rose-200">{sin.length} sin cotización</span>
          : <span className="text-[11.5px] font-bold px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">Todos cotizados</span>}
        <span className="text-[11.5px] text-zinc-500">{productos.length - sin.length} de {productos.length} con al menos una cotización</span>
        {sin.length > 0 && sin.length < productos.length && (
          <button type="button" onClick={() => setSoloFaltan(v => !v)} className="ml-auto text-[11.5px] font-semibold text-teal-700 hover:text-teal-900">{soloFaltan ? 'Ver todos' : 'Ver solo los que faltan'}</button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] min-w-[640px]">
          <thead>
            <tr className="text-left text-[10.5px] font-bold uppercase text-zinc-400 border-b border-zinc-100">
              <th className="px-4 py-2 w-8">#</th><th className="px-2 py-2">Producto</th><th className="px-2 py-2 text-right">Cant.</th>
              <th className="px-2 py-2 text-right">Costeado (c/u)</th><th className="px-2 py-2">Cotización</th><th className="px-2 py-2 text-right">Mejor precio</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {visibles.map(({ p, n, proveedores, mejor }) => (
              <tr key={p.id} className={proveedores.length === 0 ? 'bg-rose-50/40' : ''} data-testid={`cobertura-${p.id}`}>
                <td className="px-4 py-2 text-zinc-400">{n}</td>
                <td className="px-2 py-2 font-semibold text-zinc-800">{corto(p.descripcion)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{p.cantidad ?? '—'}</td>
                <td className="px-2 py-2 text-right tabular-nums text-zinc-500">{clp(costeado[p.id])}</td>
                <td className="px-2 py-2">
                  {proveedores.length === 0
                    ? <span className="inline-flex items-center gap-1 font-bold text-rose-700"><Falta size={13} /> Sin cotización</span>
                    : <span className="inline-flex items-center gap-1 text-emerald-700"><Ok size={13} /> {proveedores.length} · <span className="text-zinc-600">{proveedores.join(', ')}</span></span>}
                </td>
                <td className="px-2 py-2 text-right tabular-nums font-semibold">{clp(mejor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
