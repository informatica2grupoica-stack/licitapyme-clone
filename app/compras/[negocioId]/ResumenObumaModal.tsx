'use client';

// RESUMEN DE OBUMA (14-oct-2026): al pulsar «Obuma» arriba del flujo se muestra, solo para leer, lo que ya se creó
// en Obuma DESDE Licitank en este negocio: los SKU de los productos y las órdenes de compra a proveedores.
// Crear cosas sigue en sus pasos (SKU en «Aprobación y SKU»; proveedores y órdenes en la gestión de Obuma).
import { useEffect, useState } from 'react';
import { IconX as X, IconLoader2 as Loader2, IconCircleCheck as Check, IconCircle as Pendiente, IconBolt as Zap } from '@tabler/icons-react';
import { fmtCLP } from './ComprasContext';

interface SkuFila { productoId: number; descripcion: string; codigo: string | null }
interface OcFila { proveedor: string; folio: string | null; total: number | null; fecha: string | null }

export function ResumenObumaModal({ negocioId, onCerrar, onIrGestion, onIrSku }: {
  negocioId: number; onCerrar: () => void; onIrGestion: () => void; onIrSku: () => void;
}) {
  const [datos, setDatos] = useState<{ skus: SkuFila[]; ocs: OcFila[]; pendientesOc: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const [rS, rO, rP] = await Promise.all([
          fetch(`/api/compras/${negocioId}/sku`).then(r => r.json()),
          fetch(`/api/compras/${negocioId}/orden-compra-obuma`).then(r => r.json()),
          fetch(`/api/compras/${negocioId}/productos`).then(r => r.json()),
        ]);
        if (!vivo) return;
        const vigentes: Array<{ id: number; descripcion: string; subestado: string }> =
          (rP?.productos || []).filter((p: any) => !['RENUNCIADO', 'NO_ADJUDICADA'].includes(p.subestado));
        const skus: SkuFila[] = vigentes.map(p => {
          const s = (rS?.skus || []).find((x: any) => x.productoId === p.id && x.obumaProductoId);
          return { productoId: p.id, descripcion: p.descripcion.split(' - ')[0], codigo: s?.obumaCodigoComercial ?? null };
        });
        const provs: any[] = rO?.proveedores || [];
        const ocs: OcFila[] = provs.filter(p => p.yaCreada).map(p => ({
          proveedor: p.proveedorNombre, folio: p.yaCreada.folio, total: p.yaCreada.total ?? null, fecha: p.yaCreada.fechaOc ?? null,
        }));
        setDatos({ skus, ocs, pendientesOc: provs.filter(p => !p.yaCreada).map(p => p.proveedorNombre) });
      } catch (e: any) {
        if (vivo) setError(e.message || 'No se pudo cargar');
      }
    })();
    return () => { vivo = false; };
  }, [negocioId]);

  const conSku = datos?.skus.filter(s => s.codigo).length ?? 0;

  return (
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-start justify-center overflow-y-auto p-4" onClick={onCerrar} data-testid="resumen-obuma">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-10" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-200">
          <div>
            <p className="text-[15px] font-bold text-zinc-900 flex items-center gap-1.5"><Zap size={16} className="text-indigo-600" /> Lo creado en Obuma</p>
            <p className="text-[12px] text-zinc-500">Resumen de lo que este negocio ya tiene en Obuma, creado desde Licitank.</p>
          </div>
          <button type="button" onClick={onCerrar} className="text-zinc-400 hover:text-zinc-700" aria-label="Cerrar"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-5">
          {error && <p className="text-[13px] text-rose-700">{error}</p>}
          {!datos && !error && <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>}
          {datos && (
            <>
              <section>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[13px] font-bold text-zinc-800">SKU de los productos</p>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${conSku === datos.skus.length && conSku > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{conSku} de {datos.skus.length}</span>
                </div>
                {datos.skus.length === 0 ? <p className="text-[12.5px] text-zinc-400">Todavía no hay productos.</p> : (
                  <ul className="rounded-lg border border-zinc-200 divide-y divide-zinc-100">
                    {datos.skus.map(s => (
                      <li key={s.productoId} className="px-3 py-2 flex items-center gap-2.5 text-[12.5px]">
                        {s.codigo ? <Check size={16} className="text-emerald-600 flex-shrink-0" /> : <Pendiente size={16} className="text-zinc-300 flex-shrink-0" />}
                        <span className="flex-1 min-w-0 truncate text-zinc-800">{s.descripcion}</span>
                        {s.codigo ? <b className="text-indigo-700">{s.codigo}</b> : <span className="text-zinc-400">sin crear</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {conSku < datos.skus.length && (
                  <button type="button" onClick={() => { onCerrar(); onIrSku(); }} className="mt-1.5 text-[12.5px] font-semibold text-teal-700 hover:text-teal-900">Crear los SKU que faltan en «Aprobación y SKU» →</button>
                )}
              </section>

              <section>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[13px] font-bold text-zinc-800">Órdenes de compra a proveedores</p>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${datos.pendientesOc.length === 0 && datos.ocs.length > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{datos.ocs.length} emitida{datos.ocs.length === 1 ? '' : 's'}</span>
                </div>
                {datos.ocs.length === 0 ? <p className="text-[12.5px] text-zinc-400">Todavía no se emitió ninguna orden de compra.</p> : (
                  <ul className="rounded-lg border border-zinc-200 divide-y divide-zinc-100">
                    {datos.ocs.map(o => (
                      <li key={`${o.proveedor}-${o.folio}`} className="px-3 py-2 flex items-center gap-2.5 text-[12.5px]">
                        <Check size={16} className="text-emerald-600 flex-shrink-0" />
                        <span className="flex-1 min-w-0 truncate text-zinc-800">{o.proveedor}</span>
                        <span className="text-zinc-500">{o.folio ? `OC ${o.folio}` : 'OC'}{o.fecha ? ` · ${o.fecha.slice(0, 10)}` : ''}</span>
                        {o.total != null && <b className="text-zinc-800 tabular-nums">{fmtCLP(o.total)}</b>}
                      </li>
                    ))}
                  </ul>
                )}
                {datos.pendientesOc.length > 0 && <p className="mt-1.5 text-[12px] text-amber-700">Falta emitir: {datos.pendientesOc.join(', ')}.</p>}
              </section>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-zinc-200 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[11.5px] text-zinc-400">Aquí solo se mira. Crear proveedores y órdenes de compra se hace en la gestión de Obuma.</p>
          <button type="button" onClick={() => { onCerrar(); onIrGestion(); }} className="text-[12.5px] font-semibold text-indigo-700 border border-indigo-200 hover:bg-indigo-50 px-3 py-1.5 rounded-lg">Abrir la gestión de Obuma</button>
        </div>
      </div>
    </div>
  );
}
