'use client';

// Ficha de un proveedor en un modal: datos de contacto, productos que le hemos comprado y sus
// órdenes de compra. Se abre desde «Hay proveedores con compras anteriores parecidas» (Cotizaciones)
// y sirve desde cualquier lugar que tenga el id local o el id de Obuma del proveedor.
import { useEffect, useState } from 'react';
import { Modal } from '@/app/components/ui/Modal';
import { IconLoader2 as Loader2, IconChevronDown as ChevronDown, IconPhone as Phone, IconMail as Mail } from '@tabler/icons-react';

export interface ProveedorRef {
  proveedorId: number | null; obumaProveedorId: string | null; nombreEmpresa: string; rut: string | null;
  /** Productos que motivaron abrir la ficha (se marcan en la lista). */
  productosParecidos?: string[];
}

interface Ficha {
  proveedor: {
    id: number; rut: string | null; nombreEmpresa: string; nombreFantasia: string | null; categoria: string | null; giro: string | null;
    contactoNombre: string | null; correo: string | null; telefono: string | null; direccion: string | null; comuna: string | null; region: string | null; notas: string | null;
  } | null;
  compras: Array<{ id: string; folio: string | null; fecha: string; total: number; estado: string }>;
  totalOrdenes: number; totalComprado: number;
  productos: Array<{ nombre: string; cantidad: number; veces: number; ultimaFecha: string | null; ultimoPrecio: number | null }>;
}
interface Item { nombre: string; cantidad: number; precioUnitario: number; subtotal: number }

const fmtCLP = (n: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
const fmtFecha = (s: string | null) => (s ? s.slice(0, 10).split('-').reverse().join('-') : '—');
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Carcasa: el contenido va con `key` para que cada proveedor arranque con estado limpio.
export function ProveedorFichaModal({ prov, onClose }: { prov: ProveedorRef | null; onClose: () => void }) {
  return (
    <Modal open={!!prov} onClose={onClose} title={prov?.nombreEmpresa} subtitle={prov?.rut ? `RUT ${prov.rut}` : undefined} size="lg">
      {prov && <FichaContenido key={`${prov.proveedorId ?? ''}-${prov.obumaProveedorId ?? ''}`} prov={prov} />}
    </Modal>
  );
}

function FichaContenido({ prov }: { prov: ProveedorRef }) {
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ocAbierta, setOcAbierta] = useState<string | null>(null);
  const [items, setItems] = useState<Record<string, Item[] | 'cargando' | 'error'>>({});

  useEffect(() => {
    let vivo = true;
    const q = new URLSearchParams();
    if (prov.proveedorId != null) q.set('id', String(prov.proveedorId));
    if (prov.obumaProveedorId) q.set('obumaId', prov.obumaProveedorId);
    fetch(`/api/compras/proveedores/ficha?${q}`).then(r => r.json()).then(d => {
      if (!vivo) return;
      if (!d.success) throw new Error(d.error || 'No se pudo cargar la ficha');
      setFicha(d);
    }).catch(e => { if (vivo) setError(e.message); }).finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [prov]);

  const abrirOc = async (folio: string) => {
    const abrir = ocAbierta !== folio;
    setOcAbierta(abrir ? folio : null);
    if (!abrir || items[folio]) return;
    setItems(m => ({ ...m, [folio]: 'cargando' }));
    try {
      const d = await fetch(`/api/compras/proveedores/ficha?folio=${encodeURIComponent(folio)}`).then(r => r.json());
      if (!d.success) throw new Error();
      setItems(m => ({ ...m, [folio]: d.items }));
    } catch { setItems(m => ({ ...m, [folio]: 'error' })); }
  };

  const p = ficha?.proveedor ?? null;
  const parecidos = new Set((prov.productosParecidos ?? []).map(norm));
  const direccion = p ? [p.direccion, p.comuna, p.region].filter(Boolean).join(', ') : '';
  const datos: Array<[string, React.ReactNode]> = p ? ([
    ['RUT', p.rut],
    ['Nombre de fantasía', p.nombreFantasia],
    ['Giro', p.giro],
    ['Categoría', p.categoria],
    ['Contacto', p.contactoNombre],
    ['Teléfono', p.telefono && <a href={`tel:${p.telefono}`} className="inline-flex items-center gap-1 text-teal-700 dark:text-teal-300 hover:underline"><Phone size={12} />{p.telefono}</a>],
    ['Correo', p.correo && <a href={`mailto:${p.correo}`} className="inline-flex items-center gap-1 text-teal-700 dark:text-teal-300 hover:underline break-all"><Mail size={12} />{p.correo}</a>],
    ['Dirección', direccion],
  ] as Array<[string, React.ReactNode]>).filter(([, v]) => v) : [];

  return (
    <>
      {cargando && <div className="flex items-center justify-center py-10"><Loader2 size={18} className="animate-spin text-teal-600" /></div>}
      {error && <p className="text-[12.5px] text-rose-600 py-4">{error}</p>}
      {ficha && (
        <div className="space-y-5">
          <section>
            <h4 className="text-[12px] font-semibold text-teal-700 dark:text-teal-300 pb-1.5 mb-2.5 border-b border-zinc-100 dark:border-white/10">Datos de contacto</h4>
            {p ? (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
                {datos.map(([k, v]) => (
                  <div key={k} className="min-w-0">
                    <dt className="text-[11px] text-zinc-500 dark:text-zinc-400">{k}</dt>
                    <dd className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100 break-words mt-0.5">{v}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-[12.5px] text-zinc-500 dark:text-zinc-400">Este proveedor todavía no tiene ficha en el catálogo de Licitank (sin teléfono ni correo). Se muestra lo que hay de sus compras en Obuma.</p>
            )}
            {p?.notas && <p className="text-[12px] text-zinc-500 dark:text-zinc-400 mt-3">{p.notas}</p>}
          </section>

          <section>
            <h4 className="text-[12px] font-semibold text-teal-700 dark:text-teal-300 pb-1.5 mb-2.5 border-b border-zinc-100 dark:border-white/10 flex items-baseline justify-between gap-3">
              <span>Productos que le hemos comprado</span>
              {ficha.totalOrdenes > 0 && <span className="text-[11px] font-normal text-zinc-500 dark:text-zinc-400 tabular-nums">{ficha.totalOrdenes} orden{ficha.totalOrdenes === 1 ? '' : 'es'} de compra{ficha.compras.length < ficha.totalOrdenes ? ` · ${fmtCLP(ficha.totalComprado)} en las ${ficha.compras.length} últimas` : ` · ${fmtCLP(ficha.totalComprado)}`}</span>}
            </h4>
            {ficha.productos.length > 0 ? (
              <>
                <div className="hidden sm:block rounded-lg border border-zinc-200 dark:border-white/10 overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead className="bg-zinc-50 dark:bg-white/5 text-[11px] text-zinc-500 dark:text-zinc-400">
                      <tr><th className="text-left font-medium px-3 py-1.5">Producto</th><th className="text-right font-medium px-2 py-1.5">Veces</th><th className="text-right font-medium px-2 py-1.5">Cantidad</th><th className="text-right font-medium px-2 py-1.5 whitespace-nowrap">Último precio</th><th className="text-right font-medium px-3 py-1.5 whitespace-nowrap">Última compra</th></tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-white/10">
                      {ficha.productos.map(x => {
                        const parecido = parecidos.has(norm(x.nombre));
                        return (
                          <tr key={x.nombre} className={parecido ? 'bg-teal-50/50 dark:bg-teal-500/10' : ''}>
                            <td className="px-3 py-1.5 text-zinc-800 dark:text-zinc-100 font-medium break-words">{parecido && <span className="inline-block w-1.5 h-1.5 rounded-full bg-teal-500 mr-1.5 align-middle" title="Parecido a lo que estás cotizando" />}{x.nombre}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{x.veces}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{x.cantidad}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-zinc-800 dark:text-zinc-100 whitespace-nowrap">{x.ultimoPrecio != null ? fmtCLP(x.ultimoPrecio) : '—'}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-zinc-500 dark:text-zinc-400 whitespace-nowrap">{fmtFecha(x.ultimaFecha)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <ul className="sm:hidden rounded-lg border border-zinc-200 dark:border-white/10 divide-y divide-zinc-100 dark:divide-white/10">
                  {ficha.productos.map(x => {
                    const parecido = parecidos.has(norm(x.nombre));
                    return (
                      <li key={x.nombre} className={`px-3 py-2 ${parecido ? 'bg-teal-50/50 dark:bg-teal-500/10' : ''}`}>
                        <p className="text-[12.5px] font-medium text-zinc-800 dark:text-zinc-100 break-words">{parecido && <span className="inline-block w-1.5 h-1.5 rounded-full bg-teal-500 mr-1.5 align-middle" />}{x.nombre}</p>
                        <p className="text-[11.5px] text-zinc-500 dark:text-zinc-400 tabular-nums mt-0.5">{x.veces} vez{x.veces === 1 ? '' : 'es'} · {x.cantidad} un. · {x.ultimoPrecio != null ? fmtCLP(x.ultimoPrecio) : '—'} · {fmtFecha(x.ultimaFecha)}</p>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <p className="text-[12.5px] text-zinc-500 dark:text-zinc-400">
                {prov.productosParecidos?.length ? <>Compras parecidas: {prov.productosParecidos.join(' · ')}. </> : null}
                {ficha.compras.length > 0 ? 'Los productos de sus órdenes todavía no están guardados; ábrelas abajo para verlos.' : 'No hay órdenes de compra a este proveedor en Obuma.'}
              </p>
            )}
          </section>

          {ficha.compras.length > 0 && (
            <section>
              <h4 className="text-[12px] font-semibold text-teal-700 dark:text-teal-300 pb-1.5 mb-2.5 border-b border-zinc-100 dark:border-white/10">Órdenes de compra</h4>
              <div className="rounded-lg border border-zinc-200 dark:border-white/10 divide-y divide-zinc-100 dark:divide-white/10">
                {ficha.compras.map(c => {
                  const abierta = !!c.folio && ocAbierta === c.folio;
                  const it = c.folio ? items[c.folio] : undefined;
                  return (
                    <div key={c.id}>
                      <button type="button" disabled={!c.folio} onClick={() => c.folio && abrirOc(c.folio)} className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-white/5 disabled:hover:bg-transparent">
                        <span className="text-[12px] text-zinc-700 dark:text-zinc-200 tabular-nums">{c.folio ? `OC ${c.folio}` : `#${c.id}`} · {fmtFecha(c.fecha)} · <span className="text-zinc-500 dark:text-zinc-400">{c.estado}</span></span>
                        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-zinc-800 dark:text-zinc-100 tabular-nums">{fmtCLP(c.total)}<ChevronDown size={13} className={`text-zinc-400 transition-transform ${abierta ? 'rotate-180' : ''}`} /></span>
                      </button>
                      {abierta && (
                        <div className="px-3 pb-2.5 bg-zinc-50/60 dark:bg-white/5">
                          {it === 'cargando' || !it ? <p className="text-[11.5px] text-zinc-400 flex items-center gap-1.5 pt-2"><Loader2 size={11} className="animate-spin" /> Cargando ítems…</p>
                            : it === 'error' ? <p className="text-[11.5px] text-amber-600 pt-2">No se pudieron cargar los ítems.</p>
                            : it.length === 0 ? <p className="text-[11.5px] text-zinc-400 pt-2">Sin ítems registrados.</p>
                            : <ul className="pt-2 space-y-0.5">{it.map((x, i) => <li key={i} className="text-[12px] text-zinc-600 dark:text-zinc-300 flex justify-between gap-3"><span>{x.cantidad}× {x.nombre}</span><span className="tabular-nums">{fmtCLP(x.subtotal)}</span></li>)}</ul>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}
