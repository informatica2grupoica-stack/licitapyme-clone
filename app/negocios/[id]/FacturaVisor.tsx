'use client';

// Visor de factura de compra: la dibuja Licitank con los datos del XML (emisor, receptor, líneas, totales).
// No es el PDF oficial del SII: es una vista para revisar rápido; el XML original se baja desde el mismo cuadro.
import { useEffect, useState } from 'react';
import { IconX as X, IconLoader2 as Loader2, IconPrinter as Printer, IconFileCode as FileCode } from '@tabler/icons-react';
import type { FacturaLeida } from '@/app/lib/factura-xml';

const fmt = (n: number | null) => n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
const fecha = (f: string | null) => f ? f.slice(0, 10).split('-').reverse().join('-') : '—';

export function FacturaVisor({ negocioId, dteId, onCerrar }: { negocioId: number; dteId: string; onCerrar: () => void }) {
  const [f, setF] = useState<FacturaLeida | null>(null);
  const [xmlUrl, setXmlUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/compras/${negocioId}/factura?dte=${encodeURIComponent(dteId)}`)
      .then(async r => ({ ok: r.ok, j: await r.json().catch(() => ({})) }))
      .then(({ ok, j }) => { if (!vivo) return; if (ok && j.factura) { setF(j.factura); setXmlUrl(j.xmlUrl); } else setError(j.error || 'No se pudo abrir la factura.'); })
      .catch(() => vivo && setError('No se pudo abrir la factura.'));
    return () => { vivo = false; };
  }, [negocioId, dteId]);

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-start justify-center overflow-y-auto p-4 print:bg-white print:p-0" onClick={onCerrar} data-testid="factura-visor">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-6 print:shadow-none print:my-0" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-200 print:hidden">
          <p className="text-[13px] font-bold text-zinc-800">Vista de factura · generada por Licitank desde el XML</p>
          <div className="flex items-center gap-3">
            {f && <button onClick={() => window.print()} className="flex items-center gap-1 text-[12px] font-semibold text-zinc-600 hover:text-zinc-900"><Printer size={14} /> Imprimir</button>}
            {xmlUrl && <a href={xmlUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[12px] font-semibold text-teal-700 hover:text-teal-900"><FileCode size={14} /> XML original</a>}
            <button onClick={onCerrar} aria-label="Cerrar" className="text-zinc-500 hover:text-zinc-900"><X size={18} /></button>
          </div>
        </div>
        {!f && !error && <div className="p-10 flex items-center justify-center gap-2 text-[13px] text-zinc-500"><Loader2 size={16} className="animate-spin" /> Leyendo la factura…</div>}
        {error && <div className="p-8 text-[13px] text-rose-700">{error}</div>}
        {f && (
          <div className="p-6 text-zinc-800">
            <div className="flex flex-wrap gap-5 justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-[18px] font-extrabold leading-tight">{f.emisor.razonSocial}</p>
                {f.emisor.giro && <p className="text-[11.5px] text-zinc-500 mt-0.5">{f.emisor.giro}</p>}
                {f.emisor.direccion && <p className="text-[11.5px] text-zinc-500">{f.emisor.direccion}</p>}
              </div>
              <div className="border-2 border-rose-600 text-rose-700 rounded-md px-5 py-3 text-center min-w-[200px]">
                <p className="text-[12px] font-bold">R.U.T.: {f.emisor.rut}</p>
                <p className="text-[13px] font-extrabold uppercase">{f.tipoNombre}</p>
                <p className="text-[13px] font-extrabold">N° {f.folio}</p>
              </div>
            </div>
            <div className="mt-4 grid sm:grid-cols-2 gap-x-6 gap-y-1 text-[12.5px] border border-zinc-200 rounded-lg p-3">
              <p><span className="text-zinc-500">Señor(es):</span> <b>{f.receptor.razonSocial}</b></p>
              <p><span className="text-zinc-500">Fecha emisión:</span> <b>{fecha(f.fechaEmision)}</b></p>
              <p><span className="text-zinc-500">R.U.T.:</span> {f.receptor.rut}</p>
              <p><span className="text-zinc-500">Vencimiento:</span> {fecha(f.fechaVenc)}</p>
              {f.receptor.direccion && <p className="sm:col-span-2"><span className="text-zinc-500">Dirección:</span> {f.receptor.direccion}</p>}
              {f.receptor.giro && <p className="sm:col-span-2"><span className="text-zinc-500">Giro:</span> {f.receptor.giro}</p>}
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-[12.5px] border-collapse">
                <thead><tr className="bg-zinc-100 text-zinc-600 text-left"><th className="px-2 py-1.5 w-8">N°</th><th className="px-2 py-1.5">Código</th><th className="px-2 py-1.5">Descripción</th><th className="px-2 py-1.5 text-right">Cant.</th><th className="px-2 py-1.5 text-right">Precio</th><th className="px-2 py-1.5 text-right">Total</th></tr></thead>
                <tbody>{f.lineas.map(l => (
                  <tr key={l.n} className="border-b border-zinc-100 align-top"><td className="px-2 py-1.5 text-zinc-400">{l.n}</td><td className="px-2 py-1.5 text-zinc-500">{l.codigo || ''}</td><td className="px-2 py-1.5">{l.descripcion}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{l.cantidad ?? '—'}</td><td className="px-2 py-1.5 text-right tabular-nums">{fmt(l.precio)}</td><td className="px-2 py-1.5 text-right tabular-nums font-semibold">{fmt(l.monto)}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <div className="mt-4 flex justify-end">
              <table className="text-[13px] min-w-[240px]"><tbody>
                {f.totales.neto != null && <tr><td className="pr-6 py-0.5 text-zinc-500">Monto neto</td><td className="text-right tabular-nums">{fmt(f.totales.neto)}</td></tr>}
                {f.totales.exento != null && <tr><td className="pr-6 py-0.5 text-zinc-500">Monto exento</td><td className="text-right tabular-nums">{fmt(f.totales.exento)}</td></tr>}
                {f.totales.iva != null && <tr><td className="pr-6 py-0.5 text-zinc-500">IVA {f.totales.tasaIva ?? 19}%</td><td className="text-right tabular-nums">{fmt(f.totales.iva)}</td></tr>}
                <tr className="border-t border-zinc-300"><td className="pr-6 pt-1 font-bold">Total</td><td className="pt-1 text-right tabular-nums font-extrabold">{fmt(f.totales.total)}</td></tr>
              </tbody></table>
            </div>
            {f.referencias.length > 0 && <p className="mt-4 text-[11.5px] text-zinc-500">Referencias: {f.referencias.map(r => `${r.tipoDoc === '801' ? 'Orden de compra' : `Doc. ${r.tipoDoc}`} ${r.folio}${r.fecha ? ` (${fecha(r.fecha)})` : ''}`).join(' · ')}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
