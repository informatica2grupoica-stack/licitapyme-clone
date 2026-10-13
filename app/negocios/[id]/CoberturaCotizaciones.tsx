'use client';

// QUÉ PRODUCTOS TIENEN COTIZACIÓN Y CUÁLES NO. Igual que en el Auditor, la primera cotización de cada producto es el LINK del costeo
// (con lo costeado); después va la cotización con DOCUMENTO del proveedor, que se puede abrir para ver el archivo que se usó.
import { useState } from 'react';
import { IconCircleCheck as Ok, IconAlertTriangle as Falta, IconEye as Eye } from '@tabler/icons-react';
import { DocumentViewerModal, type VisorDoc } from '@/app/components/DocumentViewerModal';
import { LinksProducto, type LinksCosteo } from './LinksProducto';

const clp = (n: number | null | undefined) => n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
const corto = (d: string) => d.split(' - ')[0];
const nombreDeArchivo = (url: string) => { try { return decodeURIComponent(url.split('?')[0].split('/').pop() || 'cotizacion').replace(/^\d+_/, ''); } catch { return 'cotizacion'; } };

export function CoberturaCotizaciones({ productos, cotizaciones, costeado, linksCosteo = {} }: {
  productos: Array<{ id: number; descripcion: string; cantidad?: number | null }>;
  cotizaciones: Array<{ id: number; proveedorNombre: string; archivoUrl?: string | null; archivoNombre?: string | null; items: Array<{ productoId: number; precioUnitario: number | null }> }>;
  costeado: Record<number, number | null>;
  linksCosteo?: LinksCosteo;
}) {
  const [soloFaltan, setSoloFaltan] = useState(false);
  const [visor, setVisor] = useState<VisorDoc | null>(null);
  if (productos.length === 0) return null;
  const filas = productos.map((p, i) => {
    const docs = cotizaciones
      .filter(c => c.items.some(it => it.productoId === p.id))
      .map(c => ({ id: c.id, proveedor: c.proveedorNombre, precio: c.items.find(it => it.productoId === p.id)?.precioUnitario ?? null, url: c.archivoUrl ?? null, nombre: c.archivoNombre ?? null }));
    const precios = docs.map(d => d.precio).filter((x): x is number => x != null);
    return { p, n: i + 1, docs, mejor: precios.length ? Math.min(...precios) : null };
  });
  const sin = filas.filter(f => f.docs.length === 0);
  const visibles = soloFaltan ? sin : filas;

  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden" data-testid="cobertura-cotizaciones">
      <div className="flex items-center gap-2 flex-wrap px-4 py-3 bg-zinc-50 border-b border-zinc-100">
        <p className="text-[13.5px] font-bold text-zinc-700">Productos y su cotización</p>
        {sin.length > 0
          ? <span className="text-[11.5px] font-bold px-2 py-0.5 rounded-full border bg-rose-50 text-rose-700 border-rose-200">{sin.length} sin cotización con documento</span>
          : <span className="text-[11.5px] font-bold px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">Todos cotizados</span>}
        <span className="text-[11.5px] text-zinc-500">{productos.length - sin.length} de {productos.length} con al menos una cotización con documento</span>
        {sin.length > 0 && sin.length < productos.length && (
          <button type="button" onClick={() => setSoloFaltan(v => !v)} className="ml-auto text-[11.5px] font-semibold text-teal-700 hover:text-teal-900">{soloFaltan ? 'Ver todos' : 'Ver solo los que faltan'}</button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] min-w-[900px]">
          <thead>
            <tr className="text-left text-[10.5px] font-bold uppercase text-zinc-400 border-b border-zinc-100">
              <th className="px-4 py-2 w-8">#</th><th className="px-2 py-2">Producto</th><th className="px-2 py-2 text-right">Cant.</th>
              <th className="px-2 py-2">1 · Cotización por link</th><th className="px-2 py-2">2 · Cotización con documento</th><th className="px-2 py-2 text-right">Mejor precio (documento)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {visibles.map(({ p, n, docs, mejor }) => (
              <tr key={p.id} className={docs.length === 0 ? 'bg-rose-50/40' : ''} data-testid={`cobertura-${p.id}`}>
                <td className="px-4 py-2 text-zinc-400 align-top">{n}</td>
                <td className="px-2 py-2 font-semibold text-zinc-800 align-top">{corto(p.descripcion)}</td>
                <td className="px-2 py-2 text-right tabular-nums align-top">{p.cantidad ?? '—'}</td>
                <td className="px-2 py-2 align-top w-72">
                  <LinksProducto links={linksCosteo[p.id]?.links} />
                  <span className="block text-[11px] text-zinc-500 tabular-nums">Costeado (c/u): <b className="text-zinc-700">{clp(costeado[p.id])}</b></span>
                </td>
                <td className="px-2 py-2 align-top">
                  {docs.length === 0
                    ? <span className="inline-flex items-center gap-1 font-bold text-rose-700"><Falta size={13} /> Sin documento de cotización</span>
                    : docs.map(d => (
                      <span key={d.id} className="flex items-center gap-1.5 flex-wrap text-emerald-700">
                        <Ok size={13} /> <span className="text-zinc-700">{d.proveedor}</span>
                        <span className="tabular-nums font-semibold text-zinc-800">{clp(d.precio)}</span>
                        {d.url
                          ? <button type="button" onClick={() => setVisor({ nombre: d.nombre || nombreDeArchivo(d.url!), url: d.url! })} title="Ver el documento que se usó" data-testid={`cobertura-doc-${d.id}`}
                              className="inline-flex items-center gap-1 max-w-[220px] font-semibold text-teal-700 hover:text-teal-900 underline underline-offset-2"><Eye size={12} className="flex-shrink-0" /><span className="truncate">{d.nombre || nombreDeArchivo(d.url)}</span></button>
                          : <span className="text-[11px] text-zinc-400">sin documento adjunto</span>}
                      </span>
                    ))}
                </td>
                <td className="px-2 py-2 text-right tabular-nums font-semibold align-top">{clp(mejor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <DocumentViewerModal doc={visor} onClose={() => setVisor(null)} />
    </div>
  );
}
