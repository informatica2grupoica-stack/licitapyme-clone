'use client';

// EMPAREJAR A MANO (skill licitank-ui) — panel lateral para un producto que el pareo automático no resolvió bien: lista las líneas de TODAS las cotizaciones
// del negocio, de la más probable a la menos, con qué revisar de cada una (medida, presión, familia, cantidad, ya usada en otro producto), deja ver la
// cotización en el visor y, al elegir, muestra cómo quedaría antes de guardar. Lógica pura en app/lib/compras-emparejar-mano.ts (con pruebas).
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconX as X, IconEye as Eye, IconSearch as Search, IconCheck as Check } from '@tabler/icons-react';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Estado } from '@/app/components/ui/kit/Tarjeta';
import { DocumentViewerModal, type VisorDoc } from '@/app/components/DocumentViewerModal';
import { parsearMontoCL } from '@/app/lib/numeros';
import { candidatasParaProducto, resumenAsignacion, type CandidataMano, type CotizacionParaEmparejar, type ProductoParaMano, type Tono } from '@/app/lib/compras-emparejar-mano';

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;
const COLOR: Record<Tono, string> = { ok: '#16a34a', dudoso: '#d97706', malo: '#dc2626' };
const TEXTO: Record<Tono, string> = { ok: 'text-emerald-700 dark:text-emerald-400', dudoso: 'text-amber-700 dark:text-amber-400', malo: 'text-rose-700 dark:text-rose-400' };
const VISIBLES_AL_ABRIR = 12;

/** Cotización como la entrega la lista de Compras (camelCase, con el texto del documento). */
export interface CotizacionDeLista {
  id: number; proveedorNombre: string; moneda?: string | null; tipoCambioUsado?: number | null; notas?: string | null; descuentoPct?: number | null;
  precioTotalClp?: number | null; fleteMonto?: number | null; descripcionLibre?: string | null; archivoUrl?: string | null; archivoNombre?: string | null;
  items: Array<{ productoId: number; precioBase?: number | null }>;
}
export interface AsignacionMano { cotizacionId: number; productoId: number; precio: number; linea: string; cumple: 'CUMPLE' | 'INFERIOR_NEGOCIABLE'; aviso: string | null }

export function EmparejarAMano({ producto, productos, cotizaciones, costeado, onCerrar, onConfirmar }: {
  producto: ProductoParaMano; productos: ProductoParaMano[]; cotizaciones: CotizacionDeLista[]; costeado: number | null;
  onCerrar: () => void; onConfirmar: (a: AsignacionMano) => Promise<void>;
}) {
  const [busca, setBusca] = useState('');
  const [verTodas, setVerTodas] = useState(false);
  const [ocultarChocan, setOcultarChocan] = useState(false);
  const [elegida, setElegida] = useState<CandidataMano | null>(null);
  const [precioTxt, setPrecioTxt] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visor, setVisor] = useState<VisorDoc | null>(null);

  const comoPareo = useMemo<CotizacionParaEmparejar[]>(() => cotizaciones.map(c => ({
    id: c.id, proveedor_nombre: c.proveedorNombre, moneda: c.moneda ?? 'CLP', tipo_cambio_usado: c.tipoCambioUsado ?? null, notas: c.notas ?? null,
    descuento_pct: c.descuentoPct ?? null, precio_total: c.precioTotalClp ?? null, flete_monto: c.fleteMonto ?? null, descripcion_libre: c.descripcionLibre ?? null,
    archivoUrl: c.archivoUrl ?? null, archivoNombre: c.archivoNombre ?? null, items: c.items.map(i => ({ productoId: i.productoId, precioBase: i.precioBase ?? null })),
  })), [cotizaciones]);
  const todas = useMemo(() => candidatasParaProducto(producto, productos, comoPareo), [producto, productos, comoPareo]);
  const docs: VisorDoc[] = useMemo(() => cotizaciones.filter(c => c.archivoUrl).map(c => ({
    nombre: c.archivoNombre || `cotizacion-${c.id}.pdf`, url: c.archivoUrl!, titulo: c.proveedorNombre, detalle: `#${c.id}${c.archivoNombre ? ` · ${c.archivoNombre}` : ''}`,
  })), [cotizaciones]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !visor) onCerrar(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCerrar, visor]);

  const q = busca.trim().toLowerCase();
  const filtradas = todas.filter(f => (!ocultarChocan || f.tono !== 'malo') && (!q || `${f.descripcion} ${f.proveedor}`.toLowerCase().includes(q)));
  const lista = verTodas || q ? filtradas : filtradas.slice(0, VISIBLES_AL_ABRIR);
  const ofertasDeHoy = todas.filter(f => f.esActual);

  const elegir = (f: CandidataMano) => { setElegida(f); setPrecioTxt(f.precioNeto != null ? String(Math.round(f.precioNeto * 100) / 100).replace('.', ',') : ''); setError(null); };
  const precio = parsearMontoCL(precioTxt);
  const precioValido = precio != null && precio > 0;
  const res = elegida && precio != null && precioValido ? resumenAsignacion(producto, precio, costeado) : null;
  const abrirVisor = (cotizacionId: number) => { const c = cotizaciones.find(x => x.id === cotizacionId); if (c?.archivoUrl) setVisor(docs.find(d => d.url === c.archivoUrl) ?? null); };

  const confirmar = async () => {
    if (!elegida || precio == null || !precioValido) return;
    setGuardando(true); setError(null);
    const avisos = elegida.avisos.filter(a => a.tono !== 'ok').map(a => a.texto).join(' · ');
    try {
      await onConfirmar({ cotizacionId: elegida.cotizacionId, productoId: producto.id, precio, linea: elegida.descripcion, cumple: elegida.tono === 'ok' ? 'CUMPLE' : 'INFERIOR_NEGOCIABLE', aviso: avisos || null });
      onCerrar();
    } catch (e: any) { setError(e?.message || 'No se pudo guardar.'); }
    finally { setGuardando(false); }
  };

  // Portal al <body>: el comparador es un contenedor de consultas (@container) y eso encierra a los hijos con position:fixed.
  if (typeof document === 'undefined') return null;
  return createPortal(
    <>
      <div className="fixed inset-0 z-[90] flex justify-end" role="dialog" aria-modal="true" aria-label="Emparejar a mano">
        <div className="absolute inset-0 bg-black/40" onClick={onCerrar} />
        <div className="@container relative w-full max-w-[980px] h-full flex flex-col bg-white dark:bg-slate-900 shadow-flotante">
          <header className="px-6 pt-5 pb-4 border-b border-linea dark:border-slate-800">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs text-tinta-2 dark:text-slate-400">Emparejar a mano</p>
                <h2 className="text-[17px] font-semibold tracking-tight text-tinta dark:text-slate-100 leading-snug">{producto.descripcion}</h2>
                <p className="mt-1 text-xs text-tinta-2 dark:text-slate-400 tabular-nums">
                  Piden {producto.cantidad ?? '—'} {producto.unidad || 'un.'}
                  {costeado != null && <> · costeado {clp(costeado)} por unidad</>}
                  {ofertasDeHoy.length > 0 ? <> · hoy: {ofertasDeHoy.map(o => `${o.proveedor} ${clp(o.precioNeto!)}`).join(', ')}</> : <> · hoy no tiene oferta</>}
                </p>
              </div>
              <button type="button" onClick={onCerrar} aria-label="Cerrar" className="p-1.5 -m-1.5 rounded-lg text-slate-400 hover:text-tinta hover:bg-slate-100 dark:hover:bg-slate-800"><X size={18} /></button>
            </div>
            <div className="mt-3 flex items-center gap-4 flex-wrap">
              <label className="relative block flex-1 min-w-52 max-w-sm">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar en las líneas de las cotizaciones" aria-label="Buscar en las líneas"
                  className="w-full text-sm border border-linea dark:border-slate-700 dark:bg-slate-900 rounded-lg pl-8 pr-3 py-2 outline-none focus:ring-1 focus:ring-marca" />
              </label>
              <label className="inline-flex items-center gap-2 text-xs text-tinta-2 dark:text-slate-300 cursor-pointer select-none">
                <input type="checkbox" checked={ocultarChocan} onChange={e => setOcultarChocan(e.target.checked)} className="accent-teal-700" />
                Ocultar las que chocan en medida o familia
              </label>
              <span className="text-xs text-tinta-3 tabular-nums">{filtradas.length} línea{filtradas.length === 1 ? '' : 's'}</span>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto">
            <div className="hidden @3xl:grid grid-cols-[minmax(0,1.5fr)_84px_112px_minmax(0,1.3fr)_auto] gap-x-4 px-6 pt-3 pb-1 text-[11px] text-tinta-3" aria-hidden>
              <span>Línea de la cotización</span><span className="text-right">Cotiza</span><span className="text-right">Precio neto c/u</span><span>Qué revisar</span><span className="w-24" />
            </div>
            {lista.length === 0 && <p className="px-6 py-10 text-center text-sm text-tinta-2">Ninguna línea coincide. Prueba con otra palabra, o quita el filtro.</p>}
            <ul>
              {lista.map(f => {
                const sel = elegida?.cotizacionId === f.cotizacionId && elegida.codigo === f.codigo;
                const tieneDoc = !!cotizaciones.find(c => c.id === f.cotizacionId)?.archivoUrl;
                return (
                  <li key={`${f.cotizacionId}-${f.codigo}`} className={`border-t border-linea dark:border-slate-800 ${sel ? 'bg-marca-suave/70 dark:bg-teal-950/30' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'}`}>
                    <div role="button" tabIndex={0} aria-pressed={sel} onClick={() => elegir(f)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); elegir(f); } }}
                      className="grid grid-cols-[minmax(0,1fr)_auto] @3xl:grid-cols-[minmax(0,1.5fr)_84px_112px_minmax(0,1.3fr)_auto] gap-x-4 gap-y-1.5 items-start px-6 py-3 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-marca">
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-tinta dark:text-slate-100 leading-snug">{f.descripcion}</p>
                        <p className="text-xs text-tinta-2 dark:text-slate-400">{f.proveedor} · cotización #{f.cotizacionId}{f.esActual && <span className="text-marca dark:text-teal-400 font-medium"> · es la oferta de hoy</span>}</p>
                      </div>
                      <p className="text-right text-xs tabular-nums text-tinta-2 @3xl:text-[13px]">{f.cantidad != null ? `${f.cantidad.toLocaleString('es-CL')} ${f.unidad || 'un.'}` : '—'}</p>
                      <p className="text-right text-[13px] font-semibold tabular-nums text-tinta dark:text-slate-100">{f.precioNeto != null ? clp(f.precioNeto) : '—'}</p>
                      <ul className="col-span-2 @3xl:col-span-1 space-y-0.5">
                        {f.avisos.map((a, i) => (
                          <li key={i} className={`text-xs ${TEXTO[a.tono]}`}><Estado color={COLOR[a.tono]}><span className="whitespace-normal">{a.texto}</span></Estado></li>
                        ))}
                      </ul>
                      <div className="col-start-2 row-start-1 @3xl:col-start-auto @3xl:row-start-auto flex justify-end">
                        {tieneDoc && (
                          <Boton variante="fantasma" tamano="sm" icono={<Eye size={14} />} onClick={e => { e.stopPropagation(); abrirVisor(f.cotizacionId); }} aria-label={`Ver la cotización #${f.cotizacionId} de ${f.proveedor}`}>Ver cotización</Boton>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            {!verTodas && !q && filtradas.length > VISIBLES_AL_ABRIR && (
              <div className="px-6 py-3 border-t border-linea dark:border-slate-800"><Boton variante="secundario" tamano="sm" onClick={() => setVerTodas(true)}>Ver las {filtradas.length - VISIBLES_AL_ABRIR} líneas restantes</Boton></div>
            )}
          </div>

          <footer className="border-t border-linea dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 px-6 py-4">
            {!elegida ? (
              <p className="text-sm text-tinta-2 dark:text-slate-300">Elige una línea para ver cómo quedaría. Con «Ver cotización» la miras en el documento antes de decidir.</p>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
                  <label className="text-xs text-tinta-2 dark:text-slate-300">
                    Precio neto por unidad del producto
                    <input value={precioTxt} onChange={e => setPrecioTxt(e.target.value)} inputMode="decimal" aria-label="Precio neto por unidad del producto"
                      className="mt-1 block w-44 text-sm tabular-nums border border-linea dark:border-slate-700 dark:bg-slate-900 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-marca" />
                  </label>
                  {elegida.envaseDelProducto != null && elegida.precioNeto != null && (
                    <div className="text-xs text-tinta-2 dark:text-slate-300 pb-1">
                      El producto dice que viene en envases de {elegida.envaseDelProducto}. Si la línea es por unidad menor (metro) y el producto es el rollo:
                      <button type="button" onClick={() => setPrecioTxt(String(Math.round(elegida.precioNeto! * elegida.envaseDelProducto! * 100) / 100).replace('.', ','))} className="ml-1.5 font-medium text-marca dark:text-teal-400 underline underline-offset-2">usar × {elegida.envaseDelProducto}</button>
                      <button type="button" onClick={() => setPrecioTxt(String(Math.round(elegida.precioNeto! * 100) / 100).replace('.', ','))} className="ml-2 font-medium text-marca dark:text-teal-400 underline underline-offset-2">volver al de la línea</button>
                    </div>
                  )}
                </div>
                {res && (
                  <p className="text-sm text-tinta dark:text-slate-100 tabular-nums">
                    <span className="font-semibold">Quedaría: {clp(precio!)} × {res.cantidad.toLocaleString('es-CL')} = {clp(res.total)}</span>
                    <span className="text-tinta-2 dark:text-slate-400"> · {elegida.proveedor} #{elegida.cotizacionId}</span>
                    {res.costeadoTotal != null && res.difPct != null && (
                      <span className={res.difPct > 1 ? 'text-rose-700 dark:text-rose-400' : res.difPct < -1 ? 'text-emerald-700 dark:text-emerald-400' : 'text-tinta-2'}> · costeado {clp(res.costeadoTotal)} ({res.difPct > 0 ? '+' : ''}{String(res.difPct).replace('.', ',')} %)</span>
                    )}
                  </p>
                )}
                {!precioValido && <p className="text-xs font-medium text-rose-700">Escribe un precio mayor que cero.</p>}
                {elegida.tono !== 'ok' && (
                  <p className={`text-xs font-medium ${TEXTO[elegida.tono]}`}>
                    {elegida.tono === 'malo' ? 'Esta línea choca con lo pedido. Confírmala solo si miraste la cotización y sabes que sirve.' : 'Hay cosas por revisar en esta línea. Míralas en la cotización antes de confirmar.'}
                  </p>
                )}
                {error && <p className="text-xs font-medium text-rose-700">{error}</p>}
                <div className="flex items-center gap-2">
                  <Boton variante="primario" onClick={confirmar} disabled={guardando || !precioValido} icono={<Check size={15} />}>
                    {guardando ? 'Guardando…' : elegida.tono === 'malo' ? 'Usar de todos modos' : 'Asignar esta línea'}
                  </Boton>
                  <Boton variante="fantasma" onClick={() => setElegida(null)} disabled={guardando}>Elegir otra</Boton>
                </div>
              </div>
            )}
          </footer>
        </div>
      </div>
      <DocumentViewerModal doc={visor} onClose={() => setVisor(null)} lista={docs} onElegir={setVisor} />
    </>,
    document.body,
  );
}
