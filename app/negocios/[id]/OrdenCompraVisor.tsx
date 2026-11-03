'use client';

// «Ver OC»: el PDF de la orden de compra de Obuma, con la misma plantilla de Obuma (la arma Licitank con los datos guardados:
// Obuma no entrega el PDF por API). Se ve aquí mismo, se imprime y se descarga.
import { useCerrarConEsc } from '@/app/lib/use-cerrar-con-esc';
import { useEffect, useRef, useState } from 'react';
import { IconX as X, IconLoader2 as Loader2, IconPrinter as Printer, IconDownload as Download } from '@tabler/icons-react';

export function OrdenCompraVisor({ negocioId, folio, onCerrar }: { negocioId: number; folio: string; onCerrar: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const marco = useRef<HTMLIFrameElement>(null);
  const base = `/api/compras/${negocioId}/orden-compra-obuma/documento?folio=${encodeURIComponent(folio)}`;

  useCerrarConEsc(onCerrar);
  useEffect(() => {
    let vivo = true;
    let objeto: string | null = null;
    fetch(base)
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'No se pudo abrir la orden de compra.');
        return r.blob();
      })
      .then(b => { if (!vivo) return; objeto = URL.createObjectURL(b); setUrl(objeto); })
      .catch(e => vivo && setError(e instanceof Error ? e.message : 'No se pudo abrir la orden de compra.'));
    return () => { vivo = false; if (objeto) URL.revokeObjectURL(objeto); };
  }, [base]);

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" onClick={onCerrar} data-testid="oc-visor">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <p className="text-[13px] font-semibold text-slate-800">Orden de compra {folio}</p>
          <div className="flex items-center gap-4">
            {url && <button onClick={() => marco.current?.contentWindow?.print()} className="flex items-center gap-1 text-[12px] font-semibold text-slate-600 hover:text-slate-900"><Printer size={14} /> Imprimir</button>}
            <a href={`${base}&descargar=1`} className="flex items-center gap-1 text-[12px] font-semibold text-teal-700 hover:text-teal-900"><Download size={14} /> Descargar PDF</a>
            <button onClick={onCerrar} aria-label="Cerrar" className="text-slate-500 hover:text-slate-900"><X size={18} /></button>
          </div>
        </div>
        {!url && !error && <div className="flex-1 flex items-center justify-center gap-2 text-[13px] text-slate-500"><Loader2 size={16} className="animate-spin" /> Armando la orden…</div>}
        {error && <div className="p-8 text-[13px] text-rose-700">{error}</div>}
        {url && <iframe ref={marco} src={url} title={`Orden de compra ${folio}`} className="flex-1 w-full rounded-b-xl" />}
      </div>
    </div>
  );
}
