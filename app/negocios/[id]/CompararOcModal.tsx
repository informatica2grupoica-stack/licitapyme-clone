'use client';

// COMPARACIÓN VISUAL DE UNA OC: cotización del plan · OC de Obuma · factura, lado a lado y todo NETO.
// Lee /comparar-oc. Marca con color donde un precio cambia entre una columna y la siguiente.
// Si Obuma dice FACTURADA y aquí no llegó la factura, sincroniza esa licitación con Obuma una vez al abrir
// (la copia local puede ir atrasada); el botón «Sincronizar con Obuma» lo hace a mano.
import { useCerrarConEsc } from '@/app/lib/use-cerrar-con-esc';
import { useCallback, useEffect, useRef, useState } from 'react';
import { IconX as X, IconExternalLink as Ext, IconAlertTriangle as Alerta, IconFileText as Doc, IconRefresh as Refrescar, IconLoader2 as Loader2 } from '@tabler/icons-react';
import type { ComparacionOc } from '@/app/lib/compras-comparar-oc';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Estado } from '@/app/components/ui/kit/Tarjeta';
import { Esqueleto } from '@/app/components/ui/kit/Estructura';
import { useToast } from '@/app/components/ui/toast';

const fmt = (n: number | null | undefined) => n == null ? '—'
  : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
const fecha = (f: string | null) => f ? f.slice(0, 10).split('-').reverse().join('-') : '—';

/** Color del punto del estado de una OC de Obuma: facturada = verde, anulada = rojo, el resto gris. */
export function colorEstadoOc(estado: string | null) {
  if (/facturad/i.test(estado || '')) return '#15803d';
  if (/anulad/i.test(estado || '')) return '#dc2626';
  return '#94a3b8';
}
const estadoLegible = (e: string | null) => e ? e.charAt(0) + e.slice(1).toLowerCase() : '—';

/** Cuánto cambió un precio contra el de la columna anterior (≥1 %): rojo si es más caro, verde si es más barato. */
function Cambio({ ahora, antes, umbral = 0.01 }: { ahora: number | null; antes: number | null; umbral?: number }) {
  if (ahora == null || antes == null || antes === 0) return null;
  const pct = (ahora - antes) / antes;
  if (Math.abs(pct) < umbral || Math.abs(ahora - antes) < 2) return null;
  return <span className={`ml-1 text-[11px] font-semibold ${pct > 0 ? 'text-urgente' : 'text-exito'}`}>({pct > 0 ? '+' : '−'}{fmt(Math.abs(Math.round(ahora - antes)))})</span>;
}

function Panel({ paso, titulo, children }: { paso: number; titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-linea bg-white shadow-tarjeta overflow-hidden flex flex-col min-w-0 dark:bg-slate-900 dark:border-slate-800">
      <h3 className="flex items-center gap-2 px-4 pt-3.5 text-[13px] font-semibold text-tinta dark:text-slate-100">
        <span className="w-6 h-6 rounded-lg bg-slate-100 text-tinta-2 text-[12px] font-semibold tabular-nums flex items-center justify-center dark:bg-slate-800 dark:text-slate-300">{paso}</span>
        {titulo}
      </h3>
      <div className="p-4 pt-3 space-y-3 text-[12.5px] text-tinta-2 dark:text-slate-300">{children}</div>
    </section>
  );
}

const TH = 'py-1 font-medium text-[11px] text-tinta-3';
const FILA = 'border-t border-linea/70 align-top dark:border-slate-800';
const PIE = 'border-t border-slate-300 font-semibold text-tinta dark:border-slate-600 dark:text-slate-100';

export function CompararOcModal({ negocioId, ocFolio, onCerrar, onSincronizado }: {
  negocioId: number; ocFolio: string; onCerrar: () => void;
  /** Avisa a la tabla de atrás que la copia de Obuma cambió, para que se vuelva a armar. */
  onSincronizado?: () => void;
}) {
  const [c, setC] = useState<ComparacionOc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verArchivo, setVerArchivo] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  const [sincronizando, setSincronizando] = useState(false);
  const autoSincronizada = useRef(false);
  const toast = useToast();

  useCerrarConEsc(onCerrar);

  const sincronizar = useCallback(async (silencioso = false) => {
    setSincronizando(true);
    try {
      const r = await fetch(`/api/compras/${negocioId}/sincronizar-obuma`, { method: 'POST' }).then(x => x.json());
      if (r.error) throw new Error(r.error);
      if (!silencioso) toast.success('Obuma sincronizado', 'Se volvieron a traer las OC y facturas de esta licitación.');
      setVersion(v => v + 1);
      onSincronizado?.();
    } catch (e) { toast.error('No se pudo sincronizar con Obuma', e instanceof Error ? e.message : String(e)); }
    finally { setSincronizando(false); }
  }, [negocioId, onSincronizado, toast]);
  const sincronizarRef = useRef(sincronizar);
  useEffect(() => { sincronizarRef.current = sincronizar; }, [sincronizar]);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/compras/${negocioId}/comparar-oc?oc=${encodeURIComponent(ocFolio)}`)
      .then(async r => ({ ok: r.ok, j: await r.json().catch(() => ({})) }))
      .then(({ ok, j }) => {
        if (!vivo) return;
        if (!ok || !j.comparacion) { setError(j.error || 'No se pudo armar la comparación.'); return; }
        const comp = j.comparacion as ComparacionOc;
        setC(comp); setError(null);
        // Obuma dice FACTURADA pero la factura no llegó: se trae una vez sola, sin que nadie apriete nada.
        if (!autoSincronizada.current && /facturad/i.test(comp.oc.estado || '') && comp.facturas.length === 0) {
          autoSincronizada.current = true;
          sincronizarRef.current(true);
        }
      })
      .catch(() => vivo && setError('No se pudo armar la comparación.'));
    return () => { vivo = false; };
  }, [negocioId, ocFolio, version]);

  // Precio de la cotización para una línea de la OC (misma cantidad, precio parecido): para marcar cambios.
  const precioCotizado = (cant: number | null, precio: number | null) => {
    if (!c || cant == null || precio == null) return null;
    let mejor: number | null = null; let dif = Infinity;
    for (const q of c.cotizaciones) for (const l of q.lineas) {
      if (l.cantidad !== cant || l.precioUnit == null) continue;
      const d = Math.abs(l.precioUnit - precio) / (precio || 1);
      if (d < dif && d <= 0.25) { dif = d; mejor = l.precioUnit; }
    }
    return mejor;
  };
  const precioOc = (cant: number | null, precio: number | null) => {
    if (!c || cant == null || precio == null) return null;
    const l = c.oc.lineas.find(x => x.cantidad === cant && x.precio != null && Math.abs((x.precio as number) - precio) / (precio || 1) <= 0.25);
    return l?.precio ?? null;
  };

  const cotNeto = c ? c.cotizaciones.reduce((s, q) => s + q.neto + (q.fleteNeto ?? 0), 0) : 0;
  const factOk = c ? c.facturas.filter(f => f.estado === 'OK') : [];
  const factNeto = factOk.reduce((s, f) => s + (f.neto ?? (f.total != null ? Math.round(f.total / 1.19) : 0)), 0);
  const buscandoFactura = sincronizando && !!c && c.facturas.length === 0;

  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/50 flex items-start justify-center overflow-y-auto p-3" role="dialog" aria-modal="true" onClick={onCerrar} data-testid="comparar-oc">
      <div className="@container bg-slate-50 rounded-2xl shadow-flotante w-full max-w-[1500px] my-4 dark:bg-slate-950" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-linea bg-white rounded-t-2xl dark:bg-slate-900 dark:border-slate-800">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold tracking-tight text-tinta dark:text-slate-50 truncate">
              Comparar OC {ocFolio}{c?.oc.proveedor ? ` · ${c.oc.proveedor}` : ''}
            </p>
            <p className="text-[12px] text-tinta-3">Cotización elegida, orden de compra y factura, todo neto</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Boton tamano="sm" onClick={() => sincronizar()} disabled={sincronizando} data-testid="comparar-oc-sincronizar"
              icono={<Refrescar size={14} className={sincronizando ? 'animate-spin' : ''} />}>
              {sincronizando ? 'Sincronizando…' : 'Sincronizar con Obuma'}
            </Boton>
            <button onClick={onCerrar} aria-label="Cerrar" className="w-8 h-8 rounded-lg flex items-center justify-center text-tinta-3 hover:bg-slate-100 hover:text-tinta dark:hover:bg-slate-800"><X size={18} /></button>
          </div>
        </div>

        {!c && !error && (
          <div className="p-5 space-y-3" aria-label="Armando la comparación">
            <div className="grid grid-cols-3 gap-3">{[0, 1, 2].map(i => <Esqueleto key={i} className="h-[76px] rounded-2xl" />)}</div>
            <div className="grid grid-cols-1 @4xl:grid-cols-3 gap-3">{[0, 1, 2].map(i => <Esqueleto key={i} className="h-56 rounded-2xl" />)}</div>
          </div>
        )}
        {error && <div className="p-8 text-[13px] text-urgente">{error}</div>}

        {c && (
          <div className="p-5 space-y-3">
            <div className="grid grid-cols-3 gap-3" data-testid="comparar-oc-resumen">
              {[
                ['Cotización elegida', c.cotizaciones.length ? cotNeto : null, null],
                ['OC en Obuma', c.oc.neto, c.cotizaciones.length ? cotNeto : null],
                ['Facturado', factOk.length ? factNeto : null, c.oc.neto],
              ].map(([n, v, base]) => (
                <div key={n as string} className="rounded-2xl border border-linea bg-white px-4 py-3 shadow-tarjeta dark:bg-slate-900 dark:border-slate-800">
                  <p className="text-[11px] text-tinta-2 dark:text-slate-400">{n as string}</p>
                  <p className="mt-0.5 text-[22px] leading-tight font-semibold tracking-tight text-tinta tabular-nums dark:text-slate-50">
                    {v == null ? (n === 'Facturado' && buscandoFactura ? <span className="text-[13px] font-medium text-tinta-3">buscando en Obuma…</span> : '—') : fmt(v as number)}
                    <Cambio ahora={v as number | null} antes={base as number | null} umbral={0.0001} />
                  </p>
                </div>
              ))}
            </div>
            {c.avisos.length > 0 && !buscandoFactura && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-2.5 dark:bg-amber-950/30 dark:border-amber-900">
                <p className="text-[12.5px] font-semibold text-alerta flex items-center gap-1.5"><Alerta size={14} /> Para revisar</p>
                <ul className="mt-1 list-disc pl-5 text-[12.5px] text-amber-900 space-y-0.5 dark:text-amber-200">{c.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>
              </div>
            )}

            <div className="grid grid-cols-1 @4xl:grid-cols-3 gap-3 items-start">
              {/* 1 · COTIZACIÓN */}
              <Panel paso={1} titulo="Cotización del plan">
                {c.cotizaciones.length === 0 && <p className="text-tinta-3">Sin cotización asociada a esta OC.</p>}
                {c.cotizaciones.map(q => (
                  <div key={q.id} className="space-y-2">
                    <div>
                      <p className="font-semibold text-tinta dark:text-slate-100">{q.proveedor} <span className="font-normal text-tinta-3">· #{q.id} · {q.origen}{q.fecha ? ` · ${fecha(q.fecha)}` : ''}</span></p>
                      <p className="text-[12px] text-tinta-3">{[q.plazo ? `plazo: ${q.plazo}` : null, q.flete].filter(Boolean).join(' · ') || 'sin plazo ni flete indicado'}</p>
                      {q.archivoUrl ? (
                        <div className="flex items-center gap-3 mt-1">
                          <button onClick={() => setVerArchivo(v => v === q.id ? null : q.id)} className="inline-flex items-center gap-1 text-[12px] font-medium text-marca hover:text-marca-fuerte"><Doc size={13} /> {verArchivo === q.id ? 'Ocultar documento' : 'Ver el documento aquí'}</button>
                          <a href={q.archivoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] font-medium text-tinta-2 hover:text-tinta"><Ext size={12} /> Abrir</a>
                        </div>
                      ) : <p className="text-[12px] text-tinta-3 mt-1">Sin documento (cotización ingresada a mano / compra directa).</p>}
                    </div>
                    {q.archivoUrl && verArchivo === q.id && <iframe src={q.archivoUrl} title={`Cotización ${q.id}`} className="w-full h-[460px] rounded-lg border border-linea bg-white" />}
                    <table className="w-full border-collapse">
                      <thead><tr className="text-left"><th className={TH}>Producto</th><th className={`${TH} text-right`}>Cant.</th><th className={`${TH} text-right`}>P. unit.</th><th className={`${TH} text-right`}>Subtotal</th></tr></thead>
                      <tbody>
                        {q.lineas.map((l, i) => (
                          <tr key={i} className={FILA}>
                            <td className="py-1.5 pr-2 text-tinta dark:text-slate-200">{l.producto}{l.adicionales.map((a, j) => <span key={j} className="block text-[11px] text-tinta-3">+ {a.concepto} ({a.cantidad} × {fmt(a.precio)})</span>)}</td>
                            <td className="py-1.5 pl-3 text-right tabular-nums whitespace-nowrap">{l.cantidad ?? '—'}</td>
                            <td className="py-1.5 pl-3 text-right tabular-nums whitespace-nowrap">{fmt(l.precioUnit)}</td>
                            <td className="py-1.5 pl-3 text-right tabular-nums whitespace-nowrap font-semibold text-tinta dark:text-slate-100">{fmt(l.subtotal)}</td>
                          </tr>
                        ))}
                        {q.fleteNeto != null && <tr className={FILA}><td className="py-1.5" colSpan={3}>Flete cobrado aparte</td><td className="py-1.5 pl-3 text-right tabular-nums whitespace-nowrap font-semibold">{fmt(q.fleteNeto)}</td></tr>}
                      </tbody>
                      <tfoot><tr className={PIE}><td className="py-1.5" colSpan={3}>Neto</td><td className="py-1.5 pl-3 text-right tabular-nums whitespace-nowrap">{fmt(q.neto + (q.fleteNeto ?? 0))}</td></tr></tfoot>
                    </table>
                  </div>
                ))}
              </Panel>

              {/* 2 · OC DE OBUMA */}
              <Panel paso={2} titulo="Orden de compra en Obuma">
                <div>
                  <p className="font-semibold text-tinta dark:text-slate-100 flex items-center gap-2.5">OC {c.oc.folio} <span className="text-[12px] font-medium text-tinta-2"><Estado color={colorEstadoOc(c.oc.estado)}>{estadoLegible(c.oc.estado)}</Estado></span></p>
                  <p className="text-[12px] text-tinta-3">{c.oc.proveedor}{c.oc.rut ? ` · ${c.oc.rut}` : ''} · {fecha(c.oc.fecha)}</p>
                  <p className="text-[12px] text-tinta-3">Referencia: {c.oc.referencia || '—'}</p>
                  <a href={c.oc.urlObuma} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 mt-1 text-[12px] font-medium text-marca hover:text-marca-fuerte"><Ext size={12} /> Abrir en Obuma <span className="font-normal text-tinta-3">(pide sesión en Obuma)</span></a>
                </div>
                <table className="w-full border-collapse">
                  <thead><tr className="text-left"><th className={TH}>Producto</th><th className={`${TH} text-right`}>Cant.</th><th className={`${TH} text-right`}>P. unit.</th><th className={`${TH} text-right`}>Subtotal</th></tr></thead>
                  <tbody>
                    {c.oc.lineas.map((l, i) => (
                      <tr key={i} className={FILA}>
                        <td className="py-1.5 pr-2 text-tinta dark:text-slate-200">{l.producto.length > 90 ? `${l.producto.slice(0, 90)}…` : l.producto}{l.sku && <span className="block text-[11px] font-medium text-tinta-2 tabular-nums">SKU {l.sku}</span>}</td>
                        <td className="py-1.5 pl-3 text-right tabular-nums whitespace-nowrap">{l.cantidad ?? '—'}</td>
                        <td className="py-1.5 pl-3 text-right tabular-nums whitespace-nowrap">{fmt(l.precio)}<Cambio ahora={l.precio} antes={precioCotizado(l.cantidad, l.precio)} /></td>
                        <td className="py-1.5 pl-3 text-right tabular-nums whitespace-nowrap font-semibold text-tinta dark:text-slate-100">{fmt(l.subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className={PIE}><td className="py-1.5" colSpan={3}>Neto</td><td className="py-1.5 pl-3 text-right tabular-nums whitespace-nowrap">{fmt(c.oc.neto)}</td></tr>
                    <tr className="text-tinta-3"><td className="py-0.5" colSpan={3}>IVA</td><td className="py-0.5 pl-3 text-right tabular-nums whitespace-nowrap">{fmt(c.oc.iva)}</td></tr>
                    <tr className="text-tinta-3"><td className="py-0.5" colSpan={3}>Total</td><td className="py-0.5 pl-3 text-right tabular-nums whitespace-nowrap">{fmt(c.oc.total)}</td></tr>
                  </tfoot>
                </table>
              </Panel>

              {/* 3 · FACTURA */}
              <Panel paso={3} titulo="Factura">
                {c.facturas.length === 0 && (buscandoFactura
                  ? <p className="flex items-center gap-2 text-tinta-2"><Loader2 size={14} className="animate-spin text-tinta-3" /> Obuma la marca facturada: trayendo la factura…</p>
                  : <div className="space-y-2">
                      <p className="text-tinta-3">Todavía no hay factura enlazada a esta OC.</p>
                      {/facturad/i.test(c.oc.estado || '') && <p className="text-[12px] text-alerta">Obuma la marca facturada pero no entregó la factura. Revisa el enlace de la factura en la OC de Obuma y vuelve a sincronizar.</p>}
                    </div>)}
                {c.facturas.map(f => (
                  <div key={f.dteId} className={`space-y-1.5 ${f.estado !== 'OK' ? 'rounded-xl border border-amber-200 bg-amber-50/50 p-2.5 dark:bg-amber-950/30 dark:border-amber-900' : ''}`}>
                    <p className="font-semibold text-tinta dark:text-slate-100">{f.emisor || 'Emisor'} <span className="font-normal text-tinta-3">· folio {f.folio} · {fecha(f.fecha)}</span></p>
                    {f.estado !== 'OK' && <p className="text-[12px] font-medium text-alerta flex items-start gap-1"><Alerta size={13} className="mt-0.5 flex-shrink-0" /> No se suma: {f.motivo}</p>}
                    {f.lineas.length > 0 ? (
                      <table className="w-full border-collapse">
                        <thead><tr className="text-left"><th className={TH}>Detalle</th><th className={`${TH} text-right`}>Cant.</th><th className={`${TH} text-right`}>P. unit.</th><th className={`${TH} text-right`}>Monto</th></tr></thead>
                        <tbody>
                          {f.lineas.map((l, i) => (
                            <tr key={i} className={FILA}>
                              <td className="py-1.5 pr-2 text-tinta dark:text-slate-200">{l.descripcion.length > 90 ? `${l.descripcion.slice(0, 90)}…` : l.descripcion}</td>
                              <td className="py-1.5 pl-3 text-right tabular-nums whitespace-nowrap">{l.cantidad ?? '—'}</td>
                              <td className="py-1.5 pl-3 text-right tabular-nums whitespace-nowrap">{fmt(l.precio)}<Cambio ahora={l.precio} antes={precioOc(l.cantidad, l.precio)} /></td>
                              <td className="py-1.5 pl-3 text-right tabular-nums whitespace-nowrap font-semibold text-tinta dark:text-slate-100">{fmt(l.monto)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className={PIE}><td className="py-1.5" colSpan={3}>Neto</td><td className="py-1.5 pl-3 text-right tabular-nums whitespace-nowrap">{fmt(f.neto)}</td></tr>
                          <tr className="text-tinta-3"><td className="py-0.5" colSpan={3}>IVA</td><td className="py-0.5 pl-3 text-right tabular-nums whitespace-nowrap">{fmt(f.iva)}</td></tr>
                          <tr className="text-tinta-3"><td className="py-0.5" colSpan={3}>Total</td><td className="py-0.5 pl-3 text-right tabular-nums whitespace-nowrap">{fmt(f.total)}</td></tr>
                        </tfoot>
                      </table>
                    ) : <p className="text-tinta-2">No se pudo leer el detalle del XML. Total: <b className="text-tinta dark:text-slate-100">{fmt(f.total)}</b></p>}
                    {f.xmlUrl && <a href={f.xmlUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] font-medium text-marca hover:text-marca-fuerte"><Ext size={12} /> XML original</a>}
                  </div>
                ))}
              </Panel>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
