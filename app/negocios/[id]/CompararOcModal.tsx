'use client';

// COMPARACIÓN VISUAL DE UNA OC: cotización del plan · OC de Obuma · factura, lado a lado y todo NETO.
// Solo lectura (lee /comparar-oc). Marca con color donde un precio cambia entre una columna y la siguiente.
import { useEffect, useState } from 'react';
import { IconX as X, IconLoader2 as Loader2, IconExternalLink as Ext, IconAlertTriangle as Alerta, IconFileText as Doc } from '@tabler/icons-react';
import type { ComparacionOc } from '@/app/lib/compras-comparar-oc';

const fmt = (n: number | null | undefined) => n == null ? '—'
  : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
const fecha = (f: string | null) => f ? f.slice(0, 10).split('-').reverse().join('-') : '—';

/** Cuánto cambió un precio contra el de la columna anterior (≥1 %): rojo si es más caro, verde si es más barato. */
function Cambio({ ahora, antes, umbral = 0.01 }: { ahora: number | null; antes: number | null; umbral?: number }) {
  if (ahora == null || antes == null || antes === 0) return null;
  const pct = (ahora - antes) / antes;
  if (Math.abs(pct) < umbral || Math.abs(ahora - antes) < 2) return null;
  return <span className={`ml-1 text-[10.5px] font-semibold ${pct > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>({pct > 0 ? '+' : '−'}{fmt(Math.abs(Math.round(ahora - antes)))})</span>;
}

function Panel({ titulo, color, children }: { titulo: string; color: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden flex flex-col min-w-0">
      <p className={`px-3 py-2 text-[11px] font-bold uppercase tracking-wide border-b border-zinc-100 ${color}`}>{titulo}</p>
      <div className="p-3 space-y-3 text-[12px] text-zinc-700">{children}</div>
    </div>
  );
}

export function CompararOcModal({ negocioId, ocFolio, onCerrar }: { negocioId: number; ocFolio: string; onCerrar: () => void }) {
  const [c, setC] = useState<ComparacionOc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verArchivo, setVerArchivo] = useState<number | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/compras/${negocioId}/comparar-oc?oc=${encodeURIComponent(ocFolio)}`)
      .then(async r => ({ ok: r.ok, j: await r.json().catch(() => ({})) }))
      .then(({ ok, j }) => { if (!vivo) return; if (ok && j.comparacion) setC(j.comparacion); else setError(j.error || 'No se pudo armar la comparación.'); })
      .catch(() => vivo && setError('No se pudo armar la comparación.'));
    return () => { vivo = false; };
  }, [negocioId, ocFolio]);

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

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-start justify-center overflow-y-auto p-3" onClick={onCerrar} data-testid="comparar-oc">
      <div className="bg-zinc-50 rounded-xl shadow-xl w-full max-w-[1500px] my-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-zinc-200 bg-white rounded-t-xl">
          <p className="text-[14px] font-bold text-zinc-800">
            Comparar · OC {ocFolio}{c?.oc.proveedor ? ` · ${c.oc.proveedor}` : ''} <span className="font-medium text-zinc-400">· todo neto</span>
          </p>
          <button onClick={onCerrar} aria-label="Cerrar" className="text-zinc-500 hover:text-zinc-900"><X size={18} /></button>
        </div>

        {!c && !error && <div className="p-12 flex items-center justify-center gap-2 text-[13px] text-zinc-500"><Loader2 size={16} className="animate-spin" /> Armando la comparación (leyendo las facturas)…</div>}
        {error && <div className="p-8 text-[13px] text-rose-700">{error}</div>}

        {c && (
          <div className="p-4 space-y-3">
            <div className="grid grid-cols-3 gap-2" data-testid="comparar-oc-resumen">
              {[
                ['Cotización (plan)', c.cotizaciones.length ? cotNeto : null, null],
                ['OC en Obuma', c.oc.neto, c.cotizaciones.length ? cotNeto : null],
                ['Facturado', factOk.length ? factNeto : null, c.oc.neto],
              ].map(([n, v, base]) => (
                <div key={n as string} className="rounded-lg border border-zinc-200 bg-white px-3 py-2">
                  <p className="text-[10.5px] font-semibold text-zinc-500 uppercase tracking-wide">{n as string}</p>
                  <p className="text-[15px] font-bold text-zinc-800 tabular-nums">{v == null ? '—' : fmt(v as number)}<Cambio ahora={v as number | null} antes={base as number | null} umbral={0.0001} /></p>
                </div>
              ))}
            </div>
            {c.avisos.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2">
                <p className="text-[12px] font-bold text-amber-900 flex items-center gap-1.5"><Alerta size={14} /> Para revisar</p>
                <ul className="mt-1 list-disc pl-5 text-[12px] text-amber-900 space-y-0.5">{c.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
              {/* 1 · COTIZACIÓN */}
              <Panel titulo="1 · Cotización del plan" color="bg-indigo-50 text-indigo-800">
                {c.cotizaciones.length === 0 && <p className="text-zinc-400">Sin cotización asociada a esta OC.</p>}
                {c.cotizaciones.map(q => (
                  <div key={q.id} className="space-y-2">
                    <div>
                      <p className="font-bold text-zinc-800">{q.proveedor} <span className="font-normal text-zinc-400">· #{q.id} · {q.origen}{q.fecha ? ` · ${fecha(q.fecha)}` : ''}</span></p>
                      <p className="text-[11px] text-zinc-500">{[q.plazo ? `plazo: ${q.plazo}` : null, q.flete].filter(Boolean).join(' · ') || 'sin plazo ni flete indicado'}</p>
                      {q.archivoUrl ? (
                        <div className="flex items-center gap-3 mt-1">
                          <button onClick={() => setVerArchivo(v => v === q.id ? null : q.id)} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-indigo-700 hover:text-indigo-900"><Doc size={13} /> {verArchivo === q.id ? 'Ocultar documento' : 'Ver el documento aquí'}</button>
                          <a href={q.archivoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-zinc-500 hover:text-zinc-800"><Ext size={12} /> Abrir</a>
                        </div>
                      ) : <p className="text-[11px] text-zinc-400 mt-1">Sin documento (cotización ingresada a mano / compra directa).</p>}
                    </div>
                    {q.archivoUrl && verArchivo === q.id && <iframe src={q.archivoUrl} title={`Cotización ${q.id}`} className="w-full h-[460px] rounded-lg border border-zinc-200 bg-white" />}
                    <table className="w-full border-collapse">
                      <thead><tr className="text-left text-[10px] uppercase tracking-wide text-zinc-400"><th className="py-1 font-semibold">Producto</th><th className="py-1 font-semibold text-right">Cant.</th><th className="py-1 font-semibold text-right">P. unit.</th><th className="py-1 font-semibold text-right">Subtotal</th></tr></thead>
                      <tbody>
                        {q.lineas.map((l, i) => (
                          <tr key={i} className="border-t border-zinc-100 align-top">
                            <td className="py-1 pr-2">{l.producto}{l.adicionales.map((a, j) => <span key={j} className="block text-[10.5px] text-zinc-400">+ {a.concepto} ({a.cantidad} × {fmt(a.precio)})</span>)}</td>
                            <td className="py-1 pl-3 text-right tabular-nums whitespace-nowrap">{l.cantidad ?? '—'}</td>
                            <td className="py-1 pl-3 text-right tabular-nums whitespace-nowrap">{fmt(l.precioUnit)}</td>
                            <td className="py-1 pl-3 text-right tabular-nums whitespace-nowrap font-semibold">{fmt(l.subtotal)}</td>
                          </tr>
                        ))}
                        {q.fleteNeto != null && <tr className="border-t border-zinc-100"><td className="py-1" colSpan={3}>Flete cobrado aparte</td><td className="py-1 pl-3 text-right tabular-nums whitespace-nowrap font-semibold">{fmt(q.fleteNeto)}</td></tr>}
                      </tbody>
                      <tfoot><tr className="border-t border-zinc-300 font-bold text-zinc-800"><td className="py-1" colSpan={3}>Neto</td><td className="py-1 pl-3 text-right tabular-nums whitespace-nowrap">{fmt(q.neto + (q.fleteNeto ?? 0))}</td></tr></tfoot>
                    </table>
                  </div>
                ))}
              </Panel>

              {/* 2 · OC DE OBUMA */}
              <Panel titulo="2 · Orden de compra en Obuma" color="bg-sky-50 text-sky-800">
                <div>
                  <p className="font-bold text-zinc-800">OC {c.oc.folio} <span className="ml-1 text-[10.5px] font-semibold text-sky-700 bg-sky-50 border border-sky-200 px-1.5 py-0.5 rounded-full">{c.oc.estado || '—'}</span></p>
                  <p className="text-[11px] text-zinc-500">{c.oc.proveedor}{c.oc.rut ? ` · ${c.oc.rut}` : ''} · {fecha(c.oc.fecha)}</p>
                  <p className="text-[11px] text-zinc-400">Referencia: {c.oc.referencia || '—'}</p>
                  <a href={c.oc.urlObuma} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 mt-1 text-[11.5px] font-semibold text-sky-700 hover:text-sky-900"><Ext size={12} /> Abrir en Obuma <span className="font-normal text-zinc-400">(pide sesión en Obuma)</span></a>
                </div>
                <table className="w-full border-collapse">
                  <thead><tr className="text-left text-[10px] uppercase tracking-wide text-zinc-400"><th className="py-1 font-semibold">Producto</th><th className="py-1 font-semibold text-right">Cant.</th><th className="py-1 font-semibold text-right">P. unit.</th><th className="py-1 font-semibold text-right">Subtotal</th></tr></thead>
                  <tbody>
                    {c.oc.lineas.map((l, i) => (
                      <tr key={i} className="border-t border-zinc-100 align-top">
                        <td className="py-1 pr-2">{l.producto.length > 90 ? `${l.producto.slice(0, 90)}…` : l.producto}{l.sku && <span className="block text-[10.5px] font-semibold text-indigo-600">SKU {l.sku}</span>}</td>
                        <td className="py-1 pl-3 text-right tabular-nums whitespace-nowrap">{l.cantidad ?? '—'}</td>
                        <td className="py-1 pl-3 text-right tabular-nums whitespace-nowrap">{fmt(l.precio)}<Cambio ahora={l.precio} antes={precioCotizado(l.cantidad, l.precio)} /></td>
                        <td className="py-1 pl-3 text-right tabular-nums whitespace-nowrap font-semibold">{fmt(l.subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-zinc-300 font-bold text-zinc-800"><td className="py-1" colSpan={3}>Neto</td><td className="py-1 pl-3 text-right tabular-nums whitespace-nowrap">{fmt(c.oc.neto)}</td></tr>
                    <tr className="text-zinc-500"><td className="py-0.5" colSpan={3}>IVA</td><td className="py-0.5 pl-3 text-right tabular-nums whitespace-nowrap">{fmt(c.oc.iva)}</td></tr>
                    <tr className="text-zinc-500"><td className="py-0.5" colSpan={3}>Total</td><td className="py-0.5 pl-3 text-right tabular-nums whitespace-nowrap">{fmt(c.oc.total)}</td></tr>
                  </tfoot>
                </table>
              </Panel>

              {/* 3 · FACTURA */}
              <Panel titulo="3 · Factura" color="bg-emerald-50 text-emerald-800">
                {c.facturas.length === 0 && <p className="text-zinc-400">Todavía no hay factura enlazada a esta OC.</p>}
                {c.facturas.map(f => (
                  <div key={f.dteId} className={`space-y-1.5 ${f.estado !== 'OK' ? 'rounded-lg border border-amber-200 bg-amber-50/50 p-2' : ''}`}>
                    <p className="font-bold text-zinc-800">{f.emisor || 'Emisor'} <span className="font-normal text-zinc-400">· folio {f.folio} · {fecha(f.fecha)}</span></p>
                    {f.estado !== 'OK' && <p className="text-[11.5px] font-semibold text-amber-800">⚠ {f.estado === 'DUPLICADA' ? 'No se suma: ' : 'No se suma: '}{f.motivo}</p>}
                    {f.lineas.length > 0 ? (
                      <table className="w-full border-collapse">
                        <thead><tr className="text-left text-[10px] uppercase tracking-wide text-zinc-400"><th className="py-1 font-semibold">Detalle</th><th className="py-1 font-semibold text-right">Cant.</th><th className="py-1 font-semibold text-right">P. unit.</th><th className="py-1 font-semibold text-right">Monto</th></tr></thead>
                        <tbody>
                          {f.lineas.map((l, i) => (
                            <tr key={i} className="border-t border-zinc-100 align-top">
                              <td className="py-1 pr-2">{l.descripcion.length > 90 ? `${l.descripcion.slice(0, 90)}…` : l.descripcion}</td>
                              <td className="py-1 pl-3 text-right tabular-nums whitespace-nowrap">{l.cantidad ?? '—'}</td>
                              <td className="py-1 pl-3 text-right tabular-nums whitespace-nowrap">{fmt(l.precio)}<Cambio ahora={l.precio} antes={precioOc(l.cantidad, l.precio)} /></td>
                              <td className="py-1 pl-3 text-right tabular-nums whitespace-nowrap font-semibold">{fmt(l.monto)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-zinc-300 font-bold text-zinc-800"><td className="py-1" colSpan={3}>Neto</td><td className="py-1 pl-3 text-right tabular-nums whitespace-nowrap">{fmt(f.neto)}</td></tr>
                          <tr className="text-zinc-500"><td className="py-0.5" colSpan={3}>IVA</td><td className="py-0.5 pl-3 text-right tabular-nums whitespace-nowrap">{fmt(f.iva)}</td></tr>
                          <tr className="text-zinc-500"><td className="py-0.5" colSpan={3}>Total</td><td className="py-0.5 pl-3 text-right tabular-nums whitespace-nowrap">{fmt(f.total)}</td></tr>
                        </tfoot>
                      </table>
                    ) : <p className="text-zinc-500">No se pudo leer el detalle del XML. Total: <b>{fmt(f.total)}</b></p>}
                    {f.xmlUrl && <a href={f.xmlUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-emerald-700 hover:text-emerald-900"><Ext size={12} /> XML original</a>}
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
