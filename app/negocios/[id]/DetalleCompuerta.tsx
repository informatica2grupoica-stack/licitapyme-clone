'use client';

// «LO QUE ESTÁS APROBANDO»: bajo cada compuerta (compra / margen) el jefe de ventas ve en concreto qué firma —
// a quién se compra, cuánto, con qué diferencia frente a lo costeado, qué líneas tienen problemas— sin tener que
// subir a la tabla. Solo lee `/aprobaciones/tabla`; no decide nada.
import { useEffect, useState } from 'react';
import type { TablaAprobacion, LineaAprobacion } from '@/app/lib/compras-aprobacion-tabla';

const clp = (n: number | null | undefined) => n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
const corto = (d: string) => d.split(' - ')[0];
const signo = (n: number) => `${n > 0 ? '+' : ''}${clp(n)}`;

export function DetalleCompuerta({ negocioId, tipo, refresco }: { negocioId: number; tipo: 'COMPRA' | 'MARGEN'; refresco: string }) {
  const [tabla, setTabla] = useState<TablaAprobacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelado = false;
    fetch(`/api/compras/${negocioId}/aprobaciones/tabla`).then(r => r.json())
      .then(d => { if (cancelado) return; if (d.success) { setTabla(d.tabla); setError(null); } else setError(d.error || 'No se pudo cargar'); })
      .catch(e => { if (!cancelado) setError(e.message || 'No se pudo cargar'); });
    return () => { cancelado = true; };
  }, [negocioId, refresco]);

  if (error) return <p className="text-[11.5px] text-rose-700">No se pudo armar el detalle de lo que se aprueba ({error}). No apruebes sin verlo: recarga la pantalla.</p>;
  if (!tabla) return <p className="text-[11.5px] text-zinc-400">Armando el detalle de lo que se aprueba…</p>;
  return tipo === 'COMPRA' ? <DetalleCompra tabla={tabla} /> : <DetalleMargen tabla={tabla} />;
}

function Titulo({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-500 mb-1">{children}</p>;
}

function DetalleCompra({ tabla }: { tabla: TablaAprobacion }) {
  const t = tabla.totales;
  const conCompra = tabla.lineas.filter(l => l.compraUnit != null);
  const sinCompra = tabla.lineas.filter(l => l.compraUnit == null);
  const porProv = new Map<string, LineaAprobacion[]>();
  conCompra.forEach(l => { const k = l.proveedor || 'Sin nombre'; porProv.set(k, [...(porProv.get(k) || []), l]); });
  const problemas = tabla.lineas.filter(l => l.estado !== 'PASA');
  const dif = t.compra - t.costeado;
  return (
    <div className="space-y-2.5 text-[12px] text-zinc-700" data-testid="detalle-compra">
      <p className="text-[12.5px] font-bold text-zinc-800">Estás aprobando gastar {clp(t.compra + t.flete)} en {conCompra.length} de {t.lineasTotal} productos</p>
      <ul className="space-y-0.5">
        <li>Mercadería: <b>{clp(t.compra)}</b> · Flete: <b>{t.flete > 0 ? clp(t.flete) : 'sin flete'}</b>{t.fleteSinConfirmar && <span className="text-amber-700"> (flete sin confirmar)</span>}</li>
        <li>Se había costeado al ofertar: <b>{clp(t.costeado)}</b> → la compra queda <b className={dif > 0 ? 'text-rose-600' : 'text-emerald-700'}>{signo(dif)} ({dif > 0 ? 'sobre' : 'bajo'} lo costeado)</b> (mercadería)</li>
        <li>El cliente paga por todo: <b>{clp(t.venta)}</b></li>
      </ul>
      <div>
        <Titulo>A quién se compra</Titulo>
        {porProv.size === 0 ? <p className="text-rose-600 font-semibold">Ninguna línea tiene proveedor elegido todavía.</p> : (
          <div className="space-y-1.5">
            {[...porProv.entries()].map(([prov, ls]) => (
              <div key={prov} className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5">
                <p className="font-bold text-zinc-800">{prov} <span className="font-semibold text-zinc-500">· {clp(ls.reduce((a, l) => a + (l.compraTotal || 0), 0))} · {ls.length} producto(s)</span></p>
                <ul className="mt-0.5 space-y-0.5">
                  {ls.map(l => (
                    <li key={l.productoId} className="text-[11.5px] text-zinc-600 leading-snug">
                      • {l.cantidad ?? '?'} × {corto(l.descripcion)} — {clp(l.compraUnit)} c/u = <b>{clp(l.compraTotal)}</b>
                      {l.difPct != null && <span className={l.difPct > 0 ? 'text-rose-600' : 'text-emerald-700'}> ({l.difPct > 0 ? '+' : ''}{l.difPct}% vs costeado)</span>}
                      {l.plazoDias != null && <span className="text-zinc-400"> · entrega {l.plazoDias} d</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
      {sinCompra.length > 0 && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5">
          <p className="font-bold text-rose-700">{sinCompra.length} producto(s) NO están incluidos en esta compra (sin proveedor elegido):</p>
          <ul className="text-[11.5px] text-rose-800">{sinCompra.map(l => <li key={l.productoId}>• {l.cantidad ?? '?'} × {corto(l.descripcion)}</li>)}</ul>
        </div>
      )}
      {problemas.filter(l => l.compraUnit != null).length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5">
          <p className="font-bold text-amber-800">Observaciones a mirar antes de aprobar:</p>
          <ul className="text-[11.5px] text-amber-900">
            {problemas.filter(l => l.compraUnit != null).map(l => <li key={l.productoId}>• <b>{corto(l.descripcion)}:</b> {l.motivos.join('; ')}</li>)}
          </ul>
        </div>
      )}
      {problemas.length === 0 && <p className="text-emerald-700 font-semibold">✔ Todas las líneas pasan la revisión automática.</p>}
    </div>
  );
}

function DetalleMargen({ tabla }: { tabla: TablaAprobacion }) {
  const t = tabla.totales;
  const costoCompra = t.compra + t.flete;
  const estimado = tabla.lineas.filter(l => l.compraUnit == null).reduce((a, l) => a + (l.costeadoTotal || 0), 0);
  const costo = costoCompra + estimado;
  const ganancia = t.venta - costo;
  const peores = tabla.lineas.filter(l => l.margenLineaPct != null).sort((a, b) => (a.margenLineaPct! - b.margenLineaPct!)).slice(0, 5);
  return (
    <div className="space-y-2.5 text-[12px] text-zinc-700" data-testid="detalle-margen">
      <p className="text-[12.5px] font-bold text-zinc-800">
        Estás aprobando una ganancia de {clp(ganancia)}{t.margenCompletoPct != null && <> ({t.margenCompletoPct} % de la venta)</>}
      </p>
      <ul className="space-y-0.5">
        <li>El cliente paga (neto): <b>{clp(t.venta)}</b></li>
        <li>Mercadería a comprar: <b>{clp(t.compra)}</b> · Flete: <b>{t.flete > 0 ? clp(t.flete) : 'sin flete'}</b>{t.fleteSinConfirmar && <span className="text-amber-700"> (flete sin confirmar)</span>}</li>
        {estimado > 0 && <li className="text-amber-800">Costo ESTIMADO de {t.lineasSinCompra} línea(s) sin compra: <b>{clp(estimado)}</b> (usa el costeo, no una cotización real)</li>}
        <li>Costo total considerado: <b>{clp(costo)}</b> → ganancia <b>{clp(ganancia)}</b></li>
        <li>Margen mínimo exigido: <b>20 %</b> {t.margenCompletoPct != null && (t.margenCompletoPct >= 20 ? <span className="text-emerald-700 font-semibold">✔ lo cumple</span> : <span className="text-rose-600 font-semibold">✖ no lo cumple</span>)}</li>
      </ul>
      {peores.length > 0 && (
        <div>
          <Titulo>Líneas con menor margen</Titulo>
          <ul className="space-y-0.5">
            {peores.map(l => (
              <li key={l.productoId} className="text-[11.5px] text-zinc-600 leading-snug">
                • {corto(l.descripcion)} — vende {clp(l.ventaUnit)}, compra {clp(l.compraUnit)} → <b className={l.margenLineaPct! < 20 ? 'text-amber-700' : 'text-zinc-800'}>{l.margenLineaPct}%</b>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
