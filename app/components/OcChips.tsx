'use client';

// N° de orden de compra NUESTRA con botón "Ver": abre el PDF de la OC en el visor de la plataforma
// (DocumentViewerModal), sin mandar al usuario a Mercado Público. Si el cron diario todavía no bajó el
// PDF, el primer clic lo pide al toque (POST /api/ordenes-compra/pdf, el mismo que usa la sección Resultado).
// Se usa en Ganadas/Perdidas y en Postuladas.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { DocumentViewerModal, type VisorDoc } from '@/app/components/DocumentViewerModal';
import { IconEye as Eye, IconLoader2 as Loader2 } from '@tabler/icons-react';

function ChipOc({ codigo }: { codigo: string }) {
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<VisorDoc | null>(null);

  const ver = async (e: React.MouseEvent) => {
    e.stopPropagation();   // el chip vive dentro de filas/tarjetas que se expanden al hacer clic
    if (cargando) return;
    setCargando(true);
    setError(null);
    try {
      const r = await fetch('/api/ordenes-compra/pdf', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigoOC: codigo }),
      });
      const d = await r.json().catch(() => null);
      if (d?.success && d.url) setDoc({ nombre: `OC ${codigo}.pdf`, url: d.url });
      else setError(d?.error || 'No se pudo cargar la OC');
    } catch {
      setError('No se pudo cargar la OC');
    } finally {
      setCargando(false);
    }
  };

  return (
    <>
      <button type="button" onClick={ver} onKeyDown={e => e.stopPropagation()} disabled={cargando}
        title={error ? `${error} — clic para reintentar` : `Ver la orden de compra ${codigo}`}
        className={`inline-flex items-center gap-1 text-[10.5px] font-mono font-semibold border rounded-full pl-2 pr-1.5 py-px transition-colors flex-shrink-0 disabled:opacity-60 ${
          error ? 'text-rose-700 bg-rose-50 border-rose-200 hover:bg-rose-100'
                : 'text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100'}`}>
        OC {codigo}
        <span className="inline-flex items-center gap-0.5 font-sans font-bold">
          {cargando ? <Loader2 size={10} className="animate-spin" /> : <Eye size={11} />}
          {error ? 'Reintentar' : 'Ver'}
        </span>
      </button>
      {/* Portal al body: las tarjetas se transforman al pasar el mouse y eso encerraría un modal fixed. */}
      {doc && typeof document !== 'undefined' && createPortal(
        <div onClick={e => e.stopPropagation()}>
          <DocumentViewerModal doc={doc} onClose={() => setDoc(null)} />
        </div>,
        document.body,
      )}
    </>
  );
}

export function ChipsOc({ codigos }: { codigos?: string[] }) {
  if (!codigos?.length) return null;
  return <>{codigos.map(c => <ChipOc key={c} codigo={c} />)}</>;
}
