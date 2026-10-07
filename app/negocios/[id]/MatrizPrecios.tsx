'use client';

// MATRIZ DE PRECIOS — la vista principal del paso «Cotizaciones»: productos en filas, proveedores en columnas,
// y en cada celda el precio neto por unidad (con adicionales incluidos) y cuánto se aparta de lo costeado.
// Reemplaza a las tarjetas apiladas por cotización × producto: de un vistazo se ve quién cotizó qué, a cuánto,
// y cuál conviene. Tocar una celda abre el detalle (desglose, adicionales, otros controles) justo debajo.
import { IconStar as Star } from '@tabler/icons-react';
import { compararPrecioConCosteo, type VeredictoPrecio } from '@/app/lib/compras-precio-vs-costeo';

export interface SeleccionCelda { cotizacionId: number; productoId: number }
interface CotizacionMin { id: number; proveedorNombre: string; items: Array<{ productoId: number; precioUnitario: number | null; adicionales: unknown[] }> }

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;
const pct = (n: number) => String(n).replace('.', ',');

export const ESTILO_VEREDICTO: Record<VeredictoPrecio, { chip: string; texto: (diffPct: number | null) => string }> = {
  MEJOR: { chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', texto: d => `▼ ${pct(Math.abs(d ?? 0))} % menos` },
  IGUAL: { chip: 'bg-sky-50 text-sky-700 border-sky-200', texto: () => '≈ igual al costeo' },
  PEOR: { chip: 'bg-rose-50 text-rose-700 border-rose-200', texto: d => `▲ ${pct(d ?? 0)} % más` },
  SIN_COMPARAR: { chip: 'bg-zinc-100 text-zinc-600 border-zinc-200', texto: () => 'sin comparar' },
};

export function MatrizPrecios({ productos, cotizaciones, costeado, seleccion, onSeleccionar }: {
  productos: Array<{ id: number; descripcion: string }>; cotizaciones: CotizacionMin[];
  costeado: Record<number, number | null>; seleccion: SeleccionCelda | null; onSeleccionar: (s: SeleccionCelda) => void;
}) {
  if (cotizaciones.length === 0 || productos.length === 0) return null;
  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
      <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-100">
        <p className="text-[14px] font-bold text-zinc-900">Comparación de precios</p>
        <p className="text-[12.5px] text-zinc-500 mt-0.5">Precio neto por unidad, con adicionales incluidos, contra lo costeado. Toca un precio para ver el detalle.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-zinc-200">
              <th className="sticky left-0 z-10 bg-white px-4 py-2.5 text-[11.5px] font-bold text-zinc-500 uppercase tracking-wide min-w-[220px]">Producto</th>
              <th className="px-3 py-2.5 text-[11.5px] font-bold text-zinc-500 uppercase tracking-wide min-w-[120px]">Lo costeado</th>
              {cotizaciones.map(c => (
                <th key={c.id} className="px-3 py-2.5 min-w-[150px] align-bottom">
                  <span className="block text-[13px] font-bold text-zinc-900 leading-tight">{c.proveedorNombre}</span>
                  <span className="block text-[11px] font-normal text-zinc-400">Cotización #{c.id}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {productos.map(p => {
              const base = costeado[p.id] ?? null;
              const precios = cotizaciones.map(c => c.items.find(i => i.productoId === p.id)?.precioUnitario ?? null);
              const validos = precios.filter((x): x is number => x != null && x > 0);
              const mejor = validos.length >= 2 ? Math.min(...validos) : null;
              const sinCotizar = validos.length === 0 && cotizaciones.every(c => !c.items.some(i => i.productoId === p.id));
              return (
                <tr key={p.id} className="border-b border-zinc-100 last:border-0 align-top">
                  <td className="sticky left-0 z-10 bg-white px-4 py-3">
                    <p className="text-[13px] font-semibold text-zinc-900 line-clamp-2">{p.descripcion}</p>
                    {sinCotizar && <p className="text-[11.5px] font-semibold text-amber-600 mt-0.5">Sin cotizar todavía</p>}
                  </td>
                  <td className="px-3 py-3 text-[13.5px] font-semibold text-zinc-700 whitespace-nowrap">{base != null ? clp(base) : <span className="font-normal text-zinc-400" title="El costeo no tiene un costo para esta línea">—</span>}</td>
                  {cotizaciones.map((c, i) => {
                    const item = c.items.find(x => x.productoId === p.id);
                    if (!item) return <td key={c.id} className="px-3 py-3 text-[12px] text-zinc-300">no cotizó</td>;
                    const cmp = compararPrecioConCosteo(item.precioUnitario, base);
                    const est = ESTILO_VEREDICTO[cmp.veredicto];
                    const activa = seleccion?.cotizacionId === c.id && seleccion.productoId === p.id;
                    const esMejor = mejor != null && precios[i] === mejor;
                    return (
                      <td key={c.id} className="px-2 py-2">
                        <button type="button" onClick={() => onSeleccionar({ cotizacionId: c.id, productoId: p.id })}
                          className={`w-full text-left rounded-lg px-2.5 py-1.5 border transition-colors ${activa ? 'border-indigo-400 ring-2 ring-indigo-200 bg-indigo-50/40' : 'border-transparent hover:border-zinc-300 hover:bg-zinc-50'}`}>
                          <span className="flex items-center gap-1.5">
                            <span className="text-[14px] font-bold text-zinc-900 whitespace-nowrap">{item.precioUnitario != null ? clp(item.precioUnitario) : 'sin precio'}</span>
                            {esMejor && <span title="Mejor precio de este producto" className="inline-flex items-center gap-0.5 text-[10.5px] font-bold text-amber-600"><Star size={12} className="fill-amber-400" /> Mejor</span>}
                          </span>
                          <span className={`inline-block mt-1 text-[11.5px] font-semibold px-1.5 py-0.5 rounded border ${est.chip}`}>{est.texto(cmp.diffPct)}</span>
                          {item.adicionales.length > 0 && <span className="block text-[11px] text-zinc-400 mt-0.5">incluye {item.adicionales.length} adicional{item.adicionales.length === 1 ? '' : 'es'}</span>}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-2 text-[11.5px] text-zinc-400 border-t border-zinc-100">
        Verde: más barata que lo costeado · Rojo: más cara · Azul: igual (±1 %) · Gris: no se puede comparar. La estrella marca el mejor precio de cada producto.
      </p>
    </div>
  );
}
